# leaf-1.2.3 spec questions

Each question states the reading this leaf takes. Unless marked otherwise, it is the more conservative reading, and the build continues on it until the architect rules.

## SPEC-Q-1: `requestDishes` and the planner's dish type (04 §11)
04 §11 types `requestDishes` as returning `DishForSolve[]`. `DishForSolve` (1.2.2) has no cuisine, slot keys, status, method keys or core ingredients, so scoring (PLN-9) and the hard filters (§6.3) cannot use it. Reading: `planDays` takes and `requestDishes` returns `PlanDish` (ADR-1 §7), which contains a `DishForSolve`. `requestDishes` receives a `PlanGenerationRequest` (date, slot key, count, palette, cuisines to avoid, dishes to avoid, trigger reason). This maps onto `GenerationContextInput` of `packages/ai/src/recipes/context.ts` without its `config`, which the 1.4.1 wiring supplies.

## SPEC-Q-2: member-day kcal assertion when a plate is infeasible (R-28, G1)
If every plate of a member-day is `in_tolerance` after re-targeting (ADR-1 §2), the day total is within ±`tolerance.kcal` by construction, and G1 asserts it. If a plate is `infeasible` (for example Adult B's training-day snack and pre-workout, 1.2.4 G6), its deviation carries into the running total. Later slots then correct it only as far as their P/C/F tolerances allow. Reading: such a member-day is **flagged with a reason** that names the infeasible slot or slots. G1 asserts the band for every member-day without a flagged plate, and prints every member-day total, flagged ones included. Targets and the solver are not tuned to hide the flags.

## SPEC-Q-3: order of re-targeting (R-28)
"Later slots" is read as later in time within the member's day (slot `default_time`, then `sort_order`). It is not the planning order, in which shared meals come before per-member ones (ADR-1 §2).

## SPEC-Q-4: SC-2 "distinct ingredients" (G2)
The count is the distinct **core** ingredients (PLN-9: excluding `herb_spice` and water, through the 1.3.2 `coreIngredients` helper) of every variant and adjuster served on any plate across the 7 days. This is what the economy component optimises. G2 also prints the count of all distinct ingredients, spices and water included. The baseline is the same seed and configuration with `ingredient_economy = 0`.

## SPEC-Q-5: `min_gap_days` (PLN-9 §6.3)
A dish is filtered for a meal when any attendee of the meal was served it fewer than `min_gap_days` (default 6) days away, in either direction, in the planned, locked or context meals. With the default of 6, the same dish can come back 6 days later. The gap is per attendee, not per household: with it per household, the 5 F1 members' daily snacks could not be filled from the seed library's snack dishes. `frequency_rule` rows add their own `min_gap_days` and `max_per_week` (per member when `member_id` is set, otherwise for everyone). They apply to their entity type: dish, ingredient (any core ingredient of the chosen variants), cuisine or method.

## SPEC-Q-6: exclusions as a hard filter (PLN-9 §6.3, §6.4)
A dish is filtered out of a meal when some attendee has no allowed variant for a **required** component, under the attendee's own and the household-level exclusions (ingredient, category or dietary flag, allergy or not, whenever `hard`). Otherwise the dish stays eligible. Each plate uses only the attendee's allowed variants, and an optional component with no allowed variant is left off that attendee's plate (the 1.2.2 solver already does both). A `hard = never` preference filters the dish if it is on the dish, or on a core ingredient present in every variant of some required component.

## SPEC-Q-7: adjuster list (PLN-6, R-9 d, R-31)
The adjusters offered are the global adjuster dishes (`data/adjusters.json` in tests) that suit the slot under the same slot rules as dishes. A `household_adjuster` row with `enabled = false` removes one. `planning_weights.adjusters_enabled = false` removes all. With no rows, every adjuster is offered.

## SPEC-Q-8: economy's kitchen penalty (PLN-9 §6.1)
"Subtract 0.05 for each distinct variant beyond 2 that the kitchen must cook for this meal" is read per component: 0.05 × Σ over components of max(0, distinct variants served − 2). Counting every variant of the meal would penalise a dish for having more components, which the text does not intend. The result is floored at 0.

## SPEC-Q-9: variety terms (PLN-9 §6.1)
- "Previous slot the same day" is the attendee-sharing meal immediately before it in time order on that date.
- "Same cuisine 3 times in the window" means the cuisine already appears on ≥ 2 other meal-days of any shared attendee in the economy window, so this would be the third.
- "Main protein ingredient" is the heaviest raw core ingredient of the served variant of the dish's first `protein`-role component. A dish without one has none.
- "Previous meal" is the same meal as in the first bullet.

## SPEC-Q-10: individual meals (R2-MEAL-1/2)
A slot with `is_shared = false`, or a `make_individual` override for the date, produces one meal per attendee (`memberScope` = member id). A `split_member` override takes its members out of the shared meal, and each of them gets an individual meal. Individual meals are planned after the shared meals (PLN-11). Each is labelled `individual`, and a split one records the shared meal it left ("+ <name>: own dish").

## SPEC-Q-11: raw equivalents and cook batches (DM plate_item.raw_equivalent, cook_batch)
`planDays` has no catalogue, so it cannot call `rawForCooked`. The raw equivalents of every plate item, and the batches, are computed by `buildCookSheet(plan, catalog)`. The cook sheet returns the per-plate raw equivalents as well, so 1.4.1 can store `plate_item.raw_equivalent` and `cook_batch` from one call.

## SPEC-Q-12: AI trigger (PLN-12) with `ask`
Core does no I/O and does not create proposals. With `ai_generation = ask`, a triggered slot is returned in `PlanResult.generationRequests` with its reason, and 1.4.1 turns it into the proposal. With `auto`, `opts.requestDishes` is awaited and the returned dishes join the pool for that meal and the rest of the run. With `off`, or without `requestDishes`, nothing is requested.

## SPEC-Q-13: weight presets (PLN-9 §6.2)
A `weight_preset` whose `applies_to_weekdays` contains the date's weekday overrides the weights it names for that date. If several match, the first by name wins. `weights_snapshot` is the merged set.

## SPEC-Q-14: G3 "50 seeded plans"
G3 means 50 F1 week plans with seeds 1…50 and the C3 sesame allergy loaded from the F1 fixture. `f1Config()` in `test/planner/targets/config.ts` leaves exclusions empty. G3 checks every C3 plate, adjusters included, for any ingredient flagged `contains_sesame`. The negative control plans the same 50 seeds with the exclusion removed, and must find sesame on a C3 plate at least once.
