# Gates: leaf-1.2.7 Id-independent plan search

OWNS: docs/decisions/leaf-1.2.7-*.md, packages/core/src/planner/select/**, packages/core/test/planner/select/support.ts, packages/core/test/planner/select/library.ts, packages/core/test/planner/select/f1.ts, packages/core/test/planner/select/id-independence*.test.ts, packages/db/src/services/plans/load-input.ts, packages/db/test/plans/id-independence*.int.test.ts, scripts/verify/leaf-1.2.7.mjs

Scope: W-17 (R-73): the plan search keys its seeded randomness and tie-breaks on natural keys (dish slug, slot key, member order), never on surrogate ids, so the same seed gives the same plan on any freshly seeded database, as specified in docs/spec (see 04 PLN-11, 11-build-plan.md §5 and §8 W-17, R-73)

- [x] G1: id independence: F1 week seeds 1-10 planned twice in core, the second time with every surrogate id consistently remapped to fresh UUIDv7-shaped strings; mapped back, identical dish per meal, plate grams, flags and reasons; a different seed still changes the plan; negative control with today's id-keyed jitter
  CHECK: node scripts/verify/leaf-1.2.7.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.7 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3256f38e221ca13defbb42006ed89f4c1d88c02b2d40b9c4eefbd54a78a9a4ca; exit=0; EXPECT=matched; output-sha256=52d863ae463810e1c3edd709cfec56b8d696c29156c6eb74e37e7c89f5ff0c40; output-bytes=2961; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: job path: plan.generate F1 week seed 1 on two separately seeded databases (each migrated, seeded and loaded from zero) persists identical (date, slot key, member name, dish slug, plate grams, flags) rows; negative control reports a one-dish difference
  CHECK: node scripts/verify/leaf-1.2.7.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.7 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a78aab6e492e0f4f3f892fd8d6729a809025a8f6457e4c158d49eecd86620daa; exit=0; EXPECT=matched; output-sha256=b13167a56b1f41788a7890026992cbdd9f05a081cf996192162b36ddb5167bb1; output-bytes=3599; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: no regression, measured: 1.2.3 G1 G3-G5, 1.2.5 G1-G4, 1.2.6 G1-G2 and 1.4.10 G1 pass; SC-2 over seeds 1-10 measured on the new code (median >= 8 %, every seed >= 0 %); SC-1 in-tolerance rate and frequency-relaxed count printed beside the pre-fix figures
  CHECK: node scripts/verify/leaf-1.2.7.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.7 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=df1b5cf8e018078bd577cf273345a1b6439ae269bcfec403580ef4b619835691; exit=0; EXPECT=matched; output-sha256=8d79b0ee4e9f9efe34fac107fc73b39981038e7273312a4e8187e6646933f730; output-bytes=2498; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
