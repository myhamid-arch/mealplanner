# leaf-1.4.8 spec questions

Each question records the reading taken (the more conservative one) and the build continues on it. Items marked **ARCHITECT QUESTION** need a ruling because the reading depends on a file outside this leaf's OWNS; they are also listed under "Requests" in the PR.

## SPEC-Q-1: W-7, where the 4 kcal go (G3)

Reproduced before any change, on the merged base `f50c084`, with the F1 planner configuration and the seed library (seed 1, week 2026-09-28 … 2026-10-04):

| date | member | day kind | profile kcal | Σ resolver slot targets | Σ stored plate targets |
|---|---|---|---|---|---|
| 2026-10-04 (Sun) | adult_a (Omar) | default | 2150 | 2150 | 2145.8 (shown as 2146) |
| 2026-10-01 (Thu) | adult_a | default | 2150 | 2150 | 2144.5 |
| 2026-09-28 (Mon) | adult_a | training | 2390 | 2390 | 2383.8 |
| 2026-09-30 (Wed) | adult_b (Sara) | default | 1655 | 1655 | 1660.5 |

Every member-day of the week has Σ resolver slot targets = profile kcal exactly. The resolver (`packages/core/src/planner/targets/shares.ts` `slotValues`, largest remainder) is correct and is **not changed**.

The difference is R-28's kcal re-targeting (1.2.3 ADR-1, `planner/select/retarget.ts`): slot i's stored `plate.target.kcal` is `resolver kcal − D`, where D is the kcal deviation of the member's earlier plates that day. The plate API returns that re-targeted value, so any screen that sums plate targets gets `day target − Σ D`, not the day target. 1.4.4 fixed Today at CP3 (`32e661c`, `dayProfile`). Plan and Plate do not show a day figure yet.

Reading (G3):
- a core test in `packages/core/test/planner/targets/` asserts, for F1 over the full week (both day kinds of both targeted adults), that the resolver's slot kcal targets sum exactly to the profile's kcal, and reproduces the difference: Σ stored plate targets ≠ day target for at least one member-day (the Sunday adult_a case, 2146 after rounding);
- the Plan and Plate screens take the day target from the member's profile for the day kind (`dayProfile`, the resolver's PLN-4 step 1–2 rule), never from plate targets;
- negative control: the pre-fix rule (sum of plate targets) run on the same recorded plates gives 2146 and fails the "shows 2150" assertion.

## SPEC-Q-2: where Plan and Plate show the day target (G3)

WeekPlan and PlatePhone show no per-member day figure. G3 requires both screens to show "the day target from the resolver's day profile". Reading, with the least new UI:
- **Plate** (PlatePhone): the existing calorie note under the bars names the day: "The calorie band (±X) is this meal's share of your ±50 on a 2150 kcal day (rest day)". The meal target in the bars stays the plate's re-targeted target (that is what the plate was solved against, R-28).
- **Plan** (WeekPlan → meal sheet): each targeted plate row in the meal sheet reads "Omar · 679 of 2150 kcal today" (meal target of the day target), admins and viewers allowed to read targets only.

If the architect prefers another place (for example a per-member day line under each day header), the helper is the same.

## SPEC-Q-3 (ARCHITECT QUESTION): `plan_meal.move` semantics (G1)

Op `plan_meal.move`, payload `{ planMealId, toDate }`, area `plans`, not protected. Apply:
1. the meal exists, is unlocked, has status `planned` and no reviews;
2. its day and the plan day of `toDate` both exist, differ, and are `draft` (not published or cooked);
3. if `toDate` has a meal with the same slot and member scope (the occupant), it must meet 1 as well; the occupant moves to the source day (exchange);
4. the meal moves to `toDate`'s plan day (`plan_meal.plan_day_id`).

Undo is the change set's before-image restore, like every op (R-7). The move service (`packages/db/src/services/plans/move.ts`) puts one change set together: `plan_meal.move`, then the adjuster rows and one `plan.swap_dish` (same dish, re-solved plates) for every unlocked meal of both days, in time order, so the R-28 re-targeting of later slots sees the moved meal. Locked meals of either day are kept as they are (they are context, as in a swap). A move the planner refuses on the new date (the slot is not attended that day, exclusions, slot suitability) is refused with 422 and nothing is written.

