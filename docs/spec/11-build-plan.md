# 11 — Build plan (architect ↔ builder)

The build uses the **unlazy** skill (`.claude/skills/unlazy`) in orchestrated mode. The architect is the driver: it plans, dispatches, re-verifies, integrates and reports. Builders are native Claude Code background agents, each working on one leaf in its own git worktree. This file is the durable plan. The working ledgers under `.unlazy/mealplanner-v1/` are generated from it at build start and are git-ignored, as the skill requires.

## 1. Protocol (BLD-1)

1. **Plan.** The architect creates `.unlazy/mealplanner-v1/PLAN.md` (contract inventory = every requirement ID in docs 01–10 mapped to a leaf and gate), a root `GATES.md`, one `gates/leaf-*.md` per leaf (§4) and one `gates/node-*.md` per branch. It lints them (`gate-lint.mjs`), and inspects and approves every `CHECK:`.
2. **Dispatch.** For each READY set (max 3 concurrent builders), the architect claims ownership, opens a wave, launches builders with `isolation: worktree`, records the handles and seals the wave.
3. **Builder brief** (identical shape for every leaf):
   - the spec files relevant to the leaf,
   - its ledger (OWNS, gates),
   - its dependencies' public interfaces,
   - the four-pass rule (implement completely → expert reread → defect hunt → polish, repeated until clean),
   - the rules:
     - Write only inside OWNS.
     - Do not edit the spec; append questions to `docs/decisions/questions.md` as `SPEC-Q-<n>` and continue with the most conservative reading.
     - Record library/API decisions as ADRs in `docs/decisions/`.
     - Commit on the worktree branch.
     - Finish only when every gate passes with evidence, or is abandoned with a reason.
4. **Verify.** When a builder returns, the architect:
   - runs `gate-check --reverify` on the leaf ledger,
   - checks that `git diff --name-only` stays within OWNS,
   - reads the diff against the cited requirement IDs,
   - tries to refute at least one passed gate (for example by running the verify script against a deliberately broken fixture),
   - reviews the manual gates.

   If a problem is found, the leaf goes back to a builder with specific findings.
5. **Integrate.** The verified leaf is merged into `claude/family-meal-planner-macros-8s782a`, its lease released, and the event logged. Newly READY leaves are dispatched (rolling). The branch `node-*` gates run when all children of the branch are verified.
6. **Report.** At root: reread the owner's requests and this spec, reconcile every contract row, rerun all gates, and report measured met/unmet/abandoned counts to the owner.

**Spec changes.** Only the owner approves spec changes. The architect bumps the spec revision in `README.md` and records the change in `docs/decisions/spec-changelog.md`. Affected leaves are re-planned before any new dispatch.

## 2. Fixtures (BLD-2)

Fixtures live in `packages/core/test/fixtures/` (owned by leaf 1.1.2, `types`). They are used by every leaf's gates.

- **F1 — reference household (owner-like, pseudonymous).**
  - Adult A: targeted. Default day 2150 kcal / 180 P / 200 C / 70 F, sat-fat ≤ 22 g, soluble fibre ≥ 10 g. Training day 2390 / 180 / 260 / 70. Trains Mon/Wed/Fri at 18:00. Packed work lunch Mon–Fri.
  - Adult B: targeted. 1655 / 130 / 160 / 55, sat-fat ≤ 18 g. Trains Tue/Thu/Sat at 07:00.
  - Children C1 (18, F), C2 (15, M), C3 (10, M): untargeted. Appetite large / large / medium. Packed school lunch Mon–Fri, replacing lunch.
  - Slots: breakfast, lunch, dinner, snack, packed_school_lunch, packed_work_lunch, pre_workout, post_workout. Tolerance P±5 / C±5 / F±2 / kcal±50, strict.
  - Cuisines liked: italian, levantine, american, british, indian. Disliked: none.
  - One allergy: C3 sesame.
- **F2 — minimal.** One targeted adult, breakfast/lunch/dinner.
- **F3 — stress.** 8 members (5 targeted), 10 slots including 2 custom, weekday presets, 30 days of synthetic reviews.

## 3. Depth tree (BLD-3)

