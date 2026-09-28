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

The fix makes a `dish` sync create the catalogue nodes its edges need when they are missing. A
household's own ingredient has the same problem, by code reading (not reproduced): `syncRequests`
(`apps/worker/src/jobs/handlers.ts`) puts the change set's `dish` request **before** its household
`catalogue` request in the same job. A change set that adds a private ingredient and a dish using
it would sync the dish first, and it would fail on every retry, since the order does not change.

Answer at CP1 (R-70): include the household scope. The guard syncs the catalogue of each scope
with a missing node, global first. Reproduced once the test existed: with the pre-fix `syncDishes`,
the household case fails (`packages/graph/test/startup.int.test.ts`, and through the real
`kg.sync` handler and `syncRequests` in `apps/web/test/api/kg-startup.int.test.ts`, where it fails
on every attempt).

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

## SPEC-Q-4, superseded at CP3 (finding 3)

The architect's CP3 ruling replaces the ", " joiner. Ingredient lists are plain English: "a", "a and
b", "a, b and c", and, when any name has a comma of its own ("Chicken breast, skinless"), semicolons
between items ("lemon juice; chicken breast, skinless; and garlic"). Names are lower-cased
mid-sentence, except where the first word is a demonym or a place name in the catalogue (Greek,
French, Swiss, Egyptian, English, Arabic, Atlantic, Brazil, Brussels, Worcestershire, Akkawi,
Nabulsi: `PROPER_FIRST_WORDS` in `score.ts`). 1.2.3's merged `score.test.ts` pins "Reuses x, y" for a
call without display names (raw ids), so the prose list applies when names are supplied (every
production path through `run.ts`); a structural call without names keeps the raw id list.

## SPEC-Q-9: CP3 finding 1, 1.4.1 G2 under the concurrent reverify

In the architect's `--reverify --jobs 4` run, 1.4.1 G2 (run from this ledger's G3) received 0 of 18
events live (done after 23 s; about 9 s alone). What was tried here, on this container:

| Experiment | Setting | 1.4.1 G2 result |
|---|---|---|
| A | alone, with 6 busy CPU processes on 4 CPUs; `dist` checksummed before and after | 19/19 live, done after 21.8 s; `dist` unchanged |
| B | this ledger's G2 alone, sampling `pg_stat_activity` every second | (G2 passed) peak 59 of 100 connections; no "too many clients" in the server log for this session, both concurrent reverifies included |
| C | beside 1.4.1 G1, with a planted old file in `packages/db/dist` (1.4.1's own staleness rule is "oldest dist file") | 18/19 live, 10.1 s; 1.4.1 did not rebuild |
| D | beside a full `next build` of apps/web | 18/19 live, 14.9 s |

1.2.6 G2's in-place rebuild (1.2.2's gates) cannot overlap it: 1.2.6 G2 runs only after every other
gate of the ledger has ended (the exclusive lock; G3 ended at about 210 s in each run here).

Reading: the failure is real and was not reproduced here, so no single concurrent process is named as
its cause. The first concurrent reverify after the fix above (1.4.1 G2 alone) failed elsewhere in
the same way: 1.4.8 G1's "undo through the change log puts both days back exactly" hit its 5 s
vitest budget while two regression gates ran beside the other gates' own checks (a `next build`,
Playwright, several worker runtimes). Other leaves' tests carry fixed 5 s and 10 s budgets, so any
nested regression is exposed to whatever else the ledger runs.

The fix is structural: each gate runs its own checks concurrently, as before, and all its
regression gates afterwards, in the exclusive phase. That phase starts only when every other gate has
finished its own checks, and one gate's regressions run at a time, two in parallel. 1.2.6 G2 and
1.4.1 G2 run by themselves at the end of their lists. With the gates in parallel, the gate whose
regressions run last ends last (measured in the PR).

## SPEC-Q-10: "close to" a target (CP3 finding 2)

The plate fit is the solver's 0–1 score (1 = dead centre). Reasons say it in words: every targeted
plate with fit ≥ 0.75 (`CLOSE_FIT`) reads "Close to Omar's and Sara's targets"; otherwise the member
furthest off is named ("Furthest from Omar's target; close to Sara's"). No number appears in a reason;
G1 rejects a bare decimal in any reason.

## SPEC-Q-11: dates in the change log (CP3 finding 4)

Every ISO date in an entry's title (resolved or stored summary), subject and undo reason reads as the
ChangeLog mockup writes dates ("Mon 28 Sep"), with the year added when it is not the current year in
the household's time zone. Plan dates are calendar dates and are not shifted between time zones. The
stored summaries are unchanged; the API returns the readable text.
