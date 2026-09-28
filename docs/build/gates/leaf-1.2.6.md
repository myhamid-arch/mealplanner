# Gates: leaf-1.2.6 Owner rulings: repeat gaps, slot-scoped exclusions

OWNS: docs/decisions/leaf-1.2.6-*.md, packages/core/src/planner/select/config.ts, packages/core/src/planner/select/filters.ts, packages/core/test/planner/select/frequency*.test.ts, packages/core/test/planner/select/exclusion-scope*.test.ts, scripts/verify/leaf-1.2.3.mjs, packages/db/src/schema/feedback.ts, packages/db/src/migrations/0007_*, packages/db/src/migrations/meta/0007_snapshot.json, packages/core/src/onboarding/followups/**, packages/core/test/onboarding/followups/**, packages/db/test/exclusion-scope.int.test.ts, scripts/verify/leaf-1.2.6.mjs

Scope: The owner's answers to OQ-8 and OQ-9 (R-62): main meals repeat a dish only after 6 full days in between and snacks and workout meals after 3; SC-2 re-set to a median of 8 % over seeds 1-10 with no seed below 5 %; exclusions gain an optional slot scope, and a nut-free school excludes nuts from school lunch boxes only, as specified in docs/spec (see 01 SC-2, 02 §6, 04 §6.3, 12 OQ-8 and OQ-9, 11-build-plan.md §5 and §8 R-62).

- [x] G1: repeat gaps: day difference below 7 blocked in main slots, below 4 in snack and workout slots; frequency_rule keeps days-apart meaning; boundary tests; F1 seeds 1-10 have no violation outside frequency_relaxed meals; negative control with the old 6-day rule
  CHECK: node scripts/verify/leaf-1.2.6.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.6 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a3294e51f9bca0169921242e9b165a920fc1222c2a874d0967524cf35be66e31; exit=0; EXPECT=matched; output-sha256=b7e8d5543123af2d40b5249c2db96c5c14401c6b4e3e7321e1320af803a6d57f; output-bytes=1794; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: SC-2 as re-set: 1.2.3 G2 (median >= 8 %, every seed >= 0 %, measured; R-63) passes; 1.2.3 G1/G3/G4/G5, 1.2.2 G1-G5 and 1.2.5 G1-G4 pass; SC-1 reported
  CHECK: node scripts/verify/leaf-1.2.6.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.6 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=8ae6fbd3f054e0d03f25b03bbb5750efb7aad4e1f5b7c6bb693c269b55b8c5ad; exit=0; EXPECT=matched; output-sha256=2cad9ef12b34a57ed26454870d8d3a56fdb945dacd12a9dfc39e83f92693d474; output-bytes=1346; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: slot-scoped exclusions: exclusion.slot_keys (migration 0007), applied only in those slots, allergy never scoped, op and change log carry the scope; 1.1.2 G1-G6 pass; negative controls (nut dish refused in the packed school lunch and allowed at dinner; scoped allergy rejected)
  CHECK: node scripts/verify/leaf-1.2.6.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.6 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=eaff28050129050a652133153cba2588a35033c6cf5b6010b99f047d7feab541; exit=0; EXPECT=matched; output-sha256=b532577d54c55a6b38ee8aa35c3f3b07bc5fb8f4d1609d908982f0a7498a2404; output-bytes=1302; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: nut-free school follow-up writes packed_school_lunch-scoped contains_nuts exclusions per school child with the lunch-box copy; settled once all have it; 1.4.7 G1-G4 pass
  CHECK: node scripts/verify/leaf-1.2.6.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.6 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=578dc13e051f537d39fbb64e42eaaa33a8efe915928b2c6c0254272ad5dae201; exit=0; EXPECT=matched; output-sha256=6d9605a3bdb017ca88f04bebd161c300546f262192bc3c26916018b90c7d6151; output-bytes=796; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
