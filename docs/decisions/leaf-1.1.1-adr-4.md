# leaf-1.1.1 ADR-4: test runners and the unit/integration split

Status: proposed (CP1)
Requirement: ARC-1 (Vitest, Playwright), G3

## Decision
- **vitest 5.0.2** (root devDependency), **@playwright/test 1.63.0** (`apps/web` devDependency; Chromium is preinstalled in CI images via `playwright install --with-deps chromium` only in the e2e job of later leaves).
- File convention: `*.test.ts` = unit (no I/O, no database); `*.int.test.ts` = integration (needs `DATABASE_URL`).
- Per-package scripts:
  - `test:unit` = `vitest run --exclude "**/*.int.test.ts"`
  - `test:integration` = `vitest run .int.test.`
- Root: `pnpm test:unit` / `pnpm test:integration` = `turbo run ...`; integration runs with `--concurrency=1` because packages share one database.
- Empty suites: see SPEC-Q-4 (`--passWithNoTests`).
