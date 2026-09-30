# Gates: node-1.1 Foundation integration

Scope: integrate children leaf-1.1.1, leaf-1.1.2, leaf-1.1.3 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 1800 docs/build/gates/leaf-1.1.1.md docs/build/gates/leaf-1.1.2.md docs/build/gates/leaf-1.1.3.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=f17f3f3b6df6cf9d69a29f4b75f7c8ef83d01888c0c8aa6e72b4b3c1a4decead; exit=0; EXPECT=matched; output-sha256=d5bf814acc6c78941370bf3c8a1285abccacfe03fcca24eb678b03d01b8c6f04; output-bytes=6630; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.1.mjs --gate N2
  EXPECT: VERIFY node-1.1 N2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=fd5c0a964d7197df27cc021bca63f8115f5b492ebf4869c960cb41172bf1df75; exit=0; EXPECT=matched; output-sha256=3a77daf76d0babcb3335eccb55e4bd608672a98d00af31b8ed270d2a0b9926f1; output-bytes=2184; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.1.mjs --gate N3
  EXPECT: VERIFY node-1.1 N3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ec2d4b9bf245f21eb43de8039fe6be762504fd6b1ec9cc9c13eda61795459590; exit=0; EXPECT=matched; output-sha256=d2895359362040f0ad960bb712f10b96bb6251a2654d4d820960bf2abc623c29; output-bytes=2761; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.1.mjs --gate N4
  EXPECT: VERIFY node-1.1 N4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=480808576c5a0bc6e362861ec43da1eefb6f758b94487006c2876677cb4c4271; exit=0; EXPECT=matched; output-sha256=aab9e8c7b1a69a4eae4b09f188c2e9e67287ab5d6afcb0bb0b583b1fb356ea70; output-bytes=6414; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: architect review 2026-09-29 at c77176a. Children's manual outcomes: 1.1.1 G3 (CI) — .github/workflows/ci.yml runs frozen install, format:check, build, lint, typecheck, test:unit, a PostgreSQL 16 assertion and test:integration against postgres:16; its only change after the leaf review (9618aaf) runs build before lint, and the CP3 full CI of the node scripts ran the same steps on the merged tree, all exit 0. 1.1.3 G6 (20-ingredient spot-check at 02fd36c) — data/ingredients.v1.json and ingredients.manifest.json are unchanged since (git log empty). Branch level: N3 (migrations from zero; change set apply/undo equality through the service and HTTP) met with DATABASE_URL unset and set. No consequential outcome changed.
