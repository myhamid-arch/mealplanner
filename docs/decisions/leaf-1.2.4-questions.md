# leaf-1.2.4 spec questions

Each question states the conservative reading this leaf builds on. None blocks a gate.

## SPEC-Q-1: what "share ≥ 70 % of their ingredients" measures (G2, DM-3)
DM-3 says variants SHOULD share their core ingredients; REC-5 step 4 makes it measurable: "share ≥ 70 % of their non-fat, non-coating ingredients by weight". Reading taken, for two variants `a`, `b` of one component:
- Drop fat (ingredient category `oil_fat`, or any row with `is_absorbed_oil`) and coating rows (`role_note = "coating"`), and cooking liquids marked `absorbed` (the boiling water of rice is not an ingredient the dish is made of).
- Normalise the remaining raw grams of each variant to shares `pₐ(i)`, `p_b(i)` (summing to 1 per variant; a slug listed twice is summed).
- `shared(a, b) = Σᵢ min(pₐ(i), p_b(i))`, the weighted overlap. It is 1 for identical ratios and 0 for disjoint sets.
- A component qualifies when it has ≥ 2 variants and **every pair** of its variants shares ≥ 0.70 (stricter than "some pair"). A dish qualifies when at least one component qualifies. G2 requires ≥ 70 % of the active dishes (adjusters excluded) to qualify.

## SPEC-Q-2: "feasible for both targeted adults at their dinner target" (G4)
- Targets are what 1.2.2's `resolveSlotTargets` produces for the F1 fixture (`f1Config()`) over the F1 week, dinner slot only, with R-28's per-slot kcal band. Adult A and Adult B each have a `default` and a `training` dinner target in that week; the distinct (member, day kind) targets are used (identical dates give identical targets).
- A dish counts as feasible only if `solvePlate` returns `in_tolerance` in strict mode for **every** one of those targets for **both** adults, with the seed adjusters of `data/adjusters.json` offered (up to 2 per plate, PLN-6, as the planner runs it) and empty appeal. **Amended by R-31** (the proposal was: without adjusters). The rate without adjusters and the failing dishes are printed alongside, not gated. Threshold ≥ 80 %.
- Only dishes whose `slot_keys` include `dinner` are in the denominator; G1 requires at least 8 of them, and the library has many more (the PR reports the count).

## SPEC-Q-3: "every slot type has ≥ 8 suitable dishes" (G1)
The slot types are the eight PLN-2 defaults. A dish suits slot key `k` when its `slot_keys` contains `k` (PLN-9 §6.3), plus the packed rules of §6.3: `packed_work_lunch` also requires `is_packable`; `packed_school_lunch` (no reheat in PLN-2) also requires `is_packable` and `served_cold_ok`. The §6.3 equivalence "`packed_*` → `lunch` dishes with `is_packable`" is **not** used to reach the count: every packed-suitable dish lists the packed key explicitly, so the count does not depend on the planner's equivalence rule. Adjusters are not counted.

## SPEC-Q-4: what "nutrition validation" covers (G3)
For every variant of every seed dish and adjuster:
1. Every `ingredient_slug`, `method` and `cuisine` resolves (REC-5 step 2), and `min_serving_g ≤ default_serving_g ≤ max_serving_g`.
2. A method-yield row exists for every (method, ingredient category) pair used (NUT-5).
3. The 1.2.1 engine computes the variant without error, and the stored `reference_batch_cooked_g` equals its cooked batch within 1 g.
4. The R-30 variant energy check (`variantAtwaterCheck`) passes (≤ 12 %).
5. Every ingredient used passes NUT-4 under R-22 (generic, or with its own factors, within 12 %), and none has `nutrition_confidence: low` (a `low` ingredient is marked `needs_review` by the loader, R-17, and would pull the dish out of planning).
6. NUT-6: every quantity is a number of grams; any step that says "to taste" names a gram value.

## SPEC-Q-5: plates measured for G6
G6 re-runs 1.2.2's G4 measurement on the seed library instead of 1.2.2's test dishes (R-16): every F1 targeted member-slot target of the F1 week × every seed dish suitable for that slot (SPEC-Q-3 rule), solved in strict mode with the seed adjusters offered (the planner's configuration), plus the F1 children's untargeted plates for every dish. Identical targets are solved once. "No component outside [min, max]" is checked on every returned plate, adjusters included, together with the grid; the median ratio deviation `Σ|g − ρG| / G` (R-25's definition) is taken over the in-tolerance plates.

## SPEC-Q-6: pork and alcohol
F1 declares no religious exclusion, but the reference locale is Abu Dhabi. The seed library uses no ingredient flagged `contains_pork` or `contains_alcohol`, so a household that excludes them (R2-ONB-3) keeps the whole library. G1 asserts it. This is a content choice, not a new rule for other leaves.

## SPEC-Q-7: low-confidence ingredients (correction to SPEC-Q-4 item 5; ARCHITECT QUESTION on PR #8, pending)
SPEC-Q-4 item 5 barred every `nutrition_confidence: low` ingredient on the premise that the loader marks it `needs_review`. Under R-17 and R-22 the loader marks `needs_review` only for an ingredient that fails NUT-4 after its own factors, so the premise is wrong, and the rule would exclude `zaatar` (which the brief expects to carry sesame) and `labneh`. Reading taken: every ingredient used must pass NUT-4 under R-22 (this excludes `vinegar`, `apple-cider-vinegar`, `coffee-brewed`, `vanilla-extract` and the cooking wines); `low` ingredients that pass are allowed, and G3 prints which dishes use them. They are limited to `labneh-zaatar-wrap` (labneh, za'atar) and `adjuster-labneh-light` (labneh), so a reversal is a two-record swap.
