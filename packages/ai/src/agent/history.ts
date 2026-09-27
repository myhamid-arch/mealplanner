// Stored rows ↔ API messages (AGT-8; SPEC-Q-3). Rows are replayed verbatim, in order: a `user` row
// is the exact user content sent, an `assistant` row the response content as returned, a `tool`
// row's `results` the tool_result blocks sent back, and `event` rows are not sent to the model.
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Card, Json } from "./cards.js";
import type { StoredMessage } from "./types.js";

/** Content of a `tool` row. */
export interface ToolRowContent {
  results: BetaToolResultBlockParam[];
  cards: Card[];
}

/** Content of an `event` row (display only). */
export interface EventRowContent {
  text: string;
  cards: Card[];
}

function blocks(row: StoredMessage): BetaContentBlockParam[] {
  if (!Array.isArray(row.content))
    throw new Error(`chat_message ${row.id} (${row.role}) does not hold a content array`);
  return row.content as unknown as BetaContentBlockParam[];
}

/** The API message a row replays as, or null for an `event` row. */
export function messageOf(row: StoredMessage): BetaMessageParam | null {
  switch (row.role) {
    case "user":
      return { role: "user", content: blocks(row) };
    case "assistant":
      return { role: "assistant", content: blocks(row) };
    case "tool": {
      const content = row.content as unknown as Partial<ToolRowContent> | null;
      if (content === null || !Array.isArray(content.results))
        throw new Error(`chat_message ${row.id} (tool) has no results`);
      return { role: "user", content: content.results };
    }
    case "event":
      return null;
  }
}

/** The conversation as sent to the model: every stored row, in order, verbatim. */
export function replay(rows: readonly StoredMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const row of rows) {
    const message = messageOf(row);
    if (message !== null) out.push(message);
  }
  return out;
}

/** The user turn's content (AGT-3): the admin's text, the screen context, the digest last. */
export function userContent(text: string, screen: string | null, digest: string): Json {
  const parts: BetaTextBlockParam[] = [{ type: "text", text }];
  if (screen !== null) parts.push({ type: "text", text: screen });
  parts.push({ type: "text", text: digest });
  return parts as unknown as Json;
}

export function toolRowContent(content: ToolRowContent): Json {
  return JSON.parse(JSON.stringify(content)) as Json;
}

export function eventRowContent(content: EventRowContent): Json {
  return JSON.parse(JSON.stringify(content)) as Json;
}

/** The admin-visible text of a row (display text is derived; AGT-8). */
export function displayText(row: StoredMessage): string {
  if (row.role === "event") return (row.content as unknown as EventRowContent).text;
  if (row.role === "tool") return "";
  return blocks(row)
    .filter((b): b is BetaTextBlockParam => b.type === "text")
    .map((b) => b.text)
    .slice(0, row.role === "user" ? 1 : undefined)
    .join("");
}
