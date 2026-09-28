# Gates: leaf-1.2.5 Deterministic solver limit (W-4)

OWNS: docs/decisions/leaf-1.2.5-*.md, packages/core/src/planner/solver/**, packages/core/test/planner/solver/**, scripts/verify/leaf-1.2.5.mjs

Scope: Replace the per-combination wall-clock limit (PLN-5, 0.25 s) with a deterministic HiGHS work limit calibrated to the same budget, so the same seed gives the same plan whatever the machine load (PLN-11, W-4), as specified in docs/spec (see 11-build-plan.md §5 and §8 W-4).

- [x] G1: determinism under load: F1 week plans for seeds 1-3 identical across 3 idle runs and 3 runs with every CPU saturated; negative control detects a one-dish difference
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.5 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=fa4a0fc9e1efa8ac1f0edb6b9b5eca42577a089bfe9a8f6f6ac007e58b1416b1; exit=0; EXPECT=matched; output-sha256=60d09480ee67c4f2ba63aaecb5cdec3c3213894feeb897df06db2239c84f4f04; output-bytes=2400; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: budget: worst day at most 4.0 s CPU and week at most 30 s wall on an idle machine (R-38, PLN-11), measured
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.5 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=27e25f6acc5d4aaa08c3ac5a656b6483619ea96396c545f47ca4dc5bb182cf6a; exit=0; EXPECT=matched; output-sha256=d0523c2d23998f3d1dfb0b3bfd32fd3fcf0dec97353131b2bc153bbeabc3be5e; output-bytes=964; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: quality: seeds 1-10 median plan objective within 0.5% of the 0.25 s wall-clock baseline measured idle, SC-1 in-tolerance rate not lower
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.5 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c3b6e9b12b2d24f40f8caa6634601bbcc6991445ac0d30d6fd9efb7ba93ce74a; exit=0; EXPECT=matched; output-sha256=83520fd24111e6b79cb8283cb33aa88e25598803b19c38117b08fac350c0c804; output-bytes=3154; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: no regression: 1.2.3 G1, G3, G4, G5 and 1.2.2 G1-G5 pass; 1.2.3 G2 reported
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.5 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9f23504b66f8e8d2589a7505266f9fa2a37f9e8dcb869381a77f4ae058347630; exit=0; EXPECT=matched; output-sha256=2a56b7fb38147ac8d36c789c96ad86a8486d3eb7d79c98b1d2d1e96a0709c13d; output-bytes=3494; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
