# Gates: leaf-1.2.3 Dish scoring, plan search, cook sheet

OWNS: docs/decisions/leaf-1.2.3-*.md, packages/core/src/planner/select/**, packages/core/src/planner/cooksheet/**, packages/core/src/planner/solver/**, packages/core/test/planner/solver/**, packages/core/src/planner/index.ts, packages/core/test/planner/select/**, scripts/verify/leaf-1.2.3.mjs

Scope: Dish scoring, plan search, cook sheet, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: SC-1: F1 7-day plan with seed library and AI off has 100% targeted member-meals in tolerance or flagged with reason (measured)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.3 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=98e8beb4acd97c272126722ff86c9c6b232efbf940fc2d7cd5dc267a862e51e3; exit=0; EXPECT=matched; output-sha256=6dba33e9e702a68d52889e601ef7dcdc8f0594c33d0d8d344ff43aab6e3d6156; output-bytes=2084; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: SC-2 (OQ-8, R-62): distinct core ingredients with economy 0.4 vs 0 drop by a median of at least 8% over seeds 1-10, no seed below 0% (measured, not asserted from a constant)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.3 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=497f8deece633142cbbddbd25746ea70f64ced7427b5b71d126a2eebca9c9d28; exit=0; EXPECT=matched; output-sha256=3b7a8c1e9b0f761367a6428efeddd0f8e22492caccf83252c54128b7719138b2; output-bytes=1825; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: C3 sesame never appears in any C3 plate across 50 seeded plans; removing the exclusion makes it appear (negative control)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.3 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c6ec9f26e8b69614436cb841b0209ff6b0f0e31a440ab22244dff191f7b77911; exit=0; EXPECT=matched; output-sha256=1766840f1f2d6273a7c3ad9e9f98764f4565f33664124d2a8e22b62a618e283f; output-bytes=728; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: same seed gives identical plan; week at most 30 s, day at most 5 s (PLN-11)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.3 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=74e117842326cdef2f6dfe557a516fde64b271d898b9b9a80c388bd1391d04fb; exit=0; EXPECT=matched; output-sha256=2252c028a197d92da0a470c36f32a1f7e26cbeeb8afc16aaaf28ca1189874f5b; output-bytes=1162; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: cook sheet raw totals equal the sum of plate raw equivalents and the plating table covers every attendee (PLN-14)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G5
  EXPECT: VERIFY leaf-1.2.3 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ea6eb42b49bd6606bab13e5bb18efedc865151aea62ab07cd7d9d49f59c9da5a; exit=0; EXPECT=matched; output-sha256=9370e1d55cd8951aa0c69bfa9e4b214d55ad3c21642c51a7e973e175a320a8e2; output-bytes=749; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G6: meal_override split_member and make_individual are honoured (R2-MEAL-2)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G6
  EXPECT: VERIFY leaf-1.2.3 G6 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=618f8d1596ee96c0d12b55f8d79e4ec51a3d9641320ae4ca24f8b08ed6eb23be; exit=0; EXPECT=matched; output-sha256=1c95cd3904d50baefa26164303f07b68ceec073f8f96794d4a48d4adcd046b88; output-bytes=846; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
