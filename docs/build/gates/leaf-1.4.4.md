# Gates: leaf-1.4.4 Today, Plan, Plate, Recipes, Kitchen screens

OWNS: docs/decisions/leaf-1.4.4-*.md, apps/web/app/page.tsx, apps/web/app/(app)/today/**, apps/web/app/(app)/plan/**, apps/web/app/(app)/recipes/**, apps/web/app/(app)/kitchen/**, apps/web/components/plan/**, apps/web/components/recipe/**, apps/web/e2e/plan.spec.ts, scripts/verify/leaf-1.4.4.mjs, apps/web/lib/server/kitchen-flags.ts, apps/web/test/api/cook-sheet-flags.int.test.ts, apps/web/app/api/v1/plans/[date]/publish/route.ts, apps/web/app/api/v1/plan-meals/[id]/status/route.ts, apps/web/test/api/plan-status.int.test.ts

Scope: Today, Plan, Plate, Recipes, Kitchen screens, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: Playwright at 390 and 1280 px: plan week, swap, lock, one-off shared/individual override, cook sheet print view
  CHECK: node scripts/verify/leaf-1.4.4.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.4 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b0558a4b3208bbd56a74603b930685e9d85097095116384d5c91c89428058a11; exit=0; EXPECT=matched; output-sha256=434dc5fdef8068d89db1486a0454e14dac1720ca258398109e118587f3ff70dd; output-bytes=4756; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.4.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.4 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=7b88bc2420abc2deea8ed0b8a96fe523d00694dffa0a3f334f949039b8018b45; exit=0; EXPECT=matched; output-sha256=afe171ac13d74e1261110a862c1cb661137d6b0887fca762558341aaaebbcb0d; output-bytes=1165; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: kitchen flag ingredient-unavailable triggers substitution and plate re-solve visible to admins (R2-UX-1)
  CHECK: node scripts/verify/leaf-1.4.4.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.4 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=41e4818fb430501a41263c00008598a51a4d331ee1077d45afb44fd02c3f4639; exit=0; EXPECT=matched; output-sha256=dd02b0bac3a78681eca831d4a61f10445551db8ed3f3923d69eaf88430e8785a; output-bytes=1555; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: architect visual review against TodayPhone, TodayDesktop, PlatePhone, WeekPlan, SwapDialog, RecipeLibrary, RecipePage, CookSheet mockups
  EVIDENCE: architect review 2026-09-27 at 6ca9f1c (TodayDesktop, WeekPlan, CookSheet, TodayPhone rendered from docs/mockups beside the builder's 390/1280 px captures): layouts match with the recorded deviations 1-7; findings (day target was the sum of slot targets, 2146 vs 2150; training-day header untested) fixed in 32e661c and re-checked at 478a284 (G1 fails with dayProfile's day-kind lookup removed); G1-G3 re-pass on the merge with base cec4044
