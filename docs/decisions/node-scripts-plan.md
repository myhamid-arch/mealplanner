# Node verify scripts (R-69): the CP1 plan

This is the plan as posted at CP1 and approved in R-70 (base `1ff9338`), moved here from the PR body. Later changes to it are listed in `node-scripts-questions.md`, under "Plan changes against the CP1 text", and in the pre-CP2 findings.

**Files to create (all inside OWNS):**

| File                                       | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/verify/lib/node.mjs`              | Shared helpers. Locks and stale-only builds (the same lock names as 1.4.9: `packages-build` and `web-next-build`). Per-gate `next build` with `DATABASE_URL=""` (R-50). PostgreSQL acquisition in 1.4.9's order: `DATABASE_URL`, then localhost:5432, then a throwaway PG16 cluster; PG16 is asserted; the gate gets its own fresh database. Worker and `next start` processes. A free port. A vitest/Playwright runner with a JSON report, which counts tests and fails on any skipped test. The recorded-model HTTP server. `copyWorkspace`/`installCopy` from `lib/workspace.mjs` (reused, not copied). The N2 and N4 implementations, parameterised per node. |
| `scripts/verify/node-1.{1,2,3,4}.mjs`      | Gate tables and the N3 of that node. Output: `VERIFY node-1.<n> <gate> PASSED` only after every assertion holds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/db/test/node/**`                 | Service-level N3 tests (`*.node.ts` plus their own `vitest.config.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/test/node/**`                    | HTTP- and job-level N3 tests (`*.node.ts` plus their own `vitest.config.ts`) and `recorded/**` model responses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/e2e/node-1.4/**`                 | SC-5 Playwright specs (`*.e2e.ts` plus their own `playwright.config.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/decisions/node-scripts-questions.md` | SPEC-Qs and requests. ADRs go to `docs/decisions/node-scripts-adr-<n>.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

- **Public interfaces:** none. These are verify scripts and tests only; no production code changes.
- **Key decisions:**
  - The node tests use suffixes the default suites do not collect. That keeps them out of `test:unit`, `test:integration`, CI and the default Playwright run, because they need the built app and a worker that only the node scripts start (Request R-1).
  - Recorded model responses are served over HTTP through `ANTHROPIC_BASE_URL` (SPEC-Q-6).

## Per gate: what runs, through which path, what is asserted, negative control

#### N2 (every node; `lib/node.mjs` `n2(branch)`)

Branch packages per node:

| Node | Branch packages                           |
| ---- | ----------------------------------------- |
| 1.1  | `core`, `db`                              |
| 1.2  | `core`, `db`                              |
| 1.3  | `core`, `db`, `ai`, `graph`               |
| 1.4  | `core`, `db`, `api-contract`, `ui-tokens` |

1. The branch packages are built with `turbo run build --force` under the lock.
2. For each branch package, the script asserts that `exports` types resolve into `dist/`, and that each subpath the consumers import exists as a built `.d.ts`. This proves consumers compile against published types, not `src`.
3. Every workspace package that depends on a branch package, directly or transitively, runs its own `typecheck` script. `apps/web` and `apps/worker` are among them. Each must exit 0.
4. The contract tests (`apps/web/test/api/g1-contract-matrix.int.test.ts`, `g3-openapi.int.test.ts`) run on the gate's DB server. Every test must pass, none may be skipped, and the count must be above 0.

**Negative control.** In a disposable workspace copy (`copyWorkspace` then `installCopy`):

- The consumer's typecheck is run once before the edit and must pass. This soundness check shows the copy is valid.
- Then one exported type of a branch package changes incompatibly, that package is rebuilt, and the consumer's typecheck must fail with a TS error in the consumer's file.

| Node | Exported type changed                                         | Consumer that must fail |
| ---- | ------------------------------------------------------------- | ----------------------- |
| 1.1  | A field type of an entity row in `@mealplanner/core/types`    | `@mealplanner/db`       |
| 1.2  | A field of `PlanResult` in `@mealplanner/core/planner`        | `@mealplanner/db`       |
| 1.3  | A field of an exported `@mealplanner/ai` agent type           | `@mealplanner/web`      |
| 1.4  | A field type of a DTO in `@mealplanner/api-contract/contract` | `@mealplanner/web`      |

#### N3 node-1.1 (Foundation): `packages/db/test/node/foundation.node.ts` + `apps/web/test/node/foundation-http.node.ts`

**Setup**

- A fresh database is created.
- The script asserts it has no tables, then runs `runMigrations` from 0000. It asserts that every committed migration file is recorded as applied.
- The catalogue is loaded (`loadCatalogue`, counts > 0) and F1 is seeded (`loadFixture`).

**Service path**

- One change set with ops across member (create and update), target, exclusion and household settings/weights goes through `applyChangeSet`.
- The script asserts that each of those tables changed. This keeps the equality from being vacuous.
- Then `undoChangeSet` runs. Every table (SPEC-Q-4 exclusions listed) must equal its pre-apply `row_to_json` snapshot, row for row.

**HTTP path**

- The same ops go to `POST /api/v1/change-sets`, then `POST /api/v1/change-sets/{id}/undo`, against the built web app (`next start` from the gate's own dist directory), as F1's admin (SPEC-Q-3).
- The same snapshot equality must hold.

**Negative control.** One image is removed from the stored `change_set.inverse` before the undo. This is done on both paths. The equality check must report a difference, and the gate requires that it does.

#### N3 node-1.2 (Engine): `apps/web/test/node/engine.node.ts`, real worker process

**Plan generation**

- `POST /plans/generate` for F1's 7-day week (seed 1, default weights) goes through the API route. The real worker runs `plan.generate` and the script waits for the job.
- Everything is then read back from `plan_day`/`plan_meal`/`plate`/`plate_item`/`cook_batch`.

**SC-1, from the persisted plates.**

- Nutrients are recomputed from `plate_item` cooked grams × variant per-100 g values.
- Each targeted member-meal must meet 1.2.3's rules: P/C/F within tolerance, the R-28 kcal window, and sat-fat under its cap. Otherwise it must be flagged with a reason and the smallest deviation.
- The script prints the measured figures: in-tolerance, flagged and total.

**OQ-8 repeat gaps, on the persisted plan.**

- For any two meals with a shared attendee that serve the same dish, the day difference must be at least `pairGap(slotA, slotB)` (7 for main meals, 4 for snack/workout; the larger gap wins).
- The only exceptions are a household `frequency_rule` or a relaxation the persisted plan records.

**Cook sheet, day 1.**

- `cookSheetFor` builds the cook sheet from the persisted plan.
- For every batch and ingredient, the raw grams must equal the sum of that day's plate `raw_equivalent` values (items and adjusters) for the variant, within 0.5 g of rounding.

**SC-2, over seeds 1–10, through the same job path.**

- There are 20 runs. Each uses its own template clone of the F1 database and its own worker (SPEC-Q-5).
- `weights.set` sets ingredient economy to 0.4 or 0 through the API before the run.
- Distinct core ingredients are counted from the persisted plates.
- The pass condition is median reduction ≥ 8 % and every seed ≥ 0 %. The per-seed figures are printed.

**Negative controls**

- A persisted plate's grams are tampered off tolerance in a clone, and the SC-1 check must fail.
- One `plan_meal` is set to a dish served inside the gap, and the repeat check must fail.
- The SC-2 aggregation run on a plan against itself (0 %) must fail.

#### N3 node-1.3 (Intelligence): `apps/web/test/node/intelligence.node.ts`, built app + real worker + recorded model server, no live calls

**Reviews to a proposal (SC-3)**

- F1's admin signs in. The day's plan comes from the `plan.generate` job.
- Two 1★ reviews are posted on one dish by the same member (`POST /api/v1/reviews`).
- The member's dish score and plate appeal (core `evaluateAppeal` over the persisted plate) must be lower than before, and other members' values must be unchanged.
- `POST /api/v1/insights/run` then runs the worker job `insights.run`. It must produce exactly one pending `preference.set` proposal for that member and dish.

**Accepting the proposal**

- `POST /api/v1/proposals/{id}/accept` must write a change set with source `proposal_accept`, and `GET /api/v1/change-sets` must list it.

**Graph**

- The follow-up `kg.sync` job (the worker) must write a `DISLIKES` edge from the member's node to the dish's node, with weight 0.8.

**Agent**

- A `POST /api/v1/conversations/{id}/messages` turn is served by the recorded model.
- `get_preferences` runs. The tool result the app sends back to the model must carry the dish at −0.8; the recorded server captures that request.
- A second recorded turn calls `apply_change` with an unprotected op. The change log must show it with actor `agent` and source `agent_apply`.
- `POST /change-sets/{id}/undo` must restore every table to its pre-apply snapshot (SC-4).

**Negative controls**

- After one 1★ review, `insights.run` gives no proposal. This runs first in a template clone, so it does not touch the main flow.
- The agent change set undone with one before-image removed from `inverse` must fail the equality check.

#### N3 node-1.4 (Product): `apps/web/e2e/node-1.4/sc5.e2e.ts`

**Setup**

- Playwright projects at 390 px and 1280 px.
- The built app runs from the gate's own dist directory, on a fresh database with the catalogue, alongside the real worker.
- The recorded model serves the onboarding parse and the agent turns.

**Flows, each at both widths**

1. **Onboarding to a first plan.**
   - The number of questions shown must be ≤ 5; they are counted on the page.
   - The household must be saved in UAE (`Asia/Dubai`) with metric units.
   - The review screen must confirm, and a plan must be generated by the worker and shown.
2. **The plan page:** every targeted plate is shown with pass/flag.
3. **The cook sheet (`/kitchen`):** raw quantities in g/kg and the plating table.
4. **A review:** the quick rate at `/reviews/rate?planMealId=`; the review must be stored.
5. **Chat:** a recorded agent turn proposes a protected op, the proposal card is accepted, and `/changelog` shows the entry.

**Accessibility**

- axe-core (`wcag2a/aa`, `wcag21a/aa`) runs on every page visited, in light and dark mode.
- It must report no serious or critical findings.

**Negative controls**

- axe must report the serious violations on a known-bad page (an unlabelled button and image).
- In a disposable copy, `apps/web/app/(app)/kitchen` is removed and the copy's app is rebuilt. The cook-sheet flow run against it must fail.

#### N4 (every node; `lib/node.mjs` `n4()`)

The full suite runs on the integration tree:

- `format:check`, `lint`, and `typecheck` (root scripts);
- `build`: packages and worker with `turbo --force` under the lock, and `next build` into the gate's dist directory with `DATABASE_URL` cleared;
- `test:unit` and `test:integration`: each workspace package's vitest run with a JSON report. Integration runs on a fresh DB server as defined above; each test file creates its own database;
- the web e2e suite, as described in SPEC-Q-1.

Pass and total counts are printed per package and spec. Skipped, todo or pending tests fail the gate, as does a test file left outside every run.

**Negative control.** A disposable copy gets one failing unit test in `packages/core/test`. The same unit-suite runner over the copy must report the failure, so N4's verdict function returns failed for it.

## Isolation

- **Databases:** each gate creates its own databases (`node1<n>_<gate>_<pid>_<hex>`, plus template clones) on the server it acquired, and drops them in `finally`.
- **Throwaway cluster:** when used, it is per gate on a free port.
- **Processes:** worker and `next start` processes are per gate, on free ports, and are stopped in `finally`.
- **Next.js builds:** `next build` writes to `.next/verify-node-1.<n>-<gate>`.
- **Temp files:** all under `mkdtemp`.
- **Shared state:** the only shared state is the packages' `dist/`, which is built under the existing cross-process locks (only when stale for N2/N3; forced for N4).
- **Model access:** no `ANTHROPIC_API_KEY` reaches any child.

## Expected wall-clock (single gate, this 4-core container; the component timings were measured today on 1ff9338)

**Measured components**

- Package and worker build: 27 s
- `next build`: 53 s
- `test:unit`: 1 min 17 s
- `test:integration`: 3 min 43 s

**Estimates**

| Gate   | Estimate                                                                |
| ------ | ----------------------------------------------------------------------- |
| N2     | about 8–12 min, including about 4–6 min for the copy, install and build |
| N3 1.1 | about 4 min                                                             |
| N3 1.2 | about 8–15 min (21 plan jobs)                                           |
| N3 1.3 | about 5–8 min                                                           |
| N3 1.4 | about 15–25 min, including a copy rebuild                               |
| N4     | about 40–70 min, most of it the e2e runs (SPEC-Q-1)                     |

Running all twelve gates at once on this container will be several times slower than any one of them alone. I will report measured times at CP2.

## Evidence at CP2 (gate-check cannot select a single gate)

`gate-check.mjs` has no gate selector, and a default or `--approve` run of a node ledger would also run N1, which reruns every leaf.

For each N2–N4 I will:

1. Write a one-gate ledger in the session scratch directory. Its `CHECK:`/`EXPECT:` lines are copied byte for byte from the node ledger, so the definition digest is the same, because it excludes the path and title.
2. Run `node .claude/skills/unlazy/scripts/gate-check.mjs --approve --cwd <repo> --timeout <s> <that ledger>`, once with `DATABASE_URL` unset and once set.
3. Paste the checker output, including its `automatic-evidence=v1` lines, into the PR.

The node ledgers' `EVIDENCE:` lines stay untouched for the architect's own checker run.
