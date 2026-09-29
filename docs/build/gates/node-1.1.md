# Gates: node-1.1 Foundation integration

Scope: integrate children leaf-1.1.1, leaf-1.1.2, leaf-1.1.3 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 1800 docs/build/gates/leaf-1.1.1.md docs/build/gates/leaf-1.1.2.md docs/build/gates/leaf-1.1.3.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=f17f3f3b6df6cf9d69a29f4b75f7c8ef83d01888c0c8aa6e72b4b3c1a4decead; exit=0; EXPECT=matched; output-sha256=88ca049f892de280dfff4b50950de322bfabf298010559411644db248fe5f255; output-bytes=6630; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.1.mjs --gate N2
  EXPECT: VERIFY node-1.1 N2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=fd5c0a964d7197df27cc021bca63f8115f5b492ebf4869c960cb41172bf1df75; exit=0; EXPECT=matched; output-sha256=a89f266ac9cf16fd5a0b810075c28e2235faf0a6c8fcad044fe8c91ef3370b58; output-bytes=2184; shell=/bin/sh; cwd=/tmp/claude-0/cp3-26; path=ad9aca3d1be2/14 entries

- [x] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.1.mjs --gate N3
  EXPECT: VERIFY node-1.1 N3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ec2d4b9bf245f21eb43de8039fe6be762504fd6b1ec9cc9c13eda61795459590; exit=0; EXPECT=matched; output-sha256=026d83051403da97bf8ea400957e022ad1d41696dde5ea2b3e30bd411256eed8; output-bytes=2761; shell=/bin/sh; cwd=/tmp/claude-0/cp3-26; path=ad9aca3d1be2/14 entries

- [x] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.1.mjs --gate N4
  EXPECT: VERIFY node-1.1 N4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=480808576c5a0bc6e362861ec43da1eefb6f758b94487006c2876677cb4c4271; exit=0; EXPECT=matched; output-sha256=d1ee5e558ad8fd1dba1ce4492131414b729d7150615511727cc01cead481d0e5; output-bytes=6073; shell=/bin/sh; cwd=/tmp/claude-0/cp3-26; path=ad9aca3d1be2/14 entries

- [ ] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: pending
