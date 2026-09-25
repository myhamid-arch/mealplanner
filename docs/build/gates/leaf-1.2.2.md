# Gates: leaf-1.2.2 Target resolver and portion solver

OWNS: docs/decisions/leaf-1.2.2-*.md, packages/core/src/planner/targets/**, packages/core/src/planner/solver/**, packages/core/test/planner/solver/**, packages/core/test/planner/targets/**, scripts/verify/leaf-1.2.2.mjs

Scope: Target resolver and portion solver, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: F1 week: per-slot targets sum to daily targets within 1 g; training slots appear only for the training member (PLN-4)
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.2 G1 PASSED
  EVIDENCE: pending

- [ ] G2: 200 known-feasible cases are all in_tolerance on the step grid; 50 known-infeasible cases are infeasible in strict and flexible_miss in flexible (PLN-5, PLN-8)
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.2 G2 PASSED
  EVIDENCE: pending

- [ ] G3: infeasible-without-adjusters cases become feasible with at most 2 adjusters; excluded adjusters never used (PLN-6)
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.2 G3 PASSED
  EVIDENCE: pending

- [ ] G4: no component outside [min,max]; median ratio deviation at most 25% on the seed library
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.2 G4 PASSED
  EVIDENCE: pending

- [ ] G5: p95 solve time at most 150 ms per plate
  CHECK: node scripts/verify/leaf-1.2.2.mjs --gate G5
  EXPECT: VERIFY leaf-1.2.2 G5 PASSED
  EVIDENCE: pending
