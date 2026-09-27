// The events of one chat turn, sent to the browser as Server-Sent Events (AGT-7; SPEC-Q-12).
import type { Card } from "./cards.js";
import type { StoredMessage } from "./types.js";

export type TurnStopReason =
  | "end_turn"
  | "refusal"
  | "max_tokens"
  | "iteration_limit"
  | "context_window_exceeded"
  | "invalid_tool_json"
  | "error"
  | "aborted";

export type ChatStreamEvent =
  /** A row as soon as it is stored (user, assistant, tool, event). */
  | { type: "message"; message: StoredMessage }
  | { type: "text_delta"; text: string }
  /** The model is thinking (activity only; thinking text is not shown). */
  | { type: "thinking" }
  | { type: "tool_start"; toolUseId: string; name: string; label: string }
  | { type: "tool_done"; toolUseId: string; name: string; ok: boolean; cards: Card[] }
  | { type: "error"; code: string; message: string }
  /** Terminal. */
  | { type: "done"; stopReason: TurnStopReason; modelCalls: number };

export type ChatSink = (event: ChatStreamEvent) => void;
