# Gates: leaf-1.4.1 API, auth, worker, SSE

OWNS: docs/decisions/leaf-1.4.1-*.md, apps/web/Dockerfile, apps/worker/Dockerfile, apps/web/app/api/**, apps/web/lib/server/**, apps/web/lib/auth/**, apps/worker/src/**, packages/api-contract/src/**, packages/db/src/services/plans/**, apps/web/test/api/**, scripts/verify/leaf-1.4.1.mjs

Scope: API, auth, worker, SSE, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: every endpoint has a contract test and an authorisation-matrix test including cross-household denial (ARC-5, ARC-6)
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.1 G1 PASSED
  EVIDENCE: pending

- [ ] G2: a plan job runs in the worker and streams progress over SSE to a test client (ARC-7)
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.1 G2 PASSED
  EVIDENCE: pending

- [ ] G3: OpenAPI document generated and valid
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.1 G3 PASSED
  EVIDENCE: pending

- [ ] G4: block revokes all sessions immediately (next request 401); invites single-use with expiry; TOTP enforced when required (R2-ADM)
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.1 G4 PASSED
  EVIDENCE: pending

- [ ] G5: platform endpoints refuse household data without an active support grant, and each access is logged (R2-ADM-8)
  CHECK: node scripts/verify/leaf-1.4.1.mjs --gate G5
  EXPECT: VERIFY leaf-1.4.1 G5 PASSED
  EVIDENCE: pending
