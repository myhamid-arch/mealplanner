// The agent loop of one user turn (AGT-2, AGT-3, AGT-8): a manual streaming loop over the model
// port. Every request is the replay of the stored rows (so what is sent is exactly what is stored;
// SPEC-Q-3), every response is stored verbatim before its tools run, and every tool_use is
// answered by a tool row, whatever happens, so the history stays valid for the next request.
import type {
  BetaMessage,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ClaudeCallError } from "../client/index.js";
import { cardJson, type Card, type Json } from "./cards.js";
import { AGENT_MAX_TOKENS, JSON_REISSUE_LIMIT, MAX_MODEL_CALLS } from "./config.js";
import { eventRowContent, replay, toolRowContent, userContent } from "./history.js";
import {
  AgentAbortedError,
  ToolJsonError,
  type AgentModel,
  type AgentRequest,
  type AgentStreamEvent,
} from "./model.js";
import { systemBlocks } from "./prompt.js";
import type { ChatSink, TurnStopReason } from "./stream.js";
import { toolLabel } from "./tools/labels.js";
import { notRunResult, runTools } from "./tools/run.js";
import { toolDefinitions } from "./tools/schemas.js";
import type { AgentPorts, ChatCallRecord, ChatStore, StoredMessage } from "./types.js";

export interface TurnArgs {
  model: AgentModel;
  ports: AgentPorts;
  store: ChatStore;
  /** The conversation's stored rows, oldest first. */
  history: readonly StoredMessage[];
  /** The admin's message. */
  text: string;
  /** The side panel's screen context text block, if any (07 §5). */
  screen: string | null;
  /** The household digest text (AGT-3). */
  digest: string;
  sink: ChatSink;
  signal: AbortSignal;
  /** Writes the `ai_generation` row of one model call (DM-7). */
  recordCall(record: ChatCallRecord): Promise<void>;
  /** Unexpected tool failures (logged by the caller; the tool answers with an error result). */
  onUnexpected?(error: unknown, tool: string): void;
}

export interface TurnOutcome {
  stopReason: TurnStopReason;
  modelCalls: number;
  appended: StoredMessage[];
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

/** The fixed prefix of every request (tools, then system; both cached). */
export function requestPrefix(): Pick<AgentRequest, "system" | "tools"> {
  return { system: systemBlocks(), tools: toolDefinitions() };
}

function forward(sink: ChatSink) {
  return (event: AgentStreamEvent) => {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "tool_use")
        sink({
          type: "tool_start",
          toolUseId: block.id,
          name: block.name,
          label: toolLabel(block.name),
        });
      else if (block.type === "thinking" || block.type === "redacted_thinking")
        sink({ type: "thinking" });
    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      sink({ type: "text_delta", text: event.delta.text });
    }
  };
}

function usageRecord(model: string, message: BetaMessage, summary: Json): ChatCallRecord {
  return {
    purpose: "chat",
    model: message.model || model,
    requestSummary: summary,
    responseRaw: asJson({
      id: message.id,
      content: message.content,
      stopDetails: message.stop_details ?? null,
    }),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    stopReason: message.stop_reason ?? "none",
    validationErrors: null,
  };
}

function errorRecord(model: string, error: Error, summary: Json): ChatCallRecord {
  const call = error instanceof ClaudeCallError ? error : null;
  return {
    purpose: "chat",
    model: call?.servedModel ?? model,
    requestSummary: summary,
    responseRaw: asJson({ error: error.name, code: call?.code ?? null, message: error.message }),
    inputTokens: call?.usage?.inputTokens ?? 0,
    outputTokens: call?.usage?.outputTokens ?? 0,
    cacheReadTokens: call?.usage?.cacheReadTokens ?? 0,
    stopReason:
      error instanceof ToolJsonError
        ? "invalid_tool_json"
        : error instanceof AgentAbortedError
          ? "aborted"
          : (call?.stopReason ?? call?.code ?? "error"),
    validationErrors: null,
  };
}

