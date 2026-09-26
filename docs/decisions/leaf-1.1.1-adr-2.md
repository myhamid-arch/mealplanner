# leaf-1.1.1 ADR-2: TypeScript configuration and package build strategy

Status: accepted (CP1 APPROVED; built for CP2)
Requirement: ARC-1 (TypeScript 5 strict), ARC-2

## Decision
- **typescript 5.9.3** (latest 5.x; ARC-1 says TypeScript 5, and typescript-eslint 8.70.1 supports `<6.1.0`).
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes: false` (Zod/Drizzle output types conflict with it), `verbatimModuleSyntax`, `isolatedModules`, `target ES2023`, `module/moduleResolution NodeNext`, `declaration`, `sourceMap`, `skipLibCheck`.
- All packages are ESM (`"type": "module"`).
- Library packages (`core`, `db`, `ai`, `graph`, `api-contract`, `ui-tokens`) are **compiled**: `build` = `tsc -p tsconfig.json` to `dist/` with `.d.ts`. `exports` (BLD-8 R-1): `"."` → `./dist/src/index.js` (the empty root barrel owned by 1.1.1) and `"./*"` → `./dist/src/*/index.js`, each with a matching `types` entry, so `@mealplanner/core/nutrition` resolves to the `nutrition/index.ts` its leaf owns. Turborepo orders builds by `dependsOn: ["^build"]`. Chosen over "just-in-time" source packages because the worker runs on plain Node and must import JS.
- `typecheck` = `tsc -p tsconfig.json --noEmit` per package; depends on `^build` so cross-package types come from emitted `.d.ts`.
- `apps/web` uses `moduleResolution: Bundler`, `jsx: preserve` (Next.js requirement); `build` = `next build`.
- `apps/worker`: `build` = `tsc -p tsconfig.json` to `dist/`, run with `node dist/src/main.js`.
- One `tsconfig.json` per package (the only tsconfig 1.1.1 owns per package) includes `src` and `test`, with `rootDir: "."` and `outDir: "dist"`, so tests are typechecked by the same config. Emitted entry points are `dist/src/**`; `exports` maps `.` to `./dist/src/index.js` / `./dist/src/index.d.ts`. Emitted test files in `dist/test` are unused and ignored by Vitest (`dist` is excluded).

## Compile roots (BLD-8 R-1)
- `packages/*/src/index.ts`: `export {};` (permanent empty root barrel).
- `apps/worker/src/main.ts`: `export {};` until 1.4.1.
- `apps/web/app/layout.tsx` (html/body wrapper) and `apps/web/app/page.tsx` (`return null`) until 1.4.2 / 1.4.4.

## apps/web tsconfig
Extends the base with `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, `noEmit`, the `next` plugin and the `.next/types` includes. `next build` (16.3.6) accepts it unchanged: it did not rewrite the file in this session.
