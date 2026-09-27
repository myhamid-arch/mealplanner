# Leaf 1.4.9 ADR-1: where the gates' tests live and how they run

## Context

The leaf's OWNS has no `apps/web/e2e/**` path, and `apps/web/playwright.config.ts` (1.4.2) sets
`testDir: "./e2e"`. G1 and G2 need the worker's real `chat-events.ts` against a database, and G4
needs Playwright at 390 and 1280 px with axe-core. gate-check runs gates in parallel.

## Decision

- **Playwright (G4).** The spec is `apps/web/test/chat/updates.e2e.ts` with its own config
  `apps/web/test/chat/playwright.config.ts` (both inside `apps/web/test/chat/**`), started with
  `playwright test --config test/chat/playwright.config.ts`. The config mirrors 1.4.2's (Chromium,
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `next start` on the gate's port, `MISE_NEXT_DIST_DIR`). The
  `.e2e.ts` suffix keeps Vitest (`*.test.ts`) from collecting it. `@axe-core/playwright` 4.13.0 and
  `@playwright/test` are already web devDependencies; no dependency is added.
- **Integration (G1, G2).** `apps/web/test/api/chat-events-digest.int.test.ts` and
  `chat-events-plan.int.test.ts` use 1.4.1's test support (`createTestDatabase`, the API over
  node:http, `startWorkerProcess` for the built worker), so the digest and the plan-ready row are
  posted by the real worker path (`runJob` → handler → `chat-events.ts`).
- **Isolation.** As `scripts/verify/leaf-1.4.5.mjs`: each gate creates its own database
  (`leaf149_<gate>_<pid>_<hex>`), its own `next build` directory (`.next/verify-1.4.9-<gate>`),
  free ports, and temp directories; package builds run under a lock.
- **Negative controls.** G1/G2: the same assertions run against rows the test itself makes wrong
  (a `ui` and a `proposal_accept` change set in the window; an agent-started job) must fail. G3:
  the pre-fix `parse-people.ts` (from commit `a780706`, read with `git show`) is loaded in place of
  the fixed one and the same name assertions must fail. G4: the axe scan must report a seeded
  violation, and the "hidden at desktop" assertion must fail on a page where the button is forced
  visible.
