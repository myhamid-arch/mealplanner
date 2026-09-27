# Leaf 1.2.6 — spec questions and decisions

Owner rulings OQ-8 and OQ-9 (R-62). Each item states the reading taken and why, and how the
architect settled it (R-63).

## SPEC-Q-1 (settled by R-63: rule (a)): a dish that fits both a main slot and a snack/workout slot

04 §6.3 gives the gap by slot kind: main-meal slots need a day difference ≥ 7, `snack`,
`pre_workout` and `post_workout` ≥ 4. It does not say which gap applies between two servings of one
dish in slots of different kinds (served at Monday's breakfast, then considered for Thursday's
snack). 16 of the 62 seed dishes list slots of both kinds.

The frequency filter compares a candidate with every other served meal in both directions (the day
plan looks back at earlier days and at locked meals after the date; the week improvement pass
re-checks a meal against meals on both sides). A rule that looks only at the slot being planned is
therefore asymmetric: whether the pair (Mon breakfast, Thu snack) is allowed depends on which of the
two was planned first.

Measured on this branch's base with each candidate rule in `filters.ts` (F1 week, seeds 1–10, AI
off; 1.2.3 G2's own measurement code for SC-2; a scratch probe for SC-1 and relaxations):

| Rule for a pair of servings | SC-2 min | SC-2 median | SC-2 max | SC-1 (10 seeds) | frequency-relaxed meals |
|---|---|---|---|---|---|
| (a) larger gap of the two slots (symmetric) | 2.1 % (seed 1) | 9.9 % | 14.3 % | 680/680 | 5 (Sun breakfast, seeds 4, 5, 6, 8, 9) |
| (b) gap of the slot being planned (asymmetric) | −1.1 % (seed 1) | 11.6 % | 15.0 % | 680/680 | 5 (Sun breakfast, seeds 4, 5, 6, 8, 9) |
| (c) smaller gap of the two slots (symmetric) | 1.1 % (seed 1) | 11.8 % | 18.4 % | 680/680 | 4 (Sun breakfast, seeds 4, 5, 6, 8) |
| (d) architect's measurement patch: 4 only for dishes whose `slotKeys` are all snack/workout, else 7 (by dish, not slot) | 6.2 % | 9.0 % | 14.2 % | 674/680, 6 flagged | 20 |
| merged rule: 6 for every slot | — | — | — | 677/680, 3 flagged | 27 |

Row (d) reproduces the R-62 figures exactly (seed 1: 67/68, 2 snacks relaxed on day 7), so the
harness matches the architect's. Every slot-based rule (a–c) meets the median threshold (≥ 8 %)
but fails "every seed ≥ 5 %" on seed 1. Per the dispatch note, I stop here and do not tune the
threshold.

R-63 chose (a) and set the floor to "no seed below 0 %" (economy never adds ingredients).

Recommendation at CP1 if the rule stays slot-based: (a), the larger gap of the two slots. It is
symmetric, so planning order and the improvement pass agree, and it is the conservative reading of
the owner's "main meals repeat a dish only after 6 full days" (a dish eaten as a main meal does not
come back as a snack three days later).

## SPEC-Q-2: custom slots

04 §6.3 names `snack`, `pre_workout` and `post_workout` as the short-gap slots. Every other slot key,
including custom slots, takes the main-meal gap (the conservative reading).

## SPEC-Q-3: `frequency_rule` on the dish

A household-level `frequency_rule` with `min_gap_days` on the dish replaces the default in every
slot (04 §6.3: "replaces the default for its dish"), with its days-apart meaning unchanged: blocked
while the day difference is below `min_gap_days`. Member-level dish rules and rules on
ingredients, cuisines and methods add to the default, as today.

## SPEC-Q-4: exclusion unique key and canonical scope

The unique key becomes `(household_id, member_id, kind, key, slot_keys)` with `NULLS NOT DISTINCT`,
so one member can hold the same exclusion with different scopes. Array equality is order-sensitive,
so the `exclusion.add` op stores `slot_keys` canonical: de-duplicated, sorted, non-empty (an empty
list is rejected; null means every slot). Database checks: `slot_keys IS NULL OR
cardinality(slot_keys) > 0`, and `reason <> 'allergy' OR slot_keys IS NULL`. An unscoped and a
scoped row for the same key may coexist; the planner applies their union. `exclusion.add` with an
existing row of the same member, kind, key and scope updates its reason and hardness (as today); a
different scope inserts a new row.

## SPEC-Q-5 (accepted; amended at build, R-15 request): exclusion readers outside the planner

The planner (`Household` contexts per slot) and the follow-up engine read the scope. Other readers
of exclusion rows (AI recipe context and validation, the knowledge-graph substitute filter, the
onboarding resolver) are not in this leaf and keep treating every row as applying everywhere. That
over-restricts a scoped row, which is the safe side; allergy rows, the only ones the cook sheet's
allergy banner reads, are never scoped.

Amended at build: `ExclusionRow.slotKeys` is required (`string[] | null`), not optional as planned.
1.1.2's `packages/db/src/repos/entity-types.ts` asserts each core row type equals the Drizzle
select type exactly. Rows built in code (the graph's SQL reader, test fixtures) set it; the planner
and the follow-up engine still read a missing value as "every slot".

## SPEC-Q-6 (granted as R-14): insights default gap (FBK-6)

`packages/core/src/learning/rules/config.ts` (1.3.3) compares a proposed `min_gap_days` with its
own `DEFAULT_MIN_GAP_DAYS = 6` to label a frequency proposal "more" or "less" often. With OQ-8 the
default is 7 (main) or 4 (snack/workout).

Done under R-14: `config.ts` takes the planner's constants (`DEFAULT_MIN_GAP_DAYS` = 7 for the
fingerprint's more/less direction, and `defaultMinGapDays(slotKeys)`). The proposal copy "instead
of every N" was a literal 6 in `frequency.ts`; one line there now names the dish's current gap:
its household rule's `min_gap_days`, else the default of the slots it was served in during the
review window (4 only when every one is a snack or workout slot, else 7).
