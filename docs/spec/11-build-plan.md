# 11 — Build plan (architect ↔ builder)

The build uses the **unlazy** skill (`.claude/skills/unlazy`) in orchestrated mode. The architect is the driver: it plans, dispatches, re-verifies, integrates and reports. Builders are native Claude Code background agents, each working on one leaf in its own git worktree. This file is the durable plan. The working ledgers under `.unlazy/mealplanner-v1/` are generated from it at build start and are git-ignored, as the skill requires.

## 1. Protocol (BLD-1)

The review checkpoints and anti-drift rules in §7 are binding and take precedence over anything looser below. Gate ledgers are **tracked in the repo** under `docs/build/` (not `.unlazy/`), because build sessions are ephemeral and the architect must see the same ledger the builder ran.


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
    1.4.6 Sign-in, People & access, account, platform ..... gates/leaf-1.4.6.md
```

## 4. Leaf dispatch table (BLD-4)

| Leaf | Owns | Needs | Tier | Wave |
|---|---|---|---|---|
| 1.1.1 | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.github/workflows/**`, `packages/*/src/index.ts`, `apps/worker/src/main.ts`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `docker-compose.yml`, `.env.example`, `scripts/verify/lib/**`, `scripts/verify/leaf-1.1.1.mjs`, `apps/*/package.json`, `packages/*/package.json`, `packages/*/tsconfig.json`, `apps/*/tsconfig.json` | – | mechanical | 1 |
| 1.1.2 | `packages/db/drizzle.config.ts`, `packages/db/src/schema/**`, `packages/db/src/migrations/**`, `packages/db/src/repos/**`, `packages/db/src/services/changes/**`, `packages/db/src/services/config/**`, `packages/db/test/**`, `packages/core/src/changes/**`, `packages/core/src/types/**`, `packages/core/test/fixtures/**`, `scripts/verify/leaf-1.1.2.mjs` | 1.1.1 | judgment | 2 |
| 1.1.3 | `data/ingredients.*`, `data/method-yields.*`, `data/cuisines.json`, `data/soluble-fibre.csv`, `data/substitutes.csv`, `scripts/import-fdc.ts`, `scripts/verify/leaf-1.1.3.mjs` | 1.1.1 | judgment | 2 |
| 1.2.1 | `packages/core/src/nutrition/**`, `packages/core/test/nutrition/**`, `scripts/verify/leaf-1.2.1.mjs` | 1.1.1 | judgment | 2 |
| 1.4.2 | `packages/ui-tokens/**`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/(shell)/**`, `apps/web/app/(app)/layout.tsx`, `apps/web/components/ui/**`, `apps/web/public/**`, `apps/web/next.config.*`, `apps/web/playwright.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/e2e/shell.spec.ts`, `scripts/verify/leaf-1.4.2.mjs` | 1.1.1 | judgment | 2 |
| 1.2.2 | `packages/core/src/planner/targets/**`, `packages/core/src/planner/solver/**`, `packages/core/test/planner/solver/**`, `packages/core/test/planner/targets/**`, `scripts/verify/leaf-1.2.2.mjs` | 1.1.2, 1.2.1 | judgment | 3 |
| 1.2.4 | `data/seed-dishes/**`, `data/adjusters.json`, `scripts/verify/leaf-1.2.4.mjs` | 1.1.3, 1.2.2 | judgment | 4 |
| 1.3.2 | `packages/core/src/learning/preferences/**`, `packages/core/src/learning/portions/**`, `packages/core/test/learning/prefs/**`, `packages/db/src/services/reviews/**`, `packages/db/test/reviews/**`, `packages/db/src/schema/review-revision.ts`, `packages/db/src/migrations/0002_*`, `packages/db/src/migrations/meta/**`, `scripts/verify/leaf-1.3.2.mjs` (plus the single-entry edits granted in R-26) | 1.1.2 | judgment | 3 |
| 1.2.3 | `packages/core/src/planner/select/**`, `packages/core/src/planner/cooksheet/**`, `packages/core/src/planner/index.ts`, `packages/core/test/planner/select/**`, `scripts/verify/leaf-1.2.3.mjs` | 1.2.2, 1.2.4 | judgment | 5 |
| 1.3.1 | `packages/ai/src/client/**`, `packages/ai/src/recipes/**`, `packages/ai/test/recipes/**`, `scripts/verify/leaf-1.3.1.mjs` | 1.1.2, 1.2.2 | judgment | 4 |
| 1.3.4 | `packages/graph/**`, `scripts/kg-rebuild.ts`, `scripts/verify/leaf-1.3.4.mjs` | 1.1.2, 1.2.4 | judgment | 5 |
| 1.4.1 | `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/app/api/**`, `apps/web/lib/server/**`, `apps/web/lib/auth/**`, `apps/web/app/(shell)/_shell/viewer.ts`, `apps/worker/src/**`, `packages/api-contract/src/**`, `packages/db/src/services/plans/**`, `packages/db/src/seed/**`, `apps/web/test/api/**`, `scripts/verify/leaf-1.4.1.mjs` | 1.1.2, 1.2.3 | judgment | 6 |
| 1.3.3 | `packages/core/src/learning/rules/**`, `packages/core/test/learning/rules/**`, `packages/ai/src/insights/**`, `packages/db/src/services/proposals/**`, `scripts/verify/leaf-1.3.3.mjs` | 1.3.1, 1.3.2 | judgment | 5 |
| 1.3.5 | `packages/ai/src/agent/**`, `packages/ai/test/agent/**`, `evals/agent/**`, `scripts/verify/leaf-1.3.5.mjs` | 1.3.1, 1.3.3, 1.4.1 | judgment | 7 |
| 1.4.3 | `apps/web/app/(app)/onboarding/**`, `apps/web/app/(app)/family/**`, `apps/web/app/(app)/settings/**`, `apps/web/components/config/**`, `apps/web/components/detail-level/**`, `packages/core/src/onboarding/**`, `packages/core/test/onboarding/**`, `apps/web/e2e/config.spec.ts`, `scripts/verify/leaf-1.4.3.mjs` | 1.4.1, 1.4.2 | judgment | 7 |
| 1.4.6 | `apps/web/app/(auth)/**`, `apps/web/app/(app)/access/**`, `apps/web/app/(app)/account/**`, `apps/web/app/(app)/changelog/**`, `apps/web/app/(platform)/**`, `apps/web/components/admin/**`, `apps/web/e2e/admin.spec.ts`, `scripts/verify/leaf-1.4.6.mjs` | 1.4.1, 1.4.2 | judgment | 7 |
| 1.4.4 | `apps/web/app/page.tsx`, `apps/web/app/(app)/today/**`, `apps/web/app/(app)/plan/**`, `apps/web/app/(app)/recipes/**`, `apps/web/app/(app)/kitchen/**`, `apps/web/components/plan/**`, `apps/web/components/recipe/**`, `apps/web/e2e/plan.spec.ts`, `scripts/verify/leaf-1.4.4.mjs` | 1.4.1, 1.4.2, 1.2.4 | judgment | 7 |
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

**r2 additions to gates** ([13-revision-r2.md](13-revision-r2.md)):
- 1.1.2 also: `meal_override`, `household_user.status/blocked_reason`, `support_grant`, `platform_operator` role, TOTP secrets; the last-admin invariant enforced in the service layer (test).
- 1.2.3 also: the planner honours `meal_override` (split_member, make_individual) (test).
- 1.4.1 also: block revokes all sessions immediately; invite single-use + expiry; TOTP; support-grant gating on every platform endpoint (tests).
- 1.4.3 also: G5 `inferSetup` golden tests (the fixture F1 answers produce exactly the F1 configuration; sesame expands to tahini/hummus/za'atar via flags; free-text parse is stubbed); G6 SC-6 (≤ 5 required answers to the first plan) and SC-7 (every review link resolves); G7 R2-DL behaviour (auto tags, per-value override, keep/reset on lowering the level).
- 1.4.6 G1 Playwright: sign-in (password + magic link stub + invite code), invite → accept, block → the blocked session gets 401 on its next request, remove, last-admin protection, change-log undo; G2 axe-core; G3 (manual) visual review against the mockups.

## 6. Branch and root gates (BLD-6)

- Each `node-*` ledger: N1 reverify all children, N2 interface checks (packages compile against each other's public types; the contract tests pass), N3 end-to-end for the branch, N4 regression (full test suite), N5 lease releases, N6 manual review.
- **Root.** SC-1 to SC-5 ([01-product.md](01-product.md) §7) as runnable gates on a fresh `docker compose up` with seeded data. Every contract-inventory row is reconciled. The final report goes to the owner.

## 7. Review checkpoints and anti-drift rules (BLD-7)

Every leaf passes three checkpoints. The builder **stops and waits** at CP1 and CP2. Only the architect advances a leaf.

| CP | Who | What must exist | Pass condition |
|---|---|---|---|
| CP1 Plan | Builder → Architect | A draft PR `leaf <id>: <title>` into the integration branch. Its body has: the leaf plan (files to create, public interfaces, key decisions), a **traceability table** (every requirement ID the leaf covers → where it will be implemented → which gate proves it), open `SPEC-Q`s, and any dependencies to add. No production code yet, apart from optional interface stubs. | The architect comments `CP1 APPROVED` (with any amendments). |
| CP2 Evidence | Builder → Architect | The finished work on the same PR. Every gate in `docs/build/gates/leaf-<id>.md` is met, with the checker's own evidence lines. PR body updated: gate results (paste the `gate-check --reverify` output), traceability table with file:line, deviations (should be none), and the four-pass log (what each pass found and fixed). | The builder marks the PR ready for review and stops. |
| CP3 Verify | Architect | — | The architect re-runs `--reverify` on a clean checkout, confirms `git diff --name-only` ⊆ OWNS, reads the diff against the cited IDs, refutes at least one gate, and reviews the manual gates. Then either `CP3 APPROVED` + merge, or `CHANGES REQUESTED` with numbered findings. |

**Anti-drift rules** (a violation fails CP2 automatically):
1. Write only inside the leaf's OWNS globs. Anything else needed goes in the PR as a request.
2. Do not edit the spec, the mockups, or any `CHECK:`/`EXPECT:`/`OWNS:` line in a ledger. Only the checker writes `EVIDENCE:`. If a gate seems wrong, raise `SPEC-Q` and stop; never weaken it.
3. Build only what the cited requirement IDs ask for. Nothing from 01-product §5 (out of scope). No extra features, pages, settings or dependencies.
4. No placeholders, TODOs, mocked production paths or skipped/disabled tests in the finished leaf. Stubs are allowed only for the model in tests, as the gates specify.
5. UI must match the mockup for that screen (`docs/mockups/<Screen>.dc.html`) in layout, content and interactions. Improve only accessibility and responsiveness.
6. When unsure, choose the more conservative reading, record it as `SPEC-Q-<n>` in `docs/decisions/leaf-<id>-questions.md` (every leaf owns `docs/decisions/leaf-<id>-*.md`), and carry on. Stop only if the question blocks a gate.
7. Report honestly. A gate that cannot pass is `ABANDON:`ed with a reason, never marked done.
8. One leaf per PR, and one PR at a time unless the architect dispatches a wave in parallel.

## 8. Architect rulings (BLD-8)

Recorded from leaf CP1 reviews. They are binding for all leaves.

- **R-1 (SPEC-Q-1, leaf 1.1.1). Compile roots and hand-over.**
  - 1.1.1 owns `packages/*/src/index.ts`, `apps/worker/src/main.ts`, `apps/web/app/layout.tsx` and `apps/web/app/page.tsx` as minimal bootstrap entry points.
  - Hand-over: `apps/web/app/layout.tsx` goes to 1.4.2 (already in its OWNS), `apps/web/app/page.tsx` to 1.4.4, and `apps/worker/src/main.ts` to 1.4.1 (inside `apps/worker/src/**`).
  - Packages expose **subpath exports** (`@mealplanner/core/nutrition`, `…/planner`, `…/changes` …), mapped `"./*": "./dist/src/*/index.js"`. Each leaf owns its own subdirectory `index.ts`, and the package root `src/index.ts` stays an empty barrel owned by 1.1.1. This is the one permitted bootstrap stub.
