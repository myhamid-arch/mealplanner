# leaf-1.1.1 ADR-4: test runners and the unit/integration split

Status: accepted (CP1 APPROVED; built for CP2)
Requirement: ARC-1 (Vitest, Playwright), G3

## Decision
- **vitest 5.0.2** (root devDependency), **@playwright/test 1.63.0** (`apps/web` devDependency; Chromium is preinstalled in CI images via `playwright install --with-deps chromium` only in the e2e job of later leaves).
- File convention: `*.test.ts` = unit (no I/O, no database); `*.int.test.ts` = integration (needs `DATABASE_URL`).
- Per-package scripts:
  - `test:unit` = `vitest run --dir test --passWithNoTests --exclude "**/*.int.test.ts"`
  - `test:integration` = `vitest run --dir test --passWithNoTests .int.test.`
  - `--dir test` keeps Vitest out of `dist/test` (tests are compiled by `build`). In this session, a sample `a.test.ts` / `b.int.test.ts` pair ran only in its own script.
- Root: `pnpm test:unit` / `pnpm test:integration` = `turbo run ...`; integration runs with `--concurrency=1` because packages share one database.
- Empty suites: `--passWithNoTests` until node-1.1 (BLD-8 R-3).
- `apps/web` has `test:e2e` = `playwright test`. Its config file belongs to 1.4.2 (BLD-8 R-5), so the script is not run in CI yet.
- Turborepo runs in strict env mode, and `test:integration` declares `DATABASE_URL` so the variable reaches Vitest.
