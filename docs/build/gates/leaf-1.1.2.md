# Gates: leaf-1.1.2 Schema, repositories, change-set service

OWNS: docs/decisions/leaf-1.1.2-*.md, packages/db/drizzle.config.ts, packages/db/src/schema/**, packages/db/src/migrations/**, packages/db/src/repos/**, packages/db/src/services/changes/**, packages/db/src/services/config/**, packages/db/test/**, packages/core/src/changes/**, packages/core/src/types/**, packages/core/test/fixtures/**, scripts/verify/leaf-1.1.2.mjs

Scope: Schema, repositories, change-set service, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: migrations apply to empty Postgres 16 and re-run idempotently; introspection finds every table/column in 02-domain-model and 13-revision-r2 (meal_override, household_user.status/blocked_reason, support_grant, platform_operator, TOTP secret)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G1
  EXPECT: VERIFY leaf-1.1.2 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=825fbd3dcdca09d72b82ca7ffe898769a09148ab29b37ecd2a6d674e7ff4c642; exit=0; EXPECT=matched; output-sha256=358a922f31279cdd994715a0d1f0da813e407e398b1b5f00522fc05f4b76b76f; output-bytes=1252; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: cross-household access through every repository throws (DM-1)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G2
  EXPECT: VERIFY leaf-1.1.2 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=8567b8337e772da74037a427ecb47a357ab9358718e723b5dad015254ee35430; exit=0; EXPECT=matched; output-sha256=8ce2bba524c66f511956a863f7ddb60af626412cf369150cd383549f27890b13; output-bytes=1056; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: for every AGT-6 op, apply then inverse restores the exact prior state on F1 and F3; protected ops are flagged (DM-6)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G3
  EXPECT: VERIFY leaf-1.1.2 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=718780399b5a99d9ff085f2c779153dc42132f01b2b1d6e71022003478d4d28f; exit=0; EXPECT=matched; output-sha256=f4a95d6323d81207ac9d81f5ef631674f08ecfac18cfbbb718f04417f9d09859; output-bytes=2458; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: undo refuses with a conflict when a later change set touched the same entity
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G4
  EXPECT: VERIFY leaf-1.1.2 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=29e71c5017b4e11cd903da3a9a9609c0b32ab9699b879cf7f704fc6c40530d82; exit=0; EXPECT=matched; output-sha256=ee0391e77f08a8e2cb0e3b932a9d61090ca3c7ad5c02a94ff4b929476e8918f4; output-bytes=1025; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: last-admin invariant: the service refuses to block, remove or demote the final admin (R2-ADM-4)
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G5
  EXPECT: VERIFY leaf-1.1.2 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=efc62d62caea35642b4e9c0d30cb1dc6a7b485331c42bdd38c3760920a5a6c96; exit=0; EXPECT=matched; output-sha256=05b12363da32ea1b607416399010c388ec5aee26e66cf40b0696399b2d5972a8; output-bytes=946; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G6: fixtures F1, F2, F3 load
  CHECK: node scripts/verify/leaf-1.1.2.mjs --gate G6
  EXPECT: VERIFY leaf-1.1.2 G6 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9c8a3abdccba995f77600be0528d66cb445458f31b6ba31b39ecfe9f2293f506; exit=0; EXPECT=matched; output-sha256=c0ac1b2ce107e8ab2f576dcbb9f2eb75d9ab665857cce972b21913a6c2302c24; output-bytes=1493; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