- **R-2 (SPEC-Q-2). ARC-3 is an exhaustive allow-list** exactly as in leaf-1.1.1 ADR-3.
  - `ai` and `graph` do not import `db`.
  - Services from `db` reach `ai` by dependency injection, wired in `apps/*`.
- **R-3 (SPEC-Q-4).** Leaves keep `--passWithNoTests` until node-1.1. node-1.1 N4 removes it, once every package has tests.
- **R-4 (SPEC-Q-6).** `docker-compose.yml` has only `postgres:16` until 1.4.1. 1.4.1 owns `apps/web/Dockerfile` and `apps/worker/Dockerfile`, and requests the `web`/`worker` compose services from the architect.
- **R-5 (SPEC-Q-8). Tool config owners.**
  - `packages/db/drizzle.config.ts` → 1.1.2.
  - `apps/web/playwright.config.ts`, `apps/web/postcss.config.mjs` → 1.4.2. `next-env.d.ts` is generated by Next.js and git-ignored.
  - Vitest runs from CLI flags; there is no shared config file.
- **R-6.** Accepted as proposed: SPEC-Q-3 (1.1.1 creates the ui-tokens/graph manifests only), SPEC-Q-5 (no `apps/mobile` in v1), SPEC-Q-7 (`EMAIL_FROM`, `EMAIL_SERVER`).

