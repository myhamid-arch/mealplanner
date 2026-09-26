# Gates: leaf-1.4.4 Today, Plan, Plate, Recipes, Kitchen screens

OWNS: docs/decisions/leaf-1.4.4-*.md, apps/web/app/page.tsx, apps/web/app/(app)/today/**, apps/web/app/(app)/plan/**, apps/web/app/(app)/recipes/**, apps/web/app/(app)/kitchen/**, apps/web/components/plan/**, apps/web/components/recipe/**, apps/web/e2e/plan.spec.ts, scripts/verify/leaf-1.4.4.mjs

Scope: Today, Plan, Plate, Recipes, Kitchen screens, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: Playwright at 390 and 1280 px: plan week, swap, lock, one-off shared/individual override, cook sheet print view
  CHECK: node scripts/verify/leaf-1.4.4.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.4 G1 PASSED
  EVIDENCE: pending

- [ ] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.4.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.4 G2 PASSED
  EVIDENCE: pending

- [ ] G3: kitchen flag ingredient-unavailable triggers substitution and plate re-solve visible to admins (R2-UX-1)
  CHECK: node scripts/verify/leaf-1.4.4.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.4 G3 PASSED
  EVIDENCE: pending

- [ ] G4: architect visual review against TodayPhone, TodayDesktop, PlatePhone, WeekPlan, SwapDialog, RecipeLibrary, RecipePage, CookSheet mockups
  EVIDENCE: pending
