# Gates: leaf-1.2.5 Deterministic solver limit (W-4)

OWNS: docs/decisions/leaf-1.2.5-*.md, packages/core/src/planner/solver/**, packages/core/test/planner/solver/**, scripts/verify/leaf-1.2.5.mjs

Scope: Replace the per-combination wall-clock limit (PLN-5, 0.25 s) with a deterministic HiGHS work limit calibrated to the same budget, so the same seed gives the same plan whatever the machine load (PLN-11, W-4), as specified in docs/spec (see 11-build-plan.md §5 and §8 W-4).

- [ ] G1: determinism under load: F1 week plans for seeds 1-3 identical across 3 idle runs and 3 runs with every CPU saturated; negative control detects a one-dish difference
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.5 G1 PASSED
  EVIDENCE: pending

- [ ] G2: budget: worst day at most 4.0 s CPU and week at most 30 s wall on an idle machine (R-38, PLN-11), measured
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.5 G2 PASSED
  EVIDENCE: pending

- [ ] G3: quality: seeds 1-10 median plan objective within 0.5% of the 0.25 s wall-clock baseline measured idle, SC-1 in-tolerance rate not lower
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.5 G3 PASSED
  EVIDENCE: pending

- [ ] G4: no regression: 1.2.3 G1, G3, G4, G5 and 1.2.2 G1-G5 pass; 1.2.3 G2 reported
  CHECK: node scripts/verify/leaf-1.2.5.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.5 G4 PASSED
  EVIDENCE: pending
