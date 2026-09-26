# Gates: leaf-1.2.3 Dish scoring, plan search, cook sheet

OWNS: docs/decisions/leaf-1.2.3-*.md, packages/core/src/planner/select/**, packages/core/src/planner/cooksheet/**, packages/core/src/planner/index.ts, packages/core/test/planner/select/**, scripts/verify/leaf-1.2.3.mjs

Scope: Dish scoring, plan search, cook sheet, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: SC-1: F1 7-day plan with seed library and AI off has 100% targeted member-meals in tolerance or flagged with reason (measured)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.3 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=98e8beb4acd97c272126722ff86c9c6b232efbf940fc2d7cd5dc267a862e51e3; exit=0; EXPECT=matched; output-sha256=994a60b8fd3d69e5afb183268a4119161e5708060208c480d1d16932a8a0dfb7; output-bytes=2197; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G2: SC-2: distinct ingredients with economy 0.4 vs 0 drop by at least 25% (measured, not asserted from a constant)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.3 G2 PASSED
  EVIDENCE: pending

- [x] G3: C3 sesame never appears in any C3 plate across 50 seeded plans; removing the exclusion makes it appear (negative control)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.3 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c6ec9f26e8b69614436cb841b0209ff6b0f0e31a440ab22244dff191f7b77911; exit=0; EXPECT=matched; output-sha256=fc7888fa61bb5ecf75f3166a82630758df3eedbc81bc4775f4b5e4d5a937c6bc; output-bytes=727; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: same seed gives identical plan; week at most 30 s, day at most 5 s (PLN-11)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.3 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=74e117842326cdef2f6dfe557a516fde64b271d898b9b9a80c388bd1391d04fb; exit=0; EXPECT=matched; output-sha256=aead80e16b5481ec2dc915f6edd251118fdf4c80f25c38711f5abb9eb09a264f; output-bytes=983; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: cook sheet raw totals equal the sum of plate raw equivalents and the plating table covers every attendee (PLN-14)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G5
  EXPECT: VERIFY leaf-1.2.3 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ea6eb42b49bd6606bab13e5bb18efedc865151aea62ab07cd7d9d49f59c9da5a; exit=0; EXPECT=matched; output-sha256=4d9b95981e600a5c6ed05bcf65d27fd5f4edd1d8e73bd257bd4b2af8f40f002a; output-bytes=748; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G6: meal_override split_member and make_individual are honoured (R2-MEAL-2)
  CHECK: node scripts/verify/leaf-1.2.3.mjs --gate G6
  EXPECT: VERIFY leaf-1.2.3 G6 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=618f8d1596ee96c0d12b55f8d79e4ec51a3d9641320ae4ca24f8b08ed6eb23be; exit=0; EXPECT=matched; output-sha256=24359741d019920818b25671b721d17f742fe486336f8cf9c412986f8eecc08c; output-bytes=842; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
