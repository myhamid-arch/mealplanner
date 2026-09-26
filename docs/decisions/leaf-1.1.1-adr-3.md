# leaf-1.1.1 ADR-3: ESLint, Prettier and the ARC-3 boundary rule

Status: accepted (CP1 APPROVED; built for CP2)
Requirement: ARC-1 (ESLint typescript-eslint strict + Prettier), ARC-3

## Decision
- **eslint 10.11.0**, **@eslint/js 10.0.1**, **typescript-eslint 8.70.1** (`strictTypeChecked` preset), **eslint-config-prettier 10.1.8**, **prettier 3.9.9**. One flat config at the root (`eslint.config.mjs`); `pnpm lint` = `eslint .` run once over the whole repo.
- Boundary rule: **eslint-plugin-boundaries 7.2.0** (one of the two tools ARC-3 names), rule `boundaries/dependencies` with `default: "allow"`, `checkAllOrigins: true` and one `disallow` policy per element listing every internal element outside its allow-list. Element types: `core`, `db`, `graph`, `ai`, `api-contract`, `ui-tokens`, `app` (`apps/*`).
- Each policy matches both forms of an internal import:
  - resolved local files (element selector), which covers relative paths such as `../../db/src/index.js` and `@mealplanner/*` once built;
  - `@mealplanner/<pkg>` module sources (module selector), which covers imports of packages that are not built yet (resolved as external).
- **eslint-import-resolver-typescript 4.4.5** (root devDependency) is required: with the plugin's default Node resolver, `.js` specifiers that point at `.ts` sources do not resolve, and a relative cross-package import went unreported in this session. This is the one tool dependency beyond the ARC-1 list. It exists only to make the ARC-3 rule work.
- A specifier such as `@mealplanner/core/../db` would dodge both selectors. `no-restricted-imports` forbids `..` segments in `@mealplanner/*` specifiers everywhere.
- Allowed internal edges (strict reading of ARC-3, see SPEC-Q-2):

| from | may import |
|---|---|
| core | nothing internal |
| db, graph, ai | core |
| api-contract | core |
| ui-tokens | nothing internal |
| app (apps/*) | any package |

  Packages may never import `apps/*`.
- "core does no I/O": inside `packages/core/**`, `no-restricted-imports` forbids Node I/O builtins (`fs`, `net`, `http`, `https`, `child_process`, `dgram`, `dns`, `tls`, `worker_threads`, with and without `node:`) and DB/HTTP clients (`pg`, `pg-boss`, `drizzle-orm`, `@anthropic-ai/sdk`).
- Manifest check: the G2 verify script also asserts that no `package.json` declares a `workspace:*` dependency that the matrix forbids.

## Formatting scope
`pnpm format` / `pnpm format:check` cover `apps/**`, `packages/**`, `scripts/**`, `.github/workflows/**` and the root config files, excluding build output and `pnpm-lock.yaml`. Vendored `.claude/**`, `docs/**` and the PR template are not formatted: they are not owned by any code leaf, and 110 files under `.claude/`, `docs/` and the PR template fail `prettier --check` as committed (measured in this session).

## Verification
G2 writes probe files at real package paths inside a disposable, freshly installed copy of the workspace and lints them in one ESLint run under the real config. Stdin probes are not usable: the typed-lint project service rejects files that are not on disk. Results:
- each illegal edge must produce the expected error (negative control);
- each legal edge must lint clean (positive control), so a rule that rejects everything cannot pass;
- `pnpm lint` on the copy must pass with the probes removed and fail once one illegal import is added.
