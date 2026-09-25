# leaf-1.1.1 ADR-3: ESLint, Prettier and the ARC-3 boundary rule

Status: proposed (CP1)
Requirement: ARC-1 (ESLint typescript-eslint strict + Prettier), ARC-3

## Decision
- **eslint 10.11.0**, **@eslint/js 10.0.1**, **typescript-eslint 8.70.1** (`strictTypeChecked` preset), **eslint-config-prettier 10.1.8**, **prettier 3.9.9**. One flat config at the root (`eslint.config.mjs`); `pnpm lint` = `eslint .` run once over the whole repo.
- Boundary rule: **eslint-plugin-boundaries 7.2.0** (one of the two tools ARC-3 names). Element types: `core`, `db`, `graph`, `ai`, `api-contract`, `ui-tokens`, `app`.
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

## Verification
G2 lints in-memory probe files (`eslint --stdin --stdin-filename <path>`) placed at real package paths: each illegal edge must produce a `boundaries/*` error (negative control), and each legal edge must lint clean (positive control, so a rule that rejects everything cannot pass).
