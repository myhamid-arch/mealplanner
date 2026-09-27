# Gates: leaf-1.4.5 Reviews, Insights, Chat UI

OWNS: docs/decisions/leaf-1.4.5-*.md, apps/web/app/(app)/reviews/**, apps/web/app/(app)/insights/**, apps/web/app/(app)/chat/**, apps/web/components/chat/**, apps/web/components/reviews/**, apps/web/e2e/chat.spec.ts, scripts/verify/leaf-1.4.5.mjs, apps/web/test/chat/**, apps/web/e2e/chat/**, apps/web/app/api/v1/portion-biases/route.ts, apps/web/lib/server/portion-biases.ts, apps/web/test/api/portion-biases.int.test.ts

Scope: Reviews, Insights, Chat UI, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: Playwright: quick rating and detailed review, proposal appears, accept, undo (stubbed model)
  CHECK: node scripts/verify/leaf-1.4.5.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.5 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=bc28774acdb014e2eb98b43b02a00eb4eaeba0e69a0b1e0ed76d07449df22481; exit=0; EXPECT=matched; output-sha256=df445de551772e91f5a471c13dd7eca772f4607e4662b4ad31f78e3dd1bf53f3; output-bytes=1877; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.5.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.5 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=1706ca616de76fb7c1fb096f3cd8422a710401f5655d38225ea49d6163da915c; exit=0; EXPECT=matched; output-sha256=1e42e22e3e861b7c705d6baff23b535007a0e11eefd0145669f08a3d9ba0234b; output-bytes=2622; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: chat renders every AGT-7 card type from recorded tool results
  CHECK: node scripts/verify/leaf-1.4.5.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.5 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3bb7db561b3e18814a5bf115d1f4e4ef144defb78850b6e37890a77be5c81aad; exit=0; EXPECT=matched; output-sha256=e75e1492c0d25042bf0665b8f1dd63c2a42f15c64e901b3ecb5c69cbc54d8053; output-bytes=1929; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G4: architect visual review against QuickRatePhone, ReviewComposePhone, ReviewsFeed, Insights, Chat* mockups
  EVIDENCE: pending
