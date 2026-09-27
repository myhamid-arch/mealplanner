# leaf-1.3.5 ADR-1: the agent's streaming loop on `@anthropic-ai/sdk` 0.128.0

Status: proposed (CP1)

## Context

AGT-2 requires a manual streaming loop (`messages.stream` + `finalMessage()`), adaptive thinking, effort from `AGENT_EFFORT`, the server-side refusal fallback, `eager_input_streaming` on every client tool, Zod validation of every tool input, typed SDK errors, parallel tool results in one user message, `pause_turn` resumption and a 12-call cap. AGT-3 adds prompt caching and server-side compaction (beta `compact-2026-01-12`). The installed SDK is `@anthropic-ai/sdk` 0.128.0 (pinned by 1.1.1; used by 1.3.1).

Checked in the installed package (`resources/beta/messages/messages.d.ts`, `lib/BetaMessageStream.js`):
- `BetaTool` has `eager_input_streaming`; `BetaMessageCreateParams` has `fallbacks` (`BetaFallbacksParam`) and `context_management` with the `compact_20260112` edit; `BetaCompactionBlock` exists; `stop_reason` includes `pause_turn` and `refusal`; `stop_details` carries the refusal category.
- A tool input the stream cannot parse rejects with a plain `AnthropicError` ("Unable to parse tool parameter JSON from model …", `BetaMessageStream.js:603`), not an `APIError` subclass.

## Decision

1. **Beta surface.** `client.beta.messages.stream({...})` with `betas: ["server-side-fallback-2026-07-01", "compact-2026-01-12"]`, `fallbacks: "default"`, `context_management: { edits: [{ type: "compact_20260112" }] }`, `thinking: { type: "adaptive" }`, `output_config: { effort }`, `max_tokens: 64000` (streaming; no HTTP-timeout ceiling), `tool_choice` left at its default (`auto`; the default model rejects forced tool choice). `FALLBACK_BETA` is imported from 1.3.1's `client/config.ts` so the header has one source.
2. **Model.** `resolveClaudeConfig()` from 1.3.1: `ANTHROPIC_MODEL`, else `DEFAULT_MODEL` (R-32, R-44). `AGENT_EFFORT` ∈ `low|medium|high|xhigh|max`, default `high`; an invalid value is a startup error, not a silent default.
3. **Caching.** Tool definitions in a fixed order, then a stable system prompt block with `cache_control: { type: "ephemeral" }`; the household digest is the last text block of each user turn (AGT-3), after the cached prefix. History is only appended to (AGT-8), so each turn's prefix is the previous turn's request.
4. **Model port.** `AgentModel.stream(params, onEvent, signal) → Promise<BetaMessage>` wraps `stream.on("streamEvent")` for SSE deltas and `await stream.finalMessage()` in one `try`, so both iteration and the final read are covered by the same catch. Tests implement `AgentModel` with a scripted stub (recorded `BetaMessage` values and their stream events); production uses the SDK class. No other SDK surface is used by the loop.
5. **Errors.** Only the parse error in (Context) is caught as invalid JSON (`error instanceof AnthropicError && !(error instanceof APIError)` raised inside the port); everything else goes through 1.3.1's `fromSdkError` and ends the turn with a typed `error` event. SDK retries stay at the default (2) for 429/5xx.
6. **Validation.** Each tool has one Zod schema; its JSON Schema for `input_schema` is generated with `z.toJSONSchema` (zod 4.6.5, already a dependency) so the two cannot drift, and the parsed `tool_use.input` is `safeParse`d before any port is called.

## Consequences

- Compaction blocks and thinking blocks are stored and replayed verbatim; the loop never edits history, which the default model's history-editing check requires.
- Live behaviour (G4, the eval set) is a handoff while no credential exists; G1–G3 run against the stub model port and prove the loop's handling of each stop reason and error class.
