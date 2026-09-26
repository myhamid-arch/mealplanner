# Gates: leaf-1.3.3 Insights engine and proposals

OWNS: docs/decisions/leaf-1.3.3-*.md, packages/core/src/learning/rules/**, packages/core/test/learning/rules/**, packages/ai/src/insights/**, packages/ai/test/insights/**, packages/db/src/services/proposals/**, packages/db/test/proposals/**, scripts/verify/leaf-1.3.3.mjs

Scope: Insights engine and proposals, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: every FBK-7 rule has triggering and non-triggering fixture tests
  CHECK: node scripts/verify/leaf-1.3.3.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.3 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b975f85931b86771202e174f798db8d910ae31870bd65da1b832fccde792d593; exit=0; EXPECT=matched; output-sha256=663de923d7b9706ca30cd6d88585246bd017b8498af9d883d055d6eb0bbcd20e; output-bytes=2725; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: FBK-8 guardrails: fingerprint suppression, pending budget, protected ops never proposed, expiry
  CHECK: node scripts/verify/leaf-1.3.3.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.3 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9eec43482da6aef0daf2706474aba02a67bd2198b25edfd1cb1e391a5d290e88; exit=0; EXPECT=matched; output-sha256=6f043bdb5b6f18b79294de69e3892dc584090febf5ccd89444319e2052e9efbc; output-bytes=3447; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: LLM synthesis output Zod-validated; invalid kinds dropped and logged (stubbed model)
  CHECK: node scripts/verify/leaf-1.3.3.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.3 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=e37770ee215a310647ac46feef126b4b80695044652fad419efa2d2b06c67805; exit=0; EXPECT=matched; output-sha256=d1b64ca78a10c38afcf666f1d1a4f38f1bc41691aadd2e9f37fc8ab83969cc4f; output-bytes=1662; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
