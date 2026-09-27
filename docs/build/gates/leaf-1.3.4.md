# Gates: leaf-1.3.4 Knowledge graph

OWNS: docs/decisions/leaf-1.3.4-*.md, packages/graph/**, scripts/kg-rebuild.ts, scripts/verify/leaf-1.3.4.mjs

Scope: Knowledge graph, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: full rebuild equals incremental sync (KG-3)
  CHECK: node scripts/verify/leaf-1.3.4.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.4 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=cec02da2db7937fd495b47cd220c2c066465c6808aecf4228cf10d30c77e9a4a; exit=0; EXPECT=matched; output-sha256=f6832dee8c0b6d42c8d0931aedd88126015ab8b18c3643cf26ba04a83b649cd5; output-bytes=2337; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: similarDishes ranks a hand-built near-duplicate first; substitutes respect household exclusions (KG-4)
  CHECK: node scripts/verify/leaf-1.3.4.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.4 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f48fc84c1527c7fe6fcaa0fcfbad2109b90196598cec8febf93e9e2a1881670d; exit=0; EXPECT=matched; output-sha256=48dbb84ce349c2312c0295e913b9f41ba0d7187f37824e36f3770a6cc62e07ac; output-bytes=2575; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: no household-scoped edge visible to another household (KG-2)
  CHECK: node scripts/verify/leaf-1.3.4.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.4 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9f25171a67ef73f1c55f6d54d90f1b6fbb28fe6b747c244f8b3b2ad4d784e3da; exit=0; EXPECT=matched; output-sha256=64b1fd6ddf43c068bc3aa764a8c0ff76806c2474b853724a53e1d7407cd0327c; output-bytes=1623; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
