// The agent's model port (AGT-2; leaf-1.3.5 ADR-1): one streamed call through
// `client.beta.messages.stream(...)` + `finalMessage()`, with adaptive thinking, effort, the
// server-side refusal fallback and compaction. Stream events are forwarded as they arrive (SSE,
// AGT-7). Errors: the SDK's tool-JSON parse failure becomes `ToolJsonError` (SPEC-Q-4); an abort
// becomes `AgentAbortedError`; every other SDK error is mapped by 1.3.1's `fromSdkError`.
import Anthropic, { APIError, AnthropicError } from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaTextBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { FALLBACK_BETA, fromSdkError, type ClaudeConfig, type Effort } from "../client/index.js";
import { AGENT_MAX_TOKENS, COMPACTION_BETA, COMPACTION_EDIT } from "./config.js";

export interface AgentRequest {
  /** Stable, cached blocks (they carry their own `cache_control`). */
  system: BetaTextBlockParam[];
  /** Fixed order; part of the cached prefix. */
  tools: BetaToolUnion[];
  /** The replayed conversation (AGT-8), only ever appended to. */
  messages: BetaMessageParam[];
}

export type AgentStreamEvent = BetaRawMessageStreamEvent;

/** The one operation the loop needs. Tests implement it with a scripted stub. */
export interface AgentModel {
  /** The requested model. */
  readonly model: string;
  readonly effort: Effort;
  stream(
    request: AgentRequest,
    onEvent: (event: AgentStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<BetaMessage>;
}

/** The SDK could not parse a tool input's JSON at all; no final message exists (SPEC-Q-4). */
export class ToolJsonError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ToolJsonError";
  }
}

/** The caller aborted the turn (client disconnect). */
export class AgentAbortedError extends Error {
  constructor() {
    super("the turn was aborted");
    this.name = "AgentAbortedError";
  }
}

const TOOL_JSON_MESSAGE = "Unable to parse tool parameter JSON";

/** The request body of one call (exported so tests can compare it with the wire). */
export function agentParams(model: string, effort: Effort, request: AgentRequest) {
  return {
    model,
    max_tokens: AGENT_MAX_TOKENS,
    betas: [FALLBACK_BETA, COMPACTION_BETA],
    fallbacks: "default" as const,
    thinking: { type: "adaptive" as const },
    output_config: { effort },
    context_management: { edits: [{ type: COMPACTION_EDIT }] },
    system: request.system,
    tools: request.tools,
    messages: request.messages,
  };
}

/** Classifies an error thrown while a stream was consumed. */
export function classifyStreamError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return new AgentAbortedError();
  if (
    error instanceof AnthropicError &&
    !(error instanceof APIError) &&
    error.message.startsWith(TOOL_JSON_MESSAGE)
  )
    return new ToolJsonError(error.message, { cause: error });
  return fromSdkError(error);
}

class AnthropicAgentModel implements AgentModel {
  readonly model: string;
  readonly effort: Effort;
  readonly #client: Anthropic;

  constructor(model: string, effort: Effort, client: Anthropic) {
    this.model = model;
    this.effort = effort;
    this.#client = client;
  }

  async stream(
    request: AgentRequest,
    onEvent: (event: AgentStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<BetaMessage> {
    // Iteration and the final read are one try: the SDK rejects finalMessage() with the tool-JSON
    // parse error when a block stops (ADR-1).
    try {
      const stream = this.#client.beta.messages.stream(
        agentParams(this.model, this.effort, request) as Parameters<
          Anthropic["beta"]["messages"]["stream"]
        >[0],
        { signal },
      );
      stream.on("streamEvent", (event) => {
        onEvent(event);
      });
      return await stream.finalMessage();
    } catch (error) {
      throw classifyStreamError(error, signal);
    }
  }
}

/**
 * The agent model for a configuration, or null when there is no credential (the route answers
 * 503; REC-2-style, never silent). `anthropic` lets tests pass a client with a recorded fetch.
 */
export function createAgentModel(
  config: ClaudeConfig,
  effort: Effort,
  options: { anthropic?: Anthropic } = {},
): AgentModel | null {
  if (!config.enabled) return null;
  return new AnthropicAgentModel(config.model, effort, options.anthropic ?? new Anthropic());
}
