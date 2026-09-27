# Gates: leaf-1.4.8 Plan follow-ups: move, substitutes, day sums

OWNS: docs/decisions/leaf-1.4.8-*.md, apps/web/app/(app)/plan/**, apps/web/app/(app)/recipes/**, apps/web/components/plan/**, apps/web/components/recipe/**, apps/web/e2e/plan.spec.ts, apps/web/app/api/v1/plan-meals/[id]/move/**, apps/web/lib/server/plan-move.ts, apps/web/test/api/plan-move.int.test.ts, apps/web/test/api/cook-sheet-flags.int.test.ts, packages/db/src/services/plans/substitute.ts, packages/db/src/services/plans/move.ts, packages/db/test/plans/**, packages/core/src/planner/targets/**, packages/core/test/planner/targets/**, scripts/verify/leaf-1.4.8.mjs

Scope: Plan follow-ups (R-58): drag and keyboard move of a meal between days (UX-4, W-5 addendum), substituted copies whose steps name the substitute (W-6), slot targets that sum to the day target on screen and in the resolver (W-7), and the "Use for <day> <slot>" recipe action deferred from 1.4.5, as specified in docs/spec (see 11-build-plan.md §5 and §8 R-58, W-6, W-7) and matching docs/mockups.

- [ ] G1: move: plan_meal.move op and route; both days re-solved; occupied slot exchanges; locked meal or published day refused 409; admin only; undo via change log; drag and keyboard Move menu call it; negative control on unsolved plates
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.8 G1 PASSED
  EVIDENCE: pending

- [ ] G2: substitution step text: steps name the substitute (name or alias, whole word, case-insensitive) or carry the leading "Use X wherever Y is mentioned" note; olive oil to canola oil; negative control against the pre-fix replaced()
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.8 G2 PASSED
  EVIDENCE: pending

- [ ] G3: day sums: F1 slot kcal targets sum exactly to the day target for every member and day kind; Plan and Plate show the resolver's day target; the 2146 vs 2150 case reproduced then fixed; negative control on the pre-fix code
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.8 G3 PASSED
  EVIDENCE: pending

- [ ] G4: "Use for <day> <slot>" on the recipe page calls planMeals.swap; excluded or infeasible dishes refused with the reason shown
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.8 G4 PASSED
  EVIDENCE: pending

- [ ] G5: Playwright at 390 px and 1280 px plus axe-core (no serious/critical) for drag, Move menu, substituted cook sheet and the Use-for action; 1.4.4 G1-G3 still pass
  CHECK: node scripts/verify/leaf-1.4.8.mjs --gate G5
  EXPECT: VERIFY leaf-1.4.8 G5 PASSED
  EVIDENCE: pending

- [ ] G6: architect visual review against the Plan mockups and the substituted cook sheet
  EVIDENCE: pending
