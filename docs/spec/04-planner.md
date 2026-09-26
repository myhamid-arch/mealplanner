# 04 — Planner

The planner turns household configuration into plans. It has three layers:

1. **Target resolver.** For each member, date and slot: the macro target and tolerance.
2. **Portion solver.** For one dish and one member: the variant per component and the cooked grams per component that hit the target.
3. **Dish selector.** For each slot: the dish that maximises the weighted objective, given the plan so far.

Layers 1 and 2 are pure and deterministic (`packages/core/src/planner`). Layer 3 is deterministic given its candidate pool and a seed. AI recipe generation ([05-recipe-generation.md](05-recipe-generation.md)) only adds candidates to the pool. It never decides portions (PLN-1).

## 1. Pipeline

```
config ──► target resolver ──► per (member, date, slot) targets
                                       │
library + AI-generated dishes ──► candidate filter (hard rules) ──► portion solver per targeted attendee
                                       │                                   │
                                       └──────► dish scorer (weights) ◄────┘
                                                      │
                                            beam search over slots/days
                                                      │
                                     plan_day / plan_meal / plate / cook_batch
```

## 2. Default slots (PLN-2)

Seeded per household. The admin can rename, deactivate, re-time or add slots.

| key | label | shared | packed | reheat | training slot | default weight | active by default |
|---|---|---|---|---|---|---|---|
| breakfast | Breakfast | yes | no | – | no | 0.25 | yes |
| lunch | Lunch | yes | no | – | no | 0.30 | yes |
| dinner | Dinner | yes | no | – | no | 0.30 | yes |
| snack | Snack | no (per member) | no | – | no | 0.10 | yes |
| packed_school_lunch | Packed school lunch | yes (among attendees) | yes | no | no | 0.30 | no |
| packed_work_lunch | Packed work lunch | yes (among attendees) | yes | yes | no | 0.30 | no |
| pre_workout | Pre-workout | no | no | – | yes | 0.10 | yes |
| post_workout | Post-workout | no | no | – | yes | 0.15 | yes |

Custom slots default to weight 0.10 and per-member.

A member attending `packed_school_lunch` on a weekday normally does not attend `lunch` that day. The attendance editor MUST make that a one-tap "replaces lunch" choice (PLN-3).

## 3. Target resolver (PLN-4)

For member `m` on date `d`:

1. `day_kind = training` if `training_schedule` has `weekday(d)` and no `day_override(rest)` exists, or a `day_override(training)` exists. Otherwise `default`.
2. Daily target `T` = `target_profile[day_kind]`, falling back to `default`. Untargeted members skip steps 3–5.
3. Attended slots `S`: active slots the member attends on that weekday (coarse default: all non-training active slots), plus training slots on training days, adjusted by `day_override`.
4. Shares:
   - Coarse: `shareₛ = wₛ / Σ_{s∈S} wₛ`, using the default weights above.
   - Detailed: `meal_distribution` rows for the day kind. They must cover every attended slot and sum to 1 ± 0.001, and the UI validates this.
   - Expert: `slot_target_override` fixes a slot's values. The remaining daily target is distributed across the other slots by share.
5. Slot target = `T × shareₛ` for kcal, protein, carbs and fat, rounded to 1 g / 1 kcal. `sat_fat_max_slot = sat_fat_max × shareₛ`, where an unset `sat_fat_max` defaults to 6 % of the day's kcal (OQ-4). `fibre_goal_slot = fibre_min × shareₛ` and `soluble_fibre_goal_slot = soluble_fibre_min × shareₛ` (soft goals); an unset `fibre_min` defaults to 14 g per 1,000 kcal of the day's target and an unset `soluble_fibre_min` to 25 % of `fibre_min` (OQ-4, R-28).
6. Tolerance: protein, carbs and fat = member `tolerance` per meal. kcal: the member's **daily** `tolerance.kcal` (default ±50) is split across the day's attended slots in proportion to shareₛ (largest remainder, whole kcal), so the slot bands sum to the daily band (OQ-2, R-28). The plan search (PLN-11, 1.2.3) re-targets later slots of the same member-day with the kcal actually consumed by earlier slots, so the daily total stays within ±`tolerance.kcal`.

Output: `SlotTarget { memberId, date, slotKey, dayKind, kcal, protein, carbs, fat, satFatMax?, solubleFibreGoal?, tol: {kcal, protein, carbs, fat}, mode }`.

## 4. Portion solver (PLN-5)

Solves one **plate**: one member, one dish, one slot target.

**Variables.**
- The variant choice per component. All combinations are enumerated (cartesian product). If there are more than 24 combinations, only the member's top-3 appeal variants per component are kept.
- For each combination, one integer `kₑ ≥ 0` per component `c`, with cooked grams `gₑ = kₑ · step_gₑ` and `min_serving_g ≤ gₑ ≤ max_serving_g`. Non-required components may be 0. `unit` components use `unit_weight_g` as their step.

