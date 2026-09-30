# Gates: leaf-1.4.9 Chat and setup follow-ups (W-9, W-10)

OWNS: docs/decisions/leaf-1.4.9-*.md, packages/ai/src/agent/cards.ts, packages/ai/src/agent/events.ts, packages/ai/test/agent/digest-*.test.ts, apps/worker/src/jobs/chat-events.ts, apps/web/test/api/chat-events-*.int.test.ts, apps/web/components/chat/cards/**, apps/web/test/chat/**, packages/core/src/onboarding/parse-people.ts, packages/core/src/onboarding/text.ts, packages/core/src/onboarding/infer.ts, packages/core/test/onboarding/*.test.ts, apps/web/app/(shell)/_shell/assistant-button.tsx, apps/web/app/(shell)/_shell/app-shell.tsx, scripts/verify/leaf-1.4.9.mjs

Scope: The W-9 and W-10 follow-ups (R-61): the insights digest lists learning changes applied automatically with Undo, a plan finished outside a chat turn is announced in Updates, the deterministic onboarding parse keeps relation words out of names, and the floating Assistant button stays off the desktop layout, as specified in docs/spec (see 11-build-plan.md §5 and §8 W-9, W-10, R-61) and matching docs/mockups.

- [x] G1: done automatically: digest card lists learning change sets since the previous digest with Undo; stored digests without the field still render; negative control: user and accepted-proposal change sets are not listed
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.9 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=1ce2084e7bcf51d84bd81728803ec13ae1597ce521120af22e289f176f9f1730; exit=0; EXPECT=matched; output-sha256=6cd73f9871598c6bd04248a67e5a033b44bf0adf2c7d92ce47ba876d6b52b911; output-bytes=1514; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: plan ready in Updates: a plan.generate job no agent turn started posts a plan-ready row into Updates; agent-started jobs post only where they started; negative control
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.9 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=865ffbe1aecc9c6f3312241bd1cfa0125ff39cebc1ca0811d56c99e7a8c1f989; exit=0; EXPECT=matched; output-sha256=6a7019b4d34e34eb0aa18bc839d170de2fd8cf4455d04d56f5b55c63a69ef705; output-bytes=1287; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: deterministic parse names: relation and possessive phrases stripped (F1 lines plus at least 8 phrasings); 1.4.3 G1-G5 and 1.4.7 G1, G3 pass; negative control against the pre-fix parse
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.9 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=1d63b64d1725b551ff1c691b7e7ab0e9231ba21e67f66edff53e6772e63529eb; exit=0; EXPECT=matched; output-sha256=649358dbbe2bc51a4435b711c745c3380f89f3a49cf7f805fbe01101c511aff4; output-bytes=1622; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: Playwright 390/1280 plus axe-core (no serious or critical): digest automatic block with Undo, plan-ready row, floating Assistant hidden at desktop and shown at 390; 1.4.2 G1-G2, 1.3.5 G1-G3 and 1.4.5 G1-G3 pass
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.9 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3c6f49a4f6178d68a93ca82146bee0570fd83fb8e4904e99203f866831acab54; exit=0; EXPECT=matched; output-sha256=7e5e88d46196bc9e3ca350feb5e06980e192f15345c4be1946f42e77923c151a; output-bytes=1842; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: architect visual review against ChatPhoneDigest and the shell at 1280 px
  EVIDENCE: architect CP3 review 2026-09-27 of the builder's captures (artifact Hz2LhbvNPkwjCA3m3trGnv) against ChatPhoneDigest: the "Done automatically" block with Undo and the plan-ready row match. At 1280 px the chat opener's reserved space (W-10(b), option A) leaves the content clear, and the floating AssistantButton is hidden. Changes after the captures: the digest's "See Insights" and plan-ready links are underlined (as the mockup shows; the axe link-in-text-block fix), and the recipe card gained its "Use for" link (R-66). Neither changes the reviewed layout. PASS.
