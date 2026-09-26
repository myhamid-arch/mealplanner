# leaf-1.1.1 ADR-1: pnpm workspaces + Turborepo, Node 22

Status: accepted (CP1 APPROVED; built for CP2)
Requirement: ARC-1 (monorepo), ARC-2 (layout)

## Decision
- Package manager: **pnpm 10.33.0**, pinned via root `package.json` `"packageManager": "pnpm@10.33.0"`. This is the pnpm on the build container and satisfies Corepack. pnpm 12.6.0 is the latest published version; it is not chosen because nothing in the spec needs it and the CI/runtime image already ships 10.x.
- Task runner: **turbo 2.11.4** (root devDependency). Root scripts call `turbo run <task>`.
- Runtime: **Node 22** (`engines.node: ">=22.12.0 <23"`, `engineStrict: true` in `pnpm-workspace.yaml`). Lower bound 22.12.0 is the floor required by Vitest 5.0.2 and pg-boss 12.34.0 (`npm view <pkg> engines`).
- Workspace globs: `apps/*`, `packages/*`.
- Package scope: `@mealplanner/<name>`. The product name "Mise" is a placeholder (R2-UX-6), so the repo name is used.
- All dependency specifiers are exact versions (no `^`/`~`); internal dependencies use `workspace:*`.

- pnpm 10 skips dependency lifecycle scripts by default. It reports `esbuild` (a transitive dependency of drizzle-kit and vitest) as ignored. No `onlyBuiltDependencies` allow-list is set: esbuild ships its binary as an optional platform package, and the build, lint and tests all pass without its postinstall.

## Consequences
- `pnpm install --frozen-lockfile` fails when a manifest drifts from `pnpm-lock.yaml`; G1 exercises this as its negative control.
- A later leaf that needs a new dependency asks the architect (11-build-plan §4, "Shared manifests").
