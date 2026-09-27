# Gates: leaf-1.4.4 Today, Plan, Plate, Recipes, Kitchen screens

OWNS: docs/decisions/leaf-1.4.4-*.md, apps/web/app/page.tsx, apps/web/app/(app)/today/**, apps/web/app/(app)/plan/**, apps/web/app/(app)/recipes/**, apps/web/app/(app)/kitchen/**, apps/web/components/plan/**, apps/web/components/recipe/**, apps/web/e2e/plan.spec.ts, scripts/verify/leaf-1.4.4.mjs, apps/web/lib/server/kitchen-flags.ts, apps/web/test/api/cook-sheet-flags.int.test.ts, apps/web/app/api/v1/plans/[date]/publish/route.ts, apps/web/app/api/v1/plan-meals/[id]/status/route.ts, apps/web/test/api/plan-status.int.test.ts

Scope: Today, Plan, Plate, Recipes, Kitchen screens, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: Playwright at 390 and 1280 px: plan week, swap, lock, one-off shared/individual override, cook sheet print view
  CHECK: node scripts/verify/leaf-1.4.4.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.4 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b0558a4b3208bbd56a74603b930685e9d85097095116384d5c91c89428058a11; exit=0; EXPECT=matched; output-sha256=5fc8ab874f64cb4efe25be5a5b7be283f5b8d9d5f1e21bb0eef264f5be067161; output-bytes=4754; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.4.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.4 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=7b88bc2420abc2deea8ed0b8a96fe523d00694dffa0a3f334f949039b8018b45; exit=0; EXPECT=matched; output-sha256=6cd2261b696ed85aeafa10eb23ab103bd4c7f61b5eb48c5cd4c03dbd47dc9005; output-bytes=1163; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: kitchen flag ingredient-unavailable triggers substitution and plate re-solve visible to admins (R2-UX-1)
  CHECK: node scripts/verify/leaf-1.4.4.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.4 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=41e4818fb430501a41263c00008598a51a4d331ee1077d45afb44fd02c3f4639; exit=0; EXPECT=matched; output-sha256=936bbc862bb5c958c56a3207c01a7f5eca2acdecbfd1b79748685063656b76d9; output-bytes=1553; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G4: architect visual review against TodayPhone, TodayDesktop, PlatePhone, WeekPlan, SwapDialog, RecipeLibrary, RecipePage, CookSheet mockups
  EVIDENCE: pending
