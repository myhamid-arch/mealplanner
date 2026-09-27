// A scripted stand-in for the agent's model, for leaf 1.4.5's gates only (leaf-1.4.5 ADR-1). The
// verify script starts `next start` with `NODE_OPTIONS=--import <this file>`; the stub is put in the
// slot `agentModel()` reads (apps/web/lib/server/agent.ts, `Symbol.for("mealplanner.web.agentModel")`,
// the same slot 1.3.5's tests fill with `useAgentModel`). Nothing in the app reads this file; without
// the preload the server has no model and the chat route answers 503.
//
// It is a script, not a model: it looks at the admin's last message and answers with canned
// `BetaMessage`s, streaming the `content_block_*` events the SDK would.
//   "what have you learned …"  → run_insights, then a short text.
//   "show me every card …"      → get_household; then propose_change (a soft dislike exclusion,
//                                  R-34), apply_change (a household cuisine preference), get_plan
//                                  (today) and generate_plan (tomorrow) in one message; then text
//                                  with a Markdown table.
//   "keep going …"              → a tool call on every request, until the loop's 12-call cap.
//   "take your time …"          → a text answer streamed slowly (about 6 s; the 409 and Stop tests).
//   anything else               → "Noted: <text>".

const KEY = Symbol.for("mealplanner.web.agentModel");
// The loop recognises a client disconnect by this class; the package copy the server runs is the
// one `node_modules` resolves here unless Next bundled its own, in which case an abort ends the
// turn as an error instead (the chat still shows "Stopped.").
const { AgentAbortedError } = await import("@mealplanner/ai/agent").catch(() => ({
  AgentAbortedError: class extends Error {},
}));
let seq = 0;

function message(content, stop) {
  seq += 1;
  return {
    id: `msg_stub_${String(seq)}`,
    type: "message",
    role: "assistant",
    model: "claude-stub",
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
  return { type: "tool_use", id: `toolu_stub_${String(seq)}`, name, input };
};

function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    const t = m.content.find((b) => b.type === "text");
    if (t !== undefined) return { index: i, text: String(t.text).toLowerCase() };
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

function isoDay(offset) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

function respond(request) {
  const { index, text: said } = lastUser(request.messages);
  const results = resultsSince(request.messages, index);
  if (said.includes("what have you learned")) {
    if (results.length === 0) return message([use("run_insights", {})], "tool_use");
    return message(
      [text("I've started a check of the latest reviews. What I find will appear here as proposals.")],
      "end_turn",
    );
  }
  if (said.includes("show me every card")) {
    if (results.length === 0) return message([use("get_household", {})], "tool_use");
    if (results.length === 1) {
      const household = results[0] ?? {};
      const members = Array.isArray(household.members) ? household.members : [];
      const child = members.find((m) => m.isTargeted === false) ?? members[0];
      return message(
        [
          text("Here is what I found and did."),
          use("propose_change", {
            title: `Never plan liver for ${child?.displayName ?? "the kids"}`,
            rationale: "Two low ratings for dishes with liver.",
            ops: [
              {
                kind: "exclusion.add",
                payload: {
                  memberId: child?.id ?? null,
                  kind: "ingredient",
                  key: "liver",
                  reason: "dislike",
                  hard: false,
                },
              },
            ],
          }),
          use("apply_change", {
            summary: "More Italian for everyone",
            ops: [
              {
                kind: "preference.set",
                payload: {
                  memberId: null,
                  entityType: "cuisine",
                  entityKey: "italian",
                  score: 0.5,
                  source: "explicit",
                },
              },
            ],
          }),
          use("get_plan", { from: isoDay(0), to: isoDay(0) }),
          use("generate_plan", { from: isoDay(1), to: isoDay(1) }),
        ],
        "tool_use",
      );
    }
    return message(
      [
        text(
          "Done. In short:\n\n| What | Status |\n|---|---|\n| **Proposal** | waiting for you |\n| Italian | applied |\n| Tomorrow | planning |",
        ),
      ],
      "end_turn",
    );
  }
  if (said.includes("keep going")) return message([use("get_household", {})], "tool_use");
  if (said.includes("take your time"))
    return message([text("Thinking this through slowly, one step at a time.")], "end_turn");
  return message([text(`Noted: ${said}`)], "end_turn");
}

const stub = {
  model: "claude-stub",
  effort: "high",
  async stream(request, onEvent, signal) {
    const out = respond(request);
    const { text: said } = lastUser(request.messages);
    const slow = said.includes("take your time");
    for (const [i, block] of out.content.entries()) {
      onEvent({
        type: "content_block_start",
        index: i,
        content_block: block.type === "text" ? { ...block, text: "" } : block,
      });
      if (block.type === "text") {
        const words = slow ? block.text.split(" ") : [block.text];
        for (const [j, w] of words.entries()) {
          if (signal.aborted) throw new AgentAbortedError();
          onEvent({
            type: "content_block_delta",
            index: i,
            delta: { type: "text_delta", text: j === 0 ? w : ` ${w}` },
          });
          if (slow) await new Promise((r) => setTimeout(r, 600));
        }
      }
      onEvent({ type: "content_block_stop", index: i });
    }
    return out;
  },
};

globalThis[KEY] = stub;
