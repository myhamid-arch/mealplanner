# leaf-1.4.4 spec questions

Each question records the reading taken (the more conservative one) and continues on it. Items marked **ARCHITECT QUESTION** need a ruling because the reading leaves a spec requirement or a mockup control without a backend, or needs a route that this leaf may not add (BUILDER_PROMPT §4 rule 1; architect note: "a missing endpoint is an ARCHITECT QUESTION with the exact route and payload"). They are also listed under "Requests" in the PR.

## SPEC-Q-1 (ARCHITECT QUESTION): how an admin finds the result of a kitchen flag (R2-UX-1, G3)

The merged backend (1.4.1): `POST /cook-sheets/{date}/flags` writes a review (`targetType: ingredient`, tag `ingredient_unavailable`, comment = note) and returns `{ reviewId, jobId }` **to the kitchen user who flagged**. The `plates.substitute` job's result (`SubstituteReport`: `substituteId`, `copies[{ fromDishId, toDishId, name }]`, `changeSetId`, `meals`, `flagged`, `unresolved`) is only in the job's terminal `done` event. An admin has no way to get from the flag to the job: `GET /jobs/{id}` needs the id, no endpoint lists jobs, `JobDto` has no result, and `GET /diagnostics` lists failed jobs only.

What the admin *can* read today: the flag (`GET /reviews?targetType=ingredient`, filtered client-side by tag and date), the change log entry (`GET /change-sets`, summary "Substitute an unavailable ingredient in N meals", actor `system`, source `learning`), `GET /change-sets/{id}` (forward ops, including the `dish.create` of the copy "X (with Y)"), and the plan (`GET /plans`, the meal now on the copy, plates re-solved with fit status).

