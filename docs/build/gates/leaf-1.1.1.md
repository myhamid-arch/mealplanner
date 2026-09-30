# Gates: leaf-1.1.1 Monorepo, tooling, CI

OWNS: docs/decisions/leaf-1.1.1-*.md, package.json, pnpm-workspace.yaml, pnpm-lock.yaml, turbo.json, tsconfig.base.json, eslint.config.mjs, .prettierrc, .github/workflows/**, packages/*/src/index.ts, apps/worker/src/main.ts, apps/web/app/layout.tsx, apps/web/app/page.tsx, docker-compose.yml, .env.example, scripts/verify/lib/**, scripts/verify/leaf-1.1.1.mjs, apps/*/package.json, packages/*/package.json, packages/*/tsconfig.json, apps/*/tsconfig.json

Scope: Monorepo, tooling, CI, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: pnpm install --frozen-lockfile and pnpm -r build succeed on Node 22 (ARC-1, ARC-2)
  CHECK: node scripts/verify/leaf-1.1.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.1.1 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=29f99ef3309c0a6ad6cef486f4f0717d0bb67f14a6ad72cc4ff6af7f88a99aac; exit=0; EXPECT=matched; output-sha256=c3cb94c17f188c18384734fd795b91024f5d099f79c56aad3d1b6660733d0794; output-bytes=4466; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: pnpm lint and pnpm typecheck pass; the ARC-3 boundary rule rejects a deliberately illegal import fixture (negative control)
  CHECK: node scripts/verify/leaf-1.1.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.1.1 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=938345fc1b02a68e973a716cb3c22a935ae19cba17cf859b7655d2f93882c4da; exit=0; EXPECT=matched; output-sha256=64237719dcbfc95a92bbe94dd1e2c16afb75966ec86fb84c7967243552f6024b; output-bytes=4256; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: CI workflow runs lint, typecheck, unit and integration tests against a postgres:16 service
  EVIDENCE: architect review 2026-09-26: ci.yml runs frozen install, format, lint, typecheck, build, unit and integration against a postgres:16 service with a server_version=16 assertion; actions SHA-pinned; green on 0a1d160 https://github.com/myhamid-arch/mealplanner/actions/runs/36229437748