### Rulings from wave 2 CP1 (leaves 1.1.2, 1.2.1)

- **R-7 (1.1.2 SPEC-Q-1). Change ops in core, applied in db.** Change ops live in core and are written against a `ChangeTx` interface that the db package implements. Every inverse is a before-image restore through the internal `rows.restore` op, which is never exposed in `ChangeOpSchema`.
- **R-8 (1.1.2 SPEC-Q-2/3).** Every household-scoped table carries `household_id`, with composite foreign keys, as the builder proposed. The natural composite primary keys it proposed are accepted.
- **R-9 (1.1.2 SPEC-Q-4). Build all twelve column groups a–l now**, plus the R-11 and R-12 columns below.
  - Reason: only 1.1.2 owns migrations, so a column deferred now would block a later leaf.
  - **Schema changes after 1.1.2 merges:** a leaf that needs one requests it at CP1. The architect then adds `packages/db/src/schema/<file>.ts` and one new numbered migration to that leaf's OWNS for that leaf only. Nobody edits an existing migration.
- **R-10 (1.1.2 SPEC-Q-5). New ops.** Add `access.block`, `access.unblock`, `access.remove`, `access.link_member`, `meal_override.set`, `meal_override.remove`, `support.grant`, `support.revoke`, and also **`plan.save_days`**.
  - `plan.save_days` replaces the unlocked meals, plates and cook batches of the given dates with the supplied rows. It is not protected.
  - Protected: `access.block`, `access.remove`, `access.link_member`, `support.grant`.
