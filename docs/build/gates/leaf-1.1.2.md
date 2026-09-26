# Gates: leaf-1.1.2 Schema, repositories, change-set service

OWNS: docs/decisions/leaf-1.1.2-*.md, packages/db/drizzle.config.ts, packages/db/src/schema/**, packages/db/src/migrations/**, packages/db/src/repos/**, packages/db/src/services/changes/**, packages/db/src/services/config/**, packages/db/test/**, packages/core/src/changes/**, packages/core/src/types/**, packages/core/test/fixtures/**, scripts/verify/leaf-1.1.2.mjs

Scope: Schema, repositories, change-set service, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: migrations apply to empty Postgres 16 and re-run idempotently; introspection finds every table/column in 02-domain-model and 13-revision-r2 (meal_override, household_user.status/blocked_reason, support_grant, platform_operator, TOTP secret)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G1
  EXPECT: VERIFY leaf-1.1.2 G1 PASSED
  EVIDENCE: pending

- [ ] G2: cross-household access through every repository throws (DM-1)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G2
  EXPECT: VERIFY leaf-1.1.2 G2 PASSED
  EVIDENCE: pending

- [ ] G3: for every AGT-6 op, apply then inverse restores the exact prior state on F1 and F3; protected ops are flagged (DM-6)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G3
  EXPECT: VERIFY leaf-1.1.2 G3 PASSED
  EVIDENCE: pending

- [ ] G4: undo refuses with a conflict when a later change set touched the same entity
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G4
  EXPECT: VERIFY leaf-1.1.2 G4 PASSED
  EVIDENCE: pending

- [ ] G5: last-admin invariant: the service refuses to block, remove or demote the final admin (R2-ADM-4)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G5
  EXPECT: VERIFY leaf-1.1.2 G5 PASSED
  EVIDENCE: pending

- [ ] G6: fixtures F1, F2, F3 load
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G6
  EXPECT: VERIFY leaf-1.1.2 G6 PASSED
  EVIDENCE: pending
