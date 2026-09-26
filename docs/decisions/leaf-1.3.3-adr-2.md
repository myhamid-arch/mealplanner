# leaf-1.3.3 ADR-2: LLM synthesis request and output validation

Status: proposed at CP1.

## Context

FBK-7 stage 2 sends Claude these inputs:

- the rule candidates;
- the unprocessed review texts, pseudonymised;
- a summary of weights and settings;
- the last 20 rejected proposals with their decision notes.

It returns typed proposals (`kind` + `payload`) with a rationale and evidence review ids. It must not emit kinds outside the allowed set, and every proposal is Zod-validated before it is stored. G3: invalid kinds are dropped and logged.

## Decision

- **Client.** Reuse 1.3.1's `StructuredModel` (`@mealplanner/ai/client`: `createClaudeClient`, `resolveClaudeConfig`, `ClaudeCallError`). No second client is built. The model is `DEFAULT_MODEL`, or `ANTHROPIC_MODEL` when set. `resolveInsightsModel(env)` returns `{ model: null, reason }` when there is no credential. The reason is specific to insights: "insight synthesis is disabled: no Anthropic credential is configured (set ANTHROPIC_API_KEY)". `runInsights` then stores the rule candidates and reports `synthesis: { status: "disabled", reason }`. It is never silent.
- **Effort** `high`. The spec names none for insights. This is a low-volume, judgment-heavy call (at most nightly, or every 10 reviews).
- **Wire schema.** Structured outputs do not support free-form objects: every object needs `additionalProperties: false` (claude-api skill, JSON Schema limitations). Op payloads differ per kind, so each op is sent as `{ kind: string, payloadJson: string }`. Each proposal is `{ title, rationale, priority: 1–5, evidenceReviewIds: string[], ops: [...] }`, all inside `{ proposals: [...] }`. `kind` is a plain string, not an enum, so that a wrong kind reaches local validation instead of failing the whole parse.
- **Local validation.** Each proposal is checked in turn:
  - Each op's `kind` must be in the allowed set, `INSIGHT_KINDS`: `preference.set`, `preference.reset`, `exclusion.add`, `frequency.set`, `distribution.set`, `weights.set`, `ingredient.verify`.
    - These are the ops whose payloads the model can fill in from its input.
    - Any R-10 kind or statically protected kind is filtered out of the list in code. The system prompt carries each allowed kind's payload JSON schema (`z.toJSONSchema`), sorted so it caches.
    - Conditional protections, such as an `exclusion.add` that would relax an allergy, are checked again against stored state by the service's guardrails.
    - Built as proposed at CP1, except that CP1 proposed "all public kinds minus protected". A curated list keeps the prompt's schema block short and keeps the model to kinds it has the data for.
  - `payloadJson` must parse as JSON and pass `ChangeOpSchema`.
  - `evidenceReviewIds` must be a subset of the review ids sent.
  - A proposal with any invalid op is dropped whole; a proposal is not applied partially.
  - Every drop is recorded as `{ index, title, reason, kind? }`. The list goes into `ai_generation.validation_errors` through the `recordGeneration` port and is also returned as `dropped`.
  - The service's guardrails (ADR-1) then run on the survivors, as they do for rule candidates.
- **Pseudonymisation** (FBK-7, ARC-10).
  - Members are sent as labels ("Adult A", "Child A", …), using the same scheme as 1.3.1 (REC-3).
  - Review comments and rejection notes pass through 1.3.1's `scrubNames` (same package, `../recipes/context.js`).
  - Member uuids in rule candidates' payloads are replaced by the labels in the request. The model answers with labels, and the synthesiser maps them back to uuids before Zod validation. An unknown label is a drop reason.
  - The stable system block carries `cache_control`. The per-run data goes in the user message.
- **Errors.** A `ClaudeCallError` (refusal, max_tokens, parse_null, API errors) is recorded in `ai_generation` and returned as `synthesis: { status: "failed", code }`. The rule candidates are still stored.

## Consequences

G3 runs the real synthesiser against a stubbed `StructuredModel` that returns fixed outputs containing valid proposals, unknown kinds, protected kinds, malformed JSON, schema-invalid payloads and unknown evidence ids. G3 asserts which proposals survive and what was logged. A negative control swaps in a validator that accepts everything and requires the same assertions to fail.