Proposed route (1.4.1's area; this leaf builds only the UI on it):

```
GET /api/v1/cook-sheets/{date}/flags        roles: admin (kitchen: own flags only, optional)
200 { flags: Array<{
  reviewId: Id, kind: "unavailable" | "unclear",
  ingredientId: Id | null, ingredientName: string | null,
  variantId: Id | null, planMealId: Id | null,
  note: string | null, authorName: string, createdAt: Timestamp,
  job: { id: Id, status: JobStatus, finishedAt: Timestamp | null } | null,
  result: { substituteId: Id | null, substituteName: string | null,
            changeSetId: Id | null,
            meals: Array<{ planMealId: Id, date: IsoDate, slotLabel: string,
                           fromDishName: string, toDishName: string }>,
            unresolved: Id[] } | null
}> }
```

(`job` joins `job.payload->>'reviewId'`; `result` is the job's `result`.)

Fallback if declined: the admin view pairs each flag with the first later change set whose summary starts "Substitute an unavailable ingredient" and shows its copies and the re-solved meals from `GET /plans`; a flag with no such change set shows "Looking for a substitute" and cannot distinguish "still running" from "no substitute found" (`unresolved` is invisible). G3 would be built on whichever the architect rules.

## SPEC-Q-2 (ARCHITECT QUESTION): "Send to kitchen" (WeekPlan) and "Mark cooked" (CookSheet) have no write path

`plan_day.status` (`draft | published | cooked`) and `plan_meal.status` (`planned | cooked | skipped`) exist, but no op in the AGT-6 registry and no endpoint changes them (`plan.save_days` rewrites unlocked meals and is not a status change). The mockups show both buttons; TodayDesktop shows "Priya marked lunch cooked at 13:05" and "Monday's plan is ready to send to the kitchen".

Proposed routes (and ops `plan.publish` / `plan.meal_status` in core, applied as change sets so they are logged and undoable):

```
POST /api/v1/plans/{date}/publish           roles: admin    body: {}  → 200 { changeSetId }
                                            422 when the day has no plan or is already published
POST /api/v1/plan-meals/{id}/status         roles: admin, kitchen
                                            body: { status: "cooked" | "skipped" | "planned" }
                                            → 200 { changeSetId, meal: PlanMealDto }
```

Reading until ruled: both buttons are left out and listed as mockup deviations; the WeekPlan status pill shows the stored `plan_day.status` ("Draft · not sent to kitchen" / "Sent to kitchen" / "Cooked"), and the cook sheet shows a meal's stored status.

## SPEC-Q-3 (ARCHITECT QUESTION): "drag to move a dish between days" (UX-4, WeekPlan)

PLN-13 lists lock, swap and gram override; it does not define "move", and there is no op or endpoint for it. A move onto a day that already has a meal in that slot can only mean exchanging the two dishes.

Reading: dropping meal A (day 1) on meal B (day 2) **in the same slot row** exchanges their dishes with two `POST /plan-meals/{id}/swap` calls (each re-solves its plates, PLN-13); if the second is refused, the first change set is undone (`POST /change-sets/{id}/undo`) and the error is shown. Locked meals are neither drag sources nor targets; drops across slot rows are refused (the slot decides suitability). Keyboard and phone users get the same action as "Move to…" (a day picker) in the meal sheet. The two swaps are two change-log entries. If the architect prefers an atomic route (`POST /plan-meals/{id}/exchange { withPlanMealId }`), the UI calls that instead; if the architect rules move out of scope, drag is dropped and listed as a deviation.

## SPEC-Q-4: a one-off override needs a re-plan of that date (R2-MEAL-2, G1)

`meal_override.set` / `.remove` go through `POST /change-sets` (1.1.2 op, admin). `followUpJobs` does not re-solve on `meal_override` (it is not in `RESOLVE`), and a re-solve would keep the shared dish anyway. The planner (1.2.3) honours overrides when it plans the date.

Reading: after applying the override the UI queues `POST /plans/generate { dates: [date] }` and follows the job's events. This replaces that date's **unlocked** meals, so the dialog says so ("Wednesday will be re-planned; locked meals stay") before applying. Removing an override does the same.

## SPEC-Q-5: kcal band on a plate after R-28

R-28: kcal tolerance is ±50 per **day**, P/C/F per meal. `PlateDto.target.tolerance.kcal` is the slot's share of the daily band (PLN-4 step 6). The mockup's "Calories 523 · target 523 ±50" predates R-28.

Reading: the plate's kcal bar and label use the slot band from the DTO (e.g. "target 523 ±12"), with the sub-label "share of your ±50 a day"; the Today day ring and the desktop "Day vs target" column show the day total against the daily target (sum of the day's slot targets) and ±`tolerance.kcal`.

## SPEC-Q-6: carbohydrates are shown as total (R-20, R-28)

`Nutrients.carbs` is available carbohydrate; targets are total (`carbBasis: "total"`). Reading: wherever carbs are compared with a target or listed as a macro, the value is `carbs + fibre`, labelled "Carbs g (total)" (column heads, bar labels, per-100 g panels; "C" chips carry an accessible name "carbs, total"). If a plate's `carbBasis` is ever not `total`, the label follows it ("Carbs g (available)").

## SPEC-Q-7: sat-fat cap and fibre goals on the plate

`PlateDto.target` carries kcal/P/C/F only; the slot's sat-fat cap and fibre goals are not in the DTO. Reading: the plate shows its own sat fat, fibre and soluble fibre (soluble fibre "unknown" when null, R-13); the caps and goals are shown per **day** on Today (member's `satFatMaxG`, else 6 % of the day's kcal ÷ 9 (R-28); fibre goal `fibreMinG`, else 14 g per 1,000 kcal of the day's target, ≥ 25 % soluble), computed from `GET /targets` and the day's plates. Untargeted members (kids) get none of these: their plates show components and grams only (R-28 note).

## SPEC-Q-8: routes of this leaf

