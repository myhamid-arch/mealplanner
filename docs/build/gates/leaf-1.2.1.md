# Gates: leaf-1.2.1 Nutrition engine

OWNS: docs/decisions/leaf-1.2.1-*.md, packages/core/src/nutrition/**, packages/core/test/nutrition/**, scripts/verify/leaf-1.2.1.mjs

Scope: Nutrition engine, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: at least 15 hand-computed golden variants (grilled vs fried, breaded, boiled grain, retained-water stew, absorbed-oil cap) match within 0.5% (NUT-3)
  CHECK: node scripts/verify/leaf-1.2.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.1 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=bd54a21d069e1c492531dbf0144457cc2d867c63042bd9baefa64d3fd0bf9b15; exit=0; EXPECT=matched; output-sha256=1ecced8cd3b1d1d9337aaf585b39557dea4956c6bace721f48a7c0c7842fb4a4; output-bytes=2136; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: rawForCooked round-trips to batch totals within 0.1%
  CHECK: node scripts/verify/leaf-1.2.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.1 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=50ea6722ac56eb9d41c184ceb7ed91dca0133159c72fa8a2f9296f5705b8559b; exit=0; EXPECT=matched; output-sha256=49857d95d1682d5d1ca2da3154865851ef7314bdcd9977e4995dc1b399709a2c; output-bytes=1488; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: same raw ingredients grilled vs deep_fried give fat per 100 g cooked in the expected direction; identical methods give identical output (negative control)
  CHECK: node scripts/verify/leaf-1.2.1.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.1 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=0ffefef79771506ef23be657ae722269c2288777ad9b10bcafe1e989b4212cfb; exit=0; EXPECT=matched; output-sha256=750d02faf530c2d08b83c5a1e513c9b6fdfc3cf7ee23cb94fd1e0eb8c6e0c38b; output-bytes=1139; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: 100% line coverage of nutrition/ (NUT-1)
  CHECK: node scripts/verify/leaf-1.2.1.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.1 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=63a44719e5a720eee82c3663bd9129fc98538906cb58d541062a5408680a119d; exit=0; EXPECT=matched; output-sha256=35750038ce595266029bed909cf647d4b639fad5e43e2f696d593c2dc17e24fb; output-bytes=941; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
