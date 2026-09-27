# Gates: leaf-1.4.8 Plan follow-ups: move, substitutes, day sums

OWNS: docs/decisions/leaf-1.4.8-*.md, apps/web/app/(app)/plan/**, apps/web/app/(app)/recipes/**, apps/web/components/plan/**, apps/web/components/recipe/**, apps/web/e2e/plan.spec.ts, apps/web/app/api/v1/plan-meals/[id]/move/**, apps/web/lib/server/plan-move.ts, apps/web/test/api/plan-move.int.test.ts, apps/web/test/api/cook-sheet-flags.int.test.ts, packages/db/src/services/plans/substitute.ts, packages/db/src/services/plans/move.ts, packages/db/test/plans/**, packages/core/src/planner/targets/**, packages/core/test/planner/targets/**, scripts/verify/leaf-1.4.8.mjs

Scope: Plan follow-ups (R-58): drag and keyboard move of a meal between days (UX-4, W-5 addendum), substituted copies whose steps name the substitute (W-6), slot targets that sum to the day target on screen and in the resolver (W-7), and the "Use for <day> <slot>" recipe action deferred from 1.4.5, as specified in docs/spec (see 11-build-plan.md §5 and §8 R-58, W-6, W-7) and matching docs/mockups.

- [x] G1: move: plan_meal.move op and route; both days re-solved; occupied slot exchanges; locked meal or published day refused 409; admin only; undo via change log; drag and keyboard Move menu call it; negative control on unsolved plates
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.8 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a42f4578c6b0166c19157a15333421fa21c1ed1e9e6cf816c1007f4db43a8d20; exit=0; EXPECT=matched; output-sha256=080e733d1c984812a9b8b3ce2147965d74533a71ccd444b0a0dc8c55f937cbc2; output-bytes=3141; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: substitution step text: steps name the substitute (name or alias, whole word, case-insensitive) or carry the leading "Use X wherever Y is mentioned" note; olive oil to canola oil; negative control against the pre-fix replaced()
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.8 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=654477050bdaee5368c5a94811afcabb464e7de40937f709944889ecc889c613; exit=0; EXPECT=matched; output-sha256=b5b2f7b2a73ca014a6507fb95f39c45622a7e7b3409e6c301a58e7e438d90b88; output-bytes=1351; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: day sums: F1 slot kcal targets sum exactly to the day target for every member and day kind; Plan and Plate show the resolver's day target; the 2146 vs 2150 case reproduced then fixed; negative control on the pre-fix code
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.8 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9735f0099a8c28c33ae13a5caf6b952688a6fc6d87039adc77ff7c128224d0f0; exit=0; EXPECT=matched; output-sha256=e716dd1f605afe940e1e2dff0d7e365250b993d9bed21f7876dc888c1d0dc3c0; output-bytes=1786; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: "Use for <day> <slot>" on the recipe page calls planMeals.swap; excluded or infeasible dishes refused with the reason shown
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.8 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9fd6c12cfae4a7223d2c2996525d0f14536904e2fac9baf1b36bc984319ac044; exit=0; EXPECT=matched; output-sha256=a903f7c8ab6f5e21814ec08a0e61afa205e72dc8842b63c687af36a73207ae92; output-bytes=1357; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: Playwright at 390 px and 1280 px plus axe-core (no serious/critical) for drag, Move menu, substituted cook sheet and the Use-for action; 1.4.4 G1-G3 still pass
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G5
  EXPECT: VERIFY leaf-1.4.8 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ac2b5a9ad65d36784e5685891783fc08f4a8fa3813b1cb994ed93648b13fce01; exit=0; EXPECT=matched; output-sha256=ee8c7feaa8cd6167a3915633853f84631e6071afcd96de8370e81b47acb0ebb4; output-bytes=1575; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G6: architect visual review against the Plan mockups and the substituted cook sheet
  EVIDENCE: pending