Reading: `/today` (`?date=`), `/today/plates/{plateId}` (PlatePhone), `/plan` (`?week=` Monday date; grid ≥ 1024 px, day list below), `/recipes` (filters in the query string), `/recipes/{dishId}`, `/kitchen` (`?date=&meal=`). The print view is the cook sheet under `@media print` (A4, one meal per page, PLN-14); the Print button calls `window.print()`. `/` redirects with `homePathFor(role)` (R-2 hand-over).

## SPEC-Q-9: links into 1.4.5's screens (Rate, Ask the assistant)

TodayPhone "Rate", PlatePhone "Rate this meal", RecipeLibrary "Ask for a new recipe", RecipePage "Ask assistant to revise" and the SwapDialog "None of these? Ask for something" box lead to 1.4.5's quick-rate / review-compose and chat screens, whose routes are not fixed yet.

Ruled (R-52, R-53): Rate → `/reviews/rate?planMealId=<id>` (Today), detailed review → `/reviews/new?planMealId=<id>` (plate page), assistant → `/chat?prompt=<text>` (the swap box passes the typed text, the recipe buttons a sentence naming the dish).

## SPEC-Q-10: recipe Edit and Retire (UX-4 "Admin: edit, retire")

`dish.update` and `dish.retire` apply to **household** dishes only (seed dishes are global rows). A full component/ingredient editor is not in any mockup.

Reading: admins see Edit and Retire on household dishes only. Edit is a sheet for name, description, flavour tags, "packable" / "fine served cold" and each variant's steps and notes, applied as one `dish.update` change set; ingredient and gram changes go through "Ask assistant to revise" (it validates nutrition, REC). Retire applies `dish.retire`; when the op is protected (the dish has reviews) the server's refusal is shown and the admin is pointed to the assistant. Seed dishes show neither button.

## SPEC-Q-11: ratings and "Used in N meals" on the library and recipe page

No endpoint aggregates ratings per dish. Reading: the rating is the mean of 1–5 ratings on reviews of the dish itself, its components and variants, and plan meals / plates of the dish, over `GET /reviews?limit=200` (the latest 200, the API maximum) joined to `GET /plans` for the last 31 days (the API's maximum range) to map meals to dishes; the count is the number of rated reviews. "Used in N meals" counts meals of the dish in that window and is labelled "in the last month". The retired filter/labels use `status`.

## SPEC-Q-12: what the kitchen sees

`GET /plans` returns no plates for kitchen (ARC-6); the cook sheet is their view. Reading: kitchen users land on `/kitchen` (R-2); `/plan` shows them the week grid read-only (dish names, no plates, no actions); `/recipes` read-only; `/today` redirects them to `/kitchen`.

## SPEC-Q-10 as built: Edit covers the dish's own fields only (narrower than the accepted reading)

The accepted reading included each variant's steps and notes in the Edit sheet. `dish.update` replaces steps only as part of a whole component tree (`components`), and `VariantDto` does not return every stored variant field: `variant_ingredient.yield_override` is not in the contract. A tree written back from the page would therefore reset stored yield overrides to null and change nutrition silently. As built, Edit changes name, description, flavour tags, the meals the dish suits (`slotKeys`), packable and served-cold, as one `dish.update` without `components`; the sheet says that ingredients and steps are changed through "Ask assistant to revise". Listed under Deviations in the PR.

## SPEC-Q-13: the meal picker on the cook sheet groups by slot

An individual slot (snacks) has one cook-sheet meal per person. The picker shows one button per slot ("Snack 16:00 · 5 dishes"); choosing it shows that slot's meals one after another. Print still gives every meal its own A4 page (PLN-14).

## SPEC-Q-14: "Regenerate unlocked" uses a new seed

PLN-11 makes a plan deterministic for a fixed seed, so re-planning with the same seed returns the same plan for the unlocked meals. The Plan screen sends a fresh random seed for "Plan this week", "Regenerate unlocked" and the re-plan after a one-off override. The planner stays deterministic for a given seed; the UI does not show or reuse seeds.
