# leaf-1.3.3 ADR-3: verify script isolation

Status: proposed at CP1.

## Context

`gate-check` runs G1–G3 in parallel, so gates must not share build directories, ports, databases or temp files. Earlier verify scripts either rebuilt `dist/` for each gate (1.3.2) or built once under a lock (1.3.1).

## Decision

`scripts/verify/leaf-1.3.3.mjs --gate G<n>` does the following:

1. Creates a per-gate temp directory (`mkdtemp`), and removes it on exit.
2. Writes a Vitest config into that directory, with `cacheDir` in that directory too. The config has two aliases:
   - `@mealplanner/{core,ai,db}/<sub>` → `packages/<pkg>/src/<sub>/index.ts`;
   - the relative `…/core/dist/test/<path>.js` imports that other leaves' test support uses → `packages/core/test/<path>.ts`.

   Tests therefore run against the sources and **no `dist/` is written or read**. This was checked by running every gate with `packages/core/dist` moved away. It runs the gate's test files with `--config <tmp>/vitest.<name>.config.mjs`, and the JSON report goes to the temp directory.
3. Runs `tsc --noEmit` through a tsconfig written in the temp directory, with `paths` that map the packages to their sources. It covers `core/src`, `ai/src`, `db/src` and this leaf's pure tests (`core/test/learning/rules`, `ai/test/insights`). The db integration tests import 1.1.2's test support, which imports built core fixtures by relative path, so `pnpm typecheck` in CI type-checks them after the build.
4. Acquires PostgreSQL 16 for the gates that need it (G1 SC-3 end-to-end, G2), in this order:
   - `DATABASE_URL`;
   - `localhost:5432`;
   - otherwise a throwaway cluster on a free port, in its own temp directory (the `postgres` user must be able to read it), which is stopped and removed on exit.

   Each test file creates its own uniquely named database (1.1.2's `createTestDatabase`), so parallel gates never share one.
5. Requires the named tests, including each gate's negative-control tests, to be present and passing. No test may be skipped or marked todo.
6. Runs an independent re-check written in the script. The script writes a check file into its temp directory, which Vitest runs with `globals`; it imports the real modules through the same aliases.
   - The check drives the modules on fixtures defined in the script and writes the raw results to JSON.
   - The script then judges those results against the spec's numbers (FBK-6/7/8, SC-3, R-33), which it writes out itself.
   - Negative control: the same judgement is run on a known-bad result (for G1, a single 1★ review; for G2, three drafts under the budget; for G3, a permissive validator's output) and must fail.
7. Prints `VERIFY leaf-1.3.3 G<n> PASSED` only if every assertion held.

## Consequences

No lock and no shared build output. CI still builds and tests normally through turbo.