**Hard constraints (strict mode).**
- For each of protein, carbs, fat and kcal: `|actual − target| ≤ tol`.
- `satFat ≤ sat_fat_max_slot`, when set.

**Objective (minimise).**
- `Σₘ |devₘ| / tolₘ`: centres the plate inside the tolerance band.
- `+ λ_ratio · Σₑ |gₑ − ρₑ·G| / G_ref`: plate naturalness. `ρₑ` is the component's share in the dish's reference plate (from default servings), `G = Σ gₑ`, and `G_ref` is the reference plate weight. Without this term the solver can serve 320 g chicken and 15 g rice.
- `− λ_sf · solubleFibre`: soluble-fibre priority. Unknown values count as 0.
- `+ λ_sat · satFat`: pushes saturated fat below the cap, not just to it.
- `− λ_appeal · variantAppeal`: breaks ties towards the variants the member prefers. It is applied across combinations, not inside the MILP.
- Defaults: `λ_ratio = 2` (R-29; 0.5 let the centring term dominate), `λ_sat = 0.02`, `λ_appeal = 0.3`, and the fibre shortfall weights of R-28. They are constants in `planner/solver/config.ts`, not user settings in v1.

**Engine.** HiGHS (WASM, `highs` npm package) MILP with absolute-value linearisation through deviation variables. Time limit 250 ms per combination. If HiGHS cannot run in a target runtime, `javascript-lp-solver` is the fallback, behind the same interface.

**Adjusters (PLN-6).** If no combination is feasible, the solver retries with up to 2 **adjuster** components. Adjusters are single-component global dishes marked `role = adjuster`, for example: 0 % Greek yogurt, egg whites, cottage cheese (low fat), olive oil, apple, banana, dates, rice cakes, cucumber-tomato salad, labneh (light). They must:
- pass the member's exclusions,
- have appeal ≥ −0.2 for the member,
- suit the slot (`is_packable` and `served_cold_ok` rules apply).

The household can disable adjusters or edit the list. An adjuster appears on the plate and the cook sheet as "+ side for <member>".

**Result.**

```ts
type PlateSolution = {
  status: 'in_tolerance' | 'flexible_miss' | 'infeasible';
  items: Array<{ componentId: string; variantId: string; cookedG: number }>;
  adjusters: Array<{ dishId: string; variantId: string; cookedG: number }>;
  actual: Nutrients; deviation: Record<'kcal'|'protein'|'carbs'|'fat', number>;
  objective: number; fit: number /* 0..1, 1 = dead centre */; explain: string[];
}
```

`fit = 1 − mean(|devₘ|/tolₘ)`, clamped to [0, 1]. It is 0 when infeasible.

**Untargeted plates (PLN-7).** `gₑ = default_serving_g × appetite_factor × learned_role_bias`, snapped to the grid. Appetite factors: small 0.75, medium 1.0, large 1.3. Learned role bias comes from quantity feedback ([06-feedback-and-learning.md](06-feedback-and-learning.md) §4) and defaults to 1.0. The variant is the member's highest-appeal variant, subject to §6.4.

## 5. Strict vs flexible (PLN-8)

- **Strict** (default). A dish is eligible for a shared slot only if every targeted attendee's plate is `in_tolerance` (adjusters allowed). If no candidate qualifies after AI generation, the least-bad dish is used and its plates are marked `infeasible`, with the deviation shown in red and an insight raised.
- **Flexible.** The member's tolerances become soft. The solver minimises `Σ w·|dev|` without hard bounds. A miss is recorded as `flexible_miss`.

## 6. Dish scoring (PLN-9)

For candidate dish `d` at slot `s` on date `D`, with targeted attendees `T` and untargeted attendees `U`:

### 6.1 Components (each normalised to [0, 1])

| Component | Definition |
|---|---|
| MacroFit | mean over `m ∈ T` of plate `fit`. With T empty it is 1. |
| Appeal | Per member `aₘ ∈ [−1, 1]` from the preference model ([06-feedback-and-learning.md](06-feedback-and-learning.md) §3), evaluated on the plate's chosen variants. Household appeal = `(1−f)·mean(aₘ) + f·min(aₘ)`, with fairness `f` from the weights. Rescaled to [0, 1]. |
| Economy | Let `I(d)` = the core ingredients of the chosen variants (excluding `herb_spice`, water, salt and pepper). Let `W` = the ingredients already used in the window `[D − n + 1, D + n − 1]`, where `n = economy_window_days`, including planned and locked meals. `Economy = (|I∩W| − 1.5·|I∖W|) / |I|`, rescaled from [−1.5, 1] to [0, 1]. Also subtract `0.05` for each distinct variant beyond 2 that the kitchen must cook for this meal. |
| Variety | 1 minus penalties: same cuisine as the previous slot the same day −0.3; same cuisine 3 times in the window −0.3; same main protein ingredient as the previous meal −0.2. Floored at 0. |

