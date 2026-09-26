# Gates: leaf-1.3.1 Claude client and recipe generator

OWNS: docs/decisions/leaf-1.3.1-*.md, packages/ai/src/client/**, packages/ai/src/recipes/**, packages/ai/test/recipes/**, scripts/verify/leaf-1.3.1.mjs

Scope: Claude client and recipe generator, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: with recorded responses the pipeline accepts a valid batch and rejects one of each REC-5 defect class with its reason surfaced
  CHECK: node scripts/verify/leaf-1.3.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.1 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a1d2d0af2c3a361e932dff7e9873abd927dd9e68dc6c6d8e72f9815dee1c781b; exit=0; EXPECT=matched; output-sha256=771b9dda12ae8f51fee339815128d5fc741c846fea95e89ad1f106c6973edfa9; output-bytes=1472; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: system and catalogue blocks are byte-identical across calls; no member names or ages in requests (REC-2, REC-3)
  CHECK: node scripts/verify/leaf-1.3.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.1 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ef1d82cac474c8d8be8550177cf65ca925715082e42ace9cac697308815b3647; exit=0; EXPECT=matched; output-sha256=5a5e306b6604da9be35236a1a03d897d6da3ab15bbd472edc8fa68c6972a4a31; output-bytes=1268; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: refusal, max_tokens and null-parse paths handled with typed errors
  CHECK: node scripts/verify/leaf-1.3.1.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.1 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=512d8e56de617449da18c1107e8a988acbff6929a7bbde0358ea5d809bd3b4fa; exit=0; EXPECT=matched; output-sha256=4a873d019d442c20edf6a957f4341c347f478430d7d0e1208086ca65a6055b89; output-bytes=1096; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G4: live smoke test generates 3 valid F1 dinner dishes (HANDOFF if no credentials)
  EVIDENCE: pending

ABANDON: G4 no Anthropic credential in the build environment (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_PROFILE and the WIF variables are unset); the owner must provide ANTHROPIC_API_KEY, then run node scripts/verify/leaf-1.3.1.mjs --gate G4 (live F1 dinner generation, expects 3 candidates)
