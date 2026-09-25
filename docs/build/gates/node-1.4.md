# Gates: node-1.4 Product integration

Scope: integrate children leaf-1.4.1, leaf-1.4.2, leaf-1.4.3, leaf-1.4.4, leaf-1.4.5, leaf-1.4.6 into one verified result

- [ ] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --reverify --jobs 1 docs/build/gates/leaf-1.4.1.md docs/build/gates/leaf-1.4.2.md docs/build/gates/leaf-1.4.3.md docs/build/gates/leaf-1.4.4.md docs/build/gates/leaf-1.4.5.md docs/build/gates/leaf-1.4.6.md
  EXPECT: ALL MET
  EVIDENCE: pending

- [ ] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.4.mjs --gate N2
  EXPECT: VERIFY node-1.4 N2 PASSED
  EVIDENCE: pending

- [ ] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.4.mjs --gate N3
  EXPECT: VERIFY node-1.4 N3 PASSED
  EVIDENCE: pending

- [ ] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.4.mjs --gate N4
  EXPECT: VERIFY node-1.4 N4 PASSED
  EVIDENCE: pending

- [ ] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: pending
