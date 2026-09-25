# Gates: leaf-1.2.3 Dish scoring, plan search, cook sheet

OWNS: docs/decisions/leaf-1.2.3-*.md, packages/core/src/planner/select/**, packages/core/src/planner/cooksheet/**, packages/core/src/planner/index.ts, packages/core/test/planner/select/**, scripts/verify/leaf-1.2.3.mjs

Scope: Dish scoring, plan search, cook sheet, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: SC-1: F1 7-day plan with seed library and AI off has 100% targeted member-meals in tolerance or flagged with reason (measured)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.3 G1 PASSED
  EVIDENCE: pending

- [ ] G2: SC-2: distinct ingredients with economy 0.4 vs 0 drop by at least 25% (measured, not asserted from a constant)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.3 G2 PASSED
  EVIDENCE: pending

- [ ] G3: C3 sesame never appears in any C3 plate across 50 seeded plans; removing the exclusion makes it appear (negative control)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.3 G3 PASSED
  EVIDENCE: pending

- [ ] G4: same seed gives identical plan; week at most 30 s, day at most 5 s (PLN-11)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.3 G4 PASSED
  EVIDENCE: pending

- [ ] G5: cook sheet raw totals equal the sum of plate raw equivalents and the plating table covers every attendee (PLN-14)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G5
  EXPECT: VERIFY leaf-1.2.3 G5 PASSED
  EVIDENCE: pending

- [ ] G6: meal_override split_member and make_individual are honoured (R2-MEAL-2)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G6
  EXPECT: VERIFY leaf-1.2.3 G6 PASSED
  EVIDENCE: pending
