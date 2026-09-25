# leaf-1.1.1 ADR-2: TypeScript configuration and package build strategy

Status: proposed (CP1)
Requirement: ARC-1 (TypeScript 5 strict), ARC-2

## Decision
- **typescript 5.9.3** (latest 5.x; ARC-1 says TypeScript 5, and typescript-eslint 8.70.1 supports `<6.1.0`).
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes: false` (Zod/Drizzle output types conflict with it), `verbatimModuleSyntax`, `isolatedModules`, `target ES2023`, `module/moduleResolution NodeNext`, `declaration`, `sourceMap`, `skipLibCheck`.
- All packages are ESM (`"type": "module"`).
- Library packages (`core`, `db`, `ai`, `graph`, `api-contract`, `ui-tokens`) are **compiled**: `build` = `tsc -p tsconfig.json` to `dist/` with `.d.ts`; `exports` points at `dist`. Turborepo orders builds by `dependsOn: ["^build"]`. Chosen over "just-in-time" source packages because the worker runs on plain Node and must import JS.
- `typecheck` = `tsc -p tsconfig.json --noEmit` per package; depends on `^build` so cross-package types come from emitted `.d.ts`.
- `apps/web` uses `moduleResolution: Bundler`, `jsx: preserve` (Next.js requirement); `build` = `next build`.
- `apps/worker`: `build` = `tsc -p tsconfig.json` to `dist/`, run with `node dist/src/main.js`.
- One `tsconfig.json` per package (the only tsconfig 1.1.1 owns per package) includes `src` and `test`, with `rootDir: "."` and `outDir: "dist"`, so tests are typechecked by the same config. Emitted entry points are `dist/src/**`; `exports` maps `.` to `./dist/src/index.js` / `./dist/src/index.d.ts`. Emitted test files in `dist/test` are unused and ignored by Vitest (`dist` is excluded).

## Open
Blocked by SPEC-Q-1 (no compile root inside OWNS).
