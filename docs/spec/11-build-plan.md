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
    1.2.5 Deterministic solver limit (W-4) ................ gates/leaf-1.2.5.md
    1.2.6 Owner rulings: repeat gaps, slot-scoped exclusions gates/leaf-1.2.6.md
    1.2.7 Id-independent plan search (W-17) ........... gates/leaf-1.2.7.md
  1.3 Intelligence ....................................... gates/node-1.3.md
    1.3.1 Claude client + recipe generator ................ gates/leaf-1.3.1.md
    1.3.2 Reviews + preference learning ................... gates/leaf-1.3.2.md
    1.3.3 Insights engine + proposals ..................... gates/leaf-1.3.3.md
    1.3.4 Knowledge graph ................................. gates/leaf-1.3.4.md
    1.3.5 Admin agent loop + tools ........................ gates/leaf-1.3.5.md
    1.3.6 Live-model fixes (W-11) ......................... gates/leaf-1.3.6.md
  1.4 Product ............................................ gates/node-1.4.md
    1.4.1 API, auth, worker, SSE .......................... gates/leaf-1.4.1.md
    1.4.2 Design system, app shell, PWA ................... gates/leaf-1.4.2.md
    1.4.3 Onboarding, Family, Settings screens ............ gates/leaf-1.4.3.md
    1.4.4 Today, Plan, Plate, Recipes, Kitchen screens .... gates/leaf-1.4.4.md
    1.4.5 Reviews, Insights, Chat UI ...................... gates/leaf-1.4.5.md
    1.4.6 Sign-in, People & access, account, platform ..... gates/leaf-1.4.6.md
    1.4.7 Deferred scope W-5: parse, preview, first days .. gates/leaf-1.4.7.md
    1.4.8 Plan follow-ups: move, substitutes, day sums .... gates/leaf-1.4.8.md
    1.4.9 Chat and setup follow-ups (W-9, W-10) ........... gates/leaf-1.4.9.md
    1.4.10 Plain reasons, graph start-up, change-log subjects gates/leaf-1.4.10.md
    1.4.11 Assistant button clearance at phone width (W-15) gates/leaf-1.4.11.md
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
| 1.2.4 | `data/seed-dishes/**`, `data/adjusters.json`, `scripts/verify/leaf-1.2.4.mjs`, `packages/core/src/nutrition/atwater.ts`, `packages/core/src/nutrition/index.ts` (export only), `packages/core/test/nutrition/atwater.test.ts` (R-30) | 1.1.3, 1.2.2 | judgment | 4 |
| 1.2.5 | `packages/core/src/planner/solver/**`, `packages/core/test/planner/solver/**`, `scripts/verify/leaf-1.2.5.mjs` | 1.2.3 | measured | 4 |
| 1.2.6 | `packages/core/src/planner/select/{config,filters}.ts`, `packages/core/test/planner/select/frequency*.test.ts`, `packages/core/test/planner/select/exclusion-scope*.test.ts`, `scripts/verify/leaf-1.2.3.mjs` (G2 threshold and aggregation only), `packages/db/src/schema/feedback.ts` (exclusion `slot_keys` only), `packages/db/src/migrations/0007_*` + snapshot, `packages/core/src/onboarding/followups/engine.ts`, `packages/core/test/onboarding/followups/**`, `scripts/verify/leaf-1.2.6.mjs` (transferred from merged 1.2.3, 1.1.2, 1.4.7; R-62) | 1.4.7 | judgment | 9 |
| 1.2.7 | `packages/core/src/planner/select/**` (transferred from merged 1.2.3, 1.2.6, 1.4.10), `packages/core/test/planner/select/support.ts`, `packages/core/test/planner/select/library.ts`, `packages/core/test/planner/select/f1.ts`, `packages/core/test/planner/select/id-independence*.test.ts`, `packages/db/src/services/plans/load-input.ts` (transferred from merged 1.4.1), `packages/db/test/plans/id-independence*.int.test.ts`, `scripts/verify/leaf-1.2.7.mjs`, `docs/decisions/leaf-1.2.7-*.md` (R-73) | 1.4.10 | measured | 10 |
| 1.3.2 | `packages/core/src/learning/preferences/**`, `packages/core/src/learning/portions/**`, `packages/core/test/learning/prefs/**`, `packages/db/src/services/reviews/**`, `packages/db/test/reviews/**`, `packages/db/src/schema/review-revision.ts`, `packages/db/src/migrations/0002_*`, `packages/db/src/migrations/meta/**`, `scripts/verify/leaf-1.3.2.mjs` (plus the single-entry edits granted in R-26) | 1.1.2 | judgment | 3 |
| 1.2.3 | `packages/core/src/planner/select/**`, `packages/core/src/planner/cooksheet/**`, `packages/core/src/planner/solver/**` (R-38, performance only), `packages/core/test/planner/solver/**` (R-38), `packages/core/src/planner/index.ts`, `packages/core/test/planner/select/**`, `scripts/verify/leaf-1.2.3.mjs` | 1.2.2, 1.2.4 | judgment | 5 |
| 1.3.1 | `packages/ai/src/client/**`, `packages/ai/src/recipes/**`, `packages/ai/test/recipes/**`, `scripts/verify/leaf-1.3.1.mjs` | 1.1.2, 1.2.2 | judgment | 4 |
| 1.3.4 | `packages/graph/**`, `scripts/kg-rebuild.ts`, `scripts/verify/leaf-1.3.4.mjs` | 1.1.2, 1.2.4 | judgment | 5 |
| 1.4.1 | R-40 grants (schema, ops, rule-3 switch, compose, env; see §8), `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/app/api/**`, `apps/web/lib/server/**`, `apps/web/lib/auth/**`, `apps/web/app/(shell)/_shell/viewer.ts`, `apps/worker/src/**`, `packages/api-contract/src/**`, `packages/db/src/services/plans/**`, `packages/db/src/seed/**`, `apps/web/test/api/**`, `scripts/verify/leaf-1.4.1.mjs` | 1.1.2, 1.2.3 | judgment | 6 |
| 1.3.3 | `packages/core/src/learning/rules/**`, `packages/core/test/learning/rules/**`, `packages/ai/src/insights/**`, `packages/ai/test/insights/**`, `packages/db/src/services/proposals/**`, `packages/db/test/proposals/**`, `scripts/verify/leaf-1.3.3.mjs` | 1.3.1, 1.3.2 | judgment | 5 |
| 1.3.5 | `packages/ai/src/agent/**`, `packages/ai/test/agent/**`, `evals/agent/**`, `packages/ai/src/reviews/**` (R-40), `packages/ai/test/reviews/**` (R-40), `apps/web/app/api/v1/conversations/[id]/messages/route.ts` (R-40), `apps/web/test/api/conversations-messages.int.test.ts` (R-40), `apps/worker/src/jobs/reviews-extract.ts` (R-40), `apps/web/lib/server/agent.ts`, `apps/worker/src/jobs/chat-events.ts`, `apps/worker/src/jobs/recipe-draft.ts`, `packages/db/src/migrations/0005_review_extraction.sql` + snapshot (R-46), `scripts/verify/leaf-1.3.5.mjs` | 1.3.1, 1.3.3, 1.4.1 | judgment | 7 |
| 1.3.6 | `packages/ai/src/recipes/**`, `packages/ai/src/client/**`, `packages/ai/src/agent/**` except `cards.ts` and `events.ts` (1.4.9), `packages/ai/test/recipes/**`, `packages/ai/test/agent/**` except `digest-*.test.ts`, `evals/agent/**`, `scripts/verify/leaf-1.3.6.mjs` (transferred from merged 1.3.1, 1.3.5; R-64) | 1.3.5 | judgment | 10 |
| 1.4.3 | `apps/web/app/(setup)/onboarding/**` (R-47), `apps/web/app/(app)/family/**`, `apps/web/app/(app)/settings/**` except `settings/household/**` (R-45), `apps/web/app/api/v1/detail-levels/route.ts`, `apps/web/lib/server/detail-levels.ts`, `apps/web/test/api/detail-levels.int.test.ts` (R-47), `apps/web/components/config/**`, `apps/web/components/detail-level/**`, `packages/core/src/onboarding/**`, `packages/core/test/onboarding/**`, `apps/web/e2e/config.spec.ts`, `scripts/verify/leaf-1.4.3.mjs` | 1.4.1, 1.4.2 | judgment | 7 |
| 1.4.6 | `apps/web/app/(auth)/**`, `apps/web/app/(app)/access/**`, `apps/web/app/(app)/account/**`, `apps/web/app/(app)/changelog/**`, `apps/web/app/(app)/settings/household/**` (R-45), `apps/web/app/(platform)/**`, `apps/web/components/admin/**`, `apps/web/e2e/admin.spec.ts`, `scripts/verify/leaf-1.4.6.mjs` | 1.4.1, 1.4.2 | judgment | 7 |
| 1.4.7 | `packages/ai/src/onboarding/**`, `packages/ai/test/onboarding/**`, `packages/core/src/onboarding/followups/**`, `packages/core/test/onboarding/followups/**`, `apps/web/app/api/v1/onboarding/**`, `apps/web/app/api/v1/plans/preview/**`, `apps/web/app/api/v1/setup-followups/**`, `apps/web/lib/server/{onboarding-parse,plan-preview,setup-followups}.ts`, `apps/web/test/api/{onboarding-parse,plans-preview,setup-followups}.int.test.ts`, `apps/worker/src/jobs/plans-preview.ts`, `apps/web/app/(app)/getting-started/**`, `apps/web/components/setup/**`, `apps/web/e2e/setup.spec.ts`, `packages/db/src/schema/setup.ts`, `packages/db/src/migrations/0006_*` + snapshot, `scripts/verify/leaf-1.4.7.mjs` (R-55) | 1.3.1, 1.4.1, 1.4.3 | judgment | 5 |
| 1.4.4 | `apps/web/app/page.tsx`, `apps/web/app/(app)/today/**`, `apps/web/app/(app)/plan/**`, `apps/web/app/(app)/recipes/**`, `apps/web/app/(app)/kitchen/**`, `apps/web/components/plan/**`, `apps/web/components/recipe/**`, `apps/web/e2e/plan.spec.ts`, `scripts/verify/leaf-1.4.4.mjs`, R-52: `apps/web/lib/server/kitchen-flags.ts`, `apps/web/test/api/cook-sheet-flags.int.test.ts`, `apps/web/app/api/v1/plans/[date]/publish/route.ts`, `apps/web/app/api/v1/plan-meals/[id]/status/route.ts`, `apps/web/test/api/plan-status.int.test.ts` | 1.4.1, 1.4.2, 1.2.4 | judgment | 7 |
| 1.4.5 | `apps/web/app/(app)/reviews/**`, `apps/web/app/(app)/insights/**`, `apps/web/app/(app)/chat/**`, `apps/web/components/chat/**`, `apps/web/components/reviews/**`, `apps/web/e2e/chat.spec.ts`, `scripts/verify/leaf-1.4.5.mjs`, R-53: `apps/web/test/chat/**`, `apps/web/e2e/chat/**`, `apps/web/app/api/v1/portion-biases/route.ts`, `apps/web/lib/server/portion-biases.ts`, `apps/web/test/api/portion-biases.int.test.ts` | 1.4.1, 1.4.2, 1.3.3, 1.3.5 | judgment | 8 |
| 1.4.8 | `apps/web/app/(app)/plan/**`, `apps/web/app/(app)/recipes/**`, `apps/web/components/plan/**`, `apps/web/components/recipe/**`, `apps/web/e2e/plan.spec.ts` (transferred from merged 1.4.4), `apps/web/app/api/v1/plan-meals/[id]/move/**`, `apps/web/lib/server/plan-move.ts`, `apps/web/test/api/plan-move.int.test.ts`, `packages/db/src/services/plans/{substitute,move}.ts`, `packages/db/test/plans/**` (new), `apps/web/test/api/cook-sheet-flags.int.test.ts` (transferred), `packages/core/src/planner/targets/**`, `packages/core/test/planner/targets/**` (W-7 only), `scripts/verify/leaf-1.4.8.mjs` (R-58) | 1.4.4 | judgment | 8 |
| 1.4.9 | `packages/ai/src/agent/{cards,events}.ts`, `packages/ai/test/agent/digest-*.test.ts`, `apps/worker/src/jobs/chat-events.ts`, `apps/web/test/api/chat-events-*.int.test.ts`, `apps/web/components/chat/cards/**`, `apps/web/test/chat/**`, `packages/core/src/onboarding/{parse-people,text,infer}.ts`, `packages/core/test/onboarding/**` (not `followups/**`), `apps/web/app/(shell)/_shell/{assistant-button,app-shell}.tsx`, `scripts/verify/leaf-1.4.9.mjs` (transferred from merged 1.3.5, 1.4.5, 1.4.3, 1.4.2; R-61) | 1.4.5, 1.4.7 | judgment | 9 |
| 1.4.10 | `packages/core/src/planner/select/{score,run,pool}.ts`, `packages/core/test/planner/select/reasons*.test.ts`, `apps/web/components/plan/plate-detail.tsx`, `apps/worker/src/main.ts`, `packages/graph/src/sync/**`, `packages/graph/test/startup*.test.ts`, `apps/web/test/api/kg-startup*.int.test.ts`, `apps/web/lib/server/changes.ts`, `apps/web/app/(app)/changelog/**`, `apps/web/test/api/change-log-detail*.int.test.ts`, `apps/web/test/followups/**`, `scripts/verify/leaf-1.4.10.mjs`, `docs/decisions/leaf-1.4.10-*.md` (transferred from merged 1.2.3, 1.2.6, 1.3.4, 1.4.1, 1.4.6, 1.4.8; R-68) | 1.4.8, 1.4.9, 1.3.6 | judgment | 6 |
| 1.4.11 | `apps/web/app/(shell)/_shell/app-shell.tsx` (transferred from merged 1.4.2 and 1.4.9), `apps/web/e2e/assistant-clearance*.spec.ts`, `scripts/verify/leaf-1.4.11.mjs`, `docs/decisions/leaf-1.4.11-*.md` (R-77) | 1.4.10 | mechanical | 11 |
| 1.3.7 | `packages/core/src/learning/rules/practical.ts`, the `dish` exclusion kind (R-83: `packages/core/src/types/enums.ts` `EXCLUSION_KINDS` entry, `packages/db/src/migrations/0008_*.sql` and `meta/**`, `planner/select/members.ts` and `filters.ts`, `changes/ops/taste.ts`, `learning/rules/{satisfied,config,index,run}.ts`, `apps/web/components/config/never-serve.tsx`, R-85: `learning/rules/types.ts` (two `RULE_IDS` entries), `planner/select/run.ts` (one `eligiblePool` conjunct), `packages/graph/src/store/exclusions.ts` (one `case "dish"`), `packages/core/test/planner/select/dish-exclusion*.test.ts`), `packages/core/test/learning/rules/practical*.test.ts`, `packages/db/test/nutrition-recompute*.int.test.ts`, `apps/web/test/api/recipe-draft*.int.test.ts`, `scripts/verify/leaf-1.3.7.mjs`, `docs/decisions/leaf-1.3.7-*.md` (R-82) | 1.3.6, 1.4.11 | standard | 12 |
| 1.4.12 | `apps/web/e2e/contract-gaps*.spec.ts`, `apps/web/e2e/contract-gaps/**`, `apps/web/components/config/tastes-section.tsx` (one line, R-84), `scripts/verify/leaf-1.4.12.mjs`, `docs/decisions/leaf-1.4.12-*.md` (R-82) | 1.4.11 | mechanical | 12 |

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

