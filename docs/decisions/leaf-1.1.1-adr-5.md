# leaf-1.1.1 ADR-5: CI workflow

Status: proposed (CP1)
Requirement: G3

## Decision
`.github/workflows/ci.yml`, on `push` and `pull_request`:
- one job on `ubuntu-24.04`, `services.postgres` = `postgres:16` with `pg_isready` health check, port 5432;
- steps: checkout → pnpm (version from `packageManager`) → setup-node 22 with pnpm cache → `pnpm install --frozen-lockfile` → `pnpm format:check` → `pnpm lint` → `pnpm typecheck` → `pnpm build` → `pnpm test:unit` → `pnpm test:integration` with `DATABASE_URL=postgres://postgres:postgres@localhost:5432/mealplanner_test`;
- third-party actions pinned to full commit SHAs (tag in a trailing comment);
- `permissions: contents: read`, `concurrency` cancels superseded runs on the same ref.
