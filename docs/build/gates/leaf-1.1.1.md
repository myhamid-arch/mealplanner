# Gates: leaf-1.1.1 Monorepo, tooling, CI

OWNS: docs/decisions/leaf-1.1.1-*.md, package.json, pnpm-workspace.yaml, pnpm-lock.yaml, turbo.json, tsconfig.base.json, eslint.config.mjs, .prettierrc, .github/workflows/**, docker-compose.yml, .env.example, scripts/verify/lib/**, scripts/verify/leaf-1.1.1.mjs, apps/*/package.json, packages/*/package.json, packages/*/tsconfig.json, apps/*/tsconfig.json

Scope: Monorepo, tooling, CI, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: pnpm install --frozen-lockfile and pnpm -r build succeed on Node 22 (ARC-1, ARC-2)
  CHECK: node scripts/verify/leaf-1.1.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.1.1 G1 PASSED
  EVIDENCE: pending

- [ ] G2: pnpm lint and pnpm typecheck pass; the ARC-3 boundary rule rejects a deliberately illegal import fixture (negative control)
  CHECK: node scripts/verify/leaf-1.1.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.1.1 G2 PASSED
  EVIDENCE: pending

- [ ] G3: CI workflow runs lint, typecheck, unit and integration tests against a postgres:16 service
  EVIDENCE: pending
