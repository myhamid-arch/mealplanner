// The recorded agent turn for leaf 1.4.12 G2 (R2-DL-6; leaf-1.4.12 ADR-1, R-84). The verify script
// starts `next start` with `NODE_OPTIONS=--import <this file>`; it fills the model slot
// `agentModel()` reads (apps/web/lib/server/agent.ts, `Symbol.for("mealplanner.web.agentModel")`),
// as 1.4.5's `e2e/chat/agent-stub.mjs` does. Nothing in the app reads this file.
//
// It is a script, not a model. For a request that starts with one of the member page's three
// "Tell the assistant" prompts it answers with fixed `BetaMessage`s: `get_household`, then
// `apply_change` with the op that section's own controls write at the level the test shows it
// (leaf-1.4.12 SPEC-Q-1), then a short text. Only ids are filled in, from the `get_household`
// result. Anything else gets "Noted: <text>".
//   "change <name>'s daily targets: …"                → target.set, default profile (Basic)
//   "change how <name>'s day is split across meals: …" → distribution.set, lunch 40 %, the other
//                                                        rest-day meals rebalanced in proportion
//                                                        to their automatic shares (Detailed)
//   "change <name>'s tastes: …"                        → preference.set, Levantine liked (Detailed)
import { readFileSync } from "node:fs";
import { CUSTOM_SLOT_DEFAULT_WEIGHT, DEFAULT_SLOTS } from "@mealplanner/core/types";

const KEY = Symbol.for("mealplanner.web.agentModel");

/** The recorded values; the spec file reads the same file and asserts them. */
const RECORDED = JSON.parse(readFileSync(new URL("./recorded.json", import.meta.url), "utf8"));

let seq = 0;

function message(content, stop) {
  seq += 1;
  return {
    id: `msg_1412_${String(seq)}`,
    type: "message",
    role: "assistant",
    model: "claude-recorded",
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    context_management: null,
    container: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

const text = (t) => ({ type: "text", text: t, citations: null });
const use = (name, input) => {
  seq += 1;
  return { type: "tool_use", id: `toolu_1412_${String(seq)}`, name, input };
};

function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    const t = m.content.find((b) => b.type === "text");
    if (t !== undefined) return { index: i, text: String(t.text) };
  }
  return { index: -1, text: "" };
}

/** Tool results after the admin's last message, parsed (content is the JSON the tool returned). */
function resultsSince(messages, index) {
  const out = [];
  for (const m of messages.slice(index + 1))
    if (m.role === "user" && Array.isArray(m.content))
      for (const b of m.content)
        if (b.type === "tool_result") {
          try {
            out.push(JSON.parse(typeof b.content === "string" ? b.content : "null"));
          } catch {
            out.push(null);
          }
        }
  return out;
}

const weight = (key) =>
  DEFAULT_SLOTS.find((s) => s.key === key)?.defaultWeight ?? CUSTOM_SLOT_DEFAULT_WEIGHT;

/** The member's rest-day meals, as the Meals section lists them (components/config/data.ts). */
function restDaySlots(household, memberId) {
  const rows = household.schedules?.slotSchedules ?? [];
  return (household.slots ?? []).filter((slot) => {
    if (!slot.active || slot.isTrainingSlot) return false;
    const own = rows.filter((r) => r.memberId === memberId && r.slotTypeId === slot.id);
    return own.length < 7 || own.some((r) => r.attends);
  });
}

