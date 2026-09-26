# Gates: leaf-1.1.3 Catalogue data

OWNS: docs/decisions/leaf-1.1.3-*.md, data/ingredients.*, data/method-yields.*, data/cuisines.json, data/soluble-fibre.csv, data/substitutes.csv, scripts/import-fdc.ts, scripts/verify/leaf-1.1.3.mjs

Scope: Catalogue data, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: at least 250 ingredients with required fields, source and AE availability; at least 40 UAE-specific items (NUT-7)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G1
  EXPECT: VERIFY leaf-1.1.3 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=1a628d6c0e7377e0b7831da8ed2f7e6d2606e415daa9ccad54c601fb334a7b52; exit=0; EXPECT=matched; output-sha256=dddd8ada0cfe11f1332ad25f62686f7d0b88f977913916e91c7d11940ff2388a; output-bytes=1205; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: every ingredient passes the Atwater check or is marked confidence low with a reason (NUT-4)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G2
  EXPECT: VERIFY leaf-1.1.3 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c46c9499802d0e41571539a6711d70c298ebfc65741a024cb31b67d1e22d1dc2; exit=0; EXPECT=matched; output-sha256=8f0e85b8d6673b523a5f6e0d0c08d9853e359a2a8c65326365ca328914fd4a38; output-bytes=1518; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: method-yield rows exist with a source for every (method, category) used by the seed library (NUT-5)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G3
  EXPECT: VERIFY leaf-1.1.3 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=92316b3950a73cdb1db8302465b58c33d6dbc1f41f0e5849142a33e7001e1bd6; exit=0; EXPECT=matched; output-sha256=3842f89693a23cd177986eb24d564f80e255da95518d99ffd5a242eb4fc7cbee; output-bytes=1141; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: soluble-fibre values carry citations; unknowns are null, not 0 (NUT-8)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G4
  EXPECT: VERIFY leaf-1.1.3 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b61999d0e7ffb3f52a9536331328e51f8701f896f1d9e02d454688a63b060cde; exit=0; EXPECT=matched; output-sha256=26501801624649283800378166e734b494864ea30807f328eb74ac2fa834d9ee; output-bytes=709; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: allergen dietary_flags present so sesame expands to tahini, hummus and za'atar (R2-ONB-3)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G5
  EXPECT: VERIFY leaf-1.1.3 G5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=bd8d4843c26fb6b224bab7dd47e73812de7745db4430910d24ad6e58a1c3b53a; exit=0; EXPECT=matched; output-sha256=018bc13c455f627653fd825d47b45c90d98fe87116470c2c6f8c709c5c46091d; output-bytes=726; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G6: architect spot-check of 20 random ingredients against cited sources
  EVIDENCE: pending
