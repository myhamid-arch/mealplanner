# leaf-1.3.2 ADR-1: preference learning, keys and the write path

Status: proposed (CP1)
Requirement: FBK-2, FBK-3, FBK-4, FBK-5, DM-6, SC-3; BLD-8 R-7, R-24
Libraries: none added. Uses `zod` 4.6.5 (already in `@mealplanner/core`) and `drizzle-orm` 0.45.3 (already in `@mealplanner/db`).

## Context
FBK-4 defines the score as `Σ(wᵢ·sᵢ) / (Σwᵢ + k)` with `k = 2`, stored as "the weighted sum and the total weight". 02 `preference` has `score` and `evidence_weight`, both `numeric(10,3)`, and no weighted-sum column. Every learning write must go through a `learning` change set (DM-6), using the existing `preference.set` and `portion_bias.set` ops (R-7, R-24). No new op or column is needed.

## Decision
**Pure core, I/O in db.** `@mealplanner/core/learning/preferences` and `@mealplanner/core/learning/portions` are pure functions over plain inputs. `@mealplanner/db/services/reviews` loads rows, builds the pure inputs, and applies the resulting ops through `applyChangeSet(…, { actor: "system", source: "learning" })`.

**Entity keys.** One helper module defines every key, and the planner reads keys through it:

| entity_type | entity_key |
|---|---|
| `dish` | dish id |
| `dish` (variant) | `<dishId>#<variantId>` (FBK-4) |
| `ingredient` | ingredient id |
| `cuisine` | cuisine key |
| `method` | preparation-method key |
| `component_role` | role name |

Ids match `review.target_id`, so a review's target key is its preference key.

**Incremental update.** For an existing row with `score = S` and `evidence_weight = W`, the weighted sum is recovered as `Σws = S·(W + k)`. Adding contributions `(wᵢ, sᵢ)` gives `W' = W + Σwᵢ` and `S' = (S·(W + k) + Σwᵢsᵢ) / (W' + k)`. Both values are rounded to 3 decimals, as the column stores them. Each weight is rounded to 3 decimals before use, so the stored `evidence_weight` equals the sum of the FBK-4 weights as written. The rounding error on the score is at most 0.0005 per update, and the change is not otherwise lossy.

**One contribution per key per review.** Contributions to the same key in one review are summed (for example, two eaten variants with the same method). The method key receives the weight once per review, because "each eaten variant's method" names methods, not variants. A distinct method receives 0.3.

**Locked.** Learning reads the key's rows first and never emits `preference.set` for a locked `learned` row (SPEC-Q-8). The `preference.set` op also refuses that write, as a second line of defence.

**Portion bias.** `bias' = round3(clamp(bias · factor, 0.6, 1.6))`. The factors are 0.9 and 1.1, and the op is `portion_bias.set` (R-24). It refuses a targeted member. The core function returns no update for a targeted member, so that refusal is never reached.

**One change set per review.** Its summary is "Learned from <member>'s review of <target>", so the change log (R2-ADM-7, "learned automatically") shows one entry per review, and each entry can be undone.

## Consequences
- No schema change is needed for learning. Review edit history (SPEC-Q-11) is a separate request.
- The planner (1.2.3) calls `evaluateAppeal` with the plate's chosen variants. `kgSimilarityTerm` is an input that defaults to 0 until 1.3.4 supplies it.
