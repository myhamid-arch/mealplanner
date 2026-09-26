# Gates: leaf-1.1.2 Schema, repositories, change-set service

OWNS: docs/decisions/leaf-1.1.2-*.md, packages/db/drizzle.config.ts, packages/db/src/schema/**, packages/db/src/migrations/**, packages/db/src/repos/**, packages/db/src/services/changes/**, packages/db/src/services/config/**, packages/db/test/**, packages/core/src/changes/**, packages/core/src/types/**, packages/core/test/fixtures/**, scripts/verify/leaf-1.1.2.mjs

Scope: Schema, repositories, change-set service, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: migrations apply to empty Postgres 16 and re-run idempotently; introspection finds every table/column in 02-domain-model and 13-revision-r2 (meal_override, household_user.status/blocked_reason, support_grant, platform_operator, TOTP secret)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G1
  EXPECT: VERIFY leaf-1.1.2 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=825fbd3dcdca09d72b82ca7ffe898769a09148ab29b37ecd2a6d674e7ff4c642; exit=0; EXPECT=matched; output-sha256=6d3cb0beef0c9c47e9c67163cbba061e9f07d18c168e796e3f40ba06a1a718fc; output-bytes=1249; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: cross-household access through every repository throws (DM-1)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G2
  EXPECT: VERIFY leaf-1.1.2 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=8567b8337e772da74037a427ecb47a357ab9358718e723b5dad015254ee35430; exit=0; EXPECT=matched; output-sha256=689fa079826443a8144c9ec371c421406a401e17a8dade52bba7fa533f737f85; output-bytes=1053; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: for every AGT-6 op, apply then inverse restores the exact prior state on F1 and F3; protected ops are flagged (DM-6)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G3
  EXPECT: VERIFY leaf-1.1.2 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=718780399b5a99d9ff085f2c779153dc42132f01b2b1d6e71022003478d4d28f; exit=0; EXPECT=matched; output-sha256=a421887de61130270b03728bac7d8bfaf7c382a910fe29617d3f8edc33b3cb4d; output-bytes=2295; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: undo refuses with a conflict when a later change set touched the same entity
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G4
  EXPECT: VERIFY leaf-1.1.2 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=29e71c5017b4e11cd903da3a9a9609c0b32ab9699b879cf7f704fc6c40530d82; exit=0; EXPECT=matched; output-sha256=08609d12287ffe8867455bd2b3e211cf4afb665d4938f93a01d75a02b588d709; output-bytes=1022; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: last-admin invariant: the service refuses to block, remove or demote the final admin (R2-ADM-4)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G5
  EXPECT: VERIFY leaf-1.1.2 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=efc62d62caea35642b4e9c0d30cb1dc6a7b485331c42bdd38c3760920a5a6c96; exit=0; EXPECT=matched; output-sha256=2d618ef9bab3adb649ae12c0e34c85d631ed9ba6f5c99479b3297343e932c7c8; output-bytes=943; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G6: fixtures F1, F2, F3 load
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G6
  EXPECT: VERIFY leaf-1.1.2 G6 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9c8a3abdccba995f77600be0528d66cb445458f31b6ba31b39ecfe9f2293f506; exit=0; EXPECT=matched; output-sha256=80692c14e494986d96d5fef14666e327aef4afedb9fa1775e727082845e3fc5d; output-bytes=1490; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
