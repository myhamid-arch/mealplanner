# Gates: leaf-1.2.6 Owner rulings: repeat gaps, slot-scoped exclusions

OWNS: docs/decisions/leaf-1.2.6-*.md, packages/core/src/planner/select/config.ts, packages/core/src/planner/select/filters.ts, packages/core/test/planner/select/frequency*.test.ts, packages/core/test/planner/select/exclusion-scope*.test.ts, scripts/verify/leaf-1.2.3.mjs, packages/db/src/schema/feedback.ts, packages/db/src/migrations/0007_*, packages/db/src/migrations/meta/0007_snapshot.json, packages/core/src/onboarding/followups/**, packages/core/test/onboarding/followups/**, packages/db/test/exclusion-scope.int.test.ts, scripts/verify/leaf-1.2.6.mjs

Scope: The owner's answers to OQ-8 and OQ-9 (R-62): main meals repeat a dish only after 6 full days in between and snacks and workout meals after 3; SC-2 re-set to a median of 8 % over seeds 1-10 with no seed below 5 %; exclusions gain an optional slot scope, and a nut-free school excludes nuts from school lunch boxes only, as specified in docs/spec (see 01 SC-2, 02 §6, 04 §6.3, 12 OQ-8 and OQ-9, 11-build-plan.md §5 and §8 R-62).

- [ ] G1: repeat gaps: day difference below 7 blocked in main slots, below 4 in snack and workout slots; frequency_rule keeps days-apart meaning; boundary tests; F1 seeds 1-10 have no violation outside frequency_relaxed meals; negative control with the old 6-day rule
  CHECK: node scripts/verify/leaf-1.2.6.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.6 G1 PASSED
  EVIDENCE: pending

- [ ] G2: SC-2 as re-set: 1.2.3 G2 (median >= 8 %, every seed >= 5 %, measured) passes; 1.2.3 G1/G3/G4/G5, 1.2.2 G1-G5 and 1.2.5 G1-G4 pass; SC-1 reported
  CHECK: node scripts/verify/leaf-1.2.6.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.6 G2 PASSED
  EVIDENCE: pending

- [ ] G3: slot-scoped exclusions: exclusion.slot_keys (migration 0007), applied only in those slots, allergy never scoped, op and change log carry the scope; 1.1.2 G1-G6 pass; negative controls (nut dish refused in the packed school lunch and allowed at dinner; scoped allergy rejected)
  CHECK: node scripts/verify/leaf-1.2.6.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.6 G3 PASSED
  EVIDENCE: pending

- [ ] G4: nut-free school follow-up writes packed_school_lunch-scoped contains_nuts exclusions per school child with the lunch-box copy; settled once all have it; 1.4.7 G1-G4 pass
  CHECK: node scripts/verify/leaf-1.2.6.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.6 G4 PASSED
  EVIDENCE: pending
