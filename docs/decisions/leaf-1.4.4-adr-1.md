# leaf-1.4.4 ADR-1: how G1–G3 are verified

Status: accepted (CP1 APPROVED, BLD-8 R-52); built for CP2
Requirement: BLD-5 1.4.4 G1–G3; UX-4; UX-6; R2-MEAL-2; R2-UX-1; PLN-13; PLN-14

`scripts/verify/leaf-1.4.4.mjs --gate G1|G2|G3` prints `VERIFY leaf-1.4.4 <gate> PASSED` only after every assertion, negative controls included, holds; otherwise it exits non-zero. It imports only `scripts/verify/lib/*` (unchanged) and Node built-ins; it uses no library that `apps/web` does not already declare (`@playwright/test` 1.63.0, `@axe-core/playwright` 4.13.0, `pg` 8.23.0).

## Harness (every gate)

1. Build the workspace packages and the worker (turbo, under a cross-process lock shared with the other screen leaves, so parallel gates do not build the same `dist/` at once).
2. `next build` into the gate's own dist dir `.next/verify-1.4.4-g<n>` (`MISE_NEXT_DIST_DIR`, 1.4.2 ADR-4), under the shared `web-next-build` lock.
3. A database of the gate's own on PostgreSQL 16: `DATABASE_URL`'s server if set (CI's value), else `localhost:5432`, else a throwaway cluster on a free port. Name `leaf144_g<n>_<pid>_<random>`; `migrateAndSeed` (1.4.1 loader) seeds the catalogue and seed library; `scripts/kg-rebuild.ts` builds the knowledge graph (substitutes, KG-4.3) on that database. The server version must be 16 (asserted). Dropped at the end.
4. The worker (`apps/worker/dist/src/main.js`) on that database, logging to a per-gate temp file.
5. `playwright test e2e/plan.spec.ts --grep @G<n> --reporter=json` against `next start` on a free port, with its own `PLAYWRIGHT_OUTPUT_DIR` and a fresh `AUTH_SECRET`. The script requires every expected test title to be present and `passed` (none skipped) and prints each test's duration against its timeout. On any failure it prints the **full** error and stdout of every failed test and the worker log (W-1).

Nothing is written to a shared path: dist dir, database, ports, temp dirs and worker are per gate and per process.

## Test world (built through the API in `plan.spec.ts`, `beforeAll`)

- `POST /signup` (admin), then one `POST /change-sets` with the members and targets of F1 (BLD-2): two targeted adults, three untargeted children 18/15/10 with the youngest's sesame allergy as a hard `kind: flag` exclusion; slots breakfast, lunch, dinner (shared), snack (individual); tolerance P±5 / C±5 / F±2 / kcal±50.
- `POST /invites` + `POST /invites/accept` for a member login linked to adult B and a kitchen login.
- `POST /plans/generate` for the current week (Monday–Sunday in the household's time zone), awaited through `GET /jobs/{id}`.

W-4: no assertion names a dish. Tests read the dish names they need from the page or the API at run time (the swapped-in dish is whichever alternative was first; the flagged ingredient is chosen from the day's cook sheet, among those with a `SUBSTITUTES_FOR` edge).

## G1: flows at 390 and 1280 px (UX-4, PLN-13, R2-MEAL-2, PLN-14)

Per width (`page.setViewportSize`), one test each:
- **plan week**: `/plan` for an empty next week shows the empty state; "Plan this week" queues generation, progress is shown, and the grid (1280) / day list (390) then has a meal in every attended slot of all 7 days, each labelled SHARED or INDIVIDUAL; the header strip shows distinct ingredients, % on target and cuisines, each equal to the value the test computes from `GET /cook-sheets` and `GET /plans`.
- **swap**: open a dinner, "Swap": the sheet lists 1–5 alternatives with Macros/Appeal/Economy bars and the current score; "Use this" on the first one; the cell then shows that alternative's name, and `GET /plan-meals/{id}` agrees.
- **lock**: lock a meal (lock icon + "Locked" label), "Regenerate unlocked", wait for the job; the locked meal's dish is unchanged and its lock remains; unlock removes the icon.
- **one-off override**: in the swap sheet, take one attendee out of Wednesday's shared dinner → confirmation → re-plan → the cell reads "+ <name>: own dish" and the API meal has that member in `splitMembers`; then "make individual" for Thursday → Thursday's dinner row is INDIVIDUAL; removing the override restores SHARED.
- **Today, plate, recipes, kitchen**: each screen renders its mockup's structure for the admin and for the member (member sees own plates and "Hi <name>"; kids' plates show portions only, no target bars; carbs labelled total).
- **cook sheet print view**: `/kitchen` for today; `page.emulateMedia({ media: "print" })`: rail, tab bar, buttons and flag bar are hidden; the weigh-and-measure banner and each meal's plating table are visible; every meal section but the last has `break-after: page`; `@page` size is A4 (read from the stylesheet); `page.pdf({ format: "A4" })` produces one page per meal (page count computed from the PDF).
- No horizontal scroll on any visited screen at either width.

Negative controls: (1) the horizontal-scroll check fails on a page with an injected 1600 px element; (2) the print check fails on the same cook sheet with the print stylesheet removed (sections do not break, chrome is visible); (3) the "swap took effect" check fails when `POST /plan-meals/*/swap` is intercepted and answered with the unchanged meal.

## G2: axe-core (UX-6)

`@axe-core/playwright` on every screen state of the leaf (Today admin/member, plate, week grid and list, meal sheet, swap sheet, override confirmation, recipe library with a filter, recipe page on each variant tab, edit sheet, cook sheet normal / large text, flag dialog) at 390 and 1280 px, light and dark (`colorScheme` emulation). No violation with impact `serious` or `critical`. Negative control: a bad page (unlabelled icon button, image without alt, low-contrast text) must report serious or critical violations.

## G3: kitchen flag → substitution → re-solve → visible to admins (R2-UX-1)

1. Kitchen login, `/kitchen` for today: "Flag an ingredient", pick the chosen ingredient, note, send; the page confirms.
2. The worker runs `plates.substitute`. Independently of the UI, the test checks through the API that: the flag review exists with tag `ingredient_unavailable`; a change set "Substitute an unavailable ingredient …" was applied; every affected meal in the window now serves a dish whose variants (on its plates) no longer contain the ingredient, and its plates were re-solved (new plate ids, fit status present).
3. Admin login, `/today` at 1280 and 390 and `/kitchen`: the Kitchen card lists the flag (who, ingredient, note) and its result: the substitute, each changed meal "<slot>: <old dish> → <new dish>", and "macros re-checked" with the re-solved plates' fit (e.g. "all on target" or which member missed). The member login does not see the flag card.

Negative controls: (1) the same admin page, served a flag listing whose job has not produced a result yet (the response is rewritten in the browser), and a day without the flag, must both fail the "outcome visible" check; (2) the API check of step 2 run on the plan as it was before the flag must report the flagged dinner as still serving the ingredient.

Step 3 reads `GET /cook-sheets/{date}/flags` (R-52).

## Timeouts

Each e2e gate builds the app, migrates a database, generates a week of plans and runs Playwright at two widths: several minutes, well over gate-check's default 120 s. Request: the architect runs this ledger with `--timeout 1800`. Coverage is not cut to fit 120 s.

## As built (CP2)

- Setup is one household per Playwright run, built through the API in `beforeAll`: sign-up, F1's members, targets and sesame allergy (R-34/R-36: a `dietary_flag` exclusion), invites accepted for Sara (member) and a kitchen login, a household copy of a seed dish (for the Edit sheet; created before any plan, so its `plates.resolve` follow-up cannot re-solve the plates the tests read), and plans for the rest of the current week and two further weeks. Two more weeks stay free for "plan a week" at each width.
- G1 also runs `apps/web/components/plan/logic.test.ts` (dates, total carbs, R-28 goals, fit, week stats, ratings) and `apps/web/test/api/plan-status.int.test.ts` (R-52 publish and meal status).
- G3 also runs `apps/web/test/api/cook-sheet-flags.int.test.ts` (R-52 flag listing, on the real `plates.substitute` handler) and rebuilds the knowledge graph on the gate's database with `scripts/kg-rebuild.ts` before the worker starts.
- G1's swap negative control answers the swap request in the browser with the unchanged meal; the "swap took effect" check must then fail.
- Package builds and `next build` share the lock names of 1.4.3's script, so screen leaves' gates never build the same output at once. `next build` runs with `DATABASE_URL` cleared (R-50).
