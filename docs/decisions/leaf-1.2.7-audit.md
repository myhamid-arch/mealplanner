# Leaf 1.2.7: where surrogate ids reach the plan search (W-17, R-73)

Audit of `packages/core/src/planner/select/**`, `packages/core/src/planner/solver/**`,
`packages/core/src/planner/cooksheet/**` and the loader `packages/db/src/services/plans/load-input.ts`
at 9fb7109 (the integration branch when this leaf was dispatched). An id "reaches" the plan when it
feeds a hash, a comparator or an order the search depends on. Maps, sets and memo keys that only
identify an object are not listed: a consistent renaming of ids leaves them equivalent.

Reproduced in core before any change: planning the F1 week with every surrogate id remapped
(reversed order, fresh bits; `support.ts` `remapInput`) and mapping the result back changes 42 of 78
meals at seed 1 and 66 of 78 at seed 2.

## Plan search (OWNS)

| Where (9fb7109) | What reads an id | Fix |
|---|---|---|
| `select/day.ts:83` | pre-score jitter hashes `mealKey(date, slot.id, memberScope)` and `dish.id` | hash the natural meal key and `dish.slug` |
| `select/day.ts:93` | ranked pool ties broken by `dish.id` | ties by slug (`pool.ts` `bySlug`) |
| `select/day.ts:224-225` with `:250`, `:447` | beam tie-break hashes and compares a path of dish ids | path of dish slugs |
| `select/improve.ts:210` | improvement alternatives: ties broken by `dish.id` | ties by slug |
| `select/filters.ts:34` via `meals.ts:20` | "previous meal" (SPEC-Q-9) between meals of one slot ordered by a meal key holding `slotTypeId` and the member id | the meal key is built from the slot key and the member's position (`run.ts` `mealKey`) |

Not affected: `solver/**` orders by input order, bounds and indices only (`combos.ts:17`,
`solve.ts:209`); `retarget.ts:319` and `members.ts:95` sort ids only to build memo keys;
`day.ts:128` and `:329` tie by positions in the ranked pool. Their inputs' order is fixed by the
loader (below).

## Loader (OWNS)

`toPlanDishes` ordered dishes, components (after `sort_order`), variants (after the default flag) and
variant ingredient lines by id. The planner reads that order: pool order breaks ties that
compare equal, component and variant order feed the solver's enumeration, and line order feeds the
nutrition sums and "Reuses …" reasons. `loadPlannedMeals` ordered each stored meal's plates by
member id and left meals of one date and time in query order. All of these now use natural keys.

## Outside OWNS (requests at CP1)

| Where | What reads an id | Needed for a gate? |
|---|---|---|
| `cooksheet/build.ts:202` | adjuster batches on the cook sheet ordered by adjuster dish id | no: the plan is unaffected; the stored cook sheet's batch order still differs between databases |

The configuration's row order (`loadHouseholdConfig`, repository `list()` ordered by primary key)
is creation order: UUIDv7 ids made in one process are strictly increasing (`schema/ids.ts`). The
planner reads `cfg.members` order as the members' natural order (SPEC-Q-1).
