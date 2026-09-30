# Gates: leaf-1.2.5 Deterministic solver limit (W-4)

OWNS: docs/decisions/leaf-1.2.5-*.md, packages/core/src/planner/solver/**, packages/core/test/planner/solver/**, scripts/verify/leaf-1.2.5.mjs

Scope: Replace the per-combination wall-clock limit (PLN-5, 0.25 s) with a deterministic HiGHS work limit calibrated to the same budget, so the same seed gives the same plan whatever the machine load (PLN-11, W-4), as specified in docs/spec (see 11-build-plan.md §5 and §8 W-4).

- [x] G1: determinism under load: F1 week plans for seeds 1-3 identical across 3 idle runs and 3 runs with every CPU saturated; negative control detects a one-dish difference
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.5 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=fa4a0fc9e1efa8ac1f0edb6b9b5eca42577a089bfe9a8f6f6ac007e58b1416b1; exit=0; EXPECT=matched; output-sha256=ee917cbaf65b9d56f4470441eb600221242eb428908d76fdc099d51c37b0c6ee; output-bytes=2400; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: budget: worst day at most 4.0 s CPU and week at most 30 s wall on an idle machine (R-38, PLN-11), measured
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.5 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=27e25f6acc5d4aaa08c3ac5a656b6483619ea96396c545f47ca4dc5bb182cf6a; exit=0; EXPECT=matched; output-sha256=ba5fa3732cc0c1d60d4d7000e1e835da5e3bcb5df3a345d067a620bc9ec636ba; output-bytes=964; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: quality: seeds 1-10 median plan objective within 0.5% of the 0.25 s wall-clock baseline measured idle, SC-1 in-tolerance rate not lower
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.5 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c3b6e9b12b2d24f40f8caa6634601bbcc6991445ac0d30d6fd9efb7ba93ce74a; exit=0; EXPECT=matched; output-sha256=3cb8474e765a2c33a593eb641f9e0ad1750df288d031712d173cd012ec238c62; output-bytes=3153; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: no regression: 1.2.3 G1, G3, G4, G5 and 1.2.2 G1-G5 pass; 1.2.3 G2 reported
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.5 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9f23504b66f8e8d2589a7505266f9fa2a37f9e8dcb869381a77f4ae058347630; exit=0; EXPECT=matched; output-sha256=42c03bf44ea6d02e15df7d1684f130adaf7882d60c493b5d8dbb20d511fdcbb0; output-bytes=3496; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
