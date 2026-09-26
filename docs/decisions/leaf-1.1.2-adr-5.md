# leaf-1.1.2 ADR-5: tests, database provisioning and the verify script

Status: proposed (CP1)
Requirement: G1–G6, leaf-1.1.1 ADR-4 (unit/integration split), BLD-4 (negative controls)

## Decision
- Tests follow leaf-1.1.1 ADR-4: `packages/db/test/**/*.int.test.ts` need a database; `packages/core/test/**` and pure `packages/db/test/**/*.test.ts` do not. Vitest 5.0.2 from CLI flags, no config file (BLD-8 R-5).
- Each integration test file creates its own database (`CREATE DATABASE mp_test_<uuid>` on the server named by `DATABASE_URL`), runs `runMigrations`, and drops it afterwards, so files are independent and CI's single `postgres:16` service is enough.
- `scripts/verify/leaf-1.1.2.mjs --gate G<n>`:
  - uses `DATABASE_URL` if set; otherwise it starts a throwaway PostgreSQL 16 cluster from `pg_config --bindir` (or `/usr/lib/postgresql/16/bin`) with `initdb`/`pg_ctl` on a free port under a temp dir and stops it on exit. It asserts `SHOW server_version` is 16.x either way;
  - builds `@mealplanner/core` and `@mealplanner/db`, then runs the gate's test files with `vitest run --reporter=json` and asserts from the JSON report that every named test ran (none skipped or todo) and passed, and that the expected test names are present, so an emptied file cannot pass;
  - reuses `scripts/verify/lib/report.mjs` and `run.mjs` by import (not modified).
- **Negative controls.** Each gate has a bad fixture run through the same assertion function, which must fail:
  - G1: a migrated database with one spec column dropped (and one with an extra missing table) fails introspection; a schema edit without a migration fails the drift check.
  - G2: a repository built with its household filter removed (test-only wrapper) fails the cross-household suite.
  - G3: an op whose apply writes a row outside `ChangeTx` (bypassing the before-image log) fails the restore-equality check; an unflagged protected op fails the protected-flag check.
  - G4: undo with the conflict check disabled (test-only service variant) lets a conflicting undo through, and the assertion catches it.
  - G5: a change set that demotes the last admin with the invariant check removed commits, and the assertion catches it.
  - G6: a fixture with a dangling member reference and one failing Zod validation are both rejected by the loader.
