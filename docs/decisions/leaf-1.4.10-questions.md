# Leaf 1.4.10: spec questions

Each question records the reading this leaf builds on. Where the spec leaves room, the more
conservative reading is chosen (BLD-7 rule 6).

## SPEC-Q-1: where display names reach the planner (W-12, G1)

The planner's pool knows each ingredient's `id`, `slug`, `category` and `dietaryFlags`
(`PlanIngredient`, `packages/core/src/planner/select/types.ts`) and each dish's `cuisineKey`, but no
display name or cuisine label. `run.ts` labels ingredients with `pool.slugById`, and `score.ts`
prints `dish.cuisineKey`.

Reading: the names travel with the dish, like the slug does, so every path that builds or re-solves
a meal (plan jobs, swaps, moves, substitutions, previews) gets them without passing a separate map:
an optional `name` on `PlanIngredient` and an optional `cuisineLabel` on `PlanDish`, set by the
database loader (`toPlanDishes`) and by the substituted copy (`replaced()`). The fields are optional
so the structural test dishes of other leaves stay valid; where a name is missing (only in those
tests), the reason falls back to the slug or key made readable ("beef mince extra lean",
"tex mex"), never the raw slug. This needs single-entry edits outside OWNS (see the PR's Requests).

## SPEC-Q-2: reasons already stored in plans (W-12, G1)

`plan_meal.score_breakdown.reasons` is stored text. Plans made before this leaf keep their slug
wording until the meal is planned, swapped, moved, substituted or re-solved again (each re-scores
the meal and stores new reasons).

Reading: stored reasons are not rewritten (no migration; the spec asks for no migration only for
change sets, and rewriting free text by pattern would be guesswork). The Plate shows what is stored.

## SPEC-Q-3: "this week" in the cuisine reason (W-12, G1)

The spec's example is "American food is already on 6 other days this week". The count is of other
meal-days inside the economy window (`economy_window_days`, default 7), not the calendar week.

Reading: "this week" when the window is 7 days, "in these N days" otherwise, so the sentence stays
true for a household with another window.

## SPEC-Q-4: joining ingredient names that contain commas (W-12, G1)

Catalogue names contain commas ("Basmati rice, white", "Beef mince, 95% lean"). 1.2.3's
`score.test.ts` expects a reason starting "Reuses x, y" (names joined with ", ").

Reading: names are joined with ", " as today (1.2.3 G1–G6 must still pass unchanged), and the
catalogue names are used verbatim. The reason is read on the Plate next to the dish's own
component list, so the rare ambiguity costs little; the alternative breaks a merged test.

## SPEC-Q-5: what "equals `pnpm kg:rebuild`'s" compares at start-up (W-13, G2)

`kg:rebuild` derives the catalogue, every dish, members, preferences **and** the library edges
(`PAIRS_WITH`, `TYPICAL_IN`), which KG-3 recomputes nightly (`kg.nightly`, from 01:00 UTC). The two
start-up jobs never computed library edges, before or after this fix. 1.3.4's own G1 compares the
incremental sync **plus** the nightly recompute with the rebuild.

Reading: G2 checks two equalities on the canonical snapshot (1.3.4's `snapshot()`, natural keys, no
ids or timestamps): (a) right after the start-up jobs, the graph equals the rebuild's with the
library edge types left out of both sides; (b) after the `kg.nightly` job also runs, the graph
equals the rebuild's exactly. The start-up does not start computing library edges (not asked).

## SPEC-Q-6: household-scoped nodes in the same guard (W-13, G2)

The fix makes a `dish` sync create the catalogue nodes its edges need when they are missing. The
same race exists for a household's own ingredient: `syncRequests`
(`apps/worker/src/jobs/handlers.ts`) queues the change set's `dish` request **before** its
household `catalogue` request, so a change set that adds a private ingredient and a dish using it
syncs the dish first.

Reading (pending the architect's answer at CP1): the guard covers the scope of the missing nodes,
global and the dish's household, since it is the same code path; G2 tests the global case the gate
names, and a unit test covers the household case. If the architect prefers the narrower fix, the
guard is limited to global nodes and the household case is recorded as a finding.

## SPEC-Q-7: which change-log entries get a named subject (W-14, G3)

Change sets hold 1 to hundreds of ops (onboarding's "Household setup", plan saves). The spec's
examples are single-subject changes.

Reading:
- A change set whose forward ops all describe **one subject** (one login, one member, one dish, one
  slot, the household, the planning balance, one preset …) gets a title naming it, built from the
  ops and their before-images, and, for scalar fields, `detail.changes` (label, before, after).
- A change set spanning several subjects, or with an op this leaf does not describe, keeps its
  stored summary (which already names the dates or dishes for plan and recipe work) and gets no
  `detail`.
- An undo lists as "Undo: " + the undone entry's resolved title when that entry resolves.
- A subject that no longer exists (a deleted login or member, a deleted dish) leaves the entry with
  its stored summary and no `detail`.

## SPEC-Q-8: 1.4.6's e2e expects the old titles (W-14, G3 vs "1.4.6 G1–G2 still pass")

`apps/web/e2e/admin.spec.ts` (1.4.6 G1) asserts the change-log entry text "Block login", the button
"Undo: Block login", the status "Undone: Block login" and "Undo: Household settings". G3 requires the
entry to name its subject ("Blocked Priya (kitchen)") and requires that the old title-only rendering
fails. Both cannot hold without editing that spec.

Reading: the entry's title, its Undo button's accessible name ("Undo: <title>") and the undone status
use the resolved title. The four assertions in `admin.spec.ts` change to the new titles
(single-entry request). The change-set row lookups by stored `summary` in that file stay as they are.
