# leaf-1.3.3 ADR-3: verify script isolation

Status: proposed at CP1.

## Context

`gate-check` runs G1–G3 in parallel, so gates must not share build directories, ports, databases or temp files. Earlier verify scripts either rebuilt `dist/` for each gate (1.3.2) or built once under a lock (1.3.1).

## Decision

`scripts/verify/leaf-1.3.3.mjs --gate G<n>` does the following:

1. Creates a per-gate temp directory (`mkdtemp`), and removes it on exit.
2. Writes a Vitest config into that directory. The config aliases `@mealplanner/{core,ai,db}/<sub>` to `packages/<pkg>/src/<sub>/index.ts`, so tests run against the sources and **no `dist/` is written or read**. It runs the gate's test files with `--config <tmp>/vitest.config.mjs`, and the JSON report goes to the temp directory.
3. Type-checks `core`, `ai` and `db` with `tsc --noEmit` (no emitted files; the base config is not incremental).
4. Acquires PostgreSQL 16 for the gates that need it (G1 SC-3 end-to-end, G2), in this order:
   - `DATABASE_URL`;
   - `localhost:5432`;
   - otherwise a throwaway cluster on a free port in the gate's temp directory.

   Each test file creates its own uniquely named database (1.1.2's `createTestDatabase`), so parallel gates never share one.
5. Requires the named tests, including each gate's negative-control tests, to be present and passing. No test may be skipped or marked todo.
6. Runs an independent re-check written in the script. The script writes a check file into its temp directory, which imports the real modules through the same aliases. That check recomputes the gate's outcome from fixtures defined in the script. It also runs a negative control: the same assertion on a known-bad fixture must fail.
7. Prints `VERIFY leaf-1.3.3 G<n> PASSED` only if every assertion held.

## Consequences

No lock and no shared build output. CI still builds and tests normally through turbo.