Refusals and status codes: a locked meal or occupant, or a published / cooked day → **409** (as G1 says); a meal already cooked or skipped, or with reviews → 409 (conservative: moving it would detach history from its date); no plan on `toDate`, same date, or the planner refusing the dish on that date → 422. Moving onto a date without a plan day is refused (422, "plan that day first") rather than creating an empty plan day.

## SPEC-Q-4 (ARCHITECT QUESTION): "infeasible dishes are refused" by `planMeals.swap` (G4)

`swapMeal` (1.4.1, `packages/db/src/services/plans/meal.ts`) refuses a dish only when the planner drops it (exclusions, never-preferences, slot). A dish whose targeted plates cannot be in tolerance is **not** dropped: with a one-dish pool the day search uses it as the least-bad candidate (PLN-8, `planner/select/day.ts` `leastBad`) and the swap is saved with `infeasible` plates. So "Use for" through `planMeals.swap` cannot refuse an infeasible dish with the body `{ dishId }` alone.

Proposed single-entry edit in `swapMeal`: in strict mode, refuse with `PlanServiceError("refused", …)` (422) when a targeted plate of the re-solved meal is `infeasible`, naming the member, macro and amount ("Omar's dinner would miss protein by 12 g"; UX-7). This matches PLN-8's strict eligibility ("eligible for a shared slot only if every targeted attendee's plate is in_tolerance"; least-bad is the planner's fallback when no candidate qualifies, not a user's explicit choice). Side effect: the swap sheet (1.4.4) can no longer save an alternative whose plates are infeasible; it already shows the fit of each alternative.

Until ruled: "Use for" shows the swap's refusal reason for excluded dishes (422 from the service), and G4's "infeasible" case stays unmet.

## SPEC-Q-5: how the recipe page gets "the chosen date and slot" (G4)

The RecipePage mockup has no date or slot chooser; ChatSidePanel's recipe card shows "Use for Wed dinner". Reading: the recipe page offers **Use for <day> <slot>** when it is opened with `?date=YYYY-MM-DD&slot=<slot key>` (optional `&member=<member id>` for an individual meal); the action targets the shared meal of that slot on that date (or that member's own meal), and calls `planMeals.swap` with the page's dish. Without the query, or for non-admins, the action is not shown. When no meal matches (no plan that day, the slot is individual and no member is named, the meal is locked or the day published), the button is shown disabled with the reason. Entry points: 1.4.5's chat recipe card (PR #18 is not merged at CP1, so this is recorded for 1.4.5's owner: link to `/recipes/{dishId}?date=&slot=` once the draft is saved) and any later link; this leaf adds no chooser (anti-drift rule 3).

## SPEC-Q-6: W-6 scope of the text replacement (G2)

W-6 says "the copy's steps name the substitute". Reading: every step of every copied variant that contains the unavailable ingredient is rewritten; a match is the ingredient's display name or any alias, case-insensitive, on word boundaries, longest first (so "olive oil" wins over a shorter alias); the replacement is the substitute's display name, capitalised when the match starts a sentence or is capitalised, else lower case ("Heat the olive oil" → "Heat the canola oil"; "Olive oil and lemon" → "Canola oil and lemon"). A variant containing the ingredient whose steps never name it gets the leading step "Use canola oil wherever olive oil is mentioned." Variants without the ingredient keep their steps unchanged.

Not changed: variant labels, component names and the dish description (W-6 names steps only). The seed library has a variant label "Olive oil and lemon"; if the architect wants labels and component names rewritten the same way, it is the same function applied to two more fields.

## SPEC-Q-7: which meals can be dragged (G1)

Drag and the Move menu are offered to admins only, on meals dated today or later whose day is a draft and which are unlocked, planned and unreviewed (SPEC-Q-3). Drag moves the whole cell only when the cell holds one meal; a cell with a shared meal and split members' own dishes, or several individual dishes, is moved one meal at a time from the meal sheet's "Move to…" menu. Drop targets are the cells of the same slot row on other draft days of the week; dropping anywhere else cancels. The Move menu lists the week's other draft days from today on and says what happens ("Move here", "Swap with <dish>", or disabled with the reason: locked, sent to the kitchen, not planned).