- **R-11 (1.1.2 SPEC-Q-6).** Drop `user.password_hash`, because Better Auth keeps the hash in `account.password`. The spec column list (02 §1) is amended to match.
- **R-12 (1.2.1 SPEC-Q-2/3). Cooking liquid and coating.**
  - `variant_ingredient` gains `cooking_liquid` (null | `absorbed` | `retained`) and `yield_override numeric?`. These replace SPEC-Q-4c's `retained` bool.
  - An absorbed liquid adds no cooked mass but does count its own nutrients: water contributes zero, stock contributes its kcal and sodium.
  - A coating is an ordinary variant ingredient. `method_yield.coating_ingredient_id` and `coating_g_per_100g_raw` are **removed** from 02 §3.
  - 1.1.3 seeds breaded yields excluding the coating's own mass.
- **R-13 (1.2.1 SPEC-Q-4). Unknown nutrients.**
  - A variant or plate value is `null` if any contributing ingredient's value is `null`, **except** where a known bound makes it zero:
    - `solubleFibre` counts as 0 when that ingredient's `fibre` is 0;
    - `sugar` counts as 0 when its `carbs` is 0.
  - 1.1.3 fills those known zeros in the data rather than leaving them null.
  - Reason: without this, a single spice with unknown data would make almost every dish's soluble fibre unknown, which would switch off the soluble-fibre priority.