/** Lunch at 40 %; the other meals keep their automatic ratio and fill the remaining 60 %. */
function splitWithLunch(slots) {
  const others = slots.filter((s) => s.key !== "lunch");
  const lunch = slots.find((s) => s.key === "lunch");
  if (lunch === undefined) throw new Error("the member does not eat lunch");
  const total = others.reduce((a, s) => a + weight(s.key), 0);
  const round = (n) => Math.round(n * 10_000) / 10_000;
  const shares = others.map((s) => ({
    slotTypeId: s.id,
    share: round(((1 - RECORDED.lunchShare) * weight(s.key)) / total),
  }));
  shares.push({ slotTypeId: lunch.id, share: RECORDED.lunchShare });
  // The rounding remainder goes on the largest sibling, as the section's own rebalance does.
  const residual = round(1 - shares.reduce((a, s) => a + s.share, 0));
  if (residual !== 0) {
    const largest = shares
      .filter((s) => s.slotTypeId !== lunch.id)
      .sort((a, b) => b.share - a.share)[0];
    largest.share = round(largest.share + residual);
  }
  return shares;
}

const REQUESTS = [
  {
    pattern: /^change (.+)'s daily targets:/i,
    ops: (member) => [
      {
        kind: "target.set",
        payload: { memberId: member.id, kind: "default", profile: { ...RECORDED.targets } },
      },
    ],
    summary: (member) => `Set ${member.displayName}'s daily targets`,
    done: (member) =>
      `Done: ${member.displayName}'s daily targets are now ${String(RECORDED.targets.kcal)} kcal.`,
  },
  {
    pattern: /^change how (.+)'s day is split across meals:/i,
    ops: (member, household) => [
      {
        kind: "distribution.set",
        payload: {
          memberId: member.id,
          dayKind: "default",
          shares: splitWithLunch(restDaySlots(household, member.id)),
        },
      },
    ],
    summary: (member) => `Set ${member.displayName}'s meal split`,
    done: (member) => `Done: lunch is now 40 % of ${member.displayName}'s day.`,
  },
  {
    pattern: /^change (.+)'s tastes:/i,
    ops: (member) => [
      {
        kind: "preference.set",
        payload: {
          memberId: member.id,
          entityType: "cuisine",
          entityKey: RECORDED.cuisine,
          score: RECORDED.like,
          source: "explicit",
        },
      },
    ],
    summary: (member) => `${member.displayName}: Levantine`,
    done: (member) => `Done: ${member.displayName} likes Levantine food.`,
  },
];

function respond(request) {
  const { index, text: said } = lastUser(request.messages);
  const results = resultsSince(request.messages, index);
  for (const r of REQUESTS) {
    const match = r.pattern.exec(said.trim());
    if (match === null) continue;
    if (results.length === 0) return message([use("get_household", {})], "tool_use");
    if (results.length === 1) {
      const household = results[0] ?? {};
      const member = (household.members ?? []).find(
        (m) => m.displayName.toLowerCase() === match[1].toLowerCase(),
      );
      if (member === undefined)
        return message([text(`I could not find ${match[1]} in the household.`)], "end_turn");
      return message(
        [use("apply_change", { summary: r.summary(member), ops: r.ops(member, household) })],
        "tool_use",
      );
    }
    const applied = results[1];
    const ok = applied?.status === "applied";
    const member = (results[0]?.members ?? []).find(
      (m) => m.displayName.toLowerCase() === match[1].toLowerCase(),
    );
    return message(
      [text(ok && member !== undefined ? r.done(member) : "That change was not applied.")],
      "end_turn",
    );
  }
  return message([text(`Noted: ${said}`)], "end_turn");
}

globalThis[KEY] = {
  model: "claude-recorded",
  effort: "high",
  // The stream interface the loop calls (apps/web/lib/server/agent.ts): one event per block.
  stream(request, onEvent) {
    const out = respond(request);
    for (const [i, block] of out.content.entries()) {
      onEvent({
        type: "content_block_start",
        index: i,
        content_block: block.type === "text" ? { ...block, text: "" } : block,
      });
      if (block.type === "text")
        onEvent({
          type: "content_block_delta",
          index: i,
          delta: { type: "text_delta", text: block.text },
        });
      onEvent({ type: "content_block_stop", index: i });
    }
    return Promise.resolve(out);
  },
};
