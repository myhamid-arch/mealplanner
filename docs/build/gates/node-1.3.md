# Gates: node-1.3 Intelligence integration

Scope: integrate children leaf-1.3.1, leaf-1.3.2, leaf-1.3.3, leaf-1.3.4, leaf-1.3.5, leaf-1.3.6 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 1800 docs/build/gates/leaf-1.3.1.md docs/build/gates/leaf-1.3.2.md docs/build/gates/leaf-1.3.3.md docs/build/gates/leaf-1.3.4.md docs/build/gates/leaf-1.3.5.md docs/build/gates/leaf-1.3.6.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=edc8d0c9c0b3884857468595f1a96efa9c558b18f91a08ecadb0371e8540f87f; exit=0; EXPECT=matched; output-sha256=828cbe3108924ad973e9a0506e0a172fe4b7aae46bad894d1fec848f5e38c29b; output-bytes=16025; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

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