### 6.2 Total

`Score = (w_macro·MacroFit + w_appeal·Appeal + w_econ·Economy + w_variety·Variety) / (w_macro + w_appeal + w_econ + w_variety)`

Weights come from `planning_weights`, or from a matching `weight_preset` for the weekday. Because macro tolerances are hard in strict mode, `w_macro` controls how strongly the plan prefers plates **centred** in the tolerance band over more appealing or more economical dishes that are still within tolerance (PLN-10). `score_breakdown` stores every component value and human-readable reasons, for example "Reuses chicken thigh, rice, cucumber from Tue dinner", "Layla rated this 5★", "Fried variant for Omar: fat headroom 9 g".

### 6.3 Hard filters (applied before solving)

- Exclusions: household and attendee-level ingredient, category and dietary-flag exclusions. Allergies are always hard.
- Preferences with `hard = never` for any attendee, on the dish or any core ingredient of every variant of a required component.
- Frequency: the same dish within `min_gap_days` (default 6), plus `frequency_rule`s.
- Slot suitability: `slot_keys` contains the slot key or an equivalent class (`packed_*` → `lunch` dishes with `is_packable`). Packed with no reheat → `served_cold_ok`.
- `dish.status = active` and no `needs_review` variants.

### 6.4 Variant choice across attendees

Each attendee's plate picks its own variant per component. That is how one dish serves grilled fish to one member and fried to another. The kitchen then cooks one batch per distinct variant. `max_variants_per_component_per_meal` defaults to 3. Beyond that, the least-appealing extra variant is merged into the nearest variant and those plates are re-solved.

## 7. Search (PLN-11)

- **Day.** Slots are processed in time order. Per slot: pre-filter with §6.3, then a cheap pre-score (appeal + economy, no solve), keeping the top `K = 12`. Solve plates for those, score them, then run a beam search across slots with width `B = 6`, maximising the summed score. Per-member slots (snacks, pre- and post-workout) are planned per member, after the shared slots.
- **Week.** Days are planned in order, each using the plan so far as the economy context. Then an improvement pass runs: for each unlocked meal, try the top 5 alternatives and keep a swap if the week total improves. Up to 2 passes.
- Budgets: a day in ≤ 5 s and a week in ≤ 30 s on the reference fixture, excluding AI calls. Deterministic for a fixed seed.

## 8. AI generation trigger (PLN-12)

For a slot, if fewer than 4 candidates survive §6.3 and the solver, or the best score is below 0.55:

- `ai_generation = auto`: request 3 dishes from the recipe generator, passing the context in [05-recipe-generation.md](05-recipe-generation.md) §3. Validate them, compute nutrition, solve, and add them to the pool. The new dishes are saved as `active` with a "New" badge.
- `ask`: create a proposal "Generate 3 new <slot> recipes because …" and plan with the best available dish.
- `off`: plan with the best available dish.

Plan generation runs as a background job. Progress events (slot done, AI generating, solving) are streamed to the UI and the chat.

## 9. Editing (PLN-13)

- Lock or unlock a meal. Regeneration never touches locked meals.
- Swap a meal: show the top 5 alternatives with score breakdowns. Choosing one re-solves the plates.
- Change targets, tolerance, slots or schedule: future plates are re-solved with their dishes kept. Plates that become infeasible are flagged, and the agent raises a proposal to swap those dishes.
- Manually override the grams on a plate: allowed for admins. The plate is re-scored and shows its deviation. It is recorded in the change log.

## 10. Cook sheet (PLN-14)

Per day, per meal:
- Dish name, cuisine, time.
- For each distinct variant: method, total cooked grams, raw ingredient quantities (from `rawForCooked` over all plates using it, including discarded frying oil shown separately), and steps.
- Adjuster sides.
- **Plating table**: rows are members, columns are components, cells are cooked grams (and units where applicable), plus a variant label per cell.
- Notes: packed or cold handling, allergen warnings for attendees, and the NUT-6 precision rules in a banner.

Print stylesheet: A4, one meal per page.

## 11. Public interface

```ts
// packages/core/src/planner
export function resolveSlotTargets(cfg: HouseholdConfig, date: string): SlotTarget[];
export function solvePlate(input: { dish: DishForSolve; target: SlotTarget | null; member: MemberCtx; adjusters: DishForSolve[] }): PlateSolution;
export function scoreDish(input: ScoreInput): ScoreBreakdown;
export function planDays(input: PlanInput, opts: { seed: number; onProgress?: (e: PlanProgress) => void; requestDishes?: (ctx: GenerationContext) => Promise<DishForSolve[]> }): Promise<PlanResult>;
export function buildCookSheet(plan: PlanResult, catalog: CatalogContext): CookSheet;
```

`requestDishes` is injected, so the core stays free of I/O and tests can stub it.
