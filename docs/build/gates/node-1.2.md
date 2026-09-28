# Gates: node-1.2 Engine integration

Scope: integrate children leaf-1.2.1, leaf-1.2.2, leaf-1.2.3, leaf-1.2.4, leaf-1.2.5, leaf-1.2.6 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 1800 docs/build/gates/leaf-1.2.1.md docs/build/gates/leaf-1.2.2.md docs/build/gates/leaf-1.2.3.md docs/build/gates/leaf-1.2.4.md docs/build/gates/leaf-1.2.5.md docs/build/gates/leaf-1.2.6.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=c703132d4e80eedfcd7594875b983575cf6098d75bb0d3d1f109f4be37e1344d; exit=0; EXPECT=matched; output-sha256=1ada8f57f40386c5d0a9b7813b9daf28c187c0060a3906494641018b64a65956; output-bytes=25639; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

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
