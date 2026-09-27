// G3 (AGT-8), unit level: every request of a conversation is the replay of the stored rows; across
// turns, the replayed prefix is byte-identical to what was sent before. The database-level proof
// (real jsonb storage and the POST route) is in apps/web/test/api/conversations-messages.int.test.ts.
import { describe, expect, it } from "vitest";
import { runAgentTurn, type StoredMessage } from "../../src/agent/index.js";
import { assertAppendOnly, assertSentMatchesStored } from "./assertions.js";
import { DIGEST, MemoryStore, ScriptedModel, message, text, thinking, toolUse } from "./support.js";

async function turnOn(store: MemoryStore, model: ScriptedModel, userText: string) {
  const history: StoredMessage[] = [...store.rows];
  return runAgentTurn({
    model,
    ports: (await import("./support.js")).recordingPorts(),
    store,
    history,
    text: userText,
    screen: "Recipe: Chicken shawarma bowl",
    digest: DIGEST,
    sink: () => undefined,
    signal: new AbortController().signal,
    recordCall: () => Promise.resolve(),
  });
}

describe("G3 history replay", () => {
  it("G3 three turns: each request extends the previous one byte-for-byte", async () => {
    const store = new MemoryStore();
    const model = new ScriptedModel([
      message(
        [thinking(), toolUse("get_plan", { from: "2026-09-28", to: "2026-09-28" })],
        "tool_use",
      ),
      message([text("Here is Monday.")], "end_turn"),
      message([text("Sure.")], "end_turn"),
      message([toolUse("get_household", {}), toolUse("get_proposals", {})], "tool_use"),
      message([text("Two pending.")], "end_turn"),
    ]);
    await turnOn(store, model, "What is on Monday?");
    await turnOn(store, model, "Thanks");
    await turnOn(store, model, "Any proposals?");
    expect(model.calls).toBe(5);
    assertAppendOnly(model.wire);
    // Each request is the stored rows as sent, mapped independently of history.ts (CP3 finding 1),
    // and each user turn ends with that turn's digest (AGT-3).
    assertSentMatchesStored(model.wire, store.rows, (t) => t === DIGEST);
    // The stored user rows carry the screen context and the digest, last.
    const user = store.rows.find((r) => r.role === "user")?.content as { text: string }[];
    expect(user.map((b) => b.text)).toEqual([
      "What is on Monday?",
      "Recipe: Chicken shawarma bowl",
      DIGEST,
    ]);
  });

  it("G3 negative control: requests without the digest, or unlike the stored rows, fail the check", async () => {
    const store = new MemoryStore();
    const model = new ScriptedModel([message([text("Hi.")], "end_turn")]);
    await turnOn(store, model, "Hello");
    // A sender that drops the digest block (the defect of CP3 mutation M3).
    const sent = JSON.parse(model.wire[0] ?? "[]") as { content: unknown[] }[];
    const withoutDigest = JSON.stringify(
      sent.map((m) => ({ ...m, content: m.content.slice(0, -1) })),
    );
    expect(() => {
      assertSentMatchesStored([withoutDigest], store.rows, (t) => t === DIGEST);
    }).toThrow(/not the stored rows as sent/);
    expect(() => {
      assertSentMatchesStored(model.wire, store.rows, (t) => t === "another digest");
    }).toThrow(/does not end its user turn with the digest/);
  });

  it("G3 negative control: an edited earlier message breaks the append-only check", () => {
    const a = JSON.stringify([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
    const b = JSON.stringify([
      { role: "user", content: [{ text: "hi", type: "text" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(() => {
      assertAppendOnly([a, b]);
    }).toThrow(/changed earlier messages/);
  });
});
