# Leaf 1.3.7 — spec questions

## SPEC-Q-1 (blocks G1): `exclusion.add` cannot exclude a dish

**Finding.** G1 (W-23, R-82) asks for "a soft exclusion of that dish scoped to the household's packed slot keys", made with the existing `exclusion.add` op and 1.2.6's `slot_keys`. The current code cannot express it:

- `EXCLUSION_KINDS` is `ingredient | category | dietary_flag` (`packages/core/src/types/enums.ts:191`, the `exclusion_kind` pg enum, 02 §6). There is no `dish` kind, so `exclusion.add` rejects `{ kind: "dish", key: <dishId> }` at `ChangeOpSchema`, and the guardrails would drop the draft as `invalid_payload`.
- The planner applies exclusions only to ingredients, categories and dietary flags (`planner/select/members.ts` `exclusionsOf`). It never reads `exclusion.hard`: every exclusion row is a filter. "Soft" therefore has no planner meaning today.

**Options.**

- **(a) Recommended.** Add `dish` to the exclusion kinds; the key is the dish id. A slot-scoped `dish` exclusion removes that dish from those slots for the members it covers (household-level: everyone). The rule proposes `{ memberId: null, kind: "dish", key: dishId, reason: "other", hard: false, slotKeys: <the household's active packed slot keys> }`. "Soft" means `hard: false` with a non-protected reason: the exclusion is advisory in the DM-5/AGT-5 sense (never protected, removable by any later proposal or edit), while the planner still keeps the dish out of packed slots, which is what the practical tags ask for. Files outside OWNS (architect-applied or granted):
  1. `packages/core/src/types/enums.ts`: `EXCLUSION_KINDS` gains `"dish"`;
  2. `packages/db/src/migrations/0008_*.sql` + `meta/**` snapshot: `ALTER TYPE exclusion_kind ADD VALUE 'dish'`;
  3. `packages/core/src/planner/select/members.ts` (`Exclusions` gains `dishIds`) and `planner/select/filters.ts` or `run.ts` (a dish whose id is excluded for an attendee at the slot is not a candidate);
  4. `packages/core/src/changes/ops/taste.ts` `exclusionAdd.apply`: a `dish` key must name a dish the household can see;
  5. `packages/core/src/learning/rules/satisfied.ts` `exclusion.add`: a row satisfies the op only when its scope covers the op's scope (today a `packed_school_lunch`-only row would satisfy a proposal for both packed slots).
- (b) A household-level `preference.set` on the dish with a negative score. Soft, and needs no schema change, but it is not slot-scoped: it would lower the dish at dinner too. Does not meet the gate text.
- (c) `hard = never` on the dish. Not slot-scoped and not soft. Rejected.
- (d) `dish.update` of `is_packable`. Rejected by the architect's ruling (seed dishes are global; `dish.update` is household-only).

**Until ruled:** the rule, its tests and the G1 verify script are built against (a). If (a) is refused, G1 cannot pass as written and needs an architect ruling on the op.

## SPEC-Q-2 (G3): what "saves a draft dish (not active)" means

`recipe.draft` (R-46, R-53) runs the generator with `save: false`. It writes no `dish` row: each draft lives in the job result with the exact `dish.create` ops its Save applies through `POST /change-sets`, and those ops create the dish as `active` (`generation.ts:218`). `dish.status = draft` is never written by this path.

**Reading taken (conservative, no code change):** after the job succeeds, the household has no new dish row, so the planner cannot pick the draft; the job result holds one draft dish whose example plates are for the requested date and slot (one plate per attendee, named); applying its ops through `POST /change-sets` creates the dish as `active` with the drafted components and variants. Negative control: a schema-failing recorded response fails the job, the result holds no draft, and no dish row is written. If the architect wants a stored `dish.status = draft` row, that is a change to `apps/worker/src/jobs/recipe-draft.ts` and is a request.

## SPEC-Q-3 (G2): running the worker's handler from a `packages/db` test

G2's test file is `packages/db/test/nutrition-recompute*.int.test.ts`. `packages/db` does not depend on `apps/worker`. The worker's handler (`apps/worker/src/jobs/handlers.ts:127`) is `recomputeNutrition(ctx.rt.db, { householdId: ctx.job.householdId, factorsBySlug: ctx.rt.factorsBySlug })`.

**Reading taken:** the test imports the worker's `nutritionRecompute` handler from `apps/worker/src/jobs/handlers.ts` by path and calls it with a job context holding only what the handler reads (`job.householdId`, `rt.db`, `rt.factorsBySlug` from the catalogue data file), so the code under test is the worker's own. If importing across the package boundary is not acceptable, the fallback is to call `recomputeNutrition` with the handler's exact arguments.

## SPEC-Q-4 (G1): `took_too_long` threshold and slot

`took_too_long` has no slot meaning (R-82), so it is counted on every slot, not only packed ones. It becomes a digest note on a dish at the same threshold as the packing tags (≥ 2 reviews in the 30-day rule window, like FBK-7 rule 3's repeats), so a single slow evening does not produce a note.

## SPEC-Q-5 (G1): how the packing reviews are counted

"At least 2 household reviews": distinct top-level reviews by any members of the household, in the rule window (`REVIEW_WINDOW_DAYS`), whose meal (`planMealId`, or a `plan_meal`/`plate` target) is in a slot with `isPacked`, whose dish is the dish, and that carry at least one of `hard_to_pack`, `went_soggy_in_box`, `cold_is_bad` (the three count together). A review with no meal context is not counted: it cannot show the dish was eaten from a box. The proposal scopes the exclusion to every active packed slot of the household, not only the slots the reviews came from (the gate: "the household's packed slot keys").
