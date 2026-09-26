# leaf-1.2.2 spec questions

Each question states the conservative reading this leaf builds on. None blocks a gate.

## SPEC-Q-1: interface additions to 04 §3, §4 and §11
- `SlotTarget` also carries `slotTypeId` (the planner joins plates to `slot_type` rows by id) and `carbBasis: "total" | "available"` (BLD-8 R-20: the solver must know which carbohydrate figure the target means).
- HiGHS loads its WebAssembly asynchronously; solves are synchronous afterwards (ADR-1). `solvePlate` keeps the 04 §11 synchronous signature, and the solver module adds `loadPortionSolver(): Promise<void>` (idempotent), which callers await once before the first solve. `solvePlate` throws `SolverError("not_loaded")` otherwise. `planDays` is async, so 1.2.3 can await it.
- `PlateSolution.status` also admits `"untargeted"` (PLN-7 plates; it matches `plate.fit_status` in 02 §5).
- `DishForSolve` and `MemberCtx` are named but not defined by the spec. They are defined in `planner/solver/types.ts` (see the PR plan) with only the fields PLN-5/6/7 read.

## SPEC-Q-2: untargeted members in the target resolver
PLN-4 says untargeted members skip steps 3–5, so `resolveSlotTargets` returns no `SlotTarget` for them (and none for archived members). The attendance rule of step 3 is still needed for their plates, so the resolver also exports `attendedSlots(cfg, memberId, date)`, the same function it uses internally, for 1.2.3.

## SPEC-Q-3: attendance of training slots and overrides
- A training slot (`is_training_slot`) is attended only on the member's training days, unless a `member_slot_schedule` row for that weekday says `attends = false`.
- A non-training active slot is attended unless a schedule row says `attends = false` (02 §2 coarse layer).
- `day_override(absent_slot)` removes the slot for that date; `day_override(extra_slot)` adds it. An inactive slot is never attended, even with `extra_slot` (nobody cooks it).
- `day_override(rest)` makes the day `default` and drops training slots; `day_override(training)` makes it a training day and adds them.

## SPEC-Q-4: detailed shares that do not match the day's attended slots
PLN-4 step 4 (Detailed) requires `meal_distribution` rows to cover every attended slot and sum to 1. On a date where an override changes attendance, they may not. Reading taken: if the rows for the day kind cover every attended slot, their shares for the attended slots are used, renormalised to sum to 1 (a no-op on a normal day). Otherwise the coarse weights apply to that member and date.

## SPEC-Q-5: expert overrides
`slot_target_override` fixes each non-null value (kcal, protein, carbs, fat) of an attended slot. For each nutrient separately, the remainder `T − Σ fixed` is spread over the attended slots without a fixed value, in proportion to their shares. A negative remainder is clamped to 0 (the fixed values win and the day then exceeds `T`). If every attended slot is fixed for a nutrient, the fixed values stand.

## SPEC-Q-6: rounding (step 5)
Rounding every slot independently can miss the daily total by up to half a gram per slot. Slot values are apportioned by largest remainder, so they are integers that sum exactly to the rounded daily target (ties broken by slot order). `satFatMax` and `solubleFibreGoal` are rounded to 0.1 g.

## SPEC-Q-7: default sat-fat cap (OQ-4)
When a targeted member's profile has no `sat_fat_max_g`, the daily cap is `household.sat_fat_default_pct` % of the day's kcal ÷ 9 kcal/g (default 10 %). The soluble-fibre goal is set only when `soluble_fibre_min_g` is set (OQ-4: no minimum by default).

## SPEC-Q-8: missing tolerance row
A targeted member without a `tolerance` row uses the 02 §2 defaults (P ±5, C ±5, F ±2, kcal ±50) with the household's `default_precision` as mode. A targeted member with no `default` target profile is a data error: `resolveSlotTargets` throws `TargetResolverError`.

## SPEC-Q-9: where the solver constants live
04 §4 puts `λ_ratio`, `λ_sf`, `λ_sat`, `λ_appeal` in `planner/config.ts`, which is outside every leaf's OWNS. They live in `planner/solver/config.ts`. The carbohydrate-basis setting (R-20, OQ-7) lives in `planner/targets/config.ts` as one typed constant, `CARB_TARGET_BASIS = "total"`. The solver config also holds one constant the spec does not name: a per-adjuster penalty so the solver prefers one adjuster over two.

## SPEC-Q-10: `fixed` and `unit` portioning
`unit` components use `unit_weight_g` as their step (PLN-5). A `fixed` component is served at exactly `default_serving_g` (or 0 g if it is not required); the solver does not vary it.

## SPEC-Q-11: flexible mode (PLN-8)
- Tolerances become soft; the objective still uses `|dev| / tol`. The sat-fat cap becomes soft as well (penalised excess), so a flexible plate always has a result.
- The result is `in_tolerance` when the soft optimum is inside every tolerance and under the cap, otherwise the solver tries adjusters (PLN-6) with hard tolerances; if they reach tolerance the plate is `in_tolerance` with adjusters, else it is `flexible_miss` with the soft optimum.
- Serving bounds [min, max] stay hard in both modes.

## SPEC-Q-12: strict-mode infeasible plates
PLN-8: "the least-bad dish is used and its plates are marked infeasible, with the deviation shown". An infeasible strict plate therefore carries the soft (least-deviation) portions, its actual nutrients and deviation, `status: "infeasible"` and `fit: 0`.

## SPEC-Q-13: exclusions inside the solver
§6.3 hard filters are 1.2.3's (dish level). §6.3 also implies a dish passes when only some variants contain an excluded or `never` ingredient, so the solver must not pick those variants for that member. The solver skips main-dish variants that break the member's exclusions (ingredient, category, dietary flag); a required component with no allowed variant makes the plate infeasible with a reason. Adjusters are checked for exclusions, appeal ≥ −0.2 and slot suitability (PLN-6) inside the solver, even if the caller filtered them.

## SPEC-Q-14: untargeted plates
PLN-7 grams are snapped to the grid and also clamped to [min, max] (G4 covers every solved plate). The plate has `status: "untargeted"`, zero deviation, `fit: 1`, `objective: 0`, and no adjusters.

## SPEC-Q-15: G4 "ratio deviation"
Defined from the PLN-5 naturalness term: for a plate with main-dish components `c`, `G = Σ g_c`, `ρ_c` = the component's share of the reference plate (default servings), ratio deviation = `Σ_c |g_c − ρ_c·G| / G`. G4 takes the median over the `in_tolerance` plates of the test set. Adjuster sides are excluded.

## SPEC-Q-16: variant appeal of a combination
`variantAppeal` in the PLN-5 objective is the mean appeal of the chosen variants of the components served (g > 0). Missing appeal counts as 0. With more than 24 combinations the top-3 variants per component are kept by appeal, ties broken by `is_default`, then input order.
