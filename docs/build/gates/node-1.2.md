# Gates: node-1.2 Engine integration

Scope: integrate children leaf-1.2.1, leaf-1.2.2, leaf-1.2.3, leaf-1.2.4, leaf-1.2.5, leaf-1.2.6, leaf-1.2.7 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 5400 docs/build/gates/leaf-1.2.1.md docs/build/gates/leaf-1.2.2.md docs/build/gates/leaf-1.2.3.md docs/build/gates/leaf-1.2.4.md docs/build/gates/leaf-1.2.5.md docs/build/gates/leaf-1.2.6.md docs/build/gates/leaf-1.2.7.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=f5111d5eac6d133b5f83fbbd7be489e05878c51a88b68e0d6392e25a3f444fe8; exit=0; EXPECT=matched; output-sha256=ddb7bd3d0440230ad6fb7d360801dd73d19196483ba45304a6153a63e6f4b673; output-bytes=32055; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.2.mjs --gate N2
  EXPECT: VERIFY node-1.2 N2 PASSED
  EVIDENCE: pending

- [ ] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.2.mjs --gate N3
  EXPECT: VERIFY node-1.2 N3 PASSED
  EVIDENCE: pending

- [ ] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.2.mjs --gate N4
  EXPECT: VERIFY node-1.2 N4 PASSED
  EVIDENCE: pending

- [ ] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: pending
