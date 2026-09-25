# Gates: leaf-1.3.2 Reviews and preference learning

OWNS: docs/decisions/leaf-1.3.2-*.md, packages/core/src/learning/preferences/**, packages/core/src/learning/portions/**, packages/core/test/learning/prefs/**, packages/db/src/services/reviews/**, scripts/verify/leaf-1.3.2.mjs

Scope: Reviews and preference learning, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: SC-3: two 1-star reviews lower that member's dish appeal by at least 0.3 and leave other members unchanged
  CHECK: node scripts/verify/leaf-1.3.2.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.2 G1 PASSED
  EVIDENCE: pending

- [ ] G2: propagation weights follow FBK-4; locked preferences never change
  CHECK: node scripts/verify/leaf-1.3.2.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.2 G2 PASSED
  EVIDENCE: pending

- [ ] G3: untargeted portion bias follows FBK-5 within bounds; targeted grams unaffected
  CHECK: node scripts/verify/leaf-1.3.2.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.2 G3 PASSED
  EVIDENCE: pending
