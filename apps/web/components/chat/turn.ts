// The conversation as the chat shows it (AGT-7, AGT-8), built from the stored rows (display text is
// derived; ADR-2) plus the live state of a streaming turn. Pure: no React, no fetch.
// Rows: `user` = the API content sent (first text block is what the admin typed; the screen and
// digest blocks follow), `assistant` = the API response blocks (text, thinking, tool_use, …),
// `tool` = `{ results: tool_result[], cards }`, `event` = `{ text, cards }` (display only).
import type { z } from "zod";
import type { ChatMessageDto, ChatStreamEventDto } from "@mealplanner/api-contract/contract";
import type { Json } from "./proposals";

export type Row = z.output<typeof ChatMessageDto>;
export type StreamEvent = z.output<typeof ChatStreamEventDto>;

export interface Step {
  id: string;
  name: string;
  label: string;
  /** null while it runs. */
  ok: boolean | null;
}

export type Part =
  { kind: "text"; text: string; key: string } | { kind: "cards"; cards: Json[]; key: string };

export type Item =
  | { kind: "user"; id: string; text: string; createdAt: string }
  | {
      kind: "turn";
      id: string;
      steps: Step[];
      parts: Part[];
      /** The turn is still streaming. */
      live: boolean;
      thinking: boolean;
      /** Why the turn stopped early, in words (refusal, error, …). */
      notice: string | null;
    }
  | { kind: "event"; id: string; text: string; cards: Json[]; createdAt: string };

export interface Live {
  /** Text streamed since the last stored assistant row. */
  text: string;
  steps: Step[];
  /** Cards from `tool_done` not yet stored in a tool row. */
  cards: Json[];
  thinking: boolean;
  notice: string | null;
  running: boolean;
}

export const IDLE: Live = {
  text: "",
  steps: [],
  cards: [],
  thinking: false,
  notice: null,
  running: false,
};

type Labels = Readonly<Record<string, string>>;

function isRecord(v: unknown): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function blocks(row: Row): Record<string, Json>[] {
  return Array.isArray(row.content) ? row.content.filter(isRecord) : [];
}

/** What the admin typed: the first text block of a `user` row (AGT-8). */
export function userText(row: Row): string {
  const first = blocks(row).find((b) => b.type === "text");
  return typeof first?.text === "string" ? first.text : "";
}

function assistantText(row: Row): string {
  return blocks(row)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function toolUses(row: Row): { id: string; name: string }[] {
  return blocks(row).flatMap((b) =>
    b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string"
      ? [{ id: b.id, name: b.name }]
      : [],
  );
}

function toolResults(row: Row): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const content = isRecord(row.content) ? row.content : null;
  const results = content !== null && Array.isArray(content.results) ? content.results : [];
  for (const r of results)
    if (isRecord(r) && typeof r.tool_use_id === "string")
      out.set(r.tool_use_id, r.is_error !== true);
  return out;
}

function rowCards(row: Row): Json[] {
  const content = isRecord(row.content) ? row.content : null;
  return content !== null && Array.isArray(content.cards) ? content.cards : [];
}

function eventText(row: Row): string {
  const content = isRecord(row.content) ? row.content : null;
  return typeof content?.text === "string" ? content.text : "";
}

/** "Checking the plan…" → "Checking the plan" (a finished step). */
export function doneLabel(label: string): string {
  return label.replace(/[….]+$/, "");
}

const STOP_NOTICES: Readonly<Record<string, string>> = {
  refusal: "The assistant declined to answer that.",
  max_tokens: "The answer was cut off because it got too long. Ask again, maybe in smaller parts.",
  context_window_exceeded: "This conversation is too long to continue. Start a new one.",
  invalid_tool_json: "The assistant could not complete a step. Try asking again.",
  error: "Something went wrong with this reply.",
  aborted: "Stopped.",
};

/** A turn's stop reason in words, or null for a normal end. */
export function stopNotice(reason: string): string | null {
  return STOP_NOTICES[reason] ?? null;
}

