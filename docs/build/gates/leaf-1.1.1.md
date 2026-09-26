# Gates: leaf-1.1.1 Monorepo, tooling, CI

OWNS: docs/decisions/leaf-1.1.1-*.md, package.json, pnpm-workspace.yaml, pnpm-lock.yaml, turbo.json, tsconfig.base.json, eslint.config.mjs, .prettierrc, .github/workflows/**, packages/*/src/index.ts, apps/worker/src/main.ts, apps/web/app/layout.tsx, apps/web/app/page.tsx, docker-compose.yml, .env.example, scripts/verify/lib/**, scripts/verify/leaf-1.1.1.mjs, apps/*/package.json, packages/*/package.json, packages/*/tsconfig.json, apps/*/tsconfig.json

Scope: Monorepo, tooling, CI, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: pnpm install --frozen-lockfile and pnpm -r build succeed on Node 22 (ARC-1, ARC-2)
  CHECK: node scripts/verify/leaf-1.1.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.1.1 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=29f99ef3309c0a6ad6cef486f4f0717d0bb67f14a6ad72cc4ff6af7f88a99aac; exit=0; EXPECT=matched; output-sha256=cc86c005e38487b8e6dd43959b995c39088217584b7390fe6bf0b243c899c17a; output-bytes=4466; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: pnpm lint and pnpm typecheck pass; the ARC-3 boundary rule rejects a deliberately illegal import fixture (negative control)
  CHECK: node scripts/verify/leaf-1.1.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.1.1 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=938345fc1b02a68e973a716cb3c22a935ae19cba17cf859b7655d2f93882c4da; exit=0; EXPECT=matched; output-sha256=ce46185b58f3d21a87427657efe7ae36ead45c41efa31686eb69096bd90c4894; output-bytes=4211; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G3: CI workflow runs lint, typecheck, unit and integration tests against a postgres:16 service
  EVIDENCE: pending
