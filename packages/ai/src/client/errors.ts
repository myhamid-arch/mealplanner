// Typed errors of the Claude client (REC-2; leaf-1.3.1 ADR-1).
import {
  APIConnectionError,
  APIError,
  AnthropicError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";

export type ClaudeCallErrorCode =
  /** stop_reason `refusal`: the model (and the fallback chain) declined. */
  | "refusal"
  /** stop_reason `max_tokens`: the output was cut off; nothing is read from it. */
  | "max_tokens"
  /** Any other stop_reason than `end_turn` on a structured call. */
  | "unexpected_stop"
  /** `parsed_output` is null: no text, or text that is not valid JSON for the schema. */
  | "parse_null"
  | "authentication"
  | "permission"
  | "rate_limited"
  | "bad_request"
  | "connection"
  | "server"
  | "api"
  | "sdk";

export type ClaudeUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type RefusalDetails = { category: string | null; explanation: string | null };

export class ClaudeCallError extends Error {
  readonly code: ClaudeCallErrorCode;
  readonly stopReason: string | null;
  readonly stopDetails: RefusalDetails | null;
  /** HTTP status of an API error. */
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  /** Usage of a completed response that could not be used (refusal, max_tokens, parse_null). */
  readonly usage: ClaudeUsage | undefined;
  /** The model that produced the response, after any server-side fallback. */
  readonly servedModel: string | undefined;
  /** The response's content, kept for the audit record (DM-7). */
  readonly responseContent: unknown;

  constructor(
    code: ClaudeCallErrorCode,
    message: string,
    details: {
      stopReason?: string | null;
      stopDetails?: RefusalDetails | null;
      status?: number;
      requestId?: string;
      usage?: ClaudeUsage;
      servedModel?: string;
      responseContent?: unknown;
      cause?: unknown;
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ClaudeCallError";
    this.code = code;
    this.stopReason = details.stopReason ?? null;
    this.stopDetails = details.stopDetails ?? null;
    this.status = details.status;
    this.requestId = details.requestId;
    this.usage = details.usage;
    this.servedModel = details.servedModel;
    this.responseContent = details.responseContent;
  }
}

/** Maps an SDK error to a ClaudeCallError, most specific class first. */
export function fromSdkError(error: unknown): ClaudeCallError {
  if (error instanceof ClaudeCallError) return error;
  if (error instanceof APIError) {
    const status: number | undefined = (error as APIError).status;
    const details = {
      ...(status === undefined ? {} : { status }),
      ...(error.requestID == null ? {} : { requestId: error.requestID }),
      cause: error,
    };
    if (error instanceof AuthenticationError)
      return new ClaudeCallError(
        "authentication",
        "the Anthropic API rejected the credential",
        details,
      );
    if (error instanceof PermissionDeniedError)
      return new ClaudeCallError(
        "permission",
        "the credential may not use this model or feature",
        details,
      );
    if (error instanceof RateLimitError)
      return new ClaudeCallError(
        "rate_limited",
        "the Anthropic API rate limit was reached",
        details,
      );
    if (error instanceof BadRequestError)
      return new ClaudeCallError(
        "bad_request",
        `the Anthropic API rejected the request: ${error.message}`,
        details,
      );
    if (error instanceof APIConnectionError)
      return new ClaudeCallError("connection", "the Anthropic API could not be reached", details);
    if (error instanceof InternalServerError)
      return new ClaudeCallError("server", `the Anthropic API failed: ${error.message}`, details);
    return new ClaudeCallError(
      "api",
      `the Anthropic API returned an error: ${error.message}`,
      details,
    );
  }
  if (error instanceof AnthropicError)
    return new ClaudeCallError("sdk", error.message, { cause: error });
  throw error;
}
