# Gates: leaf-1.4.8 Plan follow-ups: move, substitutes, day sums

OWNS: docs/decisions/leaf-1.4.8-*.md, apps/web/app/(app)/plan/**, apps/web/app/(app)/recipes/**, apps/web/components/plan/**, apps/web/components/recipe/**, apps/web/e2e/plan.spec.ts, apps/web/app/api/v1/plan-meals/[id]/move/**, apps/web/lib/server/plan-move.ts, apps/web/test/api/plan-move.int.test.ts, apps/web/test/api/cook-sheet-flags.int.test.ts, packages/db/src/services/plans/substitute.ts, packages/db/src/services/plans/move.ts, packages/db/test/plans/**, packages/core/src/planner/targets/**, packages/core/test/planner/targets/**, scripts/verify/leaf-1.4.8.mjs

Scope: Plan follow-ups (R-58): drag and keyboard move of a meal between days (UX-4, W-5 addendum), substituted copies whose steps name the substitute (W-6), slot targets that sum to the day target on screen and in the resolver (W-7), and the "Use for <day> <slot>" recipe action deferred from 1.4.5, as specified in docs/spec (see 11-build-plan.md §5 and §8 R-58, W-6, W-7) and matching docs/mockups.

- [x] G1: move: plan_meal.move op and route; both days re-solved; occupied slot exchanges; locked meal or published day refused 409; admin only; undo via change log; drag and keyboard Move menu call it; negative control on unsolved plates
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.8 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a42f4578c6b0166c19157a15333421fa21c1ed1e9e6cf816c1007f4db43a8d20; exit=0; EXPECT=matched; output-sha256=4ddce0bac0999db7a9e1e0b4716e198ad6cdf16317b71460d8274a9de2a93acd; output-bytes=3145; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: substitution step text: steps name the substitute (name or alias, whole word, case-insensitive) or carry the leading "Use X wherever Y is mentioned" note; olive oil to canola oil; negative control against the pre-fix replaced()
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.8 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=654477050bdaee5368c5a94811afcabb464e7de40937f709944889ecc889c613; exit=0; EXPECT=matched; output-sha256=d280d86f45176527768e71158068324be96937f965ea9a5569edd5833bc30e5c; output-bytes=1353; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: day sums: F1 slot kcal targets sum exactly to the day target for every member and day kind; Plan and Plate show the resolver's day target; the 2146 vs 2150 case reproduced then fixed; negative control on the pre-fix code
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.8 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9735f0099a8c28c33ae13a5caf6b952688a6fc6d87039adc77ff7c128224d0f0; exit=0; EXPECT=matched; output-sha256=c4f1b19fffdc7e041074fa5108468a570eac45c916625d256a0397e0d0d62da8; output-bytes=1788; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: "Use for <day> <slot>" on the recipe page calls planMeals.swap; excluded or infeasible dishes refused with the reason shown
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.8 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9fd6c12cfae4a7223d2c2996525d0f14536904e2fac9baf1b36bc984319ac044; exit=0; EXPECT=matched; output-sha256=b9b53a6d6e4e782ceef5683cd19864870dc4c849b7ef3c76e1702922c624378d; output-bytes=1361; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: Playwright at 390 px and 1280 px plus axe-core (no serious/critical) for drag, Move menu, substituted cook sheet and the Use-for action; 1.4.4 G1-G3 still pass
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G5
  EXPECT: VERIFY leaf-1.4.8 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ac2b5a9ad65d36784e5685891783fc08f4a8fa3813b1cb994ed93648b13fce01; exit=0; EXPECT=matched; output-sha256=02df22a367864b2c1c31f2207cd76afaafd49ea40c741db99f868e37564af68b; output-bytes=1577; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G6: architect visual review against the Plan mockups and the substituted cook sheet
  EVIDENCE: architect review 2026-09-27 at 1a75f88 merged onto dc61783 (builder's 390/1280 px captures: week grid mid-drag, meal sheet with Move to... and 'of N kcal today', PlatePhone with the day-kind calorie note, RecipePage Use for Wed dinner, cook sheet with the canola oil copy): matches WeekPlan, PlatePhone, RecipePage and CookSheet with the SPEC-Q-2/5/7 additions; the pre-check race (lock landing mid-move gives 422 instead of 409, nothing written) accepted; G1-G5 met twice (DATABASE_URL unset and set, --timeout 1800); mutations caught: substitutedSteps returning steps unchanged (G2, 6 assertions), occupant check removed (G1, locked occupant 409 test). Seen and recorded outside this leaf: W-12
