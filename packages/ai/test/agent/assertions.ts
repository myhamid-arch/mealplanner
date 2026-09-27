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

interface Row {
  role: string;
  content: unknown;
}

/**
 * AGT-8, written independently of `history.ts` (CP3 finding 1): what the stored rows say was sent.
 * User and assistant rows are their content verbatim, a tool row's `results` are one user message,
 * event rows are not sent.
 */
export function storedAsSent(rows: readonly Row[]): unknown[] {
  return rows.flatMap((r) => {
    if (r.role === "user" || r.role === "assistant") return [{ role: r.role, content: r.content }];
    if (r.role === "tool")
      return [{ role: "user", content: (r.content as { results: unknown }).results }];
    return [];
  });
}

/**
 * Every request sent is, byte for byte, the stored rows up to that point; and each request's last
 * user turn (a message with text blocks) ends with the digest `digestOf` expects for it.
 */
export function assertSentMatchesStored(
  wire: readonly string[],
  rows: readonly Row[],
  digestOk: (text: string) => boolean,
): void {
  const stored = storedAsSent(rows);
  wire.forEach((sent, i) => {
    const n = (JSON.parse(sent) as unknown[]).length;
    if (sent !== JSON.stringify(stored.slice(0, n)))
      throw new Error(`request ${String(i)} is not the stored rows as sent`);
    const turns = (
      JSON.parse(sent) as { role: string; content: { type: string; text?: string }[] }[]
    ).filter((m) => m.role === "user" && m.content.some((b) => b.type === "text"));
    const last = turns.at(-1)?.content.at(-1);
    if (last?.type !== "text" || !digestOk(last.text ?? ""))
      throw new Error(`request ${String(i)} does not end its user turn with the digest`);
  });
}
