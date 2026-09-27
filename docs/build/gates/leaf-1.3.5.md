# Gates: leaf-1.3.5 Admin agent loop and tools

OWNS: docs/decisions/leaf-1.3.5-*.md, packages/ai/src/agent/**, packages/ai/test/agent/**, evals/agent/**, scripts/verify/leaf-1.3.5.mjs, apps/web/app/api/v1/conversations/[id]/messages/route.ts, apps/web/test/api/conversations-messages.int.test.ts, packages/ai/src/reviews/**, packages/ai/test/reviews/**, apps/worker/src/jobs/reviews-extract.ts, apps/web/lib/server/agent.ts, apps/worker/src/jobs/chat-events.ts, apps/worker/src/jobs/recipe-draft.ts, packages/db/src/migrations/0005_review_extraction.sql, packages/db/src/migrations/meta/0005_snapshot.json

Scope: Admin agent loop and tools, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: scripted stub model: parallel tool results in one message, invalid tool JSON returns is_error, refusal/max_tokens/pause_turn handled, iteration cap enforced (AGT-2)
  CHECK: node scripts/verify/leaf-1.3.5.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.5 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=de1782a35c2541e8db8a475b8927cb29d539425e8d7df1f680d5832dec67b1a8; exit=0; EXPECT=matched; output-sha256=88f7412c884777f27980b78c4b4ff08414fb0af400824cfeba17b6b1a3f13d9d; output-bytes=2959; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: protected ops sent via apply_change become proposals, enforced server-side (AGT-5)
  CHECK: node scripts/verify/leaf-1.3.5.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.5 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=83c0cc3b03a1871e54e401257235d289433f62aa71b29a8bcf6d595250692c66; exit=0; EXPECT=matched; output-sha256=561b421773d05e99485ac8b39b7255a15a6a5ef2bd1081ace5bd8ce9a6657c0c; output-bytes=1389; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: history append-only: replayed stored blocks are byte-identical (AGT-8)
  CHECK: node scripts/verify/leaf-1.3.5.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.5 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a86e0a56cb07fc9e0ce45297dcbbf0d1e71d061cc749f557e742b08a04b0f65c; exit=0; EXPECT=matched; output-sha256=7bc1142a175b64e3411ba39f224af9cb9093c2d7c55b0f347cbad6782f77238a; output-bytes=1090; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G4: agent eval set passes at least 90% (HANDOFF if no credentials) (AGT-9)
  EVIDENCE: pending (live run 2026-09-27T09:17Z at 61c3b5b, claude-fable-5-1: 26/29 = 89.7 % against 90 %; failed allergy-sesame, weekend-appeal, make-sara-admin; docs/build/live/leaf-1.3.5-G4.log; W-11)

