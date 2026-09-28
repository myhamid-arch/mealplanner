# Gates: leaf-1.2.7 Id-independent plan search

OWNS: docs/decisions/leaf-1.2.7-*.md, packages/core/src/planner/select/**, packages/core/test/planner/select/support.ts, packages/core/test/planner/select/library.ts, packages/core/test/planner/select/f1.ts, packages/core/test/planner/select/id-independence*.test.ts, packages/db/src/services/plans/load-input.ts, packages/db/test/plans/id-independence*.int.test.ts, scripts/verify/leaf-1.2.7.mjs

Scope: W-17 (R-73): the plan search keys its seeded randomness and tie-breaks on natural keys (dish slug, slot key, member order), never on surrogate ids, so the same seed gives the same plan on any freshly seeded database, as specified in docs/spec (see 04 PLN-11, 11-build-plan.md §5 and §8 W-17, R-73)

- [x] G1: id independence: F1 week seeds 1-10 planned twice in core, the second time with every surrogate id consistently remapped to fresh UUIDv7-shaped strings; mapped back, identical dish per meal, plate grams, flags and reasons; a different seed still changes the plan; negative control with today's id-keyed jitter
  CHECK: node scripts/verify/leaf-1.2.7.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.7 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3256f38e221ca13defbb42006ed89f4c1d88c02b2d40b9c4eefbd54a78a9a4ca; exit=0; EXPECT=matched; output-sha256=f4365282849db3c7b70326895fc02167271bf2e85bac0906c6e1a17686405b01; output-bytes=2961; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: job path: plan.generate F1 week seed 1 on two separately seeded databases (each migrated, seeded and loaded from zero) persists identical (date, slot key, member name, dish slug, plate grams, flags) rows; negative control reports a one-dish difference
  CHECK: node scripts/verify/leaf-1.2.7.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.7 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a78aab6e492e0f4f3f892fd8d6729a809025a8f6457e4c158d49eecd86620daa; exit=0; EXPECT=matched; output-sha256=47a13a06074fbe97de0a912bf6b095d556a6a6934b7f6b041ec84150e07c1f5b; output-bytes=3598; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: no regression, measured: 1.2.3 G1 G3-G5, 1.2.5 G1-G4, 1.2.6 G1-G2 and 1.4.10 G1 pass; SC-2 over seeds 1-10 measured on the new code (median >= 8 %, every seed >= 0 %); SC-1 in-tolerance rate and frequency-relaxed count printed beside the pre-fix figures
  CHECK: node scripts/verify/leaf-1.2.7.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.7 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=df1b5cf8e018078bd577cf273345a1b6439ae269bcfec403580ef4b619835691; exit=0; EXPECT=matched; output-sha256=bff3e521e68297c37d18168fc17a7f80a3227a1c2a3cff5c705e9976f5e69509; output-bytes=2500; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
