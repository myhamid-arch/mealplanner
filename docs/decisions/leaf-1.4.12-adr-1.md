# leaf-1.4.12 ADR-1: test harness and the recorded agent turn

## Context
Leaf 1.4.12 (R-82) adds Playwright tests only, for two requirements that are implemented and untested:
PLN-3's one-tap "replaces lunch" (`apps/web/components/config/schedule-screen.tsx`) and R2-DL-6's
"Tell the assistant" (`apps/web/components/detail-level/detail-control.tsx`). G1 needs a real plan
generated through the worker; G2 needs an agent turn that applies a change, with no live model
(07 §1, anti-drift rule 7: recorded responses in tests). No new dependency may be added
(`@playwright/test` 1.63.0 and `@axe-core/playwright` 4.13.0 are already in `apps/web`).

## Decisions
1. **Harness: 1.4.8's, with this leaf's names.** `scripts/verify/leaf-1.4.12.mjs` builds the workspace
   packages and the worker under the shared `packages-build` lock, runs `next build` with
   `DATABASE_URL` cleared (R-50) into its own `.next/verify-1.4.12-<gate>` directory under the shared
   `web-next-build` lock, and gives every e2e gate its own database (on `DATABASE_URL`'s server, else
   localhost:5432, else a throwaway PostgreSQL 16 cluster), migrated and seeded with the catalogue,
   its own free port, its own worker process and its own temp directory. Gates are safe to run
   concurrently. Playwright runs `e2e/contract-gaps.spec.ts --grep @1.4.12-G<n> --reporter=json`, and
   the script checks every expected test title passed and none was skipped.
2. **The recorded agent turn goes in the model slot `agentModel()` reads**
   (`Symbol.for("mealplanner.web.agentModel")`, apps/web/lib/server/agent.ts), filled by a preload
   passed to `next start` through `NODE_OPTIONS=--import …`, the mechanism 1.4.5's
   `e2e/chat/agent-stub.mjs` and node-1.4 N3 use. It is a script, not a model: for a request that
   starts with one of the three section prompts, it answers with fixed `BetaMessage`s
   (`get_household`, then `apply_change` with the op the section writes at its level, then a short
   text, `stop_reason` `tool_use` / `end_turn`), filling only ids read from the `get_household` tool
   result. 1.4.5's stub is not reused: it has no turn for these requests and is 1.4.5's file.
   - Where the preload lives: Request R-1 asks for `apps/web/e2e/contract-gaps/**` in OWNS
     (`agent-turn.mjs`). If R-1 is not granted, the preload is a mode of
     `scripts/verify/leaf-1.4.12.mjs` itself: imported (not run) with `LEAF_1_4_12_AGENT_TURN=1`, it
     installs the turn and does nothing else.
3. **Negative controls go through the same assertion functions** as the positive checks:
   - G1: a twin household at each width where the tap is not made; the same "no lunch plate, packed
     plate present" check over its generated plan must fail (its lunch plate stays).
   - G2: the member page with the "Tell the assistant" link removed from one detail-level section
     (DOM removal in the test page); the same "every section offers it" check must fail and name
     that section.