**1.2.5 Deterministic solver limit (W-4)**
- G1 Determinism under load: F1 week plans for seeds 1–3 are identical across 3 idle runs and 3 runs with every CPU saturated by busy processes. Negative control: the same comparison reports a plan that differs in one dish.
- G2 Budget (R-38, PLN-11): worst day ≤ 4.0 s CPU and week ≤ 30 s wall on an idle machine, measured and printed.
- G3 Quality: over seeds 1–10 of the F1 week, the median plan objective is within 0.5 % of the 0.25 s wall-clock baseline measured idle on the same machine, and SC-1's in-tolerance rate is not lower. Both measured, baseline included.
- G4 No regression: 1.2.3 G1, G3, G4, G5 and 1.2.2 G1–G5 pass; 1.2.3 G2 is reported (W-3 open).

**1.2.7 Id-independent plan search (W-17; R-73)**
- G1 Id independence (W-17, PLN-11): for each seed 1–10, the F1 week is planned twice in core. The second time, every surrogate id is consistently remapped to a fresh UUIDv7-shaped string: dishes, components, variants, adjusters, members, slot types, and the config rows that reference them. Mapped back, the two plans are identical: the dish per meal, plate grams, flags and reasons. For each seed, a different seed still changes the plan. Negative control: today's id-keyed jitter fails the comparison.
- G2 Job path: `plan.generate` for the F1 week at seed 1 runs on two separately seeded databases, each migrated, seeded and loaded with F1 from zero (not clones of one template). The persisted rows, as (date, slot key, member name, dish slug, plate grams, flags), are identical. Negative control: the same comparison reports a one-dish difference.
- G3 No regression, measured: 1.2.3 G1 and G3–G5, 1.2.5 G1–G4, 1.2.6 G1–G2 and 1.4.10 G1 pass. SC-2 over seeds 1–10 is measured on the new code: median ≥ 8 % and every seed ≥ 0 % (1.2.3 G2 as re-set by R-63). SC-1's in-tolerance rate and the frequency-relaxed count are printed, beside the same figures on the pre-fix code.

**1.4.11 Assistant button clearance at phone width (W-15; R-77)**
- G1 Clearance (W-15, UX-4): with Playwright at 390 px and at 360 px, as an admin (the floating Assistant button shows), on `/account` and on a Plate page, each scrolled to the end, the button's box does not intersect the page's last control ("Delete my account", "See recipe"), and `elementFromPoint` at that control's centre hits the control. On a role without the assistant, the page keeps today's padding (no extra space). Negative control: with the pre-fix padding, the Plate's intersection is at least 20 px at both widths, and on `/account` the gap between the control and the button is under the 16 px margin (R-78).
- G2 No regression: 1.4.2 G1–G2 and 1.4.9 G4 pass (the desktop breakpoint, W-10b, is unchanged), and axe-core reports no serious or critical findings on both pages at 390 px.
- G3 (manual) Architect visual review of both pages at 390 px, scrolled to the end, against the shell mockups.

**1.4.7 Deferred scope W-5 (R-55)**
- G1 Onboarding parse (R2-ONB-3): `POST /api/v1/onboarding/parse` returns typed `people` / `targets` / `neverEat` results from recorded model responses through 1.3.1's structured-output client; a model answer that fails the schema is refused, not repaired; 503 without a credential, and the onboarding page then keeps the deterministic parse; admin only. Live-model accuracy is a credential handoff (ABANDON with the owner command), never faked.
- G2 Planning preview (UX-4): `POST /api/v1/plans/preview` computes current vs proposed (distinct ingredients, in-tolerance rate, changed meals) with the given weights and writes no plan rows (row counts and change log identical before and after); the proposed plan equals the plan actually produced by applying those weights and replanning the same dates with the same seed.
- G3 First days (R2-ONB-6): the follow-up engine proposes only what the five answers leave open (fixture F1 answers → an expected list), at most one card per day, dismissals and answers persist, and the "Getting set up" checklist counts progress; negative control: an item the answers already settle is never proposed.
- G4 Playwright at 390 px and 1280 px plus axe-core (no serious/critical): the preview panel, the parse confirmation, the follow-up card and the checklist.
- G5 (manual) Architect visual review against PlanningBalance (preview panel) and FirstDaysPhone.
- G6 Live parse of the F1 answers through the real model matches the deterministic parse. Owner handoff (ABANDON with the owner command) while no credential exists.

**1.4.8 Plan follow-ups (R-58)**
- G1 Move (UX-4, W-5 addendum): `POST /api/v1/plan-meals/{id}/move` moves an unlocked meal to another date's same slot through a change op (`plan_meal.move`), re-solves the plates of both days, and is undone by the change log; moving onto an occupied slot exchanges the two meals; a locked meal or a published day is refused (409); admin only. Drag and a keyboard-operable "Move to…" menu on the Plan week grid both call it. Negative control: a move that leaves either day's plates unsolved fails.
- G2 Substitution step text (W-6): after an `unavailable` flag, the substituted copy's steps name the substitute wherever the step names the unavailable ingredient (display name or alias, case-insensitive, whole word); when no step matches, a leading note "Use <substitute> wherever <ingredient> is mentioned" is added. Tested on olive oil → canola oil; negative control: the pre-fix `replaced()` fails the test.
- G3 Day sums (W-7): for F1, every member's slot kcal targets on every day kind sum exactly to the day target, and the Plan and Plate screens show the day target from the resolver's day profile, not a sum of rounded plate values; the 2146 vs 2150 case is reproduced first, then fixed. Negative control: the reproduction fails on the pre-fix code.
- G4 "Use for dinner" (R-53 deferral): a recipe's detail page offers "Use for <day> <slot>" for the chosen date and slot, calling `planMeals.swap` with that dish; excluded or infeasible dishes are refused with the reason shown. 1.4.5's chat recipe card links to the same action if 1.4.5 has merged at CP1 (single-entry request), otherwise it is recorded for 1.4.5's owner.
- G5 Playwright at 390 px and 1280 px plus axe-core (no serious/critical): drag, the Move menu, the substituted cook sheet and the "Use for" action; 1.4.4 G1–G3 still pass.
- G6 (manual) Architect visual review against the Plan mockups and the substituted cook sheet.

**1.4.9 Chat and setup follow-ups (W-9, W-10; R-61)**
- G1 Done automatically (W-9a, FBK-5, R2-UX-4 "learned automatically"): the `insight_digest` card gains an optional `automatic` list (change set id, title, applied at, undone) of the `learning` change sets applied since the household's previous digest; the digest card shows them as "Done automatically" with Undo (the existing change-set undo). Stored digests without the field still render (backward compatible, card schema test). Negative control: a user or accepted-proposal change set in the same window is not listed.
- G2 Plan ready in Updates (W-9b, AGT-7 proactive events): when a `plan.generate` job that no agent turn started finishes, a job row ("Monday's plan is ready" with meals on target and a link to the plan) is posted into the admin's Updates conversation; agent-started jobs still post only into the conversation that started them (1.3.5 behaviour unchanged). Negative control: an agent-started job does not also post to Updates.
- G3 Names in the deterministic parse (W-10a, R2-ONB-3): `inferSetup` strips possessive and relation phrases before a name ("me (41), my wife Sara 39 and our three kids Layla 18, Adam 15 and Zayd 10" gives the viewer, Sara, Layla, Adam and Zayd with their ages), over the F1 lines and at least 8 phrasings; 1.4.3 G1-G5 and 1.4.7 G1, G3 still pass. Negative control: the pre-fix parse yields "my wife Sara" and fails.
- G4 Playwright at 390 px and 1280 px plus axe-core (no serious/critical): the digest card with its automatic block and Undo, the plan-ready row in Updates, the floating Assistant button hidden at the desktop breakpoint (the sidebar has Assistant) and shown at 390 px (W-10b); 1.4.2 G1-G2, 1.3.5 G1-G3 and 1.4.5 G1-G3 still pass.
- G5 (manual) Architect visual review against ChatPhoneDigest and the shell at 1280 px.

**1.4.10 Plain reasons, graph start-up, change-log subjects (W-12, W-13, W-14; R-68)**
- G1 Plain reasons (W-12, UX-7): the planner's score reasons name ingredients by catalogue display name and cuisines by `data/cuisines.json` label, in plain words ("American food is already on 6 other days this week"). After a substitution, the Plate's "Why this …" box does not name the replaced ingredient. Unit tests over the F1 week plans for seeds 1–10: no reason contains a slug, a snake_case key or a raw id. 1.2.3 G1–G6, 1.2.6 G1–G2 and 1.4.8 G1–G4 still pass. Negative control: today's labels (slug for ingredients, key for cuisines) fail the check.
- G2 Graph start-up order (W-13, KG-3): the global catalogue's nodes exist before any `dish` sync writes edges to them, whatever the worker's concurrency. A test runs the two start-up jobs (`syncCatalogueGraph`) at `WORKER_CONCURRENCY` 2 on an empty graph with the F1 seed library: no attempt fails with "edge(s) name a node that does not exist", and the resulting graph equals `pnpm kg:rebuild`'s. 1.3.4 G1–G3 still pass. Negative control: the test fails on the pre-fix start-up (reproduced first, and the reproduction recorded in `docs/decisions/leaf-1.4.10-*.md`).
- G3 Change-log subjects (W-14, R2-ADM-7, ChangeLog mockup): each change-log entry names what it changed. Examples: "Blocked Ravi (kitchen)", "Sara's protein target 130 → 140 g", "Household settings: week starts Sunday → Monday". Names are resolved when the log is read, from the change set's ops and before-images, so stored change sets need no migration. For scalar fields, `GET /change-sets` returns an optional per-entry detail with subject and before → after, and the change-log screen shows it (the mockup's chips). An entry whose subject no longer exists still renders, with the stored title. 1.4.1 G1–G3 and 1.4.6 G1–G2 still pass. Negative controls: two blocks of different logins read differently, and the old title-only rendering fails the test.
- G4 Playwright at 390 px and 1280 px plus axe-core (no serious/critical): the Plate "Why this dinner" box after a substitution, and `/changelog` with a block, a target change and a settings change; 1.4.2 G1–G2 still pass.
- G5 (manual) Architect visual review against PlatePhone and ChangeLog.

**1.2.6 Owner rulings: repeat gaps, slot-scoped exclusions (OQ-8, OQ-9; R-62)**
- G1 Repeat gaps (OQ-8, PLN-9 §6.3): for an attendee, the same dish is blocked at a day difference below 7 in main-meal slots and below 4 in `snack`, `pre_workout` and `post_workout`; a household `frequency_rule` on the dish keeps its days-apart meaning and replaces the default. Unit tests at the boundaries (Mon → Sun blocked and Mon → next Mon allowed for dinner; Mon → Thu blocked and Mon → Fri allowed for a snack); the F1 week plans for seeds 1–10 contain no violation outside meals flagged `frequency_relaxed`. Negative control: the old single 6-day rule fails the dinner boundary test.
- G2 SC-2 as re-set (OQ-8, R-63): 1.2.3 G2 asserts the median over seeds 1–10 ≥ 8 % and every seed ≥ 0 %, measured; 1.2.3 G1, G3, G4, G5, 1.2.2 G1–G5 and 1.2.5 G1–G4 pass; SC-1 unchanged (reported).
- G3 Slot-scoped exclusions (OQ-9, 02 §6): `exclusion.slot_keys` (migration 0007; null = every slot); the planner applies a scoped exclusion only in those slots; allergy exclusions cannot be scoped (database check and op validation); `exclusion.add` and the change log carry the scope; 1.1.2 G1–G6 pass. Negative controls: a nut dish is refused in the scoped child's packed school lunch and allowed at that child's dinner; an allergy exclusion with `slot_keys` is rejected.
- G4 Nut-free school follow-up (R2-ONB-6, OQ-9): "yes" writes a `contains_nuts` exclusion for each school child scoped to `packed_school_lunch`, and the card reads "Is the school nut-free? I'll keep nuts out of the lunch boxes." (the FirstDaysPhone copy); settled once every school child has the scoped exclusion; 1.4.7 G1–G4 pass.

**1.3.7 Contract gaps in learning and recipes (W-23; R-82)**
- G1 FBK-3 practical tags (W-23; R-83): at least 2 household reviews tagging one dish `hard_to_pack`, `went_soggy_in_box` or `cold_is_bad`, on meals in packed slots (`slot.isPacked`), give one pending proposal of a `dish` exclusion (not protected) scoped to the household's packed slot keys (1.2.6's `exclusion.slot_keys`), deduplicated by the FBK-8 fingerprint; once accepted, planned weeks keep the dish out of the packed slots and still offer it elsewhere. `took_too_long` gives a digest note and no op. Negative control: one such review gives no proposal.
- G2 DM-4: a recipe change set that changes a variant's ingredient grams queues `nutrition.recompute` (`followups.ts`); running the worker job rewrites that variant's cache row to the engine's new per-100 g values with a later `computed_at`, and leaves other variants' rows unchanged. Negative control: the stale row fails the same comparison.
- G3 REC-6: the `recipe.draft` job, with a recorded model response, saves a draft dish (not active) with example plates for the requested day and slot; the save path activates it. Negative control: a schema-failing recorded response saves nothing.
- G4 No regression: leaf-1.3.3 G1–G2 and `apps/web` test:integration pass.

