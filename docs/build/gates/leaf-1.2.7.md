# Gates: leaf-1.2.7 Id-independent plan search

OWNS: docs/decisions/leaf-1.2.7-*.md, packages/core/src/planner/select/**, packages/core/test/planner/select/support.ts, packages/core/test/planner/select/library.ts, packages/core/test/planner/select/f1.ts, packages/core/test/planner/select/id-independence*.test.ts, packages/db/src/services/plans/load-input.ts, packages/db/test/plans/id-independence*.int.test.ts, scripts/verify/leaf-1.2.7.mjs

Scope: W-17 (R-73): the plan search keys its seeded randomness and tie-breaks on natural keys (dish slug, slot key, member order), never on surrogate ids, so the same seed gives the same plan on any freshly seeded database, as specified in docs/spec (see 04 PLN-11, 11-build-plan.md §5 and §8 W-17, R-73)

- [ ] G1: id independence: F1 week seeds 1-10 planned twice in core, the second time with every surrogate id consistently remapped to fresh UUIDv7-shaped strings; mapped back, identical dish per meal, plate grams, flags and reasons; a different seed still changes the plan; negative control with today's id-keyed jitter
  CHECK: node scripts/verify/leaf-1.2.7.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.7 G1 PASSED
  EVIDENCE: pending

- [ ] G2: job path: plan.generate F1 week seed 1 on two separately seeded databases (each migrated, seeded and loaded from zero) persists identical (date, slot key, member name, dish slug, plate grams, flags) rows; negative control reports a one-dish difference
  CHECK: node scripts/verify/leaf-1.2.7.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.7 G2 PASSED
  EVIDENCE: pending

- [ ] G3: no regression, measured: 1.2.3 G1 G3-G5, 1.2.5 G1-G4, 1.2.6 G1-G2 and 1.4.10 G1 pass; SC-2 over seeds 1-10 measured on the new code (median >= 8 %, every seed >= 0 %); SC-1 in-tolerance rate and frequency-relaxed count printed beside the pre-fix figures
  CHECK: node scripts/verify/leaf-1.2.7.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.7 G3 PASSED
  EVIDENCE: pending
