# Gates: leaf-1.3.6 Live-model fixes (W-11)

OWNS: docs/decisions/leaf-1.3.6-*.md, packages/ai/src/recipes/**, packages/ai/src/client/**, packages/ai/src/agent/prompt*.ts, packages/ai/src/agent/tools/**, packages/ai/src/agent/loop*.ts, packages/ai/test/recipes/**, packages/ai/test/agent/*.test.ts, evals/agent/**, apps/web/test/api/agent-household.int.test.ts, docs/build/live/leaf-1.3.6-*.log, scripts/verify/leaf-1.3.6.mjs

Scope: Fix the two live-model failures of 2026-09-27 (W-11, R-64): recipe generation that hit max_tokens on a 3-dish request, and the agent eval at 26/29 (89.7 %) against 90 %, as specified in docs/spec (see 05 §1, 07, 11-build-plan.md §5 and §8 W-11, R-64).

- [x] G1: recipe generation fits its budget: 3-dish request cannot end at max_tokens (split or measured budget, ADR); recorded max_tokens cut is a typed failure with nothing saved; 1.3.1 G1-G3 pass
  CHECK: node scripts/verify/leaf-1.3.6.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.6 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=850586aa499226cf7077fc8ee14aeef612265f25ce86ca34c50ecc3ab1e257af; exit=0; EXPECT=matched; output-sha256=ca57b1058a17752cca487eec92190c63364c009f7e63f699ac4d3e6b4e6af7bb; output-bytes=943; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G2: agent eval failures diagnosed from live transcripts with root causes recorded; fixes in prompt, tool descriptions or behaviour; eval expectations change only after an architect ruling; 1.3.5 G1-G3 pass
  CHECK: node scripts/verify/leaf-1.3.6.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.6 G2 PASSED
  EVIDENCE: pending

- [ ] G3: live: 1.3.1 G4 generates 3 valid F1 dinner dishes and the agent eval scores at least 90 % on two consecutive full runs, logged under docs/build/live with no key in any log or commit
  EVIDENCE: pending
