# Gates: node-1.4 Product integration

Scope: integrate children leaf-1.4.1, leaf-1.4.2, leaf-1.4.3, leaf-1.4.4, leaf-1.4.5, leaf-1.4.6, leaf-1.4.7, leaf-1.4.8, leaf-1.4.9, leaf-1.4.10, leaf-1.4.11, leaf-1.4.12 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 1800 docs/build/gates/leaf-1.4.1.md docs/build/gates/leaf-1.4.2.md docs/build/gates/leaf-1.4.3.md docs/build/gates/leaf-1.4.4.md docs/build/gates/leaf-1.4.5.md docs/build/gates/leaf-1.4.6.md docs/build/gates/leaf-1.4.7.md docs/build/gates/leaf-1.4.8.md docs/build/gates/leaf-1.4.9.md docs/build/gates/leaf-1.4.10.md docs/build/gates/leaf-1.4.11.md docs/build/gates/leaf-1.4.12.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=4a1912bfaa149e1786e8d3db854aaa5ef236ee6d0f7cf65d0b9df98cbc1b7b47; exit=0; EXPECT=matched; output-sha256=deb338a30f32f3428b054297862968b4f1a6346e7853f6c6cee2e86e88e38437; output-bytes=23959; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.4.mjs --gate N2
  EXPECT: VERIFY node-1.4 N2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=eed54e09c5a16ebaf2b314234ded57956b5f41407aad07dd80f7bf032cabe869; exit=0; EXPECT=matched; output-sha256=6defe404b2f013b895dbc5eeb01f5fa851c46a49869559923ca5919960c18ab4; output-bytes=2814; shell=/bin/sh; cwd=/tmp/claude-0/cp3-26; path=ad9aca3d1be2/14 entries

- [x] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.4.mjs --gate N3
  EXPECT: VERIFY node-1.4 N3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=eb4612d397915f8e9b12e8cbbf913ce9d896279539bc4a0627fcf525082af391; exit=0; EXPECT=matched; output-sha256=4f354435b0214f2fc0e8c9076061908fdb665018b4916586712fd46a0a27e890; output-bytes=3377; shell=/bin/sh; cwd=/tmp/claude-0/cp3-26; path=ad9aca3d1be2/14 entries

- [x] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.4.mjs --gate N4
  EXPECT: VERIFY node-1.4 N4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=4a1acd948bdb6c0a74ee653e5b0862804efb71a8d1615f5a8bd991982670c826; exit=0; EXPECT=matched; output-sha256=3576f1e04829cb474019f778dd0dbff7623a19148a4cdc1c48854fedec355d1d; output-bytes=6074; shell=/bin/sh; cwd=/tmp/claude-0/cp3-26; path=ad9aca3d1be2/14 entries

- [x] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: architect review 2026-09-29 at c77176a. Children's manual outcomes: visual reviews 1.4.2 G3, 1.4.3 G6, 1.4.4 G4, 1.4.5 G4, 1.4.6 G3, 1.4.7 G5, 1.4.8 G6, 1.4.9 G5, 1.4.10 G5 and 1.4.11 G3 all recorded. Branch level: two defects surfaced only above the leaves and are fixed on the base — W-15 (1.4.11: the Assistant button covered the last control at 390 px; padding added, reviewed in 1.4.11 G3) and W-22 (found in node-1.4 N4: the UX-7 "Saved. It's in the change log" line vanished when a keyed section reloaded; fixed with a failing-then-passing control, no layout change). N3 (SC-5 flows at 390 and 1280 px, axe light and dark, no serious or critical) met with DATABASE_URL unset and set.
