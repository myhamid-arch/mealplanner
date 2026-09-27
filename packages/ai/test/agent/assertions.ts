// Assertions shared by the G1–G3 tests and their negative controls: the same check runs on the
// real transcript (must pass) and on a known-bad one (must fail).
import type {
  BetaContentBlockParam,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

function blocksOf(m: BetaMessageParam): BetaContentBlockParam[] {
  return typeof m.content === "string" ? [] : m.content;
}

/**
 * AGT-2: the results of every tool_use of an assistant message come back together in the very
 * next user message, one result per call, in the calls' order, and nowhere else.
 */
export function assertResultsInOneMessage(messages: readonly BetaMessageParam[]): void {
  messages.forEach((m, i) => {
    if (m.role !== "assistant") return;
    const ids = blocksOf(m)
      .filter((b) => b.type === "tool_use")
      .map((b) => (b as { id: string }).id);
    if (ids.length === 0) return;
    const next = messages[i + 1];
    if (next === undefined) throw new Error(`tool_use ${ids.join(",")} is not answered`);
    if (next.role !== "user")
      throw new Error(`message ${String(i + 1)} after tool_use is not a user message`);
    const results = blocksOf(next)
      .filter((b) => b.type === "tool_result")
      .map((b) => (b as { tool_use_id: string }).tool_use_id);
    if (JSON.stringify(results) !== JSON.stringify(ids))
      throw new Error(
        `message ${String(i + 1)} answers [${results.join(",")}] instead of [${ids.join(",")}] in one message`,
      );
    const elsewhere = messages.some(
      (other, j) =>
        j !== i + 1 &&
        blocksOf(other).some(
          (b) =>
            b.type === "tool_result" && ids.includes((b as { tool_use_id: string }).tool_use_id),
        ),
    );
    if (elsewhere)
      throw new Error(`a result of [${ids.join(",")}] is also sent in another message`);
  });
}

/** Every request is a strict extension of the one before it (append-only; AGT-8). */
export function assertAppendOnly(wire: readonly string[]): void {
  for (let i = 1; i < wire.length; i += 1) {
    const prev = JSON.parse(wire[i - 1] ?? "[]") as unknown[];
    const next = JSON.parse(wire[i] ?? "[]") as unknown[];
    if (next.length < prev.length) throw new Error(`request ${String(i)} dropped messages`);
    const prefix = JSON.stringify(next.slice(0, prev.length));
    if (prefix !== wire[i - 1]) throw new Error(`request ${String(i)} changed earlier messages`);
  }
}
