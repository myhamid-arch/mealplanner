# Gates: leaf-1.2.2 Target resolver and portion solver

OWNS: docs/decisions/leaf-1.2.2-*.md, packages/core/src/planner/targets/**, packages/core/src/planner/solver/**, packages/core/test/planner/solver/**, packages/core/test/planner/targets/**, scripts/verify/leaf-1.2.2.mjs

Scope: Target resolver and portion solver, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: F1 week: per-slot targets sum to daily targets within 1 g; training slots appear only for the training member (PLN-4)
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.2 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5830c5cf0bc34c22340c9704c81e72d58c37adee791930bf493e56d6679b6ba6; exit=0; EXPECT=matched; output-sha256=132380a1ce2fd735d86519df0d0c84bde463acf7840e05bdd0b996251cc00036; output-bytes=1113; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: 200 known-feasible cases are all in_tolerance on the step grid; 50 known-infeasible cases are infeasible in strict and flexible_miss in flexible (PLN-5, PLN-8)
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.2 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f025a993e6c33aebc6c5199254f26d205bdf09572c99261520b21529451689d8; exit=0; EXPECT=matched; output-sha256=cf06c5b9702fcb9a0a54ad94445dbb0ce1b0bd1ca6d02b9de5066c0826e560c9; output-bytes=1287; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: infeasible-without-adjusters cases become feasible with at most 2 adjusters; excluded adjusters never used (PLN-6)
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.2 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9e3dcde07c84998bafeeb54a0d5e0f0040e014b309f3f0087a4bee779d90bcd1; exit=0; EXPECT=matched; output-sha256=ac245481d47af308086a7da62c562e02e26980f6fc92daa4e74e7dd92da75c4f; output-bytes=587; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: no component outside [min,max]; median ratio deviation at most 25% on this leaf's own test dish set of at least 20 multi-component dishes (the seed-library check is 1.2.4 G6)
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.2 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=72cb02af4427ff7d8526cb9507399019fd61064611ec07ba41bdb661597f92bf; exit=0; EXPECT=matched; output-sha256=5ecca79b24ef25c6d75297825605263cb3d44ca4414a38246330686d8f89d669; output-bytes=672; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: p95 solve time at most 150 ms per plate
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G5
  EXPECT: VERIFY leaf-1.2.2 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=8f032d294889c62083ec573b287bae269b0083abc91fea365747b03e6e9bec1f; exit=0; EXPECT=matched; output-sha256=c837acf3353a45e71ae3179684066f60bfeb5b4346d319743f03b8cd8ebb2c0b; output-bytes=399; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