```
1 Meal planner v1 ........................................ GATES.md
  1.1 Foundation ......................................... gates/node-1.1.md
    1.1.1 Monorepo, tooling, CI ........................... gates/leaf-1.1.1.md
    1.1.2 Schema, repositories, change-set service ........ gates/leaf-1.1.2.md
    1.1.3 Catalogue data (ingredients, yields, cuisines) .. gates/leaf-1.1.3.md
  1.2 Engine ............................................. gates/node-1.2.md
    1.2.1 Nutrition engine ................................ gates/leaf-1.2.1.md
    1.2.2 Target resolver + portion solver ................ gates/leaf-1.2.2.md
    1.2.3 Dish scoring, plan search, cook sheet ........... gates/leaf-1.2.3.md
    1.2.4 Seed dish library ............................... gates/leaf-1.2.4.md
  1.3 Intelligence ....................................... gates/node-1.3.md
    1.3.1 Claude client + recipe generator ................ gates/leaf-1.3.1.md
    1.3.2 Reviews + preference learning ................... gates/leaf-1.3.2.md
    1.3.3 Insights engine + proposals ..................... gates/leaf-1.3.3.md
    1.3.4 Knowledge graph ................................. gates/leaf-1.3.4.md
    1.3.5 Admin agent loop + tools ........................ gates/leaf-1.3.5.md
  1.4 Product ............................................ gates/node-1.4.md
    1.4.1 API, auth, worker, SSE .......................... gates/leaf-1.4.1.md
    1.4.2 Design system, app shell, PWA ................... gates/leaf-1.4.2.md
    1.4.3 Onboarding, Family, Settings screens ............ gates/leaf-1.4.3.md
    1.4.4 Today, Plan, Plate, Recipes, Kitchen screens .... gates/leaf-1.4.4.md
    1.4.5 Reviews, Insights, Chat UI ...................... gates/leaf-1.4.5.md
```

## 4. Leaf dispatch table (BLD-4)

