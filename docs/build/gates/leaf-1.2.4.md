# Gates: leaf-1.2.4 Seed dish library

OWNS: docs/decisions/leaf-1.2.4-*.md, data/seed-dishes/**, data/adjusters.json, scripts/verify/leaf-1.2.4.mjs, packages/core/src/nutrition/atwater.ts, packages/core/src/nutrition/index.ts, packages/core/test/nutrition/atwater.test.ts

Scope: Seed dish library, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: at least 60 active dishes across at least 10 cuisines; at least 8 per slot type and 8 served_cold_ok packable
  CHECK: node scripts/verify/leaf-1.2.4.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.4 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=adf873927221a40b90a7bc7ad65ccb7031c1b9b7a37a000e7c56a850cab5b3d8; exit=0; EXPECT=matched; output-sha256=e581a56279593e252268eeeb45ac26fccf3704ef499edbc1059253e40f23ab1f; output-bytes=1666; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: at least 70% of dishes have a component with 2+ variants sharing at least 70% of ingredients (DM-3)
  CHECK: node scripts/verify/leaf-1.2.4.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.4 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9a766c80ea170cc5a9efc4732bf9759612aa5fdd27a4391cd9add8aa139036d8; exit=0; EXPECT=matched; output-sha256=3c8f0201fda3a29a7f5dc9a08156c6811c5e7091cb598c5538dbb601799cc202; output-bytes=612; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: every variant passes nutrition validation; at least 15 adjuster dishes
  CHECK: node scripts/verify/leaf-1.2.4.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.4 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=26e507966df6c48f11bbda2e82af5255194d491e106012c753b335ffd9d59a58; exit=0; EXPECT=matched; output-sha256=1cda7dfe8b8b83274472e1ad723cc466f48bd77b101b3233a77ee34ff7526d36; output-bytes=1404; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: at least 80% of dishes feasible for both F1 targeted adults at dinner
  CHECK: node scripts/verify/leaf-1.2.4.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.4 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=0fc4d98fa1157078616ca11eb321ca4c097904c9e454321c0461ad69e47bcf01; exit=0; EXPECT=matched; output-sha256=d72844014af7a6c88f82f372eb78d5dcb7eca3b9d8de0c789eb3dbcae630fe00; output-bytes=1095; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G5: architect review of 10 random recipes for plausibility, UAE availability and step clarity
  EVIDENCE: pending

- [x] G6: plate naturalness on the seed library: no solved F1 plate has a component outside its [min,max], and the median ratio deviation is at most 25% (PLN-5)
  CHECK: node scripts/verify/leaf-1.2.4.mjs --gate G6
  EXPECT: VERIFY leaf-1.2.4 G6 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ff41a695df1a94f3b3137022676881164795383c6eb0fb6e40ecd7ba3ab19489; exit=0; EXPECT=matched; output-sha256=0a90c9e0d568d70643c600145b215c99f1b56edd63bec68d054ae311d44b5151; output-bytes=778; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
