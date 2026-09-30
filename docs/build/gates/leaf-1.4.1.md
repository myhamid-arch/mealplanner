# Gates: leaf-1.4.1 API, auth, worker, SSE

OWNS: docs/decisions/leaf-1.4.1-*.md, apps/web/Dockerfile, apps/worker/Dockerfile, apps/web/app/api/**, apps/web/lib/server/**, apps/web/lib/auth/**, apps/web/app/(shell)/_shell/viewer.ts, apps/worker/src/**, packages/api-contract/src/**, packages/db/src/services/plans/**, packages/db/src/seed/**, apps/web/test/api/**, scripts/verify/leaf-1.4.1.mjs, packages/db/src/schema/jobs.ts, packages/db/src/schema/tenancy.ts, packages/db/src/schema/index.ts, packages/db/src/migrations/0004_jobs_support_access.sql, packages/db/src/migrations/meta/**, packages/db/src/repos/tables.ts, packages/db/src/repos/entity-types.ts, packages/core/src/types/entities.ts, packages/db/test/spec-columns.ts, packages/db/test/support/populate.ts, packages/db/test/support/op-samples.ts, packages/core/src/changes/ops/recipes.ts, packages/core/src/changes/registry.ts, packages/core/src/changes/define.ts, packages/core/src/learning/rules/config.ts, packages/core/test/learning/rules/rules.test.ts, docker-compose.yml, .env.example, packages/core/test/planner/targets/config.ts, packages/db/test/changes.int.test.ts, scripts/verify/leaf-1.3.3.mjs, packages/db/test/migrations.int.test.ts

Scope: API, auth, worker, SSE, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: every endpoint has a contract test and an authorisation-matrix test including cross-household denial (ARC-5, ARC-6)
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.1 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=18666222dcb1d6c12046cffe7ad0ad31b15b201c9321e8432241f741c1c26f11; exit=0; EXPECT=matched; output-sha256=85f1660b2b37a54ff8e19850b541b8c1c7104f2111775891cd6d7fc62d8a2227; output-bytes=3178; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: a plan job runs in the worker and streams progress over SSE to a test client (ARC-7)
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.1 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=d3cbf8d120eaf3246897d77f0239ff95ecaf2be31604b9180ee03fefeaadca37; exit=0; EXPECT=matched; output-sha256=678fe54f444dffe940c2174a7450d94c5026ad0f4a10668eb665e4dd86ca5e7d; output-bytes=4720; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: OpenAPI document generated and valid
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.1 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=74255a58a0a14257647dd81e0a3bae0ec0f1d9ba25c1b687d48af4000545aa5d; exit=0; EXPECT=matched; output-sha256=8caeb3c7df62c45adc0599367a0d452ea83e4868a949e278cc9c5e0da62c2f8c; output-bytes=1554; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: block revokes all sessions immediately (next request 401); invites single-use with expiry; TOTP enforced when required (R2-ADM)
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.1 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c8f7f2995d5f417e1c1b45dc53ad1189125fa1f3e46ee7c83b113703f5e4e965; exit=0; EXPECT=matched; output-sha256=5a9f7616a160d0508006943007caa9b366f3e4351c7eef8d1e9a9f6140c6261d; output-bytes=3675; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: platform endpoints refuse household data without an active support grant, and each access is logged (R2-ADM-8)
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G5
  EXPECT: VERIFY leaf-1.4.1 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=56850e8142218b7681be8d2094c65423ed37b41d772fa47ef856499b19260a9e; exit=0; EXPECT=matched; output-sha256=48967da5460d4c1dba13fdafded03ce0986cdeb21964e5ae043f9885dbcfeee2; output-bytes=1645; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
