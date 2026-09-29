# Gates: node-1.4 Product integration

Scope: integrate children leaf-1.4.1, leaf-1.4.2, leaf-1.4.3, leaf-1.4.4, leaf-1.4.5, leaf-1.4.6, leaf-1.4.7, leaf-1.4.8, leaf-1.4.9, leaf-1.4.10, leaf-1.4.11 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 1800 docs/build/gates/leaf-1.4.1.md docs/build/gates/leaf-1.4.2.md docs/build/gates/leaf-1.4.3.md docs/build/gates/leaf-1.4.4.md docs/build/gates/leaf-1.4.5.md docs/build/gates/leaf-1.4.6.md docs/build/gates/leaf-1.4.7.md docs/build/gates/leaf-1.4.8.md docs/build/gates/leaf-1.4.9.md docs/build/gates/leaf-1.4.10.md docs/build/gates/leaf-1.4.11.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=e02737babeb968fe330db0a5c3c8b49004ae801b382b4d10e2029d2fa22c5b9a; exit=0; EXPECT=matched; output-sha256=1bcb9d9b528f9aed309afc8376103b422362825a3e4ebe39e3427776e82e3ee4; output-bytes=22072; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

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