**1.4.12 Contract gaps in the planning screens (R-82)**
- G1 PLN-3 at 390 and 1280 px: in the attendance editor, one tap marks a member's packed lunch as replacing lunch; the stored schedule has the member off lunch on those days, and the next generated plan has no lunch plate and a packed plate for them there. Negative control: without the tap the lunch plate stays.
- G2 R2-DL-6 at 390 and 1280 px: every detail-level section on a member's page offers "Tell the assistant"; it opens chat with a request naming that member and section, and a recorded agent turn applies the change at that section's level. Negative control: a section without the control fails the same check.
- G3 No regression: leaf-1.4.3 G1 and G3 pass.

**1.3.6 Live-model fixes (W-11; R-64)**
- G1 Recipe generation fits its budget (REC-2, 05 §1): a request for 3 dishes can no longer end at `max_tokens` (split the request per dish, or size the budget from a measured per-dish output, with the reason recorded in an ADR); the recorded-response tests cover a response cut at `max_tokens` (typed failure, nothing saved) and the new split or budget; 1.3.1 G1–G3 pass.
- G2 Agent eval failures diagnosed: each of allergy-sesame, weekend-appeal and make-sara-admin has its live transcript examined and a root cause recorded in `docs/decisions/leaf-1.3.6-evals.md`; fixes go in the system prompt, tool descriptions or tool behaviour. An eval expectation changes only where the builder shows the spec requires different behaviour (SPEC-Q with the spec citation, architect ruling first); 1.3.5 G1–G3 pass.
- G3 (manual, live) With the environment's `MEALPLANNER_ANTHROPIC_API_KEY` passed as `ANTHROPIC_API_KEY` per command: 1.3.1 G4 generates 3 valid F1 dinner dishes, and the agent eval set scores at least 90 % on two consecutive full runs, each logged under `docs/build/live/` with command, time, commit and per-case results; the key never appears in any log or commit.

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
- **Root.** SC-1 to SC-5 ([01-product.md](01-product.md) §7), and SC-6 and SC-7 from r2 (R-79), as runnable gates on a fresh `docker compose up` with seeded data. Every contract-inventory row is reconciled. The final report goes to the owner.

