# Gates: leaf-1.4.9 Chat and setup follow-ups (W-9, W-10)

OWNS: docs/decisions/leaf-1.4.9-*.md, packages/ai/src/agent/cards.ts, packages/ai/src/agent/events.ts, packages/ai/test/agent/digest-*.test.ts, apps/worker/src/jobs/chat-events.ts, apps/web/test/api/chat-events-*.int.test.ts, apps/web/components/chat/cards/**, apps/web/test/chat/**, packages/core/src/onboarding/parse-people.ts, packages/core/src/onboarding/text.ts, packages/core/src/onboarding/infer.ts, packages/core/test/onboarding/*.test.ts, apps/web/app/(shell)/_shell/assistant-button.tsx, apps/web/app/(shell)/_shell/app-shell.tsx, scripts/verify/leaf-1.4.9.mjs

Scope: The W-9 and W-10 follow-ups (R-61): the insights digest lists learning changes applied automatically with Undo, a plan finished outside a chat turn is announced in Updates, the deterministic onboarding parse keeps relation words out of names, and the floating Assistant button stays off the desktop layout, as specified in docs/spec (see 11-build-plan.md §5 and §8 W-9, W-10, R-61) and matching docs/mockups.

- [ ] G1: done automatically: digest card lists learning change sets since the previous digest with Undo; stored digests without the field still render; negative control: user and accepted-proposal change sets are not listed
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.9 G1 PASSED
  EVIDENCE: pending

- [ ] G2: plan ready in Updates: a plan.generate job no agent turn started posts a plan-ready row into Updates; agent-started jobs post only where they started; negative control
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.9 G2 PASSED
  EVIDENCE: pending

- [ ] G3: deterministic parse names: relation and possessive phrases stripped (F1 lines plus at least 8 phrasings); 1.4.3 G1-G5 and 1.4.7 G1, G3 pass; negative control against the pre-fix parse
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.9 G3 PASSED
  EVIDENCE: pending

- [ ] G4: Playwright 390/1280 plus axe-core (no serious or critical): digest automatic block with Undo, plan-ready row, floating Assistant hidden at desktop and shown at 390; 1.4.2 G1-G2, 1.3.5 G1-G3 and 1.4.5 G1-G3 pass
  CHECK: node scripts/verify/leaf-1.4.9.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.9 G4 PASSED
  EVIDENCE: pending

- [ ] G5: architect visual review against ChatPhoneDigest and the shell at 1280 px
  EVIDENCE: pending
