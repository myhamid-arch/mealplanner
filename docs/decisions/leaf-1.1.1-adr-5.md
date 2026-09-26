# leaf-1.1.1 ADR-5: CI workflow

Status: accepted (CP1 APPROVED; built for CP2)
Requirement: G3

## Decision
`.github/workflows/ci.yml`, on `push` and `pull_request`:
- one job on `ubuntu-24.04`, `services.postgres` = `postgres:16` with `pg_isready` health check, port 5432;
- steps: checkout → pnpm (version from `packageManager`) → setup-node 22 with pnpm cache → `pnpm install --frozen-lockfile` → `pnpm format:check` → `pnpm lint` → `pnpm typecheck` → `pnpm build` → `pnpm test:unit` → a `psql` query asserting the service reports server_version 16.x → `pnpm test:integration` with `DATABASE_URL=postgres://postgres:postgres@localhost:5432/mealplanner_test`;
- third-party actions pinned to full commit SHAs, resolved with `git ls-remote` in this session: `actions/checkout@3d3c42e5…` (v7.0.1), `pnpm/action-setup@ea17c68d…` (v6.1.0, the dereferenced commit of the annotated tag), `actions/setup-node@82076278…` (v7.0.0);
- `permissions: contents: read`, `concurrency` cancels superseded runs on the same ref.