**Node gate definitions (R-69).** `scripts/verify/node-1.<n>.mjs --gate N2|N3|N4` over a shared `scripts/verify/lib/node.mjs`. Each gate prints `VERIFY node-1.<n> <gate> PASSED` only when every assertion holds, and carries a negative control. Gates are safe to run concurrently. `next build` runs with `DATABASE_URL` cleared (R-50). Each N3 uses its own fresh database (a new database on `DATABASE_URL`'s server, else localhost:5432, else a throwaway PostgreSQL 16 cluster), migrated from zero, with the catalogue loaded and F1 seeded.
- **N2 (every node).** Build the branch's packages, then typecheck every workspace package that depends on them, so consumers compile against the published types (`dist`, subpath exports). `@mealplanner/api-contract`'s contract tests pass. Negative control: in a disposable workspace copy, one exported type of a branch package changes incompatibly, and a consumer's typecheck fails.
- **N3 node-1.1 (Foundation).** Migrations 0000 onward on the empty database; catalogue load; F1 seed. A change set with ops across members, targets, exclusions and settings is applied through the changes service and then undone: every touched table equals its pre-apply snapshot, row for row (SC-4 at foundation level). The same flow through the HTTP API (`POST /change-sets`, `…/undo`) against the built web app. Negative control: an undo that skips one before-image fails the equality check.
- **N3 node-1.2 (Engine).** Through the worker's `plan.generate` job, not the planner in memory: a 7-day F1 plan is persisted. SC-1 is measured from the persisted plates. The OQ-8 repeat gaps hold on the persisted plan. Day 1's cook sheet, built from the persisted plan, has raw totals equal to the sum of plate raw equivalents. SC-2 is measured over seeds 1–10 through the same job path (median ≥ 8 %, every seed ≥ 0 %). Negative controls: persisted plate grams tampered off tolerance fail SC-1, and a repeated dish inside the gap fails the repeat check.
- **N3 node-1.3 (Intelligence), with recorded model responses and no live calls.** Two 1★ reviews by one member through the API lead, through the real worker jobs, to the member's lower dish appeal and a pending proposal (SC-3). Accepting the proposal through the API writes a change set to the log. `kg.sync` gives the graph the member's dislike edge. The agent's `get_preferences` reports it. An agent `apply_change` (recorded) appears in the change log, and its undo restores the prior state exactly (SC-4). Negative controls: one 1★ review gives no proposal, and an undo that skips a before-image fails.
- **N3 node-1.4 (Product).** SC-5 in Playwright at 390 px and 1280 px, plus axe-core (no serious or critical findings), against the built web app and a real worker with recorded model responses: onboarding (at most 5 questions, UAE, metric) to a first plan; the plan; the cook sheet; a review; a chat proposal accepted and visible in the change log. Negative control: axe reports a known-bad page, and a flow assertion fails when its route is removed from a disposable copy.
- **N4 (every node).** The full suite on the integration tree: `format:check`, `lint`, `typecheck`, `build`, `test:unit`, `test:integration` (fresh database) and the web e2e suite. Test counts are reported and none are skipped. Negative control: a disposable copy with one failing unit test makes N4 fail.
- **Root** (`gates/root.md`, written by the architect after the node gates): R1 reverifies every node ledger. R2 runs SC-1 to SC-5 on a fresh `docker compose up` with seeded data, reusing the N3 flows. R3 reconciles every contract-inventory row. R4 (manual) is the final report to the owner.

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

### Wave 4 dispatch

- **R-30 (R-22 variant check).** 1.2.4 adds to `packages/core/src/nutrition/atwater.ts` a variant-level check that compares the variant's kcal with the sum of its ingredients' predicted energy, each ingredient using its `atwater_factors` where recorded (carbohydrate factor on `carbs + fibre`, no fibre term) and 4/4/9/2 otherwise, within 12 %. It may add the export to `nutrition/index.ts` and tests to `test/nutrition/atwater.test.ts`. The existing `atwaterCheck` is unchanged. 1.2.1's G1–G4 (including 100 % line coverage on `nutrition/`) must still pass on the 1.2.4 branch; the CP2 PR shows that output. 1.2.4 G3 ("every variant passes nutrition validation") uses the new check.

### Rulings from wave 4 CP1 (leaves 1.2.4, 1.3.1)

- **R-31 (1.2.4 SPEC-Q-1 … 6).**
  - SPEC-Q-2: G4 "feasible" means strict `in_tolerance` at every distinct F1 dinner target **with up to 2 adjusters from `data/adjusters.json`**, as the planner will run it (PLN-6). The rate without adjusters is also printed. Gate threshold unchanged (≥ 80 %).
  - SPEC-Q-1, 3, 4, 5 and 6 (no pork or alcohol in the seed library): accepted as proposed.
- **R-32 (1.3.1 SPEC-Q-1 … 13).** Accepted as proposed, including the beta `messages.parse` (fallbacks live on beta params), persistence through injected ports wired by 1.4.1 (R-2), and G4 as an explicit `ABANDON` handoff while no `ANTHROPIC_API_KEY` is present.
  - SPEC-Q-5: until 1.2.4 merges, 1.3.1 uses its own R-22 variant check in `validate/nutrition.ts`; after both merge, the architect replaces it with the `variantAtwaterCheck` export (import change plus deletion of the local helper) and re-runs 1.3.1 G1.
  - Default model: `DEFAULT_MODEL` must be the most capable current model in the `claude-api` skill's model table at build time; the ADR cites the table row. `ANTHROPIC_MODEL` overrides it.
- **R-33 (1.3.3 SPEC-Q-1 … 16).** Accepted as proposed, except as amended below.
  - SPEC-Q-1: OWNS gains `packages/ai/test/insights/**` and `packages/db/test/proposals/**`.
  - SPEC-Q-3: `revise_recipe` stays a digest note in 1.3.3. Follow-up **W-2**: a `recipe.revise` op (dish, variant, notes) plus its regenerate-variant job is owed by 1.4.1 (job runner). When it exists, rule 3 is switched to store proposals; no other leaf may drop it.
  - SPEC-Q-5 (amended): the budget of 5 counts and limits only `rule` and `insights` proposals. `agent_chat` proposals are what the admin asked for in chat; they are neither blocked by nor counted against the budget. Over-budget drafts are kept in priority order (highest first); dropped drafts appear in the digest with reason `budget`.
  - SPEC-Q-8 (amended): because rules read the whole window, a candidate must also be suppressed when (a) a proposal with the same fingerprint is pending, (b) one with the same fingerprint was accepted in the last 30 days, or (c) its ops are already satisfied by current state (e.g. the preference already holds that score and lock). G2 includes a test that a second run over the same reviews, after accept, proposes nothing.
  - SPEC-Q-10 (amended): the fingerprint also carries the direction of the change where one exists: the sign of `preference.set.score`, and away/toward for `distribution.set`. Rejecting "less of X" must not suppress "more of X".
  - SPEC-Q-11: a learned dislike exclusion is `hard: false`. Accepted.

- **R-34 (1.2.3 SPEC-Q-1 … 14, ADR-1).** Accepted as proposed, except as amended below.
  - ADR-1 (state-independent cached solves, then a time-order kcal re-targeting pass with the cumulative band `Bᵢ`): accepted. An in-tolerance plate at slot i keeps the running deviation within ±`Bᵢ`, so a member-day of in-tolerance plates ends within ±`tolerance.kcal`.
  - SPEC-Q-2: accepted. A member-day with an infeasible plate is flagged with the slot(s) as reason; G1 asserts the ±`tolerance.kcal` band on every other member-day and prints every member-day total.
  - SPEC-Q-6 (amended): **every exclusion row is a filter, whatever its `hard` flag.** 04 §6.3 lists exclusions as hard filters without distinction; in the merged code `hard` only decides whether relaxing the exclusion is protected (1.1.2 `isProtectedExclusion`). Reading `hard: false` as "not applied" would make 1.3.3's accepted dislike exclusions no-ops. The rest of SPEC-Q-6 (required vs optional components, `hard = never` preferences) is accepted.
  - Ingredient exclusion keys are slugs (R-36): when building the solver's `MemberCtx.exclusions.ingredientIds`, resolve each `kind = ingredient` key through the catalogue.
- **R-35 (1.3.4 SPEC-Q-1 … 12, ADR-1/2).** Accepted as proposed, except as amended below.
  - SPEC-Q-1: `PostgresKgSource` stays in `packages/graph` (no `db` import). Conditions: parameterised SQL only; every household-scoped read filters by `household_id`; the integration tests run on the migrated schema so a column change fails them.
  - SPEC-Q-2: accepted. Match `kind = ingredient` keys on slug (canonical, R-36) or id.
  - SPEC-Q-4 (amended): the dish ingredient vector uses 1.3.2's `coreIngredients` (excludes `herb_spice` and `water`), so similarity and the preference model agree on what an ingredient "is" in a dish. PAIRS_WITH and TYPICAL_IN (SPEC-Q-5/6) keep spices and exclude only water, as proposed.
- **R-36 (cross-leaf: ingredient keys).** 02 §6 did not fix the key format. Recorded from the merged leaves: `exclusion.key` for `kind = ingredient` is the ingredient **slug** (1.3.1 validator, 1.3.3 dislike proposals); `preference.entity_key` and `frequency_rule.entity_key` for `entity_type = ingredient` are the ingredient **id** (1.3.2). Code that matches exclusions against ingredient ids resolves slugs through the catalogue; 1.3.5 (agent) and 1.4.x forms write slugs for exclusions.
- **R-37 (1.2.3 SPEC-Q-15, SC-2).** SPEC-Q-15 accepted: when the frequency filter (min gap, `frequency_rule`) leaves a targeted member-meal with no eligible dish, only that filter relaxes; the eligible dish served longest ago is used and the meal is flagged `frequency_relaxed`. Exclusions, `never` preferences and slot suitability never relax. SC-2 / G2: measured 5–21 % on seeds 1–5 against the 25 % target; the search is bounded by the library and the 6-day per-attendee gap (economy-only runs reach 16–24 %). G2 is not changed; the threshold, the economy definition or a library follow-up is an **owner decision (OQ-8)**. G2 reports additional breakdowns meanwhile.
- **R-38 (1.2.3 G4 budget; ARCHITECT QUESTION after CP3 finding 1).** The PLN-11 day budget (5 s) is dominated by HiGHS solves (≈ 97 % of a day), the adjuster stage of 1.2.2's solver alone costing ≈ 0.9 s for 3 solves; 1.2.3's planner-side pruning (`869f6a3`) cut solves 17 % with no CPU change. Measured on the architect's container at `869f6a3`: worst day 4.44–5.53 s CPU over 5 standalone runs, 1 of 5 failing. Ruling: option (a). 1.2.3's OWNS gains `packages/core/src/planner/solver/**` and `packages/core/test/planner/solver/**` **for performance changes only**. Conditions: (1) behaviour-preserving — 1.2.2 G1–G4, 1.2.4 G4 and G6, and 1.2.3 G1/G3/G5/G6 all pass, and the 1.2.3 F1 plan hashes for seeds 1 and 2 are unchanged versus `869f6a3` (print both); any intended change to a solution is out of scope; (2) no change to PLN-5/PLN-6 semantics, the adjuster list, K, B, the budget or G4's clock or process model (option (b), warm-process timing, is rejected: G4 keeps measuring a cold process); (3) acceptance: worst day ≤ 4.0 s CPU in 5 consecutive standalone G4 runs on the builder's container, and 5 of 5 passing standalone runs on the architect's container at CP3.

- **R-39 (1.2.3 ARCHITECT QUESTION after CP3 round 2: cutoff vs time limit).** Option (a) accepted. The ADR-2 objective cutoff is exact with respect to the proven optimum; under PLN-5's 0.25 s per-combination time limit it can differ from the uncut solver only where the uncut solve timed out (2 of 300 random-appeal seed plates), and there it returned a better plate (never worse). Uncut results in those cases already depend on machine speed. "Behaviour unchanged" in R-38 means identical to the proven optimum; `cutoff-appeal.test.ts` (in G4) checks it with the time limit lifted, and mutation M4 fails it.
- **W-3 (1.2.3 G2 / SC-2, owner decision OQ-8 in progress).** 1.2.3 merged with G2 unmet (median 10.7 % over seeds 1–10 against 25 %). The owner chose option (c), change the rules. Architect measurements on the merged planner: snack/workout slots min gap 3 days → median 14.9 %; every slot min gap 3 days → median 25.3 % (range 14.9–31.2 %), ~22 dishes/week, SC-1 unaffected. Pending the owner's confirmation of the exact rule, and of judging SC-2 on the median over seeds 1–10 instead of seed 1.
- **R-40 (1.4.1 SPEC-Q-1 … 19, ADR-1 … 4, requests R-a … R-g).** Accepted as proposed, except as amended below.
  - **R-a schema (granted, R-9 procedure):** `packages/db/src/schema/jobs.ts` (`job`, `job_event`, `support_access` as in SPEC-Q-7/8), `household.deletion_confirmed_at` / `deletion_confirmed_by_user_id` in `tenancy.ts`, migration `0004_jobs_support_access.sql` + meta, and single-entry additions to `schema/index.ts`, `repos/tables.ts`, `repos/entity-types.ts`, `core/src/types/entities.ts`, `db/test/spec-columns.ts`, `db/test/support/populate.ts`. 1.1.2 G1–G3 must pass on the branch (shown at CP2).
  - **R-b ops (granted, amended):** `recipe.generate` and `recipe.revise` in `ops/recipes.ts` + registry entries + `op-samples.ts`; apply inserts a `job` row (`status: queued`). **Amendment:** the inverse (undo) succeeds only while that job row is still `queued`; the worker claims a job with an atomic `UPDATE job SET status='running' … WHERE id=$1 AND status='queued'`, so undo and pickup cannot both win. A test runs undo and claim concurrently (exactly one wins). Job status updates by the worker are operational writes outside DM-6 (the `job` table is not configuration).
  - **R-c (granted):** `RECIPE_REVISION_OP = "recipe.revise"`; rule-3 expectations switch from notes to proposals; 1.3.3 G1–G3 pass on the branch. Closes W-2 when merged.
  - **R-d dependencies (applied by the architect on the base branch):** `apps/web`: pg-boss 12.34.0, pg 8.23.0, drizzle-orm 0.45.3, nodemailer 10.0.10, pino 10.3.1; dev: @types/pg 8.23.1, @types/nodemailer 8.0.2, @readme/openapi-parser 9.0.0. `apps/worker`: pg 8.23.0, drizzle-orm 0.45.3, pino 10.3.1; dev: @types/pg 8.23.1.
  - **R-e/R-f (granted):** `web` and `worker` services in `docker-compose.yml`; `AI_RECIPE_DAILY_LIMIT`, `CHAT_TURNS_PER_HOUR` in `.env.example`.
  - **R-g ownership:** SPEC-Q-9 accepted — `POST /conversations/:id/messages` belongs to 1.3.5 (OWNS extended). SPEC-Q-10 — the `reviews.extract` module (`packages/ai/src/reviews/**`) and its worker job file go to 1.3.5 (OWNS extended); 1.4.1 builds no placeholder. SPEC-Q-19 — **ARC-12** is assigned: structured pino logs (household id, request id, job durations, planner metrics from `PlanResult.stats`) and a `GET /api/v1/diagnostics` endpoint (admin: last 50 `ai_generation` rows and failed jobs of the household) are built by 1.4.1; the diagnostics page UI by 1.4.6. **R2-UX-1** is assigned: the backend (`POST /api/v1/cook-sheets/:date/flags` accepting kitchen flags; an `unavailable` flag enqueues `plates.substitute`, which uses `@mealplanner/graph` `substitutes` under the household's exclusions and re-solves affected future plates through the plan service, result visible to admins) by 1.4.1; the cook-sheet flag UI and the admin result view by 1.4.4. Both are covered by G1's contract + matrix tests.
  - SPEC-Q-12: accepted; `source: learning` for system-triggered change sets is the closest enum value (no new enum).
- **R-41 (1.4.1 ARCHITECT QUESTIONs after R-40).** Single-entry edits granted to 1.4.1, each a direct consequence of R-40: (1) `packages/core/test/planner/targets/config.ts` — add `deletionConfirmedAt: null, deletionConfirmedByUserId: null` to the `HouseholdRow` literal (1.2.2 G1–G5 shown passing at CP2); (2) `packages/db/test/changes.int.test.ts` — add `"recipe.generate"` and `"recipe.revise"` to the registry list, **title unchanged** (so 1.1.2's verify script is untouched); (3) `scripts/verify/leaf-1.3.3.mjs` — the required test name "G1 rule 3 stays a note while no revision op exists (R-33)" becomes "G1 rule 3 is a proposal now that recipe.revise exists (R-40)"; nothing else in that script changes. 1.1.2 G1–G3 and 1.3.3 G1–G3 shown passing at CP2.

- **R-42 (1.4.1 ARCHITECT QUESTION: magic link vs `verification.id`).** Verified in the installed package: Better Auth 1.7.6 `internalAdapter.reserveVerificationValue` (`dist/db/internal-adapter.mjs:885`) writes `verification.id = base64url(SHA-256("reserve:" + identifier))`, not a generated id, so a `uuid` column rejects every magic-link sign-in of an existing account. Ruling: `verification.id` becomes `text` (`tenancy.ts` + an `ALTER TABLE "verification" ALTER COLUMN "id" TYPE text` in `0004_jobs_support_access.sql` with its snapshot); every other id stays `uuid`. This amends 1.1.2 ADR-4 for this one table; 1.1.2 G1–G6 are shown passing at CP2. The library's first-magic-link behaviour for accounts with `email_verified = false` (revokes the password credential and sessions, then marks the email verified) is **kept**: it defends against account pre-registration takeover. It must be visible: the magic-link verify flow returns a flag that the password was removed, 1.4.6 shows "Your password was removed because you signed in by email link; set a new one in Account", and G4 includes a test that asserts the revocation and the flag.
  - R-42 addendum: 1.1.2's `packages/db/test/migrations.int.test.ts` asserts every `id` column is `uuid` (failing on 1.4.1 CI at `4dc8428`: "verification.id is text, not uuid"). Single-entry edit granted to 1.4.1: exempt exactly `verification.id` (expected `text`, citing R-42); every other id stays asserted `uuid`.

- **R-43 (1.1.1 G2 procedure).** 1.1.1 G2 linted a fresh workspace copy without building it; since leaves import sibling packages through built output (1.3.4's tests, `scripts/kg-rebuild.ts`), type-aware lint on the unbuilt copy reported 2,308 unresolved-type errors on the base branch (found by 1.4.1 at CP2, reproduced by the architect at `a9c5a71`). CI already builds before lint. Fix on the base branch: `scripts/verify/leaf-1.1.1.mjs` G2 now runs `pnpm -r build` in the copy after install, as CI does (new assertion "workspace copy builds"). The gate's CHECK/EXPECT lines and every other assertion are unchanged; the illegal-import negative control still fails lint.
- **R-44 (1.4.1 CP3 architect follow-up).** `docker-compose.yml` defaulted `ANTHROPIC_MODEL` to `claude-opus-5`, overriding R-32's `DEFAULT_MODEL`; changed to `${ANTHROPIC_MODEL:-}` (empty falls through to `DEFAULT_MODEL` in `packages/ai/src/client/config.ts`). 1.4.1 SPEC-Q-20 … 26 accepted as recorded.
- **W-4 (1.2.3 determinism under load).** Reported by 1.4.1 at CP2: 1.2.3 G5's cook-sheet snapshot differed (`bread.fresh` vs `bread.toasted`) only while gates ran in parallel. Consistent with PLN-5's 0.25 s wall-clock time limit per combination: under CPU load more combinations time out, so a plan can depend on machine load (R-39 accepted timeout-dependent differences as never worse, but they also break same-seed reproducibility, PLN-11). To be confirmed by the architect and fixed by replacing the wall-clock limit with a deterministic work limit (HiGHS node/iteration limit) calibrated to the same budget; owner: follow-up leaf, dispatched with the 1.4.x wave.

- **R-45 (wave 3 CP1: shared Settings and dependencies, applied by the architect on the base branch).**
  - Settings paths are fixed: General (HouseholdSettings) `/settings/household` → **1.4.6** (`apps/web/app/(app)/settings/household/**`, removed from 1.4.3's OWNS); Planning balance `/settings/planning`, Meals & schedule `/settings/schedule`, the hub `/settings` and `/settings/detail-levels` → 1.4.3; Change log `/changelog` → 1.4.6.
  - The tab strip is shared and owned by neither leaf: `SETTINGS_TABS` in `apps/web/app/(shell)/_shell/nav.ts` and the `TabLinks` primitive in `apps/web/components/ui/tab-links.tsx` (exported from `components/ui`). Both leaves render `<TabLinks items={SETTINGS_TABS} activeHref=… label="Settings sections" />` on their tab pages. The Settings rail item is also active on `/changelog` (`alsoActiveFor`; 1.4.6 R-c done).
  - Dependencies: `apps/web` `uqr` 0.1.3 (1.4.6 ADR-2), dev `@axe-core/playwright` 4.13.0 (1.4.3–1.4.6 G2); `packages/ai` dev `js-yaml` 5.4.2 (1.3.5 R-F).
- **R-46 (1.3.5 CP1).** Approved with these grants and rulings:
  - OWNS extended: `apps/web/lib/server/agent.ts` (R-C), `apps/worker/src/jobs/chat-events.ts` (R-D), `apps/worker/src/jobs/recipe-draft.ts` (below), `packages/db/src/migrations/0005_review_extraction.sql` with its `meta/0005_snapshot.json` and the journal entry (R-G).
  - Single-entry edits granted: `packages/api-contract/src/contract/{endpoints,dto}.ts` (`conversationsSend`, `ChatSendBody`, `ChatStreamEventDto`; R-A); `apps/web/test/api/g1-contract-matrix.int.test.ts` line 81 removed and the negative control's fabricated route replaced, `apps/web/test/api/support/cases.ts` one case (R-B; 1.4.1 G1–G3 shown passing at CP2); `apps/worker/src/jobs/handlers.ts` (the `insightsRun` digest post and the `HANDLERS` entries), `apps/worker/src/runner.ts` (the job-completion post) (R-D); `apps/web/lib/server/feedback.ts` (the `reviews.extract` enqueue; R-E); `packages/db/src/services/plans/jobs.ts` (`"reviews.extract"`, `"recipe.draft"` in `JOB_KINDS`); `packages/db/src/schema/feedback.ts` (`review.extracted_tags text[] not null default '{}'`, `review.extracted_at timestamptz`; R-G); `packages/db/src/services/proposals/load.ts` (rule inputs read `tags ∪ extracted_tags`; 1.3.3 G1–G3 shown passing at CP2).
  - SPEC-Q-10 changed: `create_recipe` does not rebuild the generator's database ports in `apps/web` (a second copy of `apps/worker/src/ai.ts` would drift). It enqueues a `recipe.draft` job (payload: `conversationId`, request, slot, count) and returns a `job_progress` card; the worker handler calls `generateDishes(..., { save: false, adminRequest })`, and SPEC-Q-9's completion post puts the `recipe` card (draft and per-attendee example plates, Save / Discard) in the conversation. Save applies `dish.create` through `POST /change-sets` (1.4.5).
  - SPEC-Q-11 accepted with a condition: the turn's advisory lock is released and its connection returned in `finally`, including on client disconnect and model errors; an integration test aborts a turn mid-stream and shows the next POST succeeds.
  - SPEC-Q-15 (R-G) accepted: extraction never touches `processed_at`; extracted tags feed learning and 1.3.3's rule inputs. Migration number **0005** is 1.3.5's; any other leaf needing a migration asks first.
  - SPEC-Q-1…9, 12…14, 16 accepted as recorded.
- **R-47 (1.4.3 CP1).** Approved with these grants and rulings:
  - SPEC-Q-6 granted: onboarding moves to `apps/web/app/(setup)/onboarding/**` (replaces `(app)/onboarding/**`); the `(setup)` group has no layout outside that path, and the page does its own server-side session and admin check.
  - SPEC-Q-12 granted (blocks G3): 1.4.3 builds `GET` / `PUT /api/v1/detail-levels` as specified in its question: OWNS gains `apps/web/app/api/v1/detail-levels/route.ts`, `apps/web/lib/server/detail-levels.ts`, `apps/web/test/api/detail-levels.int.test.ts`; single-entry edits in `packages/api-contract/src/contract/{endpoints,dto}.ts` and `apps/web/test/api/support/cases.ts` (1.4.1 G1–G3 shown passing at CP2). Writes go through the `detail_level` repository (R-24, outside DM-6); a member may write only their own `taste` row.
  - SPEC-Q-11 and SPEC-Q-13 deferred (W-5): the page ships the deterministic parse with confirmation, and PlanningBalance ships without the "Next week, if you save" panel; both are listed deviations.
  - SPEC-Q-14: TastePhone at `/family/me` accepted; ChatOnboarding is 1.4.5's; `/settings/household` is 1.4.6's (R-45); FirstDaysPhone (R2-ONB-6) deferred (W-5).
  - SPEC-Q-3 accepted as a listed deviation: no carb-bias rows without an owner figure; the explanation does not claim a bias.
  - SPEC-Q-15 accepted (ratio inference, no schema change); the unit tests include the ambiguous case (all shown as "yours").
  - SPEC-Q-1, 2, 4, 5, 7…10, 16, 17 accepted as recorded.
- **R-48 (1.4.6 CP1).** Approved: R-a granted (R-45), R-c done by the architect (R-45), R-d and R-e applied (R-45). SPEC-Q-6 ruled against: InviteAccept has no "No password — email me a link each time" button (a hidden random credential plus a device-local marker that suppresses the R-42 notice is more mechanism than the button is worth; the email link is on `/sign-in` for every account). Listed as a mockup deviation. SPEC-Q-1…5, 7…15 accepted as recorded.
- **W-5 (deferred scope, planned after wave 3).** Model-backed onboarding parse (`POST /api/v1/onboarding/parse`, R2-ONB-3), planning preview (`POST /api/v1/plans/preview`, UX-4), FirstDaysPhone follow-up questions and checklist (R2-ONB-6, needs storage). One follow-up leaf, with the W-4 solver-limit fix as a separate leaf.
- **R-49 (1.3.5 ARCHITECT QUESTIONs after CP1).** Single-entry edits granted to 1.3.5, each shown not to regress its owner's gates at CP2:
  1. `apps/web/test/api/support/matrix.ts` (`successProblems`, SSE branch): validate each `data:` line with `endpoint.response ?? JobEventDto` instead of `JobEventDto` (1.4.1 G1–G3).
  2. R-G type cascade: `packages/core/src/types/entities.ts` (`ReviewRow` gains `extractedTags: string[]`, `extractedAt: Date | null`); the review-row literals in `packages/db/src/services/reviews/create.ts`, `packages/db/src/services/config/fixtures.ts`, `packages/db/test/support/populate.ts` (`extractedTags: [], extractedAt: null`); `packages/db/test/spec-columns.ts` lists both columns under `review` (1.1.2 G1–G6, 1.3.2 and 1.3.3 gates).
  3. `packages/core/src/learning/rules/satisfied.ts`, `exclusion.add`: already satisfied only when a covering row exists **and** the member's own row for that key, if any, has the same `reason` and `hard`. Reason: guardrails check "protected" before "satisfied", so an admin's protected relaxing request through chat (`agent_chat`) was dropped as satisfied and lost; engine drafts are unaffected because they are dropped as `protected` first. Unit tests: the agent relaxing case becomes a pending proposal; an engine duplicate with the same reason and `hard` stays satisfied; an engine dislike over an existing allergy row is still dropped (1.3.3 G1–G3).
  4. SPEC-Q-18: `apps/worker/src/jobs/handlers.ts` `planGenerate` attributes a plan to `{ actor: "agent", source: "agent_apply" }` when the job payload says `source: "agent"` (R2-ADM-7). Condition: `source` is set only server-side by the agent adapter; `POST /plans/generate` must not accept it from a client body (a test sends it and shows it ignored or rejected). SPEC-Q-17 accepted.
- **R-50 (1.4.6 CP3, architect follow-up).** `scripts/verify/leaf-1.4.6.mjs` inherited the caller's `DATABASE_URL` into `next build`; with it set (ADR-3's own first choice), prerendering `/offline` builds the runtime, which also requires `AUTH_SECRET`, and G1/G2 failed at the build step (reproduced at `50abdc1`; both passed with `DATABASE_URL` unset). Fix on the base branch: the build step clears `DATABASE_URL`. 1.4.6 SPEC-Q-16 … 20 accepted as recorded. G3 (visual review): PeopleAccess, HouseholdSettings compared with their mockups; passed with the listed deviations.
- **R-51 (W-4 follow-up leaf).** Leaf 1.2.5 "Deterministic solver limit" is added under node 1.2 (§1, §4, §5; `gates/leaf-1.2.5.md`; node-1.2 now integrates it). With 1.2.3 merged, `packages/core/src/planner/solver/**` and its tests pass to 1.2.5. The per-combination wall-clock `time_limit` is replaced by a deterministic HiGHS work limit (node / iteration / leaf limits as available in the installed `highs` build) calibrated to the same budget; any remaining wall-clock guard may only cut off a run as a failure, never change which plan is chosen. PLN-5's text in 04 is updated by the architect once the calibration is measured.
- **R-52 (1.4.4 CP1).** Approved with:
  - SPEC-Q-1 granted: `GET /api/v1/cook-sheets/{date}/flags` as specified in the question (admin: all flags of the date with their `plates.substitute` job and result; kitchen: own flags only). OWNS gains `apps/web/lib/server/kitchen-flags.ts` and `apps/web/test/api/cook-sheet-flags.int.test.ts`; single-entry edits: the `GET` export in `apps/web/app/api/v1/cook-sheets/[date]/flags/route.ts`.
  - SPEC-Q-2 granted: ops `plan.publish` (`{ date }`) and `plan_meal.status` (`{ planMealId, status: planned|cooked|skipped }`), not protected, applied as logged, undoable change sets; routes `POST /api/v1/plans/{date}/publish` (admin) and `POST /api/v1/plan-meals/{id}/status` (admin, kitchen). OWNS gains `apps/web/app/api/v1/plans/[date]/publish/route.ts`, `apps/web/app/api/v1/plan-meals/[id]/status/route.ts`, `apps/web/test/api/plan-status.int.test.ts`; single-entry edits: the two op definitions and their registry entries in `packages/core/src/changes/**`, the registry list in 1.1.2's registry test, the service functions in `apps/web/lib/server/plans.ts`. 1.1.2 G1–G6 shown passing at CP2.
  - SPEC-Q-3: drag to move is out of v1 (listed deviation; added to W-5). No exchange route.
  - SPEC-Q-9: routes are 1.4.5's (R-53): Rate → `/reviews/rate?planMealId=`, detailed review → `/reviews/new?planMealId=`, assistant → `/chat?prompt=<text>` (not `draft`).
  - Both leaves (1.4.4, 1.4.5) get single-entry edits in `packages/api-contract/src/contract/{endpoints,dto}.ts` and `apps/web/test/api/support/cases.ts` for their granted routes; 1.4.1 G1–G3 shown passing at CP2. Gate timeout: `--timeout 1800`. SPEC-Q-4 … 8, 10 … 12 accepted.
- **R-53 (1.4.5 CP1).** Approved with:
  - SPEC-Q-1 Option A: one server-side mapping. `packages/db/src/services/plans/generation.ts` exports a pure `generatedDishOps(...)` used by `saveGeneratedDishes`; `apps/worker/src/jobs/recipe-draft.ts` adds `ops` and `summary` per draft to the job result; Save posts exactly those ops (single-entry edits; 1.2.3 and 1.3.5 gates shown passing at CP2).
  - SPEC-Q-2 granted: the `panel` line in `apps/web/app/(shell)/layout.tsx` (1.4.2 G1/G2 at CP2).
  - SPEC-Q-3 granted: `GET /api/v1/portion-biases?memberId=` (admin; member own only). OWNS gains `apps/web/app/api/v1/portion-biases/route.ts`, `apps/web/lib/server/portion-biases.ts`, `apps/web/test/api/portion-biases.int.test.ts`.
  - SPEC-Q-10: 1.4.3 is merged; build ChatOnboarding at `/chat/setup` now. Single-entry edit: 1.4.3's "Just tell me" link in `apps/web/app/(setup)/onboarding/**` points to `/chat/setup` (1.4.3 G1/G5 at CP2).
  - SPEC-Q-14 granted: OWNS gains `apps/web/test/chat/**` and `apps/web/e2e/chat/**`.
  - SPEC-Q-4 … 9, 11 … 13, 15 accepted; SPEC-Q-9's routes are fixed for every leaf.
- **R-54 (1.2.5 CP1).** Approved. SPEC-Q-5: approve and reverify this ledger with `--jobs 1 --timeout 1200`, so G1's load never overlaps G2/G3; the idleness check stays as a guard and fails loudly rather than report a figure measured under load. No wall-clock guard (ADR-1) accepted: the node and iteration limits bound every solve. SPEC-Q-1 … 4, 6 … 8 accepted.
- **W-5 addendum.** Drag to move a dish between days (UX-4, 1.4.4 SPEC-Q-3) joins W-5.
  - R-52 addendum: single-entry edit granted in `packages/db/test/support/op-samples.ts`: generators for `plan.publish` and `plan_meal.status` (1.1.2 G3 asserts one generator per public op kind).
  - R-53 addendum: the "Just tell me" link lives in `apps/web/components/config/onboarding/onboarding-flow.tsx` (1.4.3's `components/config/**`), not under `(setup)/onboarding/**`; the single-entry edit is granted there instead.
- **W-4 closed (1.2.5 merged).** CP3: G1–G4 met twice (`--jobs 1`), with `DATABASE_URL` unset and set; re-adding `time_limit: 0.25` to the MILP options fails G1. F1 seeds 1–10 give plans identical to the 0.25 s baseline at idle; worst day 2.64 s CPU. 04 PLN-5's engine text updated to the work limit (572 nodes, 10,748 LP iterations).
- **R-55 (W-5 leaf).** Leaf 1.4.7 "Deferred scope W-5" is added under node 1.4 (§1, §4, §5; `gates/leaf-1.4.7.md`; node-1.4 integrates it): the model-backed onboarding parse, the planning preview and the first-days follow-ups with their storage (migration 0006). Drag to move (W-5 addendum) waits for 1.4.4 to merge and is dispatched separately. Edits to merged leaves' files (1.4.3's onboarding flow and planning screen, 1.4.1's job registry) are listed by the builder at CP1 as single-entry requests; the Today card for follow-ups is a request against 1.4.4's page after it merges.
- **W-6 (substitution leaves stale step text).** Seen in 1.4.4's G4 screenshots: after an `unavailable` kitchen flag, `packages/db/src/services/plans/substitute.ts` `replaced()` swaps ingredient ids and recomputes nutrition, but the copy's method steps still name the unavailable ingredient ("marinate with … olive oil" in the "(with Canola oil)" copy). The cook reads the flagged ingredient in the instructions. Fix: the copy's steps name the substitute (replace the ingredient's display name and aliases in step text, or add a leading step note "Use <substitute> wherever <ingredient> is mentioned" when no exact match is found); tested on the olive oil → canola case. Owner: the drag-to-move follow-up leaf (1.4.8).
- **W-7 (per-slot targets vs the day target).** Seen in 1.4.4's G4 screenshots: Omar's rest day shows a day target of 2146 kcal (the sum of his plates' slot targets) against his 2150 kcal daily target. To be checked in 1.2.2's resolver: slot targets of a day should sum exactly to the day target (largest-remainder rounding), or the kcal ±50 day band is judged against the wrong total. Owner: 1.4.8, with a test on F1.
- **R-56 (1.4.7 CP1).** Approved. Requests R-1 … R-14 granted as listed in the PR (new schema file `packages/db/src/schema/setup.ts` added to OWNS; the rest single-entry edits, owners' gates shown at CP2: 1.1.2 G1–G6, 1.4.1 G1–G3, 1.4.3 G1/G2/G5). R-15 (the follow-up card on Today) waits for 1.4.4's merge. SPEC-Q-8: accepted with its honest copy: "nut-free school" writes a member-level `contains_nuts` exclusion for each school child, which keeps nuts out of their meals everywhere, not only the lunch box, because exclusions have no slot scope (02 §6); see W-8. SPEC-Q-12: gate G6 added (live parse of the F1 answers matches the deterministic parse), abandoned as an owner handoff with the owner command. SPEC-Q-1 … 7, 9 … 11 accepted.
- **W-8 (owner decision: slot-scoped exclusions).** A nut-free school usually only needs nut-free lunch boxes. Supporting "keep nuts out of the packed school lunch only" needs a slot scope on `exclusion` (02 §6) and planner support; until the owner asks for it, the follow-up card excludes nuts from the school children's meals everywhere and says so.
- **R-57 (1.4.7 questions after 1.4.4 merged).** Gate timeout: `--approve --reverify --timeout 1800` approved (as R-52 for 1.4.4). R-15 granted: the follow-up card on Today is a single-entry edit in `apps/web/app/(app)/today/page.tsx` that renders 1.4.7's component from `apps/web/components/setup/**`, with no other change to 1.4.4's page; at CP2 show 1.4.4 G1–G3 passing on the merge.
- **R-58 (leaf 1.4.8 "Plan follow-ups").** Added under node 1.4 (§1, §4, §5; `gates/leaf-1.4.8.md`; node-1.4 integrates it). Scope: drag to move (W-5 addendum), W-6, W-7, and the "Use for dinner" action deferred from 1.4.5. 1.4.4 has merged, so its plan and recipe files transfer to 1.4.8's OWNS (Today stays out: 1.4.7 holds R-15 there). The new change op, its contract entry and the ops registry are single-entry requests at CP1 (1.1.2's `packages/core/src/changes/**`, 1.4.1's `packages/api-contract/src/**`), in their own `1.4.8 (R-58)` blocks. W-7 note: `slotValues` in `packages/core/src/planner/targets/shares.ts` already apportions the rounded daily value, so the 4 kcal are lost elsewhere (candidates: a slot override, the day kind used by the screen, or the screen summing plate targets); the builder reproduces it before touching the resolver, and OWNS on `planner/targets/**` covers only a fix proven necessary there.
- **W-9 (Updates conversation gaps, seen at 1.4.5 CP3).** ChatPhoneDigest shows two things merged code cannot produce: (a) a "Done automatically · Undo" block: the `insight_digest` card type (`packages/ai/src/agent/cards.ts`, 1.3.5) has no field for changes applied without a proposal (FBK-5 portion-bias moves); (b) the "Monday's plan is ready" row in Updates: `apps/worker/src/jobs/chat-events.ts` (1.3.5, R-46) posts a job's completion only into the conversation whose turn started it, so the nightly plan run never reaches Updates. Owner: a follow-up leaf after 1.4.5 merges (card-type field plus the Updates routing of scheduled jobs, with 1.4.5's digest card rendering it).
- **R-59 (1.4.7 question: 1.4.3 G4 scan).** R-55's `packages/core/src/onboarding/followups/**` directory makes 1.4.3 G4's "no model or network call" scan (`scripts/verify/leaf-1.4.3.mjs`, which reads every entry of `packages/core/src/onboarding` as a file) throw `EISDIR`. Granted to 1.4.7 as a single-entry edit: the scan reads `.ts` files recursively (`readdirSync(…, { recursive: true })` filtered to `.ts`), every other assertion unchanged. The scan now also covers `followups/`, so it widens rather than weakens the check; 1.4.3's CHECK and EXPECT lines are unchanged. At CP2, show 1.4.3 G1, G2, G4 and G5 passing.
- **R-60 (1.4.8 CP1).** Approved.
  - Requests R-1 … R-6 granted as single-entry edits in `1.4.8 (R-58)` blocks; `--timeout 1800` granted. At CP2 show 1.1.2 G1–G6, 1.4.1 G1–G3 and 1.4.4 G1–G3 passing.
  - SPEC-Q-1 accepted: the resolver sums exactly; the 2146 is R-28 re-targeting stored on plates, which screens must not sum into a day target. No change under `planner/targets/**` (its OWNS entry stays unused). W-7 is closed by G3.
  - SPEC-Q-2 accepted (Plate's calorie note names the day target; the Plan meal sheet shows "679 of 2150 kcal today").
  - SPEC-Q-3 accepted, with one addition: in an exchange, the occupant moving to the source date passes the same planner check as the moved meal, and a refusal of either refuses the whole move (422, nothing written).
  - SPEC-Q-4 / R-7 granted: `swapMeal` refuses with 422 when a re-solved targeted plate of a member in strict mode is `infeasible`, naming member, macro and amount (UX-7). Members in flexible mode keep the least-bad save. This follows PLN-8 (an explicit swap is not the planner's fallback). Show 1.4.1 G1–G3 and 1.4.4 G1–G3 passing.
  - SPEC-Q-5 accepted. The chat recipe card link (`/recipes/{dishId}?date=&slot=`) is recorded for 1.4.5 (see W-9's follow-up leaf if 1.4.5 has merged without it).
  - SPEC-Q-6 amended: rewrite variant labels and component names with the same function, not only steps. The cook reads labels such as "Olive oil and lemon" on the substituted copy, which is the W-6 problem. The dish description stays (the copy's title already says "with <substitute>").
  - SPEC-Q-7 accepted.
- **W-10 (seen at 1.4.7 CP3; owner: the W-9 follow-up leaf).** (a) 1.4.3's deterministic onboarding parse (`packages/core/src/onboarding`, `inferSetup`) keeps relation words in names: "my wife Sara 39 and our three kids Layla 18, …" yields members "my wife Sara" and "our three kids Layla". Without a credential this is what the household gets. Fix: strip possessive and relation phrases (my/our + wife, husband, son, daughter, kid(s), child(ren), n kids) before the name, tested on the F1 lines. (b) 1.4.2's floating Assistant button also shows at 1280 px, where the sidebar already has Assistant, and covers content at the right edge (PlanningBalance's preview panel). Hide it at the desktop breakpoint, or reserve its space.
- **R-61 (leaf 1.4.9 "Chat and setup follow-ups").** Added under node 1.4 (§1, §4, §5; `gates/leaf-1.4.9.md`; node-1.4 integrates it) for W-9 and W-10. 1.3.5, 1.4.5, 1.4.3 and 1.4.2 have merged, so the listed files transfer to 1.4.9's OWNS; 1.4.7's `onboarding/followups/**` stays out. Edits elsewhere (the worker's `handlers.ts` call site, the `plan.generate` completion hook, a digest query in `packages/db`) are single-entry requests at CP1. The chat recipe card's "Use for" link (R-60 SPEC-Q-5) is not in this leaf: it needs 1.4.8's recipe action and goes to whichever leaf merges second.
- **R-62 (owner answers OQ-8 and OQ-9, 2026-09-27; leaf 1.2.6).**
  - OQ-8: main meals repeat a dish only after 6 full days in between (day difference ≥ 7), snacks and workout meals after 3 full days (≥ 4). Measured by the architect on the merged planner with that rule (seeds 1–10, F1 week, AI off): SC-2 min 6.2 %, median 9.0 %, max 14.2 %; SC-1 67/68 in tolerance with one flagged miss; 32–37 distinct dishes a week; 2 snack meals frequency-relaxed (seed 1, day 7). The owner chose to lower SC-2 to what the planner achieves: median ≥ 8 %, no seed below 5 % (01 SC-2). W-3 is closed by 1.2.6. `frequency_rule.min_gap_days` keeps its days-apart meaning.
  - OQ-9 (W-8): nut-free school means lunch boxes only. Exclusions gain `slot_keys` (02 §6, 04 §6.3); allergy exclusions are never slot-scoped. W-8 is closed by 1.2.6.
  - Leaf 1.2.6 is added under node 1.2 (§1, §4, §5; `gates/leaf-1.2.6.md`; node-1.2 integrates it). 1.2.3, 1.1.2 and 1.4.7 have merged, so the listed files transfer. Edits elsewhere (the `exclusion.add` op schema in `packages/core/src/changes/**`, the contract DTO, 1.4.3's exclusion editor and 1.4.5's `describe.ts` showing the scope, `packages/db/test/**` helpers) are single-entry requests at CP1. 1.4.9 owns `packages/core/src/onboarding/{parse-people,text,infer}.ts`, not `followups/**`.
  - Architect note on SC-2: at 9 % the ingredient-economy weight does little under this rule; raising it again would need a library with more dishes built on shared ingredients (not planned).
- **R-63 (1.2.6 CP1 and 1.4.9 CP1).**
  - 1.2.6 SPEC-Q-1: the repeat gap follows the slots, and a pair of servings of one dish uses the **larger** gap of its two slots (symmetric; the conservative reading of "main meals only after 6 full days"). Measured by the builder, F1 seeds 1–10, AI off: SC-2 min 2.1 % (seed 1), median 9.9 %, max 14.3 %; SC-1 680/680; 5 frequency-relaxed meals. R-62's "no seed below 5 %" floor was the architect's, not the owner's; the owner asked for the target to be what the planner achieves, so the floor becomes "no seed where economy adds ingredients" (≥ 0 %); the median ≥ 8 % stands (01 SC-2, 12 OQ-8, 1.2.3 G2 title). The dish-keyed rule of R-62's measurement is not used (it ignores the slot being planned and scored worse on SC-1: 674/680, 20 relaxed).
  - 1.2.6 requests R-1 … R-13 granted (R-10's new int test joins OWNS); SPEC-Q-2 … 5 accepted. SPEC-Q-6: granted as R-14, a single-entry edit in 1.3.3's `packages/core/src/learning/rules/config.ts` so FBK-6 frequency proposals start from the new default of the dish's slot kind (7 main, 4 snack/workout) and their copy ("instead of every N days") stays true; show 1.3.3 G1–G5 passing.
  - 1.4.9 W-10(b): option A. The desktop button is 1.4.5's side-panel opener (`panel.tsx`), the only way to open ChatSidePanel; `app-shell.tsx` reserves its space at the desktop breakpoint while the panel is available, and G4 asserts at 1280 px that `AssistantButton` is hidden and the opener overlaps no content. R-1 (`handlers.ts`, `planGenerate` result gains `ready`) granted; R-2 not needed. SPEC-Q-1 … 6 accepted.

- **Live owner handoffs (2026-09-27, run at 61c3b5b, model claude-fable-5-1).** The owner's key reaches new sessions as `MEALPLANNER_ANTHROPIC_API_KEY` (passed per command as `ANTHROPIC_API_KEY`). 1.4.7 G6 PASSED (people, both adults' targets and never-eat equal the deterministic parse; 4 calls, 624 tokens). 1.3.1 G4 FAILED: the 3-dish generation hit `max_tokens` (20 000) before completing. 1.3.5 G4 FAILED narrowly: 26/29 = 89.7 % against 90 % (allergy-sesame: `exclusion.add` not with `sesame-seeds`/allergy/hard; weekend-appeal: no `preset.upsert`, only read the household; make-sara-admin: no tool call, no `role.set`). Logs in `docs/build/live/`; the two gates' ABANDON lines are removed because the credential now exists, so they stand unmet.
- **W-11 (live-model failures; owner: leaf 1.3.6).** The two failures above. Environment variables are visible to anyone using the environment; the owner was told.
- **R-64 (leaf 1.3.6 "Live-model fixes").** Added under node 1.3 (§1, §4, §5; `gates/leaf-1.3.6.md`; node-1.3 integrates it). 1.3.1 and 1.3.5 have merged, so their `packages/ai` recipes, client and agent files transfer, except `agent/cards.ts` and `agent/events.ts`, which 1.4.9 holds. Dispatch waits for a free builder slot (cap 3).
- **R-65 (1.2.6 request R-15).** `ExclusionRow.slotKeys` is required (1.1.2's `entity-types.ts` asserts core rows equal the Drizzle select type), so six single-entry edits are granted in `1.2.6 (R-62)` blocks: `packages/graph/src/sync/postgres-source.ts` (select `slot_keys`; the graph keeps avoiding a scoped exclusion in every slot, the safe side of SPEC-Q-5), `packages/graph/test/similarity.test.ts`, `packages/ai/test/recipes/support/household.ts`, `packages/core/test/learning/rules/guardrails.test.ts`, `packages/core/test/planner/select/f1.ts`, and `packages/core/test/planner/select/filters.test.ts` (`slotKeys: null`, the slot argument in `exclusionsOf`). At CP2 add 1.3.1 G1–G3, 1.3.3 G1–G5 and 1.3.4's runnable gates to the owners' gates shown.
- **W-12 (raw slugs on Plate, seen at 1.4.8 CP3).** PlatePhone's "Why this dinner" box (1.4.4 text, now in 1.4.8's `components/plan/**`) lists ingredient slugs ("beef-mince-extra-lean, olive-oil, …") and says "american already on 6 other days"; it should use catalogue display names and plain wording (UX-7), and after a substitution it should not name the replaced ingredient. Owner: leaf 1.4.10 (R-68).
- **W-13 (kg.sync edges to missing nodes, seen at 1.4.9 CP3).** In 1.4.9's G4 world (base 608ed0a, F1 seed library, real worker) a `kg.sync` job logs "40 edge(s) name a node that does not exist: Cuisine:tex_mex@global, Cuisine:mexican@global, Method:roasted@global, Ingredient:<id>@global, …" and retries. Traced by code reading 2026-09-27; no reproduction yet. The named nodes exist in `data/cuisines.json` and `data/method-yields.v1.json`. `syncCatalogueGraph` (`apps/worker/src/main.ts:48`) enqueues the global `catalogue` sync and the seed-dish `dish` sync together. The worker runs each queue with `localConcurrency: WORKER_CONCURRENCY` (default 2, `main.ts:21`), so the dish job can insert edges to global Ingredient/Cuisine/Method nodes before the catalogue job's transaction commits. The retry then succeeds, which is why it only shows in logs. A cold deploy with retries exhausted would leave the seed library out of the graph. Fix direction: the dish sync must not run before the catalogue nodes exist, for example with one startup job doing catalogue then dishes, or a `dish` request that syncs the global catalogue first when its nodes are missing. First gate: a test that runs both startup jobs concurrently and fails on today's code. Owner: leaf 1.4.10 (R-68).
- **W-14 (change log does not say who or what, seen reviewing 1.4.6 G3).** `/changelog` titles are the change sets' fixed summaries ("Block login", "Household settings", "Add Adam"), so two blocks of different people read the same, and settings changes show no before → after. The ChangeLog mockup has "Blocked Ravi (kitchen)" and diff chips. The accepted SPEC-Q-18 put this down to the API. The fix is in the summaries 1.4.1's services write (name the subject), plus an optional detail field on `GET /change-sets`. Owner: leaf 1.4.10 (R-68).
- **W-15 (floating Assistant button covers the last content at 390 px; seen reviewing 1.4.6 G3 and 1.4.10 G5).** 1.4.2's `AssistantButton` (`app-shell.tsx`, `fixed right-4 bottom-[100px]`) sits over the bottom of the page when it is scrolled to the end. It covers "Delete my account" on `/account` and the "See recipe" button on the Plate. 1.4.9 (W-10(b)) reserved its space at the desktop breakpoint only. Fix: reserve the button's space at the phone breakpoint too, as padding at the bottom of `main` while the button shows, so the last control scrolls clear of it. Owner: to be decided at the node-1.4 N5 review. It is a single-file change in `app-shell.tsx`, with a Playwright overlap assertion at 390 px on `/account` and a Plate page. **Closed by leaf 1.4.11 (merged 59d65a2), R-77, R-78.**
- **R-72 (live-credential gates inside node N1).** Node N1 reruns every child CHECK in one environment. Most leaf scripts don't clear `ANTHROPIC_API_KEY`, so N1 must run without it. A CHECK that needs the live model therefore names the credential itself, scoped to that one command: 1.4.7 G6 becomes `ANTHROPIC_API_KEY="$MEALPLANNER_ANTHROPIC_API_KEY" node scripts/verify/leaf-1.4.7.mjs --live`. The ledger line holds the variable reference, never the value. Every other gate keeps running without a credential. The node-1.4 N1 run of 2026-09-28 01:56–03:21 failed on exactly this, and on 1.4.8 G5.
- **W-16 (1.4.8 G5 locator, fixed by the architect).** `apps/web/e2e/plan.spec.ts` found the substituted meal's cook-sheet card with `filter({ hasText: dishName })`. The first matching card can be another meal's card that mentions the dish: in the N1 run it read the Labneh snack's card. It passed alone and failed in N1 depending on the generated plan. It now matches the card's own `h2` heading exactly. This is a single test-only edit in merged 1.4.8's file, and G5 was rerun.
- **R-66 (1.3.6 CP1 and 1.4.9 CP3 question).**
  - 1.3.6 CP1 approved. SPEC-Q-1: ruling A. The allergy-sesame eval expects `exclusion.add {kind: dietary_flag, key: contains_sesame, reason: allergy, hard: true}` (R2-ONB-3; onboarding's resolver maps sesame to the flag, and `sesame-seeds` alone leaves tahini, hummus, sesame oil, za'atar and halva allowed); the `hard: false` must-not stays. This is the only eval expectation change. ADR-1 accepted: the recipe budget is measured (20 000 output tokens per dish, capped at 128 000), not a per-dish split; measured live 3 dishes = 24 932 tokens in 244 s. The prompt fixes (weekday numbering 0 = Monday, `role.set` through `apply_change` as a protected proposal, the allergen flag rule) are accepted.
  - 1.4.9 finding 2 ("Use for" on the chat recipe card): option (a). Single-entry edits granted to 1.4.9 in `1.4.9 (R-61)` blocks: `packages/ai/src/agent/tools/schemas.ts` (`create_recipe` gains `date: IsoDate.optional()`, "the day the recipe is for, when the admin names one"), `apps/web/lib/server/agent.ts` (`createRecipe` passes `date`), `apps/worker/src/jobs/recipe-draft.ts` (`RecipeDraftPayload.date`; when set, draft for that date). The job's computed date is not used for the link. 1.3.6 does not edit `schemas.ts`; 1.3.6's prompt should mention the optional date only if its eval needs it. At CP2 1.4.9 shows 1.3.5 G1–G3 passing.
- **R-67 (1.3.6 questions).**
  - `get_household` logins: granted to 1.3.6 as a single-entry edit in `apps/web/lib/server/agent.ts` in a `1.3.6 (R-64)` block: `getHousehold` adds `logins` from `listAccess` (userId, name, role, status, memberId, memberName; no emails). Without it `role.set` cannot work in the app although the eval passes. OWNS gains a new `apps/web/test/api/agent-household.int.test.ts` proving an admin's `get_household` returns the logins and a non-admin cannot reach it. 1.4.9 also edits `agent.ts` (`createRecipe`); whichever merges second resolves the two separate blocks.
  - SPEC-Q-2, option B: the REC-5 follow-up triggers when *candidates* (dishes feasible for every targeted attendee) are fewer than `count`, asks for `count − candidates`, and quotes the infeasible dishes' solver reasons; infeasible dishes are still saved (REC-5 step 7). This supersedes 1.3.1 SPEC-Q-6 in R-32. The control test `g1-pipeline.test.ts` (duplicate detection) updates its call count accordingly; 1.3.1 G1–G3 and 1.4.1 G2 must pass.
- **R-68 (leaf 1.4.10 "Plain reasons, graph start-up, change-log subjects").** Added under node 1.4 (§1, §4, §5; `gates/leaf-1.4.10.md`; node-1.4 integrates it). It closes W-12, W-13 and W-14. Their files belong to merged leaves (1.2.3, 1.2.6, 1.3.4, 1.4.1, 1.4.6, 1.4.8), so they transfer. The change-set DTO in `packages/api-contract` (the optional detail) and any label data the planner pool needs from `packages/db` are single-entry requests at CP1. W-13's cause is traced but not reproduced (see W-13), so G2's reproduction comes first. If it does not reproduce, the builder reports that at CP1 with the attempt, before changing start-up. The floating assistant button covering "Delete my account" at 390 px until scrolled (seen at the 1.4.6 G3 review, 1.4.2's shell) is not in this leaf; it goes to node-1.4's N5 review.
- **R-69 (node verify scripts).** The node gates' N2–N4 are defined in §6 ("Node gate definitions"). A builder writes `scripts/verify/node-1.{1,2,3,4}.mjs` and `scripts/verify/lib/node.mjs`, plus the N3 tests they run, under the leaf checkpoints (CP1 plan, CP2 evidence, CP3 architect).
  - Its OWNS: those scripts, `packages/db/test/node/**`, `apps/web/test/node/**`, `apps/web/e2e/node-1.4/**` and `docs/decisions/node-scripts-*.md`.
  - Its gates are the node ledgers' N2–N4, met through `gate-check`. N1 (reverify the children) and N5 (manual) stay with the architect.
  - node-1.4's N1 waits for 1.4.10, but its N2–N4 can be written and run before then.
- **W-17 (the plan depends on surrogate ids; reported by the node-scripts builder, root-caused by the architect).** Three `plan.generate` runs of the F1 week at seed 1, each on a freshly seeded database, persisted three different plans: 10, 13 and 14 same-dish pairs, and one relaxed breakfast repeat.
  - Cause: `packages/core/src/planner/select/day.ts:83` hashes `slot.id` and `dish.id` into the seeded pre-score jitter, and the beam tie-break hashes a path built from dish ids (`day.ts:224,250,447`). Ids are UUIDv7s made at seed time (`packages/db/src/schema/ids.ts`), so every fresh database is a hidden second seed.
  - Correction (1.2.7 CP3): library dishes' ids are deterministic (`seedId("dish", slug)`, `packages/db/src/seed/load.ts`), so on two fresh databases the ids that differ are the slot and member ids `loadFixture` makes (and household dishes'). The meal key's `slot.id` and member id were the cross-database cause; dish ids matter under any id renaming, which 1.2.7 G1 covers.
  - Reproduced in core with no database: prefixing every dish id with a constant salt, which keeps their order, changes 54–58 of 78 meals and relaxes a breakfast repeat.
  - Nothing reads the clock or `Math.random`, and query order is fixed.
  - 1.2.3 G4 and 1.2.5 G1 passed because they compare runs over one id set.
  - This violates PLN-11 ("deterministic for a fixed seed") in substance: the seed must be the only source of variation.
  - Fix: key the seeded randomness and every tie-break on natural keys (dish slug, slot key, member order), never on surrogate ids. Owner: leaf 1.2.7 (R-73).
- **R-73 (leaf 1.2.7 "Id-independent plan search").** Added under node 1.2 (§3, §4, §5; `gates/leaf-1.2.7.md`; node-1.2 integrates it). It closes W-17.
  - Ownership: `packages/core/src/planner/select/**` transfers from merged 1.2.3, 1.2.6 and 1.4.10, and `load-input.ts` from merged 1.4.1.
  - `PlanDish` gains its natural key (the dish slug). Other constructors of `PlanDish` and its config types that must change (`apps/worker/src/jobs/plans-preview.ts`, `packages/db/src/services/plans/{meal,generate,substitute}.ts`, their tests) are single-entry requests at CP1.
  - Plans change once, at this leaf. SC-1 and SC-2 are re-measured on the new code (G3), and a seed where economy adds ingredients fails.
  - The node verify scripts (R-69) measure at run time, so they need no change.

- **R-74 (1.2.7 CP1).** Approved.
  - Requests granted as single-entry edits marked `1.2.7 (R-73)`:
    - R-1: `cooksheet/build.ts` orders adjuster batches by slug.
    - R-2: regenerate the `cooksheet.test.ts` snapshot, with the diff reported at CP2.
    - R-3: `config.test.ts` uses the first of seeds 1–10 whose Monday plan serves an adjuster, and fails if none does.
    - R-4 (a): `day-sums.test.ts` and `leaf-1.4.8.mjs` (the title match only) assert that the stored sum differs from the day target, without pinning 2146.
    - R-5: `GENERATOR_VERSION` becomes `"1.2.7"`.
  - SPEC-Q-1, 2, 4 and 5 accepted. The member key is the position in `cfg.members`, which is creation order, because `newId` is strictly increasing within a process.
  - SPEC-Q-3 not accepted: G2 runs the worker's `plan.generate` handler (`runJob`) on each database.
  - If G3 takes longer than node-1.2 N1's 1800 s per gate, the architect raises that timeout.
- **W-18 (flaky 1.4.10 open-tx witness; reported by the node-scripts builder, fixed by the architect).** `apps/web/test/api/kg-startup.int.test.ts` `openTx` held only the catalogue job, so the dish job could end its first attempt before the catalogue nodes were written. No backend then waited on a lock, and `lockWait` stayed false, in about 1 run of 8 (node-1.4 N4). The W-13 fix held in every run. Now the dish job starts only once the catalogue nodes are written and not yet committed. This is a single test-only edit in merged 1.4.10's file: `-t "open-tx"` passed 12 of 12 (the fixed test plus its pre-fix negative control), and leaf-1.4.10 G2 passed.
- **R-75 (1.2.7 CP2: G3 wall time).** Leaf 1.2.7's G3 reruns other leaves' full gates (1.4.10 G1 with its nested regressions and e2e, and 1.2.6 G2). It took 3627 s alone and about 3980 s with G1 and G2 running alongside. node-1.2's N1 therefore reruns its children with `--timeout 5400` instead of 1800. G3 is not trimmed.
- **R-76 (1.2.7 CP3, merged in 4b40a55).** The architect reverified the leaf with `DATABASE_URL` unset and then set, gates concurrent: ALL MET 3/0/0 both times. Full CI passed: format, build, lint, typecheck, unit, integration.
  - Mutations:
    - `dish.id` restored in the jitter key: G1 fails (4 of 9 tests). G2 passes, because library dish ids are the same on every database (see the W-17 correction), so this is not a G2 test.
    - The slot id in place of the slot key in `Run.mealKey`: G1 fails and G2 fails (4 assertions, service level and worker handler).
  - W-17 is closed.

- **W-19 (the Docker images did not build; found by the architect preparing root R2, fixed by the architect).** A fresh `docker compose up --build`, the setup SC-1 to SC-5 are defined on (§6 root), failed on any machine. No gate had ever built the images; leaf 1.4.1's gates run the apps from the workspace.
  - Both Dockerfiles used `node:22.12-bookworm-slim`, but the locked `@eslint/js@10.0.1` requires Node `^22.13.0`, so `pnpm install --frozen-lockfile` stopped with ERR_PNPM_UNSUPPORTED_ENGINE. CI and development run Node 22.22.
  - The web image then failed in `next build`'s type check: `apps/web/test/api/plans-preview.int.test.ts` imports `apps/worker/dist`, and the web Dockerfile built only web's own dependencies.
  - The Dockerfiles' `COPY --exclude=**/.next` did not keep `apps/web/.next/verify-*` (8.8 GB of gate output) out of the build context.
  - Fix:
    - both Dockerfiles use `node:22.22-bookworm-slim`;
    - the web image also builds `@mealplanner/worker...`;
    - a root `.dockerignore` excludes installs, build output and gate artefacts;
    - the root `engines.node` floor rises to `>=22.13.0`.
  - Verified by the architect: both images built from a clean export, the worker image built from a working copy with a context of 11.7 MB, and `docker compose up` on a fresh volume came up healthy. The worker migrated and seeded 62 dishes, 18 adjusters and 363 ingredients, `/` redirected to `/today`, and `/sign-in`, `/onboarding` and `/offline` returned 200.
  - These are single-entry edits in merged 1.1.1's `package.json` and 1.4.1's Dockerfiles. Root R2 builds the images, so this cannot recur unseen.
- **R-77 (W-15 owner; leaf 1.4.11).** W-15 gets its own leaf, 1.4.11 (§3, §4, §5; `gates/leaf-1.4.11.md`; node-1.4 integrates it). It is a product change in merged 1.4.2's `app-shell.tsx`, so it does not go to the architect as a test-only fix.
  - Cause: at < 1024 px, `main` keeps `pb-[calc(100px+safe-area)]`, which clears the tab bar only. The 58 px `AssistantButton` sits at `bottom-[calc(100px+safe-area)]`, so at the end of a page it covers the last 58 px on the right.
  - Direction: while the button shows, reserve its height and margin as bottom padding at the phone breakpoint, the phone counterpart of 1.4.9's W-10b desktop rule.
- **R-78 (1.4.11 ARCHITECT QUESTION, the /account negative control).** Option A.
  - 1.4.6's account `Frame` has `pb-16 lg:pb-0` (`account-screen.tsx:420`), so before the fix "Delete my account" already ends about 6 px clear of the button once the page is scrolled to the end. The 390 px capture at the 1.4.10 G5 review showed the overlap before the page reached the end.
  - The Plate overlaps at the end: 58 × 52 px, measured by the builder.
  - §5 G1's control is reworded:
    - the Plate's pre-fix intersection is at least 20 px;
    - on /account, the pre-fix gap is under the 16 px margin, where the fix gives at least 16 px.
  - 1.4.6's padding stays, so roles without the assistant keep their layout.

- **R-79 (root gates reconciled with r2; architect ruling, 2026-09-29).**
  - **SC-6 and SC-7 are root gates.** r2 (13-revision-r2.md §SC, lines 105-106) adds SC-6 (a new household reaches its first generated day plan after at most 5 questions, counted by Playwright) and SC-7 (every inferred setting on the review screen links to where it is adjusted, and every link resolves). 13 overrides §6's "SC-1 to SC-5": the root runs SC-1 to SC-7.
  - **The root ledger is `docs/build/GATES.md`**, not `gates/root.md`. R1 reverifies the nodes; R2–R8 are SC-1 … SC-7, one gate each (§6's single R2 split per criterion); R9 (manual) rereads the owner's requests and spec r2 and reconciles every contract-inventory row (§6's R3). The final report to the owner (§6's R4) follows R9 and is not a gate.
  - **Node gates as built:** N1 reverify, N2 interfaces, N3 end to end, N4 full suite, N5 the architect's manual branch review. §6's separate "N5 lease releases" gate does not exist; nothing in v1 holds leases.
  - **R1 runs through `scripts/verify/root.mjs --gate R1`.** The earlier CHECK (one `gate-check --reverify` over four node ledgers, with no `--approve` and no `--timeout`) had the R-75 defect: nested runs fall back to a 120 s timeout. It also could not survive a machine reboot, since the four nodes take many hours; this container rebooted twice on 2026-09-29.
    - `--gate R1` runs `gate-check --root . --cwd . --approve --reverify --jobs 1 --timeout 14400` on each node ledger in turn. It records each node's pass in a cache keyed by the git tree (`git rev-parse HEAD^{tree}`) and a clean worktree. On a rerun it reuses only the passes recorded for the same tree.
    - It prints `VERIFY root R1 PASSED` only when all four nodes passed on the current tree.
    - Negative control: a pass cached under a different tree is not reused.
- **R-80 (root-verify leaf).** A builder writes `scripts/verify/root.mjs` (R1 and SC-1 … SC-7) against GATES.md R1–R8, under the node-scripts leaf's rules (R-69, R-70).
  - OWNS: `scripts/verify/root.mjs`, `scripts/verify/lib/root*.mjs`, `apps/web/e2e/root/**`, `apps/web/test/root/**`, `docs/decisions/root-verify-*`; R-84: `apps/web/e2e/node-1.4/**`; R-86: the one root-config entry in `scripts/verify/lib/node.mjs`.
  - SC-1 … SC-7 run against a fresh `docker compose up` (the repo's `docker-compose.yml`, images built from its Dockerfiles, a new project name and volume per gate, torn down after). The stack migrates and loads the catalogue and seed library itself. F1 is set up through the running stack's API or onboarding, and the model is recorded (as in node N3).
  - Each gate reuses the N3 flow and measure that proves it, and carries a negative control. Gates are safe to run one after another (compose projects are not shared).
- **R-81 (spec errata found by the R9 contract review; architect ruling, 2026-09-29).** Where spec text disagrees with a later decision, the decision holds; the code and gates already follow it:
  - sat-fat default: 6 % of kcal (OQ-4, R-28, owner 2026-09-26), not 13-revision-r2.md:18's 10 %;
  - SC-2: median ≥ 8 % over seeds 1–10, every seed ≥ 0 % (owner, OQ-8/R-62/R-63), not §5 1.2.3 G2's ≥ 25 % (its ledger already says 8 %);
  - FBK-6 repeat gap: day difference ≥ 7 in main slots and ≥ 4 in snack and workout slots (OQ-8), not 06's 6 days;
  - NUT-7 carbs: FDC 1005 − 1079 (R-20); REC-5's follow-up call is on candidates (R-67); the default model is `DEFAULT_MODEL` (R-32, R-44), not `claude-opus-5`;
  - UX-2, UX-3, UX-4 and UX-5 are superseded where r2 (R2-DL, R2-UX, stars not thumbs or emoji) and the mockups (R-21) say otherwise;
  - ledgers are authoritative over §5's gate numbering where they differ (1.1.2, 1.1.3, 1.2.4, 1.4.3).
  - `docs/build/CONTRACT-INVENTORY.md` is R9's inventory (every requirement ID in spec 01–10, 12 and 13, and BLD, mapped to the gates that prove it).
- **R-82 (contract gaps; leaves 1.3.7 and 1.4.12).** R9's review found requirements that no gate proves, verified by the architect against the tests (the inventory's first pass also listed PLN-7, PLN-12 and US-4, which unit tests and node-1.4 N3 do cover):
  - W-23 FBK-3: practical tags are collected but never become slot-suitability flags (not implemented). Ruling: because seed-library dishes are global, the rule proposes a household-scoped soft exclusion from packed slots (1.2.6's `slot_keys`) rather than editing the dish; `took_too_long` has no slot meaning and becomes a digest note. Proposals, not automatic changes.
  - DM-4 recompute on change, REC-6's draft job past queueing, PLN-3's one-tap "replaces lunch" and R2-DL-6's "tell the assistant" are implemented and untested.
  - Leaf 1.3.7 (node-1.3) takes the first three, leaf 1.4.12 (node-1.4) the last two; the node ledgers' N1 now include them, so N1 of node-1.3 and node-1.4 is pending again. ARC-9's `.env.example` gains the optional `LOG_LEVEL` and `DATA_DIR`; ARC-4 (no business logic in route handlers) is an architecture review item for R9.
- **R-83 (1.3.7 SPEC-Q-1: a dish exclusion kind).** R-82 assumed `exclusion.add` could exclude a dish; it cannot (`EXCLUSION_KINDS` is ingredient, category, dietary_flag, and the planner filters only those). Ruling, the builder's option (a): add `dish` to `EXCLUSION_KINDS` (key = dish id; migration 0008 `ALTER TYPE exclusion_kind ADD VALUE 'dish'`); the planner drops a dish excluded for an attendee at a slot the exclusion covers; `exclusion.add` validates that the dish is visible to the household; `satisfied.ts` counts a row as satisfying the op only when its scope covers the op's; the family page's never-serve list names a dish exclusion by the dish's name. "Soft" in R-82 means not protected (`hard: false`, a non-protected reason: removable by any later edit or proposal); the planner still applies it as a filter in the slots it names. OWNS of 1.3.7 extended accordingly (§4). SPEC-Q-2 (no stored draft row; the draft lives in the job result and Save creates the dish active), SPEC-Q-3 (import the worker's handler), SPEC-Q-4 and SPEC-Q-5 are accepted as recorded.
- **R-84 (CP1 grants for 1.4.12 and root-verify).**
  - 1.4.12: R-1 granted (`apps/web/e2e/contract-gaps/**` for the recorded agent turn). SPEC-Q-2 granted: the Tastes section's "Tell the assistant" prompt becomes `Change <name>'s tastes: ` (`tastes-section.tsx:188`, one line), so every detail-level prompt names member and section. SPEC-Q-1, 3 and 4 are accepted as recorded.
  - root-verify: R-1 granted: node-1.4 N3's SC-5 flow and `axeFindings` move into an exported module under `apps/web/e2e/node-1.4/` that `sc5.e2e.ts` and the root spec both import (one flow, not two copies); node-1.4 N3 must still pass on the change. OWNS of root-verify gains `apps/web/e2e/node-1.4/**`. SPEC-Q-1 … 7 are accepted as recorded.
- **R-85 (1.3.7 grants past R-83, and SPEC-Q-6).**
  - Granted, exactly as in `docs/decisions/leaf-1.3.7-pending-grants.md`: `RULE_IDS` gains `practical_packing` and `practical_time` (`learning/rules/types.ts`; `InsightNote.rule` is typed, and borrowing another rule's id would mislabel the note); `eligiblePool` gains the conjunct `dishExclusionReason(d, meal.attendees, meal.slot.key, this.household) === null` (`planner/select/run.ts`, the one place a meal's dishes are filtered); `isExcluded` gains `case "dish": return false` (`packages/graph/src/store/exclusions.ts`; a dish exclusion never excludes a substitute ingredient, and without the case the exhaustive switch fails to compile). With no dish exclusions the planner is unchanged, so SC-1/SC-2 hold as measured; CP3 reverifies node-1.2's measure on the merge.
  - At CP3 (merge of PR #31) the architect applied the builder's non-blocking request, `dish: "Dish"` among the exclusion kind labels of `apps/web/components/chat/describe.ts`, and Prettier-formatted the generated `meta/_journal.json` and `meta/0008_snapshot.json` (the only `format:check` failure; the parsed JSON is unchanged).
  - SPEC-Q-6 accepted as recorded: the recipe card's example plates are REC-5 step 7's feasibility plates, one per targeted attendee of the requested meal. An untargeted member has no target to check, and their PLN-7 appetite portion is set when a day plan is solved, not in a draft. Reported to the owner as an interpretation of "per-attendee example plates" (05 §101, 07 §95).
- **W-24 (a meal split read back from the database showed every share as "yours"; found by the 1.4.12 builder, SPEC-Q-5, fixed by the architect).**
  - The problem: `meal_distribution.share` is `numeric(10,3)`, but `inferYours` (`apps/web/components/detail-level/logic.ts`) compared the siblings' `stored / auto` ratios within 0.4 % only, the 4-decimal rounding of `rebalance()`. Rounding to 3 decimals moves a small share's ratio by more (snack at lunch 40 %: 0.43 %), the siblings split into groups, and the inference fell to its ambiguous case: every share showed "Yours · back to auto" (R2-DL-4 expects only the value set).
  - The fix: the comparison adds the column's half-unit (0.0005 / auto share) for each side.
  - Verified: a unit case of stored 3-decimal splits (lunch 40 %, lunch 36 %, automatic, two of five set) failed on the pre-fix code (all four shown as yours) and passes with the fix; leaf-1.4.3 G3 reverified at CP3 of PR #32.
  - Edit in merged leaf 1.4.3's `logic.ts` and `logic.test.ts`. Root R1 reverifies them.
- **W-25 (web integration tests timed out under CPU load; found by the architect in node-1.4 N1, 2026-09-30).**
  - The problem: `apps/web` had no Vitest config, so its API integration tests ran on Vitest's 5 s default test timeout. The G4 access tests sign users up and in (scrypt password hashing) and make many database round trips per test. With other work on the machine they ran past 5 s and failed with "Test timed out in 5000ms"; alone they passed.
  - Where it showed: the node-1.4 N1 rerun of 2026-09-30 (started 01:10, alongside node-1.3's N1) reset leaf-1.4.1 G4 and G5 to pending. Alone, both passed (16/16 and 5/5). With a full `pnpm build` running alongside, G4 failed 1 of 2 runs: "G4 TOTP enforced when required" and "G4 undoing an unblock …" timed out at 5000 ms.
  - The fix: `apps/web/vitest.config.ts` sets `testTimeout` and `hookTimeout` to 30 s for the suite. Tests that need more still pass their own timeout, as the other API integration files already do.
  - Verified: the pre-fix G4 failed 1 of 2 runs with a full build alongside; the fixed G4 passed 3 of 3 runs (16/16 each) with a forced (uncached) full build alongside, a heavier load. node-1.4 N1 is then rerun with nothing alongside.
- **W-26 (node N4 did not know leaf 1.4.12's e2e spec; found by the root-verify builder, fixed by the architect).**
  - The problem: leaf 1.4.12 added `apps/web/e2e/contract-gaps.spec.ts` to the default Playwright config, but `scripts/verify/lib/node.mjs` `E2E_SPECS` had no entry for it. Every node's N4 failed "every spec file of the default config is run" on the base from the 1.4.12 merge (1a70427). The architect's CP3 of 1.4.12 ran the leaf's gates and full CI but no node N4, so it did not see this.
  - The fix: an `E2E_SPECS` entry (a seeded database and the worker, as the leaf's verify script gives it) and a `preload(tag)` option in `e2eRun`, which puts the leaf's recorded agent turn (`e2e/contract-gaps/agent-turn.mjs`) into `next start` for `@1.4.12-G2`, as the chat stub is.
  - Verified: node-1.1 N4 on the fix passed (DATABASE_URL unset), with `contract-gaps.spec.ts` @1.4.12-G1 3/3 and @1.4.12-G2 3/3; before it, the builder's N4 runs (unset and set) failed on exactly that assertion.
  - Process change: at CP3, a leaf that adds or moves an e2e spec or Playwright config also runs node N4.
- **R-87 (owner answers to the final report, 2026-10-01).**
  - **Confirmed:**
    - carbs ±5 g per meal (the owner's "+-56" was ±5; OQ-1 is now decided, not a default);
    - v1 is the installable PWA, with the native app deferred (OQ-3);
    - PRD-4's 5-minute bound stays unmeasured;
    - the ARC-4 exception (the auth route's 2FA policy read) stays.
  - **Open:** SPEC-Q-6 (recipe-card example plates for targeted attendees only). The owner is reviewing it and will say whether it changes.
- **W-27 (the web container got no model settings under docker compose; found by the architect after the root run, 2026-09-30).**
  - The problem: `docker-compose.yml` passed `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` to the worker only. The chat assistant and onboarding's parse run in the web app, so a stack started as the file says (`cp .env.example .env`, `docker compose up`) answered 503 "assistant unavailable". Separately, `.env.example` set `ANTHROPIC_MODEL=claude-opus-5`, not the default model (R-81 errata), so copying it as instructed would have broken every model call.
  - Why no gate saw it: root R2–R8's generated compose override sets the recorded model's variables on both containers, which masked the base file's omission; no gate reads `.env.example`.
  - The fix: the web service gets `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` and `AGENT_EFFORT`; `.env.example` leaves `ANTHROPIC_MODEL` empty (an empty value falls back to `DEFAULT_MODEL`, `packages/ai/src/client/config.ts:36`).
  - Verified: `docker compose config` shows the three variables on web; root R2–R8 reran on the fixed tree (335fa59) through one-gate ledgers identical to GATES.md's: 7 of 7 met (21:20–21:34), SC-2 median 13.9 %. No node gate reads either file, so R1's pass stands.
- **R-86 (root-verify SPEC-Q-8: node N4 and the root Playwright config).** N4's rule "every Playwright config of apps/web is run" found `apps/web/e2e/root/playwright.config.ts`, whose tests need the compose stack a root gate starts. The builder's rename to `root.playwright.ts` (so N4's finder would not collect it) is refused: it dodges the coverage rule by filename, and any later config could do the same. Granted instead: one entry in `scripts/verify/lib/node.mjs` naming exactly that path as run by root gates R6–R8, with a negative control that a stray `playwright.config.ts` elsewhere still fails N4. root-verify's OWNS gains that one entry.
- **W-23 (FBK-3 practical tags not implemented; found in R9).** See R-82. Owner: leaf 1.3.7.
- **W-20 (a job's terminal event and status were committed apart; reported by the node-scripts builder as R-5, fixed by the architect).**
  - The problem: `apps/worker/src/runner.ts` committed the `done` event, whose `pg_notify` ends the SSE stream, before setting `succeeded`. A client that had seen the stream end could read the job as `running`. The failure path had the same gap for `failed`. It showed up as node-1.3 N4 failing `g2-worker-sse.int.test.ts:218`.
  - The fix: each terminal event and its status now commit in one transaction. On the failure path, if that transaction fails, the status alone is still written, so a job never stays `running`.
  - Verified in a clean worktree:
    - `g2-worker-sse.int.test.ts` passes 6 of 6;
    - with a 500 ms pause inside the transaction it passes 3 of 3;
    - the pre-fix code with the same pause between separate writes fails 3 of 3 with "expected 'running' to be 'succeeded'".
  - This is a single edit in the worker runner, which merged leaf 1.4.1 owns.
- **W-21 (verify-script locks a dead holder could leave for ever; found and fixed by the architect).**
  - The problem: the verify scripts' mkdir locks were taken over only when their `pid` file named a dead process.
    - A holder killed between `mkdirSync` and writing its pid left a lock with an empty `pid` file, and nothing ever took it over. Every later gate needing that lock waited out its deadline (25 min) and failed.
    - The build locks of leaves 1.3.4, 1.3.5, 1.4.1, 1.4.5 and 1.4.6 recorded no pid at all, so any killed holder left them blocked.
    - Leaf 1.3.1's lock went stale only after 15 min, while its waiters gave up at 10.
    - The exclusive locks of leaves 1.2.7 and 1.4.10 waited with no deadline while their `pid` file was missing.
  - Where it showed: a `packages-build` lock left with an empty pid at 23:38 on 2026-09-28. In node-1.4 N1 rerun #3 on 2026-09-29, nothing built between 07:27 and 08:17: two gates in a row timed out.
  - The fix: one shared rule, `scripts/verify/lib/lock.mjs` `lockIsStale`. A lock may be taken over when its recorded holder is dead, or when it records no holder (empty, missing or unreadable pid) and is older than 5 s, the mkdir-to-write window. Every lock loop in the verify scripts now uses it, and the build locks that recorded no pid now record one.
  - Verified:
    - The rule was unit-tested on nine cases: empty, missing and garbage pid, both aged and fresh; a live holder; a dead holder; a lock that is gone.
    - With an aged empty-pid lock planted, real gates of leaf 1.4.3 (`withLock`), 1.3.4 (build lock), 1.3.1 (build lock) and 1.2.7 (exclusive) each took it over, 4 of 4.
    - With the pre-fix rule substituted, all four stayed blocked, 0 of 4, and the unit cases failed 3 of 9.
    - The leaf 1.3.1, 1.3.4 and 1.4.2 ledgers were reverified on the change in a clean worktree: ALL MET, 10 met. The first attempt failed 4 gates because the takeover harness had SIGKILLed a gate mid-build in that worktree, leaving `packages/db/dist` empty. After a full package rebuild, every gate passed.
  - Edits in the verify scripts of merged leaves 1.2.7, 1.3.1, 1.3.4, 1.3.5 and 1.4.1–1.4.11. Root R1 reverifies all of them.
- **W-22 (a saved target or training change lost its "Saved" confirmation at once; found by the architect in PR #26's CP3, fixed by the architect).**
  - The problem: on the family page, `TargetsSection` and `TrainingSection` are keyed by the member's saved targets and training days (`family-screen.tsx`, and `detail-levels-screen.tsx` for targets). This makes a form reset from fresh data.
    - After a save, `setSaved(true)` showed "Saved. It's in the change log, where you can undo it." Then `reload()` brought back the new data, the key changed, and React re-created the section with `saved` false.
    - The UX-7 confirmation therefore showed only for the length of one reload, tens of milliseconds.
  - Where it showed: node-1.4 N4 in PR #26's CP3 (unset round, 2026-09-29) failed leaf 1.4.3's `e2e/config.spec.ts` "@G1 family edits at 390 px" at the confirmation check. The same suite passed in the three other nodes' N4. Whether the test's first look came before the re-creation depended on timing.
  - The fix: the page keeps which sections have saved (`useSavedSections` in `components/config/parts.tsx`) and passes it to both sections, so the line survives their re-creation. The keys stay: they still reset the forms from the saved data.
  - The test now waits for "Save targets" to disappear (the form matches the reloaded data) before it looks for the confirmation. It checks the state after the reload, deterministically.
  - Verified (leaf-1.4.3 G1, both widths):
    - with the test change on the pre-fix code, "@G1 family edits" failed at 390 and 1280 px ("element(s) not found" at the confirmation);
    - with the fix, all 7 @G1 tests passed.
  - Edits in merged leaf 1.4.3's files (`parts.tsx`, `targets-section.tsx`, `training-section.tsx`, `family-screen.tsx`, `detail-levels-screen.tsx`, `e2e/config.spec.ts`). Root R1 reverifies all of them.
