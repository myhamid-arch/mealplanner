# Gates: node-1.1 Foundation integration

Scope: integrate children leaf-1.1.1, leaf-1.1.2, leaf-1.1.3 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 1800 docs/build/gates/leaf-1.1.1.md docs/build/gates/leaf-1.1.2.md docs/build/gates/leaf-1.1.3.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=f17f3f3b6df6cf9d69a29f4b75f7c8ef83d01888c0c8aa6e72b4b3c1a4decead; exit=0; EXPECT=matched; output-sha256=88ca049f892de280dfff4b50950de322bfabf298010559411644db248fe5f255; output-bytes=6630; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.1.mjs --gate N2
  EXPECT: VERIFY node-1.1 N2 PASSED
  EVIDENCE: pending

- [ ] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.1.mjs --gate N3
  EXPECT: VERIFY node-1.1 N3 PASSED
  EVIDENCE: pending

- [ ] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.1.mjs --gate N4
  EXPECT: VERIFY node-1.1 N4 PASSED
  EVIDENCE: pending

- [ ] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: pending
