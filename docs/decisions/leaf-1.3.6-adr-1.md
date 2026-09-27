# leaf-1.3.6 ADR-1: recipe output budget sized from a measured per-dish output

Status: accepted (CP1, BLD-8 R-66)

## Context
- The live 1.3.1 G4 run (`docs/build/live/leaf-1.3.1-G4.log`, 2026-09-27T09:13:25Z, `claude-fable-5-1`) failed: the 3-dish F1 dinner request ended at `max_tokens` = 20 000 (leaf-1.3.1 ADR-1 chose 20 000 as the largest round value below the SDK's non-streaming ceiling of 21 333, and said to revisit it if G4 hit `max_tokens`).
- **Measurement** (`docs/build/live/leaf-1.3.6-budget-measure-1.log`, 2026-09-27T11:05:35Z). The same request `buildRecipeRequest` builds, with the same system blocks, schema, effort `high`, adaptive thinking and fallback, was streamed with `max_tokens` 64 000:

  | dishes | stop_reason | output tokens (thinking included) | per dish | seconds |
  |---|---|---|---|---|
  | 3 | end_turn | 24 932 | 8 311 | 244 |
  | 1 | end_turn | 9 069 | 9 069 | 97 |

  A 3-dish batch needs about 25 % more than the whole 20 000 budget. Output grows about linearly: 1 137 + 7 932 × n, fitted to these two points.
- **SDK (0.128.0).** `beta.messages.create`/`parse` throws "Streaming is required …" when `max_tokens` > 21 333 and no timeout is given (`calculateNonstreamingTimeout`). With an explicit `timeout` request option, the check is skipped. Streaming (`beta.messages.stream().finalMessage()`) also parses structured output. Model maximum output: 128 000 (`claude-api` skill: Fable 5.1 "128K max output").
- **Constraints outside this leaf's OWNS:**
  - `scripts/verify/leaf-1.3.1.mjs` G1–G3 drive `generateRecipes` and `model.parse` with **recorded JSON (non-streaming) responses**. One 3-dish response gives one call; the defect run asserts `calls === 2`.
  - `scripts/verify/leaf-1.4.1.mjs` asserts `recipe.generate` makes `calls === 1` from one recorded response.

## Options
1. **Split per dish** (one call, or one conversation turn, per dish). Each call fits 20 000 easily (9 069 measured for one dish). Rejected:
   - It changes the call count and the recorded-response shape that 1.3.1 G1–G3 and 1.4.1 assert, in files this leaf cannot edit.
   - REC-5's "one follow-up call" has no clear meaning across several per-dish conversations.
   - It triples the cached-prefix reads and sequential latency.
2. **Streaming with a large budget.** REC-2 names `messages.parse()`. The recorded JSON fixtures that 1.3.1's verify script replays would no longer be accepted (a stream needs SSE bodies). Rejected for the same OWNS reason.
3. **Measured budget on the same non-streaming `parse`, with an explicit timeout (chosen).**

## Decision
- `StructuredRequest` gains an optional `maxTokens`. Callers that omit it keep `MAX_OUTPUT_TOKENS` = 20 000: onboarding parse, review extraction and insights are unchanged.
- Recipe budget: `recipeMaxTokens(n) = min(128 000, 20 000 × n)` for n dishes requested in that call. The first call uses `context.count`; the REC-5 follow-up uses the number of replacements it asks for.
  - 20 000 per dish is 2.4× the measured 3-dish mean (8 311) and 2.2× the measured 1-dish total (9 069).
  - 3 dishes → 60 000 (2.4× the measured 24 932); 1 dish → 20 000 (as today); the agent's `create_recipe` maximum of 5 → 100 000.
- The call passes the request option `timeout = max(10 min, 60 min × max_tokens / 128 000)`. This is the SDK's own scaling formula, applied explicitly so that the SDK's non-streaming guard does not refuse the call: 60 000 → 28 min 8 s. At the measured ~100 tokens/s, a full 60 000-token response takes about 10 min, and the measured 3-dish response took 4 min. SDK retries stay at 2.
- A response that still reaches the budget is the existing typed `ClaudeCallError("max_tokens")`, whose message now names the actual budget. The generator records the call and saves nothing (REC-2, REC-5). The `ai_generation` request summary records the budget used.

## Consequences
- The 1.3.1 recorded tests and verify scripts see the same calls and bodies, except that `max_tokens` scales with the count. `packages/ai/test/recipes/g3-errors.test.ts` (in this leaf's OWNS) asserts the new value.
- Worst-case latency grows with the budget, not the typical case: a 3-dish call takes as long as the model's actual output.
- Risk: a long non-streaming HTTP request can be dropped by an intermediate proxy. The measured 3-dish call (4 min) fits comfortably within timeouts. If drops appear in production, the fix is option 2, together with SSE fixtures in 1.3.1's verify script (an architect-owned change).
- G1's verify script reads the measurement logs `docs/build/live/leaf-1.3.6-budget-measure-*.log` and asserts `recipeMaxTokens(n) ≥ 2 × measured(n)` for every logged measurement. The negative control is the old fixed 20 000, which fails it against the 3-dish measurement. `--measure <n>` in the same script re-runs the measurement live, so the logged numbers are reproducible and not hard-coded.
