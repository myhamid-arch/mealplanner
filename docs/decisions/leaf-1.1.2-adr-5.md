# leaf-1.1.2 ADR-5: tests, database provisioning and the verify script

Status: accepted (CP1 APPROVED with amendments; built for CP2)
Requirement: G1–G6, leaf-1.1.1 ADR-4 (unit/integration split), BLD-4 (negative controls)

## Decision

- Tests follow leaf-1.1.1 ADR-4: `packages/db/test/**/*.int.test.ts` need a database; `packages/core/test/**` and pure `packages/db/test/**/*.test.ts` do not. Vitest 5.0.2 from CLI flags, no config file (BLD-8 R-5).
- Each integration test file creates its own database (`CREATE DATABASE mp_test_<uuid>` on the server named by `DATABASE_URL`), runs `runMigrations`, and drops it afterwards, so files are independent and CI's single `postgres:16` service is enough.
- `scripts/verify/leaf-1.1.2.mjs --gate G<n>`:
  - uses `DATABASE_URL` if set; otherwise `postgres://postgres@localhost:5432/postgres` if it answers; otherwise it starts a throwaway PostgreSQL 16 cluster (as the `postgres` user via `runuser` when run as root) from `pg_config --bindir` (or `/usr/lib/postgresql/16/bin`) with `initdb`/`pg_ctl` on a free port under a temp dir and stops it on exit. It asserts `SHOW server_version` is 16.x either way;
  - builds `@mealplanner/core` and `@mealplanner/db`, then runs the gate's test files with `vitest run --reporter=json` and asserts from the JSON report that every named test ran (none skipped or todo) and passed, and that the expected test names are present, so an emptied file cannot pass;
  - reuses `scripts/verify/lib/report.mjs` and `run.mjs` by import (not modified).
- **Negative controls.** Each gate runs its assertion on a known-bad input, which must fail:
  - G1: a migrated database with `household_user.blocked_reason` and `support_grant` dropped fails introspection; a committed migration with that column removed builds a database that differs from the schema and fails introspection; a schema edit without a migration makes `drizzle-kit generate` add a file.
  - G2: a repository without household filtering (test code) leaks every table's `get`, and the isolation check reports each one.
  - G3: a write outside `ChangeTx` (a direct UPDATE) is not restored and the exact-state comparison reports it; a lying protected flag for `member.archive` is reported by the flag check.
  - G4: an undo without the conflict check (test code applying the stored inverse directly) loses the later change, and the property check reports it.
  - G5: the same demote/block/remove attempts through `ChangeTx` without the invariant take away the last admin, and the check reports each breach.
  - G6: a fixture with an unknown cuisine or a dangling member reference is rejected with nothing written; a schema-invalid fixture is rejected; and the fixture-comparison check reports a household whose targets differ from its fixture.
- The verify script also measures coverage from the built packages: G2 requires a passing cross-household test for every name in `REPOSITORY_NAMES`, and G3 a passing apply → inverse test on F1 and on F3 for every kind in `PUBLIC_OPS`.
- Mutation check run in this session: disabling the repository's cross-household throw, the undo conflict check, the last-admin assertion, or before-image recording for updates makes G2, G4, G5 and G3 print `FAILED` respectively.