/** The stored rows as chat items, oldest first; a live turn is merged into the last one. */
export function buildItems(rows: readonly Row[], labels: Labels, live: Live = IDLE): Item[] {
  const items: Item[] = [];
  type Turn = Extract<Item, { kind: "turn" }>;
  let turn: Turn | null = null;
  const newTurn = (id: string): Turn => {
    const t: Turn = {
      kind: "turn",
      id,
      steps: [],
      parts: [],
      live: false,
      thinking: false,
      notice: null,
    };
    items.push(t);
    return t;
  };
  for (const row of rows) {
    if (row.role === "user") {
      items.push({ kind: "user", id: row.id, text: userText(row), createdAt: row.createdAt });
      turn = null;
    } else if (row.role === "event") {
      items.push({
        kind: "event",
        id: row.id,
        text: eventText(row),
        cards: rowCards(row),
        createdAt: row.createdAt,
      });
      turn = null;
    } else if (row.role === "assistant") {
      const t: Turn = turn ?? newTurn(row.id);
      turn = t;
      for (const use of toolUses(row))
        t.steps.push({
          id: use.id,
          name: use.name,
          label: labels[use.name] ?? "Working…",
          ok: null,
        });
      const text = assistantText(row);
      if (text.trim() !== "") t.parts.push({ kind: "text", text, key: row.id });
    } else {
      const t: Turn = turn ?? newTurn(row.id);
      turn = t;
      const results = toolResults(row);
      for (const s of t.steps) {
        const ok = results.get(s.id);
        if (ok !== undefined) s.ok = ok;
      }
      const cards = rowCards(row);
      if (cards.length > 0) t.parts.push({ kind: "cards", cards, key: row.id });
    }
  }
  const running = live.running || live.text !== "" || live.cards.length > 0 || live.notice !== null;
  if (!running) return items;
  const last = items.at(-1);
  const t: Turn = last?.kind === "turn" ? last : newTurn("live");
  t.live = live.running;
  t.thinking = live.thinking && live.running;
  t.notice = live.notice;
  for (const s of live.steps) {
    const existing = t.steps.find((x) => x.id === s.id);
    if (existing === undefined) t.steps.push({ ...s });
    else if (s.ok !== null) existing.ok = s.ok;
  }
  if (live.cards.length > 0) t.parts.push({ kind: "cards", cards: live.cards, key: "live-cards" });
  if (live.text !== "") t.parts.push({ kind: "text", text: live.text, key: "live-text" });
  return items;
}

/** Folds one stream event into the stored rows and the live state. */
export function reduce(
  state: { rows: Row[]; live: Live },
  event: StreamEvent,
): { rows: Row[]; live: Live } {
  const { rows, live } = state;
  switch (event.type) {
    case "message": {
      const m = event.message;
      if (rows.some((r) => r.id === m.id)) return state;
      const next = [...rows, m];
      if (m.role === "assistant")
        return { rows: next, live: { ...live, text: "", thinking: false } };
      if (m.role === "tool") return { rows: next, live: { ...live, cards: [] } };
      return { rows: next, live };
    }
    case "text_delta":
      return { rows, live: { ...live, text: live.text + event.text, thinking: false } };
    case "thinking":
      return { rows, live: { ...live, thinking: true } };
    case "tool_start":
      return {
        rows,
        live: {
          ...live,
          thinking: false,
          steps: [
            ...live.steps.filter((s) => s.id !== event.toolUseId),
            { id: event.toolUseId, name: event.name, label: event.label, ok: null },
          ],
        },
      };
    case "tool_done":
      return {
        rows,
        live: {
          ...live,
          steps: live.steps.map((s) => (s.id === event.toolUseId ? { ...s, ok: event.ok } : s)),
          cards: [...live.cards, ...event.cards],
        },
      };
    case "error":
      return {
        rows,
        live: {
          ...live,
          notice: event.message === "" ? (STOP_NOTICES.error ?? null) : event.message,
        },
      };
    case "done":
      return {
        rows,
        live: {
          ...IDLE,
          notice: live.notice ?? stopNotice(event.stopReason),
        },
      };
  }
}
