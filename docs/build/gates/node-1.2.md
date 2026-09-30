# Gates: node-1.2 Engine integration

Scope: integrate children leaf-1.2.1, leaf-1.2.2, leaf-1.2.3, leaf-1.2.4, leaf-1.2.5, leaf-1.2.6, leaf-1.2.7 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 5400 docs/build/gates/leaf-1.2.1.md docs/build/gates/leaf-1.2.2.md docs/build/gates/leaf-1.2.3.md docs/build/gates/leaf-1.2.4.md docs/build/gates/leaf-1.2.5.md docs/build/gates/leaf-1.2.6.md docs/build/gates/leaf-1.2.7.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=f5111d5eac6d133b5f83fbbd7be489e05878c51a88b68e0d6392e25a3f444fe8; exit=0; EXPECT=matched; output-sha256=99aed3991fee3fb343d649312b9684ea0a3511e07db1c8adee7c20a189d49337; output-bytes=16989; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.2.mjs --gate N2
  EXPECT: VERIFY node-1.2 N2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3ff39b8097f044fad728f19728c5c523223150e84823706dd0f1b7c5f9f5341d; exit=0; EXPECT=matched; output-sha256=e63385abf5cb7f088cbdfea5a9750c23efa92eb4bd8ca0bd5bd4e7d445d78545; output-bytes=2143; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.2.mjs --gate N3
  EXPECT: VERIFY node-1.2 N3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=54d08efc90a21bb6df4abb5e1daeef2f7006a0a7b376399f3d524e058cb69963; exit=0; EXPECT=matched; output-sha256=922032c5dba1a8dc0d5f47f7949ce1d9c7410479ca23c40c4e3e5d90905d5d2d; output-bytes=5442; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.2.mjs --gate N4
  EXPECT: VERIFY node-1.2 N4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c90059af46e722118943bcf26ef4eab693afba47d89de6104bab9e8a2038627e; exit=0; EXPECT=matched; output-sha256=8a33da03a471af638b50ba10b7ed5244625c07389b605992c43ddacad22ec9f2; output-bytes=6415; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: architect review 2026-09-29 at c77176a. Children's manual outcome 1.2.4 G5 (10 recipes, plausibility, UAE availability, steps) — data/seed-dishes unchanged since e9abe38 (git log empty). Branch level: plans changed once by 1.2.7 (W-17, id-independent search); N3 on the merged tree measured SC-1 68/68 in tolerance, 0 unflagged; OQ-8 15 same-dish pairs, 0 inside the owner's gaps (main ≥ 7, snack/workout ≥ 4); SC-2 seeds 1–10 median 13.9 %, min 9.8 % (owner: median ≥ 8 %, every seed ≥ 0 %); day-1 cook sheet within 0.002 g. Consistent with the owner's OQ-8 and SC-2 decisions.
