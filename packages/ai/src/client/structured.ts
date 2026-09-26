// Structured Claude calls (REC-2; leaf-1.3.1 ADR-1): `beta.messages.parse` with a Zod output
// format, adaptive thinking, server-side refusal fallback, and `stop_reason` checked before
// the parsed output is read.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { FALLBACK_BETA, type ClaudeConfig } from "./config.js";
import { ClaudeCallError, fromSdkError, type ClaudeUsage } from "./errors.js";

/**
 * The largest round output budget below the SDK's non-streaming ceiling (21 333 tokens without an
 * explicit timeout; ADR-1). A response that does not fit ends as a typed `max_tokens` error.
 */
export const MAX_OUTPUT_TOKENS = 20_000;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type StructuredRequest<S extends z.ZodType> = {
  schema: S;
  /** Stable, cacheable blocks (they carry their own `cache_control`). */
  system: BetaTextBlockParam[];
  /** The conversation; only ever appended to by callers. */
  messages: BetaMessageParam[];
  effort: Effort;
};

export type StructuredResult<T> = {
  output: T;
  /** The model that produced the response (differs from the requested one after a fallback). */
  servedModel: string;
  stopReason: string;
  usage: ClaudeUsage;
  /** The assistant content exactly as returned, for appending to a follow-up (REC-5). */
  content: BetaContentBlock[];
  requestId: string | undefined;
};

/** The one operation generators need. Tests drive the real client through a recorded fetch. */
export interface StructuredModel {
  readonly model: string;
  parse<S extends z.ZodType>(request: StructuredRequest<S>): Promise<StructuredResult<z.output<S>>>;
}

function usageOf(message: BetaMessage): ClaudeUsage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
}

/** The request body sent for a structured call (exported so tests can compare it with the wire). */
export function structuredParams<S extends z.ZodType>(
  model: string,
  request: StructuredRequest<S>,
  format: ReturnType<typeof betaZodOutputFormat>,
) {
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default" as const,
    thinking: { type: "adaptive" as const },
    output_config: { effort: request.effort, format },
    system: request.system,
    messages: request.messages,
  };
}

class AnthropicStructuredModel implements StructuredModel {
  readonly model: string;
  readonly #client: Anthropic;

  constructor(model: string, client: Anthropic) {
    this.model = model;
    this.#client = client;
  }

  async parse<S extends z.ZodType>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResult<z.output<S>>> {
    const base = betaZodOutputFormat(request.schema);
    const parseProblem: { message: string | null } = { message: null };
    // The SDK's parser throws on text that is not valid JSON for the schema, which a refusal or a
    // max_tokens response can carry. Returning null instead lets stop_reason be checked first.
    const format = {
      ...base,
      parse: (text: string): z.output<S> | null => {
        try {
          return base.parse(text);
        } catch (error) {
          parseProblem.message = error instanceof Error ? error.message : String(error);
          return null;
        }
      },
    };

    let message: BetaMessage & { parsed_output: z.output<S> | null };
    let requestId: string | undefined;
    try {
      const { data, request_id } = await this.#client.beta.messages
        .parse(structuredParams(this.model, request, format))
        .withResponse();
      message = data as BetaMessage & { parsed_output: z.output<S> | null };
      requestId = request_id ?? undefined;
    } catch (error) {
      throw fromSdkError(error);
    }

    const details = {
      stopReason: message.stop_reason,
      usage: usageOf(message),
      servedModel: message.model,
      responseContent: message.content,
      ...(requestId === undefined ? {} : { requestId }),
    };
    if (message.stop_reason === "refusal") {
      const stop = message.stop_details;
      throw new ClaudeCallError(
        "refusal",
        `the model declined the request${stop?.category == null ? "" : ` (${stop.category})`}`,
        {
          ...details,
          stopDetails: { category: stop?.category ?? null, explanation: stop?.explanation ?? null },
        },
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new ClaudeCallError(
        "max_tokens",
        `the response reached max_tokens (${String(MAX_OUTPUT_TOKENS)}) before it was complete`,
        details,
      );
    }
    if (message.stop_reason !== "end_turn") {
      throw new ClaudeCallError(
        "unexpected_stop",
        `unexpected stop_reason ${String(message.stop_reason)} on a structured call`,
        details,
      );
    }
    const output = message.parsed_output;
    if (output === null) {
      throw new ClaudeCallError(
        "parse_null",
        parseProblem.message === null
          ? "the response carried no structured output"
          : `the structured output did not match the schema: ${parseProblem.message}`,
        details,
      );
    }
    return {
      output,
      servedModel: message.model,
      stopReason: message.stop_reason,
      usage: details.usage,
      content: message.content,
      requestId,
    };
  }
}

/**
 * The Claude client for a configuration, or null when generation is disabled (REC-2: the caller
 * falls back and says so). `anthropic` lets tests pass a client with a recorded `fetch`.
 */
export function createClaudeClient(
  config: ClaudeConfig,
  options: { anthropic?: Anthropic } = {},
): StructuredModel | null {
  if (!config.enabled) return null;
  return new AnthropicStructuredModel(config.model, options.anthropic ?? new Anthropic());
}
