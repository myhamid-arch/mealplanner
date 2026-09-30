# Gates: node-1.3 Intelligence integration

Scope: integrate children leaf-1.3.1, leaf-1.3.2, leaf-1.3.3, leaf-1.3.4, leaf-1.3.5, leaf-1.3.6, leaf-1.3.7 into one verified result

- [x] N1: every direct child is reverified from its exact ledger
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --approve --reverify --jobs 1 --timeout 1800 docs/build/gates/leaf-1.3.1.md docs/build/gates/leaf-1.3.2.md docs/build/gates/leaf-1.3.3.md docs/build/gates/leaf-1.3.4.md docs/build/gates/leaf-1.3.5.md docs/build/gates/leaf-1.3.6.md docs/build/gates/leaf-1.3.7.md
  EXPECT: ALL MET
  EVIDENCE: automatic-evidence=v1; definition-sha256=090939fc66c630b15481c76b5f1488129742507ac66cc8e6bf3dd10f785c5a87; exit=0; EXPECT=matched; output-sha256=ac7a6fab08bb869aa4d9aa56aa03cf09c541dd78802b7df9fd305af407272744; output-bytes=11512; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N2: child packages compile against each other's public types and contract tests pass
  CHECK: node scripts/verify/node-1.3.mjs --gate N2
  EXPECT: VERIFY node-1.3 N2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=2a1ca30354ccf209d680a2b003f53b70b8b0799543622280492ace9b0ae8f129; exit=0; EXPECT=matched; output-sha256=577fd4b5322d4d4832c81ffb3f05e380e050dc055cc8d232287998e20425c993; output-bytes=2923; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N3: branch end-to-end behaviour works
  CHECK: node scripts/verify/node-1.3.mjs --gate N3
  EXPECT: VERIFY node-1.3 N3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b2af5532aaab0e8a4ef1b4e9d8b25bcda7444ff3cdc34b06c5670183f156b40c; exit=0; EXPECT=matched; output-sha256=37650a55f0c21523287efd478e5c6815cefc1957e99b803f1025a6821cf5cc73; output-bytes=3087; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N4: full test suite passes with no regressions
  CHECK: node scripts/verify/node-1.3.mjs --gate N4
  EXPECT: VERIFY node-1.3 N4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=47b5a9055dba47f3e2131f5364c3b4f9c82f8e557e97107ca8bcf0707df935db; exit=0; EXPECT=matched; output-sha256=251dfd6d3a431f4b5b37a59f388cf504f71da9ac34e72d42324dc64587da0781; output-bytes=6414; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] N5: consequential manual outcomes from the children reviewed at branch level by the architect
  EVIDENCE: architect review 2026-09-29 at c77176a. Children's manual/live outcomes: 1.3.1 G4 (live recipe smoke, 7ddc752) — packages/ai/src/recipes unchanged since, so it stands. 1.3.5 G4 and 1.3.6 G3 (agent eval) — since 7ddc752 leaf 1.4.9 added an optional `date` field to the create_recipe tool schema (packages/ai/src/agent/tools/schemas.ts:88), which the model sees, so the eval was rerun on the final head: 29/29 = 100 % twice consecutively (2026-09-29T21:21:25Z and 21:29:51Z, claude-fable-5-1; docs/build/live/node-1.3-N5-eval-7.log and -8.log, secret scan clean). Branch level: N3 (reviews → proposal → accept → DISLIKES edge; agent get_preferences and apply_change with undo) met with DATABASE_URL unset and set.