- **R-14 (1.2.1 other questions).**
  - Accepted as proposed: SPEC-Q-1 (the engine keeps its own structural input types; the db and planner leaves map rows onto them), SPEC-Q-5, SPEC-Q-6 and SPEC-Q-7.
  - The dependency `@vitest/coverage-v8@5.0.2` is added at the root on the base branch.
- **R-15 (1.1.2 SPEC-Q-7/8/9).** Accepted as proposed.
- **R-16. Plan correction (architect error).**
  - Leaf 1.2.2 also needs 1.1.2: its gates use fixture F1 and `HouseholdConfig` from `@mealplanner/core/types`.
  - 1.2.2 G4 no longer measures against the seed library, which 1.2.4 builds after 1.2.2 and would make the plan circular. G4 now measures the leaf's own test dish set, and the seed-library check moves to the new 1.2.4 G6.

### Rulings from wave 2 CP1 (leaf 1.1.3)

- **R-17 (1.1.3 SPEC-Q-3). Catalogue loader.** Leaf 1.4.1 owns `packages/db/src/seed/**`: an idempotent loader from `data/*` into the catalogue tables (ARC deployment: "seed data loads idempotently"). It maps rows by DM column name, resolves slugs and keys to foreign keys, ignores `meta`, and marks an ingredient `needs_review` when it fails NUT-4 (1.1.3 SPEC-Q-10). Until then, leaves that need catalogue data read the JSON files directly in tests.
- **R-18 (1.1.3 SPEC-Q-9).** The architect adds `scripts/tsconfig.json` (no emit, `.ts` import extensions allowed, erasable syntax only), so typed lint covers `scripts/*.ts`. When 1.1.3 merges, the architect adds `tsc -p scripts` to the root `typecheck`.
- **R-19 (1.1.3 other questions).**
  - Accepted as proposed: SPEC-Q-1 (all method × category pairs except a reasoned exclusion list; G3 re-derives the used pairs from `data/seed-dishes/**` once it exists), Q-2 (`cofid:`, `afcd:`, `off:` source prefixes), Q-4 (mirrored FDC data with fidelity checks), Q-5, Q-7, Q-8, Q-10, Q-11 and Q-12.
  - SPEC-Q-6 is settled by R-13: soluble fibre is 0 where total fibre is 0, and sugar is 0 where carbohydrate is 0.
  - Under R-12, `breaded_*` yield rows describe the substrate only. The coating's mass and nutrients are excluded, and the file has no coating columns.
- **R-20 (1.1.3 SPEC-Q-13). Carbohydrate basis — architect error in NUT-4/NUT-7.** NUT-4's formula `4P + 4C + 9F + 2·fibre` balances only when `C` is **available** carbohydrate, but NUT-7 mapped `carbs_g` to FDC 1005, which is carbohydrate by difference and includes fibre.
  - `ingredient.carbs_g` and the engine's `carbs` are **available carbohydrate**: FDC `1005 − 1079` (clamped at 0, derivation in `meta`), CoFID `CHO` and AFCD available carbohydrate as reported. `fibre_g` is FDC 1079 / AOAC. NUT-4 is unchanged.
  - Total carbohydrate is `carbs + fibre`. Whether a member's carb target means total or net is owner question OQ-7; its default is **total**. The target resolver (1.2.2) and every UI that shows carbs against a target follow OQ-7, and label which basis they show.

### Rulings from wave 2 CP1 (leaf 1.4.2)

