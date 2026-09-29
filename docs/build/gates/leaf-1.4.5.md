# Gates: leaf-1.4.5 Reviews, Insights, Chat UI

OWNS: docs/decisions/leaf-1.4.5-*.md, apps/web/app/(app)/reviews/**, apps/web/app/(app)/insights/**, apps/web/app/(app)/chat/**, apps/web/components/chat/**, apps/web/components/reviews/**, apps/web/e2e/chat.spec.ts, scripts/verify/leaf-1.4.5.mjs, apps/web/test/chat/**, apps/web/e2e/chat/**, apps/web/app/api/v1/portion-biases/route.ts, apps/web/lib/server/portion-biases.ts, apps/web/test/api/portion-biases.int.test.ts

Scope: Reviews, Insights, Chat UI, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: Playwright: quick rating and detailed review, proposal appears, accept, undo (stubbed model)
  CHECK: node scripts/verify/leaf-1.4.5.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.5 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=bc28774acdb014e2eb98b43b02a00eb4eaeba0e69a0b1e0ed76d07449df22481; exit=0; EXPECT=matched; output-sha256=0cadbc80225cc7af56d69c9a60c4ddb540395d6e1fac2ed970a3faa519dfee32; output-bytes=1876; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.5.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.5 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=1706ca616de76fb7c1fb096f3cd8422a710401f5655d38225ea49d6163da915c; exit=0; EXPECT=matched; output-sha256=1bf7f46afde5a5d9d48c0f61128d37bca1d7b0da712a2b34f00f0851f12ccbc8; output-bytes=2622; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: chat renders every AGT-7 card type from recorded tool results
  CHECK: node scripts/verify/leaf-1.4.5.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.5 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3bb7db561b3e18814a5bf115d1f4e4ef144defb78850b6e37890a77be5c81aad; exit=0; EXPECT=matched; output-sha256=b049285fc4bc1d4ad6341844bcc887dd594f36f69a8cc9ef12746fb7398c1d4a; output-bytes=1928; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: architect visual review against QuickRatePhone, ReviewComposePhone, ReviewsFeed, Insights, Chat* mockups
  EVIDENCE: architect review 2026-09-27 at 819eaa6 (ChatDesktop, ChatPhoneDigest rendered from docs/mockups beside the builder's 390/1280 px captures, screenshot page version 3): layouts match with the accepted deviations (Portions copy, whole-meal chips, Rating for, no Use-for button -> 1.4.8, floating button, SPEC-Q-16/17/18) and W-9 (digest auto-applied block and plan-ready row in Updates, outside this leaf); findings (raw enum values and no Now/Proposed rows on proposal/applied cards; phone suggestion chips in three rows) fixed and re-checked (Before 0.20 -> After 0.50 capture; label mapping mutated back to raw values fails 4 describe tests); G1-G3 met twice on the merge with base b79c0c3 (DATABASE_URL unset and set); mutations caught: undo call removed (G1), macro_table card dropped (G3)
