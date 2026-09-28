# Gates: node-1.4 Product integration

Scope: integrate children leaf-1.4.1, leaf-1.4.2, leaf-1.4.3, leaf-1.4.4, leaf-1.4.5, leaf-1.4.6, leaf-1.4.7, leaf-1.4.8, leaf-1.4.9, leaf-1.4.10 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 1800 docs/build/gates/leaf-1.4.1.md docs/build/gates/leaf-1.4.2.md docs/build/gates/leaf-1.4.3.md docs/build/gates/leaf-1.4.4.md docs/build/gates/leaf-1.4.5.md docs/build/gates/leaf-1.4.6.md docs/build/gates/leaf-1.4.7.md docs/build/gates/leaf-1.4.8.md docs/build/gates/leaf-1.4.9.md docs/build/gates/leaf-1.4.10.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=854305a912ba8aa6f279f6de68b40faaa1d138efcea11d4690b21ec0069233a6; exit=0; EXPECT=matched; output-sha256=a995676df9e90fc98431a82760f68a16bbd52ff69128002469fecca04f508989; output-bytes=20863; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

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
