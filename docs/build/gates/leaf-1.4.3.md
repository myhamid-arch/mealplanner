# Gates: leaf-1.4.3 Onboarding, Family, Settings, detail levels

OWNS: docs/decisions/leaf-1.4.3-*.md, apps/web/app/(setup)/onboarding/**, apps/web/app/(app)/family/**, apps/web/app/(app)/settings/page.tsx, apps/web/app/(app)/settings/planning/**, apps/web/app/(app)/settings/schedule/**, apps/web/app/(app)/settings/detail-levels/**, apps/web/app/api/v1/detail-levels/route.ts, apps/web/lib/server/detail-levels.ts, apps/web/test/api/detail-levels.int.test.ts, apps/web/components/config/**, apps/web/components/detail-level/**, packages/core/src/onboarding/**, packages/core/test/onboarding/**, apps/web/e2e/config.spec.ts, scripts/verify/leaf-1.4.3.mjs

Scope: Onboarding, Family, Settings, detail levels, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: Playwright at 390 and 1280 px: 5-question onboarding to first plan, family edits, settings (matches mockups)
  CHECK: node scripts/verify/leaf-1.4.3.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.3 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=e1a341a2c2f2517c0df8eeedac75783aff35b89cefb7885a328c219b46c56248; exit=0; EXPECT=matched; output-sha256=e09b282f209898eafd79907f5f7d2e9583fd005905ff88ac075aa44b247959e1; output-bytes=1311; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.3.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.3 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=6f1698c508f858fe77f91963f2ae23ae4c5ab60c32dd85a73454ad66148b6c19; exit=0; EXPECT=matched; output-sha256=a0f47ec426252379b959ad482774a3e5558014560d5a87c2a39b35037c4cd2a0; output-bytes=1042; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: R2-DL: auto tags visible, per-value override and back-to-auto, keep/reset prompt when lowering level
  CHECK: node scripts/verify/leaf-1.4.3.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.3 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=44cdb66bcae666e39993e5da66256ff85af5b1fc0bbb976e57f80b9ddf0ec034; exit=0; EXPECT=matched; output-sha256=ea8c63df896a766a5630f918966d14db3330c818a314832ddb9b150c74122ab0; output-bytes=2355; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: inferSetup golden tests: F1 answers produce exactly the F1 configuration; sesame expands via flags; free-text parse stubbed (R2-ONB-3)
  CHECK: node scripts/verify/leaf-1.4.3.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.3 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=40f34e5dc4c413846b081589cfa173fcfe5bdabca42e6637c975a707d4b20834; exit=0; EXPECT=matched; output-sha256=29ed7afc26f0557961c18cfee212e8361fee924a00de02cd28c2d1395d0ad9ef; output-bytes=1166; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: SC-6 at most 5 required answers to the first plan and SC-7 every review-screen Adjust link resolves
  CHECK: node scripts/verify/leaf-1.4.3.mjs --gate G5
  EXPECT: VERIFY leaf-1.4.3 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=84afb387dc80b9169c5ba002d5bacb35ad1e7c8528bc27b6447044225bd0eaec; exit=0; EXPECT=matched; output-sha256=54e65a8731699c6f80a06a60701e8e7042dd1decef07d4977d9a210c36401e13; output-bytes=1313; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G6: architect visual review against Onboarding, DetailLevels, MemberSimple, MemberDetailed, ScheduleGrid, PlanningBalance, TastesDesktop mockups
  EVIDENCE: pending
