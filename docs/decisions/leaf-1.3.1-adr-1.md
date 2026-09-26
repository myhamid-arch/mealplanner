# leaf-1.3.1 ADR-1: Claude API surface for the recipe generator

Status: proposed (CP1)

## Context
REC-2 fixes the call: `@anthropic-ai/sdk` (declared by 1.1.1 in `packages/ai`, exact version 0.128.0), model from `ANTHROPIC_MODEL` (default `claude-opus-5`), `messages.parse()` with `output_config.format = zodOutputFormat(DishBatchSchema)`, adaptive thinking at effort `high`, beta `server-side-fallback-2026-07-01` with `fallbacks: "default"`, `stop_reason` checked before content, prompt caching on the system prompt and catalogue block, typed SDK errors, SDK default retries.

Read from the installed package (`node_modules/@anthropic-ai/sdk`, 0.128.0) and the `claude-api` skill:

1. `fallbacks` exists only on the **beta** params (`BetaFallbacksParam = Array<BetaFallbackParam> | 'default'`, `resources/beta/messages/messages.d.ts`). `'server-side-fallback-2026-07-01'` is in the `AnthropicBeta` union. The non-beta `client.messages.parse` has no `fallbacks` field.
2. The beta counterpart of `messages.parse` is `client.beta.messages.parse(params)`, which returns `ParsedBetaMessage<T>` with `parsed_output: T | null`; its format helper is `betaZodOutputFormat` from `@anthropic-ai/sdk/helpers/beta/zod` (same shape as `zodOutputFormat`: `{ type: "json_schema", schema, parse(text) }`). `parse` adds the `structured-outputs-2025-12-15` beta itself.
3. `parseBetaMessage` calls the format's `parse` on each text block and **throws** `AnthropicError("Failed to parse structured output …")` when the text is not valid JSON or fails the Zod schema. A `refusal` or `max_tokens` response can carry partial JSON, so with the helper as shipped the SDK would throw before the caller sees `stop_reason`.
4. `claude-opus-5` is a current model ID per the `claude-api` skill's model table (cached 2026-06-24). The spec default needs no SPEC-Q.
5. Non-streaming requests: the SDK refuses `max_tokens` above 21 333 when no explicit timeout is set (`calculateNonstreamingTimeout`: 60 min × max_tokens / 128 000 must not exceed 10 min).

## Decision
- Call `client.beta.messages.parse({ model, max_tokens: 20000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", thinking: { type: "adaptive" }, output_config: { effort: "high", format }, system, messages })`. This is REC-2's `messages.parse` + Zod output format on the beta namespace, which is the only namespace that accepts REC-2's `fallbacks` (SPEC-Q-1).
- `format` is `betaZodOutputFormat(DishBatchSchema)` with its `parse` wrapped so that a text that does not parse returns `null` instead of throwing (the parse error message is kept for the audit record). The request body is unchanged (functions are not serialised). Then the client checks, in order:
  1. `stop_reason === "refusal"` → `ClaudeCallError("refusal")` with `stop_details` (category, explanation) and the model that served the turn (after server-side fallback, `response.model`);
  2. `stop_reason === "max_tokens"` → `ClaudeCallError("max_tokens")`;
  3. any other `stop_reason` than `end_turn` → `ClaudeCallError("unexpected_stop")`;
  4. `parsed_output === null` → `ClaudeCallError("parse_null")` (REC-5 step 1: the whole call fails).
  Only then is `parsed_output` read.
- `max_tokens: 20000`: the largest round value below the SDK's non-streaming ceiling, so no explicit timeout override is needed. A batch that does not fit ends as a typed `max_tokens` error, never as a truncated batch.
- Errors: SDK errors are mapped most-specific first, by class (`Anthropic.AuthenticationError`, `PermissionDeniedError`, `RateLimitError`, `BadRequestError`, `APIConnectionError`, `InternalServerError`, `APIError`, `AnthropicError`) to `ClaudeCallError` codes (`authentication`, `rate_limited`, `bad_request`, `connection`, `server`, `api`, `sdk`), keeping `status` and `request_id`. Retries stay at the SDK default (2; 408/409/429/5xx and connection errors).
- Prompt caching: `system` is two text blocks, the system prompt and the catalogue block, each with `cache_control: { type: "ephemeral" }`. Both are rendered from sorted data only (no dates, ids or household data). Everything volatile goes in the user message.
- The client is behind an interface (`StructuredModel`) so tests use recorded responses through the real SDK: tests construct `new Anthropic({ apiKey: "test", fetch })` with a `fetch` that returns recorded JSON bodies, so the real `beta.messages.parse`, header building, error classes and `parseBetaMessage` run. No production path is mocked.
- Model: `process.env.ANTHROPIC_MODEL`, trimmed; empty or unset → `claude-opus-5`.
- Credentials: generation is enabled when the environment provides a credential the SDK resolves from env (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, a selected `ANTHROPIC_PROFILE`, or the complete Workload Identity Federation set). Otherwise `createClaudeClient` returns a disabled status with a reason, and the generator throws `RecipeGenerationError("disabled")` (REC-2: no silent failure). The key is never read into our own variables, logged or stored.

## Alternatives
- Non-beta `client.messages.parse` + `zodOutputFormat`: the literal spec text, but it cannot send `fallbacks`, so REC-2's refusal fallback would be lost.
- `client.beta.messages.create` and parsing ourselves: works, but REC-2 names `parse`, and the SDK's parser is the tested path.
- Streaming (`beta.messages.stream().finalMessage()`): allows a larger `max_tokens`; not taken because REC-2 names `parse` and 20 000 output tokens is ample for a batch of ≤ 3 dishes plus thinking. Revisit if G4 hits `max_tokens`.