| Leaf | Owns | Needs | Tier | Wave |
|---|---|---|---|---|
| 1.1.1 | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.github/workflows/**`, `docker-compose.yml`, `.env.example`, `scripts/verify/lib/**`, `apps/*/package.json`, `packages/*/package.json`, `packages/*/tsconfig.json`, `apps/*/tsconfig.json` | – | mechanical | 1 |
| 1.1.2 | `packages/db/src/schema/**`, `packages/db/src/migrations/**`, `packages/db/src/repos/**`, `packages/db/src/services/changes/**`, `packages/db/src/services/config/**`, `packages/db/test/**`, `packages/core/src/changes/**`, `packages/core/src/types/**`, `packages/core/test/fixtures/**`, `scripts/verify/leaf-1.1.2.mjs` | 1.1.1 | judgment | 2 |
| 1.1.3 | `data/ingredients.*`, `data/method-yields.*`, `data/cuisines.json`, `data/soluble-fibre.csv`, `data/substitutes.csv`, `scripts/import-fdc.ts`, `scripts/verify/leaf-1.1.3.mjs` | 1.1.1 | judgment | 2 |
| 1.2.1 | `packages/core/src/nutrition/**`, `packages/core/test/nutrition/**`, `scripts/verify/leaf-1.2.1.mjs` | 1.1.1 | judgment | 2 |
| 1.4.2 | `packages/ui-tokens/**`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/(shell)/**`, `apps/web/components/ui/**`, `apps/web/public/**`, `apps/web/next.config.*`, `apps/web/e2e/shell.spec.ts`, `scripts/verify/leaf-1.4.2.mjs` | 1.1.1 | judgment | 2 |
| 1.2.2 | `packages/core/src/planner/targets/**`, `packages/core/src/planner/solver/**`, `packages/core/test/planner/solver/**`, `packages/core/test/planner/targets/**`, `scripts/verify/leaf-1.2.2.mjs` | 1.2.1 | judgment | 3 |
| 1.2.4 | `data/seed-dishes/**`, `data/adjusters.json`, `scripts/verify/leaf-1.2.4.mjs` | 1.1.3, 1.2.2 | judgment | 4 |
| 1.3.2 | `packages/core/src/learning/preferences/**`, `packages/core/src/learning/portions/**`, `packages/core/test/learning/prefs/**`, `packages/db/src/services/reviews/**`, `scripts/verify/leaf-1.3.2.mjs` | 1.1.2 | judgment | 3 |
| 1.2.3 | `packages/core/src/planner/select/**`, `packages/core/src/planner/cooksheet/**`, `packages/core/src/planner/index.ts`, `packages/core/test/planner/select/**`, `scripts/verify/leaf-1.2.3.mjs` | 1.2.2, 1.2.4 | judgment | 5 |
| 1.3.1 | `packages/ai/src/client/**`, `packages/ai/src/recipes/**`, `packages/ai/test/recipes/**`, `scripts/verify/leaf-1.3.1.mjs` | 1.1.2, 1.2.2 | judgment | 4 |
| 1.3.4 | `packages/graph/**`, `scripts/kg-rebuild.ts`, `scripts/verify/leaf-1.3.4.mjs` | 1.1.2, 1.2.4 | judgment | 5 |
| 1.4.1 | `apps/web/app/api/**`, `apps/web/lib/server/**`, `apps/web/lib/auth/**`, `apps/worker/src/**`, `packages/api-contract/src/**`, `packages/db/src/services/plans/**`, `apps/web/test/api/**`, `scripts/verify/leaf-1.4.1.mjs` | 1.1.2, 1.2.3 | judgment | 6 |
| 1.3.3 | `packages/core/src/learning/rules/**`, `packages/core/test/learning/rules/**`, `packages/ai/src/insights/**`, `packages/db/src/services/proposals/**`, `scripts/verify/leaf-1.3.3.mjs` | 1.3.1, 1.3.2 | judgment | 5 |
| 1.3.5 | `packages/ai/src/agent/**`, `packages/ai/test/agent/**`, `evals/agent/**`, `scripts/verify/leaf-1.3.5.mjs` | 1.3.1, 1.3.3, 1.4.1 | judgment | 7 |
| 1.4.3 | `apps/web/app/(app)/onboarding/**`, `apps/web/app/(app)/family/**`, `apps/web/app/(app)/settings/**`, `apps/web/components/config/**`, `apps/web/e2e/config.spec.ts`, `scripts/verify/leaf-1.4.3.mjs` | 1.4.1, 1.4.2 | judgment | 7 |
| 1.4.4 | `apps/web/app/(app)/today/**`, `apps/web/app/(app)/plan/**`, `apps/web/app/(app)/recipes/**`, `apps/web/app/(app)/kitchen/**`, `apps/web/components/plan/**`, `apps/web/components/recipe/**`, `apps/web/e2e/plan.spec.ts`, `scripts/verify/leaf-1.4.4.mjs` | 1.4.1, 1.4.2, 1.2.4 | judgment | 7 |
| 1.4.5 | `apps/web/app/(app)/reviews/**`, `apps/web/app/(app)/insights/**`, `apps/web/app/(app)/chat/**`, `apps/web/components/chat/**`, `apps/web/components/reviews/**`, `apps/web/e2e/chat.spec.ts`, `scripts/verify/leaf-1.4.5.mjs` | 1.4.1, 1.4.2, 1.3.3, 1.3.5 | judgment | 8 |

**Shared manifests.** `package.json` files, `pnpm-lock.yaml` and workspace config belong to 1.1.1, which declares every dependency named in ARC-1 up front. A later leaf that needs a new dependency lists it in its return report, and the architect adds it on the integration branch before merging that leaf. Builders never edit files outside their OWNS.

Every leaf's verify script (`scripts/verify/leaf-<id>.mjs`) runs that leaf's tests and measurements. It prints `VERIFY leaf-<id> PASSED` only after every assertion passes, and exits non-zero otherwise. Each script includes at least one **negative control**: it runs the same assertion against a known-bad fixture and requires that run to fail. The architect reads each script before approving it (unlazy: CHECK is code).

## 5. Gates per leaf (BLD-5)

Each gate below becomes a ledger entry. Runnable gates use `CHECK: node scripts/verify/leaf-<id>.mjs --gate <G>` and `EXPECT: VERIFY leaf-<id> <G> PASSED`. `(manual)` marks gates reviewed by the architect.

**1.1.1 Monorepo, tooling, CI**
- G1 `pnpm install --frozen-lockfile && pnpm -r build` succeeds on Node 22.
- G2 `pnpm lint` and `pnpm typecheck` pass. The boundary rule (ARC-3) rejects a deliberately illegal import in a fixture (negative control).
- G3 The CI workflow runs lint, typecheck, unit and integration tests against a `postgres:16` service (manual: workflow file review).

**1.1.2 Schema, repositories, change-set service**
- G1 Migrations apply to an empty Postgres 16 and roll forward idempotently. Every table and column in [02-domain-model.md](02-domain-model.md) exists (introspection test).
- G2 Cross-household access through any repository throws (every repo is tested).
- G3 For every op in the AGT-6 registry: apply → inverse restores the exact prior state (property test with F1/F3), and protected ops are flagged.
- G4 Undo refuses with a conflict when a later change set touched the same entity.
- G5 Fixtures F1–F3 load.

**1.1.3 Catalogue data**
- G1 ≥ 250 ingredients. Every entry has required fields, a source and AE availability. ≥ 40 UAE-specific items from NUT-7 are present.
- G2 Every ingredient passes the Atwater check (NUT-4) or is marked `confidence: low` with a reason.
- G3 Method-yield rows exist for every (method, category) pair used by 1.2.4, and each has a source.
- G4 Soluble-fibre values have citations. Unknown values are `null`, not 0.
- G5 (manual) Architect spot-check of 20 random ingredients against their cited sources.

**1.2.1 Nutrition engine**
- G1 Golden tests: at least 15 hand-computed variants, covering grilled vs fried, breaded, boiled grain, retained-water stew and an absorbed-oil cap. They match to ±0.5 %.
- G2 `rawForCooked(variant, per100gCooked-derived plate)` round-trips to the batch totals within 0.1 %.
- G3 The same raw ingredients under `grilled` vs `deep_fried` produce different fat per 100 g cooked, in the physically expected direction (negative control: identical methods produce identical output).
- G4 100 % line coverage on `nutrition/`.

**1.2.2 Target resolver + portion solver**
- G1 Target resolver: for F1 over a full week, the per-slot targets sum to the daily targets (±1 g), and training days add pre/post slots for the right member only.
- G2 Solver: on 200 generated (dish, target) cases known to be feasible, 100 % are `in_tolerance` and all grams are on the step grid. On 50 known-infeasible cases, status is `infeasible` in strict mode and `flexible_miss` in flexible mode.
- G3 Adjusters: cases that are infeasible without adjusters become feasible with ≤ 2 adjusters, and excluded adjusters are never used.
- G4 Plate naturalness: no solved plate has a component outside its [min, max], and the median ratio deviation is ≤ 25 % on the seed library.
- G5 p95 solve time ≤ 150 ms per plate on the CI runner.

**1.2.3 Dish scoring, plan search, cook sheet**
- G1 SC-1: F1 7-day plan, with seed library only and AI off → 100 % of targeted member-meals `in_tolerance`, or flagged with a reason. Measured and printed.
- G2 SC-2: distinct ingredients with economy weight 0.4 vs 0 → ≥ 25 % reduction. Measured, not asserted from a constant.
- G3 Hard filters: the allergy (C3 sesame) is never present in any C3 plate across 50 seeded plans. Negative control: removing the exclusion makes sesame appear at least once.
- G4 Determinism: the same seed gives an identical plan. Week ≤ 30 s and day ≤ 5 s.
- G5 Cook sheet: raw totals equal the sum of plate raw equivalents. The plating table covers every attendee. A snapshot test is included.

**1.2.4 Seed dish library**
- G1 ≥ 60 active dishes across ≥ 10 cuisines. Every slot type has ≥ 8 suitable dishes; packed-no-reheat has ≥ 8 `served_cold_ok`.
- G2 ≥ 70 % of dishes have at least one component with ≥ 2 preparation variants that share ≥ 70 % of their ingredients (DM-3).
- G3 Every variant passes nutrition validation. ≥ 15 adjuster dishes exist.
- G4 For F1 targets, ≥ 80 % of dishes are feasible for both targeted adults at their dinner target.
- G5 (manual) Architect review of 10 random recipes for culinary plausibility, UAE availability and step clarity.

**1.3.1 Claude client + recipe generator**
- G1 With a recorded-response stub, the pipeline accepts a valid batch and rejects one of each defect class from REC-5 (bad slug, exclusion violation, variant drift, Atwater failure, duplicate, infeasible). Each rejection reason is surfaced.
- G2 The request builder: the system and catalogue blocks are byte-identical across two calls with different contexts (cache stability). No member names or ages appear in the request (pseudonymisation test).
- G3 `refusal`, `max_tokens` and parse-null paths are handled, with typed errors.
- G4 (manual, needs credentials) A live smoke test generating 3 F1 dinner dishes passes validation. Skipped with an explicit HANDOFF if no credentials are available.

**1.3.2 Reviews + preference learning**
- G1 SC-3: two 1★ reviews by one member lower that member's dish appeal by ≥ 0.3 and do not change other members' scores.
- G2 Propagation weights follow FBK-4. Locked preferences are never changed by learning.
- G3 Untargeted portion bias follows FBK-5 and stays within bounds. Targeted members' grams are unaffected.

**1.3.3 Insights engine + proposals**
- G1 Every FBK-7 rule has unit tests with triggering and non-triggering fixtures.
- G2 Guardrails (FBK-8): fingerprint suppression, the pending budget, protected ops never proposed, expiry.
- G3 LLM synthesis output is Zod-validated. Invalid kinds are dropped and logged (stubbed model).

**1.3.4 Knowledge graph**
- G1 A rebuild equals the incremental sync (KG-3).
- G2 `similarDishes` ranks a hand-built near-duplicate first. `substitutes` respects household exclusions.
- G3 Household isolation: no household-scoped edge is visible to another household.

**1.3.5 Admin agent**
- G1 Loop behaviour with a scripted stub model: parallel tool calls return in one user message, invalid tool JSON returns `is_error`, and `refusal`/`max_tokens`/`pause_turn` are handled. The iteration cap is enforced.
- G2 Protected ops sent via `apply_change` become proposals (server-enforced test).
- G3 History is append-only: a replayed conversation's stored blocks are byte-identical to what was sent.
- G4 (manual, needs credentials) The eval set (AGT-9) scores ≥ 90 % pass. HANDOFF if no credentials.

**1.4.1 API, auth, worker, SSE**
- G1 Every endpoint has a contract test (schema in and out) and an authorisation-matrix test (ARC-6), including cross-household denial.
- G2 A plan job runs in the worker and streams progress over SSE to a test client.
- G3 The OpenAPI document is generated and valid.

**1.4.2 Design system, app shell, PWA**
- G1 Tokens exist in light and dark themes. An automated contrast check passes AA for every text/background token pair used.
- G2 The shell renders at 390 px and 1280 px with no horizontal scroll (Playwright). Lighthouse PWA installability passes.
- G3 (manual) Architect visual review against UX-5.

**1.4.3 / 1.4.4 / 1.4.5 Screens**
- G1 Playwright flows for the leaf's screens at 390 px and 1280 px: onboarding → plan tomorrow (1.4.3); plan week, swap, lock, cook sheet print view (1.4.4); review with tags → proposal appears → accept → undo (1.4.5, with the stubbed model).
- G2 axe-core has no serious or critical violations on the leaf's screens.
- G3 The progressive-granularity behaviour of UX-2 works for each area the leaf owns (1.4.3).
- G4 (manual) Architect visual review against UX-5.

## 6. Branch and root gates (BLD-6)

- Each `node-*` ledger: N1 reverify all children, N2 interface checks (packages compile against each other's public types; the contract tests pass), N3 end-to-end for the branch, N4 regression (full test suite), N5 lease releases, N6 manual review.
- **Root.** SC-1 to SC-5 ([01-product.md](01-product.md) §7) as runnable gates on a fresh `docker compose up` with seeded data. Every contract-inventory row is reconciled. The final report goes to the owner.
