# Gates: node-1.2 Engine integration

Scope: integrate children leaf-1.2.1, leaf-1.2.2, leaf-1.2.3, leaf-1.2.4, leaf-1.2.5, leaf-1.2.6, leaf-1.2.7 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 5400 docs/build/gates/leaf-1.2.1.md docs/build/gates/leaf-1.2.2.md docs/build/gates/leaf-1.2.3.md docs/build/gates/leaf-1.2.4.md docs/build/gates/leaf-1.2.5.md docs/build/gates/leaf-1.2.6.md docs/build/gates/leaf-1.2.7.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=f5111d5eac6d133b5f83fbbd7be489e05878c51a88b68e0d6392e25a3f444fe8; exit=0; EXPECT=matched; output-sha256=ddb7bd3d0440230ad6fb7d360801dd73d19196483ba45304a6153a63e6f4b673; output-bytes=32055; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.2.mjs --gate N2
  EXPECT: VERIFY node-1.2 N2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3ff39b8097f044fad728f19728c5c523223150e84823706dd0f1b7c5f9f5341d; exit=0; EXPECT=matched; output-sha256=27f190bc737f14a4603345c1f653ac9e5939b852240664363c426f4a4eed94d3; output-bytes=2143; shell=/bin/sh; cwd=/tmp/claude-0/cp3-26; path=ad9aca3d1be2/14 entries

- [x] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.2.mjs --gate N3
  EXPECT: VERIFY node-1.2 N3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=54d08efc90a21bb6df4abb5e1daeef2f7006a0a7b376399f3d524e058cb69963; exit=0; EXPECT=matched; output-sha256=982462a3ae508d7daf2ead712185fcce1faf73395e8a1869575ec150cf71ce65; output-bytes=5442; shell=/bin/sh; cwd=/tmp/claude-0/cp3-26; path=ad9aca3d1be2/14 entries

- [x] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.2.mjs --gate N4
  EXPECT: VERIFY node-1.2 N4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c90059af46e722118943bcf26ef4eab693afba47d89de6104bab9e8a2038627e; exit=0; EXPECT=matched; output-sha256=c8caf5dd3457c46a890c212267cacbfc6d48a24b67cf52e5f647bc0cd96531af; output-bytes=6075; shell=/bin/sh; cwd=/tmp/claude-0/cp3-26; path=ad9aca3d1be2/14 entries

- [ ] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: pending
