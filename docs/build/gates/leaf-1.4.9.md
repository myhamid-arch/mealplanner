# Gates: leaf-1.4.9 Chat and setup follow-ups (W-9, W-10)

OWNS: docs/decisions/leaf-1.4.9-*.md, packages/ai/src/agent/cards.ts, packages/ai/src/agent/events.ts, packages/ai/test/agent/digest-*.test.ts, apps/worker/src/jobs/chat-events.ts, apps/web/test/api/chat-events-*.int.test.ts, apps/web/components/chat/cards/**, apps/web/test/chat/**, packages/core/src/onboarding/parse-people.ts, packages/core/src/onboarding/text.ts, packages/core/src/onboarding/infer.ts, packages/core/test/onboarding/*.test.ts, apps/web/app/(shell)/_shell/assistant-button.tsx, apps/web/app/(shell)/_shell/app-shell.tsx, scripts/verify/leaf-1.4.9.mjs

Scope: The W-9 and W-10 follow-ups (R-61): the insights digest lists learning changes applied automatically with Undo, a plan finished outside a chat turn is announced in Updates, the deterministic onboarding parse keeps relation words out of names, and the floating Assistant button stays off the desktop layout, as specified in docs/spec (see 11-build-plan.md §5 and §8 W-9, W-10, R-61) and matching docs/mockups.

- [x] G1: done automatically: digest card lists learning change sets since the previous digest with Undo; stored digests without the field still render; negative control: user and accepted-proposal change sets are not listed
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.9 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=1ce2084e7bcf51d84bd81728803ec13ae1597ce521120af22e289f176f9f1730; exit=0; EXPECT=matched; output-sha256=8763ffad25139b49c9699304112436d9f21bb5b46b5b5524300b6cf6b0689932; output-bytes=1514; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: plan ready in Updates: a plan.generate job no agent turn started posts a plan-ready row into Updates; agent-started jobs post only where they started; negative control
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.9 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=865ffbe1aecc9c6f3312241bd1cfa0125ff39cebc1ca0811d56c99e7a8c1f989; exit=0; EXPECT=matched; output-sha256=3b705ca3fbddb7f4b597f633f19749028530c3625873ed1c0adc1efa0f35001f; output-bytes=1287; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: deterministic parse names: relation and possessive phrases stripped (F1 lines plus at least 8 phrasings); 1.4.3 G1-G5 and 1.4.7 G1, G3 pass; negative control against the pre-fix parse
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.9 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=1d63b64d1725b551ff1c691b7e7ab0e9231ba21e67f66edff53e6772e63529eb; exit=0; EXPECT=matched; output-sha256=21f31e5aacc20a31825187a1fb4933e5a8596e1427d041625b5d583c2ddc0834; output-bytes=1622; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: Playwright 390/1280 plus axe-core (no serious or critical): digest automatic block with Undo, plan-ready row, floating Assistant hidden at desktop and shown at 390; 1.4.2 G1-G2, 1.3.5 G1-G3 and 1.4.5 G1-G3 pass
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.9 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3c6f49a4f6178d68a93ca82146bee0570fd83fb8e4904e99203f866831acab54; exit=0; EXPECT=matched; output-sha256=10e638903e79a1c113c56bc100401164759d5ed51e89ba33dd8732df9ccc8cee; output-bytes=1841; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G5: architect visual review against ChatPhoneDigest and the shell at 1280 px
  EVIDENCE: pending
