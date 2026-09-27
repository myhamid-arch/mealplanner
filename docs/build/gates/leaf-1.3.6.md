# Gates: leaf-1.3.6 Live-model fixes (W-11)

OWNS: docs/decisions/leaf-1.3.6-*.md, packages/ai/src/recipes/**, packages/ai/src/client/**, packages/ai/src/agent/prompt*.ts, packages/ai/src/agent/tools/**, packages/ai/src/agent/loop*.ts, packages/ai/test/recipes/**, packages/ai/test/agent/*.test.ts, evals/agent/**, apps/web/test/api/agent-household.int.test.ts, docs/build/live/leaf-1.3.6-*.log, scripts/verify/leaf-1.3.6.mjs

Scope: Fix the two live-model failures of 2026-09-27 (W-11, R-64): recipe generation that hit max_tokens on a 3-dish request, and the agent eval at 26/29 (89.7 %) against 90 %, as specified in docs/spec (see 05 §1, 07, 11-build-plan.md §5 and §8 W-11, R-64).

- [x] G1: recipe generation fits its budget: 3-dish request cannot end at max_tokens (split or measured budget, ADR); recorded max_tokens cut is a typed failure with nothing saved; 1.3.1 G1-G3 pass
  CHECK: node scripts/verify/leaf-1.3.6.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.6 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=850586aa499226cf7077fc8ee14aeef612265f25ce86ca34c50ecc3ab1e257af; exit=0; EXPECT=matched; output-sha256=943e6d8258bedb2d1da81ac1b881179fe69ffea648427881e4c0dd8f47799106; output-bytes=1214; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: agent eval failures diagnosed from live transcripts with root causes recorded; fixes in prompt, tool descriptions or behaviour; eval expectations change only after an architect ruling; 1.3.5 G1-G3 pass
  CHECK: node scripts/verify/leaf-1.3.6.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.6 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=e0b5a8ff686bcd4529e4560432ded16c22983f60ee004f21616dcb58bec2a7fd; exit=0; EXPECT=matched; output-sha256=bf6265165c37db6d34fe086acf51f46694fe6b228f0d1ba653d1cdc7b7ce7104; output-bytes=1764; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: live: 1.3.1 G4 generates 3 valid F1 dinner dishes and the agent eval scores at least 90 % on two consecutive full runs, logged under docs/build/live with no key in any log or commit
  EVIDENCE: architect CP3 review 2026-09-27 of docs/build/live/leaf-1.3.6-*.log, all with command, UTC time, exit and commit headers. 1.3.1 G4 PASSED at 7ddc752 (2026-09-27T14:33:19Z, run3: 3 candidates in 2 calls) and at dd3d766 (run2); run1 at d26d83b FAILED before R-67 and is logged. Agent eval, two consecutive full runs on the merged head 7ddc752: 29/29 = 100 % (eval-full-5, 14:16:26Z) and 29/29 (eval-full-6, 14:24:22Z), claude-fable-5-1; earlier pair at 6d5153e also 29/29. Between 7ddc752 and the merged head 2fd70fb only logs and docs changed. Secret scan (sk-ant- pattern) of docs/build/live: clean. PASS.
