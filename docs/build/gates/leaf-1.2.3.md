# Gates: leaf-1.2.3 Dish scoring, plan search, cook sheet

OWNS: docs/decisions/leaf-1.2.3-*.md, packages/core/src/planner/select/**, packages/core/src/planner/cooksheet/**, packages/core/src/planner/solver/**, packages/core/test/planner/solver/**, packages/core/src/planner/index.ts, packages/core/test/planner/select/**, scripts/verify/leaf-1.2.3.mjs

Scope: Dish scoring, plan search, cook sheet, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: SC-1: F1 7-day plan with seed library and AI off has 100% targeted member-meals in tolerance or flagged with reason (measured)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.3 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=98e8beb4acd97c272126722ff86c9c6b232efbf940fc2d7cd5dc267a862e51e3; exit=0; EXPECT=matched; output-sha256=9615229c8672aa2211da5b19b9618cdeb186b46aaf56061f9e875dcba6360b56; output-bytes=2080; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: SC-2 (OQ-8, R-62): distinct core ingredients with economy 0.4 vs 0 drop by a median of at least 8% over seeds 1-10, no seed below 0% (measured, not asserted from a constant)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.3 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=497f8deece633142cbbddbd25746ea70f64ced7427b5b71d126a2eebca9c9d28; exit=0; EXPECT=matched; output-sha256=8588469bc161de934904647f66a0093f618f0903ea5ac7db5c069be6f3e3a834; output-bytes=1811; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: C3 sesame never appears in any C3 plate across 50 seeded plans; removing the exclusion makes it appear (negative control)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.3 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c6ec9f26e8b69614436cb841b0209ff6b0f0e31a440ab22244dff191f7b77911; exit=0; EXPECT=matched; output-sha256=ba3fbb0f30ac08fe4462c765f11884e2fb7ba99632b9f832890ae569d12ec55f; output-bytes=738; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: same seed gives identical plan; week at most 30 s, day at most 5 s (PLN-11)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.3 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=74e117842326cdef2f6dfe557a516fde64b271d898b9b9a80c388bd1391d04fb; exit=0; EXPECT=matched; output-sha256=7596cab6bed2fe2c02dfcd9884d6459330fdaa1af1357693154fee0c59e95783; output-bytes=1160; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: cook sheet raw totals equal the sum of plate raw equivalents and the plating table covers every attendee (PLN-14)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G5
  EXPECT: VERIFY leaf-1.2.3 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ea6eb42b49bd6606bab13e5bb18efedc865151aea62ab07cd7d9d49f59c9da5a; exit=0; EXPECT=matched; output-sha256=97bd0e8a40fef8f2c6934126142d32bd2bb2507055a02eb4ce93ce50fa167b66; output-bytes=748; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G6: meal_override split_member and make_individual are honoured (R2-MEAL-2)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G6
  EXPECT: VERIFY leaf-1.2.3 G6 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=618f8d1596ee96c0d12b55f8d79e4ec51a3d9641320ae4ca24f8b08ed6eb23be; exit=0; EXPECT=matched; output-sha256=55f505fb703dd8dc44d50e74fa8578452da27bca765470a58dfada7bdf767410; output-bytes=842; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
