# Gates: node-1.3 Intelligence integration

Scope: integrate children leaf-1.3.1, leaf-1.3.2, leaf-1.3.3, leaf-1.3.4, leaf-1.3.5 into one verified result

- [ ] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --reverify --jobs 1 docs/build/gates/leaf-1.3.1.md docs/build/gates/leaf-1.3.2.md docs/build/gates/leaf-1.3.3.md docs/build/gates/leaf-1.3.4.md docs/build/gates/leaf-1.3.5.md
  EXPECT: ALL MET
  EVIDENCE: pending

- [ ] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.3.mjs --gate N2
  EXPECT: VERIFY node-1.3 N2 PASSED
  EVIDENCE: pending

- [ ] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.3.mjs --gate N3
  EXPECT: VERIFY node-1.3 N3 PASSED
  EVIDENCE: pending

- [ ] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.3.mjs --gate N4
  EXPECT: VERIFY node-1.3 N4 PASSED
  EVIDENCE: pending

- [ ] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: pending
