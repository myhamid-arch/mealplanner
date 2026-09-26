# Gates: leaf-1.3.2 Reviews and preference learning

OWNS: docs/decisions/leaf-1.3.2-*.md, packages/core/src/learning/preferences/**, packages/core/src/learning/portions/**, packages/core/test/learning/prefs/**, packages/db/src/services/reviews/**, packages/db/test/reviews/**, packages/db/src/schema/review-revision.ts, packages/db/src/migrations/0002_*, packages/db/src/migrations/meta/**, packages/db/src/schema/index.ts, packages/db/src/repos/tables.ts, packages/db/test/spec-columns.ts, scripts/verify/leaf-1.3.2.mjs

Scope: Reviews and preference learning, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: SC-3: two 1-star reviews lower that member's dish appeal by at least 0.3 and leave other members unchanged
  CHECK: node scripts/verify/leaf-1.3.2.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.2 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=84bbe436e1e65289183b18c3d96ed246a4842b1adfe4d3a557f7495bae6114f2; exit=0; EXPECT=matched; output-sha256=241c64858837d1003fefce0e9c202bf96fd34037ece79a74838095d4205a77f0; output-bytes=2002; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: propagation weights follow FBK-4; locked preferences never change
  CHECK: node scripts/verify/leaf-1.3.2.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.2 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f94fee607b6c4e206dcad3b33c36ebc09c13826050181b87b8b947dac621bf33; exit=0; EXPECT=matched; output-sha256=c669e000b8dd645e13cb54f9c136294777c87beeb9be442c9bc421405e2e76a4; output-bytes=2575; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: untargeted portion bias follows FBK-5 within bounds; targeted grams unaffected
  CHECK: node scripts/verify/leaf-1.3.2.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.2 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c242593c59849d3df5f7b79ede365220fbd865e397c5bd2e6557b433102c2c4b; exit=0; EXPECT=matched; output-sha256=5184798966a2ef4f33f3b3dfef4a284466e272179e99120fe45740cad16e24c1; output-bytes=2167; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