/** Runs one user turn to its end. Appends rows only; never edits or reorders (AGT-8). */
export async function runAgentTurn(args: TurnArgs): Promise<TurnOutcome> {
  const { model, ports, store, sink, signal } = args;
  const rows: StoredMessage[] = [...args.history];
  const appended: StoredMessage[] = [];
  const prefix = requestPrefix();
  const ran: { name: string; ok: boolean }[] = [];
  let calls = 0;
  let reissues = 0;

  const append = async (role: StoredMessage["role"], content: Json) => {
    const row = await store.append(role, content);
    rows.push(row);
    appended.push(row);
    sink({ type: "message", message: row });
    return row;
  };
  const finish = (stopReason: TurnStopReason): TurnOutcome => {
    sink({ type: "done", stopReason, modelCalls: calls });
    return { stopReason, modelCalls: calls, appended };
  };
  /** Answers unrun tool_use blocks so the history stays valid (SPEC-Q-5, SPEC-Q-6). */
  const answerUnrun = async (blocks: BetaToolUseBlock[], why: string) => {
    if (blocks.length === 0) return;
    await append(
      "tool",
      toolRowContent({ results: blocks.map((b) => notRunResult(b, why)), cards: [] }),
    );
  };
  const limitReached = async (unrun: BetaToolUseBlock[]) => {
    await answerUnrun(unrun, `the ${String(MAX_MODEL_CALLS)}-call limit for this turn was reached`);
    const card: Card = {
      type: "iteration_limit",
      limit: MAX_MODEL_CALLS,
      ran,
      notRun: unrun.map((b) => ({ name: b.name })),
    };
    const done =
      ran.length === 0
        ? "nothing yet"
        : ran.map((r) => `${r.name}${r.ok ? "" : " (failed)"}`).join(", ");
    const left =
      unrun.length === 0 ? "the rest of the answer" : unrun.map((b) => b.name).join(", ");
    await append(
      "event",
      eventRowContent({
        text: `I reached the limit of ${String(MAX_MODEL_CALLS)} steps for one message. Done: ${done}. Left: ${left}. Send another message to continue.`,
        cards: [cardJson(card) as unknown as Card],
      }),
    );
    return finish("iteration_limit");
  };

  await append("user", userContent(args.text, args.screen, args.digest));

  for (;;) {
    if (signal.aborted) return finish("aborted");
    calls += 1;
    const messages = replay(rows);
    const summary = asJson({
      call: calls,
      messages: messages.length,
      effort: model.effort,
      maxTokens: AGENT_MAX_TOKENS,
      tools: prefix.tools.length,
    });
    let message: BetaMessage;
    try {
      message = await model.stream({ ...prefix, messages }, forward(sink), signal);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      await args.recordCall(errorRecord(model.model, error, summary));
      if (error instanceof AgentAbortedError) return finish("aborted");
      if (error instanceof ToolJsonError) {
        if (reissues < JSON_REISSUE_LIMIT && calls < MAX_MODEL_CALLS) {
          reissues += 1;
          sink({
            type: "error",
            code: "invalid_tool_json_retry",
            message: "The assistant's tool call was malformed; asking again.",
          });
          continue;
        }
        sink({ type: "error", code: "invalid_tool_json", message: error.message });
        return finish("invalid_tool_json");
      }
      if (error instanceof ClaudeCallError) {
        sink({ type: "error", code: error.code, message: error.message });
        return finish("error");
      }
      throw error;
    }
    await args.recordCall(usageRecord(model.model, message, summary));
    const assistant = await append("assistant", asJson(message.content));
    const toolUses = message.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");

    switch (message.stop_reason) {
      case "refusal": {
        await answerUnrun(toolUses, "the response was refused");
        const category = message.stop_details?.category ?? null;
        sink({
          type: "error",
          code: "refusal",
          message: `The assistant declined this request${category === null ? "" : ` (${category})`}.`,
        });
        return finish("refusal");
      }
      case "max_tokens":
        await answerUnrun(toolUses, "the response was cut off at max_tokens");
        sink({
          type: "error",
          code: "max_tokens",
          message: "The answer was cut off at its length limit.",
        });
        return finish("max_tokens");
      case "model_context_window_exceeded":
        await answerUnrun(toolUses, "the conversation is too long");
        sink({
          type: "error",
          code: "context_window_exceeded",
          message: "This conversation is too long; start a new one.",
        });
        return finish("context_window_exceeded");
      case "pause_turn":
      case "compaction":
        // Resume: the stored assistant row is sent back as is (no extra user message).
        if (calls >= MAX_MODEL_CALLS) return limitReached([]);
        continue;
      case "tool_use": {
        if (toolUses.length === 0) return finish("end_turn");
        if (calls >= MAX_MODEL_CALLS) return limitReached(toolUses);
        const runs = await runTools(toolUses, ports, assistant.id, sink, (e, tool) => {
          args.onUnexpected?.(e, tool);
        });
        for (const r of runs) ran.push({ name: r.name, ok: r.ok });
        // AGT-2: all results of one assistant message in one user message.
        await append(
          "tool",
          toolRowContent({
            results: runs.map((r) => r.result),
            cards: runs.flatMap((r) => r.cards),
          }),
        );
        continue;
      }
      default:
        return finish("end_turn");
    }
  }
}