- **R-21 (1.4.2 SPEC-Qs).**
  - Q-1: 1.4.2 also owns `apps/web/app/(app)/layout.tsx`, a re-export of the shell layout.
  - Q-2: the approved mockups win over UX-3: the phone tab bar ends with **Me**, and the rail has nine items including People & access.
  - Q-3: route paths as proposed; Me → `/family/me`.
  - Q-4: G2 checks installability through Chromium's `Page.getInstallabilityErrors`; Lighthouse is not added.
  - Q-5: accepted. `apps/web/app/(shell)/_shell/viewer.ts` passes to **1.4.1** when 1.4.2 merges; 1.4.1 replaces its body with the session lookup.
  - Q-6, Q-7, Q-8: accepted. 1.4.6's sign-out calls `clearOfflineCache()`.
  - Q-9: **overruled.** 1.4.4 needs star ratings (TodayDesktop, RecipePage, RecipeLibrary) before 1.4.5 exists, so `StarRating` is a 1.4.2 primitive.
  - Dependencies `@fontsource-variable/fraunces`, `@fontsource/nunito`, `@fontsource/jetbrains-mono` (5.3.0) are added to `apps/web`. The optional CI e2e job is declined: the architect re-runs G1 and G2 at CP3.

### Rulings from wave 2 CP3 (leaf 1.1.3)

- **R-22. NUT-4 and source-specific energy factors — architect error.** USDA SR computes energy with food-specific Atwater factors (for example 2.44 kcal/g protein in many vegetables). The generic 4/4/9/2 check therefore fails correct USDA data for cucumber, mushrooms, kidney beans, oat bran and others, and R-17's loader rule would have excluded them from planning.
  - Where the source publishes food-specific factors, the catalogue records them in `meta.atwater_factors` (`protein`, `fat`, `carbohydrate`, numeric, with the source record). An ingredient **passes NUT-4** when either the generic check or the check with its own factors is within 12 %. Its confidence is not lowered for that reason.
  - Only failures that remain after that are data errors: `low` with a reason, and marked `needs_review` by the loader (R-17).
  - Computed variants inherit the same gap (a steamed-mushroom component would fail the generic check). The variant check therefore compares the variant's kcal with the sum of its ingredients' predicted energy, each ingredient using its own factors where recorded and 4/4/9/2 otherwise. This amends 1.2.1's `atwaterCheck` for variants; the architect assigns that change when 1.2.4 is dispatched, and 1.2.4 G3 uses it.

### Rulings from wave 2 CP3 (leaf 1.1.2)

- **R-23. No emoji in data (R2-UX-5) — architect error in 02.** 02 still carried r1 emoji fields. Before 1.1.2 merges: `member.emoji_avatar` and `cuisine.flag_emoji` are removed; `slot_type.emoji` becomes `slot_type.icon` (text, not null), an icon key the UI maps to an inline SVG. 1.1.3 drops `flag_emoji` from `data/cuisines.json`.
- **R-24 (1.1.2 SPEC-Q-10 … 14, D-1).**
  - Q-10: weekday `0 = Monday … 6 = Sunday`, through `weekdayOf()`. Accepted.
  - Q-11: 1.1.2 adds `portion_bias.set` now (FBK-5 logs it as a `learning` change set; not protected). `detail_level` is a per-member UI preference written directly through its repository, outside DM-6. Invite acceptance is part of the auth flow (1.4.1). Accepted.
  - Q-12 (roles enforced in the API layer, 1.4.1) and Q-13 (`plan.save_days` refuses a date whose meal has reviews unless it is locked): accepted.
  - Q-14: default slot times accepted; icons per R-23.
  - D-1: `drizzle.config.ts` lives under `packages/db/src/migrations/`. Accepted.

### Rulings from wave 3 CP1 (leaves 1.2.2, 1.3.2)

- **R-25 (1.2.2 SPEC-Q-1 … 16).** Accepted as proposed: the interface additions (`SlotTarget.slotTypeId`, `SlotTarget.carbBasis`, `loadPortionSolver()`, status `untargeted`, `DishForSolve` / `MemberCtx`), constants in `planner/solver/config.ts`, the sat-fat default from `household.sat_fat_default_pct` (OQ-4), largest-remainder rounding, the G4 ratio-deviation definition, and the strict-infeasible and untargeted rules. `planner/index.ts` (1.2.3) re-exports `planner/targets` and `planner/solver`.
- **R-26 (1.3.2).**
  - SPEC-Q-1: SC-3 requires a *measurable* drop. G1 asserts the member's dish preference score falls by ≥ 0.3 and the member's plate appeal falls by a measured amount > 0, with every other member unchanged.
  - SPEC-Q-2: 1.3.2 owns `packages/db/test/reviews/**`.
  - SPEC-Q-11 (architect gap): FBK-2 "edits are kept" had no table. 02 now has `review_revision`. Under R-9, 1.3.2 owns `packages/db/src/schema/review-revision.ts`, migration `0002_*` and `packages/db/src/migrations/meta/**`, and may make **single-entry** additions to `packages/db/src/schema/index.ts` (export), `packages/db/src/repos/tables.ts` (the repository entry, household-scoped), `packages/db/test/spec-columns.ts` (the new table's columns) and `packages/db/test/support/populate.ts` (one `review_revision` insert, so 1.1.2 G2 has a row to attack). Migration `0001` stays untouched. 1.1.2's gates G1 and G2 must still pass on the 1.3.2 branch, and the CP2 PR shows that output.
  - SPEC-Q-3 … 10, 12, 13: accepted as proposed.

### Rulings from wave 3 CP3 (leaves 1.3.2, 1.4.2)

- **R-27 (R-21 hand-over).** 1.4.2 is merged; `apps/web/app/(shell)/_shell/viewer.ts` now belongs to 1.4.1, which replaces its body with the session lookup.
- **W-1 (watch item).** In the architect's CP3 of 1.4.2 at `04f43f1`, G2 failed once in nine runs (three `gate-check --reverify` runs, six direct runs, some under CPU load); the checker truncated the output, and the failure did not reproduce. The next leaf that runs the shell e2e (1.4.4 or 1.4.6) prints full failure output on any G2-style failure; a second occurrence is a finding against `apps/web/e2e/shell.spec.ts`.

### Owner answers (2026-09-26)

- **R-28. OQ-2, OQ-4 and OQ-7 answered by the owner.**
  - **OQ-7: carbohydrate targets are total** (`carbs_g + fibre_g`), the R-20 default. `CARB_TARGET_BASIS = "total"` stays.
  - **OQ-2: kcal tolerance is ±50 per day, not per meal.** P/C/F tolerances stay per meal. The target resolver (1.2.2) splits the daily kcal band across attended slots by share (04 PLN-4 step 6); the plan search (1.2.3) re-targets later slots with the kcal already consumed, and asserts every member-day total within ±`tolerance.kcal`. `tolerance.kcal` keeps its column and default 50; only its meaning changes.
  - **OQ-4: saturated fat ≤ 6 % of kcal** when a member sets no `sat_fat_max_g` (hard, as before). `household.sat_fat_default_pct` defaults to 6 via migration `0003_sat_fat_default_6` (architect-applied).
  - **OQ-4: fibre goals** when a member sets none: total fibre ≥ 14 g per 1,000 kcal of the day's target, of which ≥ 25 % soluble. Both are **soft** goals in the solver objective (penalised shortfall), split by slot share, and misses are reported. They are not hard constraints: soluble fibre is unknown (null, counted as 0) for 208 of the 363 catalogue ingredients, so a hard soluble minimum would make most plans infeasible on missing data rather than on food.
- **R-29 (1.2.2 SPEC-Q-17). `λ_ratio = 2`.** Measured on 771 in-tolerance plates: at the spec's 0.5 the centring term `Σ|dev|/tol` outweighs naturalness (1 g of protein centring ≈ 175 g of ratio deviation) and the median ratio deviation is 0.276 (G4 limit 0.25). At 2 it is 0.200 with every plate still in tolerance; only the choice among in-band plates changes. G4's threshold and metric are unchanged. 04 PLN-5 amended.
