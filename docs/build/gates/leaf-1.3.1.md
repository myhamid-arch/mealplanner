# Gates: leaf-1.3.1 Claude client and recipe generator

OWNS: docs/decisions/leaf-1.3.1-*.md, packages/ai/src/client/**, packages/ai/src/recipes/**, packages/ai/test/recipes/**, scripts/verify/leaf-1.3.1.mjs

Scope: Claude client and recipe generator, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: with recorded responses the pipeline accepts a valid batch and rejects one of each REC-5 defect class with its reason surfaced
  CHECK: node scripts/verify/leaf-1.3.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.1 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a1d2d0af2c3a361e932dff7e9873abd927dd9e68dc6c6d8e72f9815dee1c781b; exit=0; EXPECT=matched; output-sha256=f80c0b88ea7404a76e7307f5ea3c04b140dba081e930e73d48eb5b15097f62ea; output-bytes=1498; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: system and catalogue blocks are byte-identical across calls; no member names or ages in requests (REC-2, REC-3)
  CHECK: node scripts/verify/leaf-1.3.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.1 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ef1d82cac474c8d8be8550177cf65ca925715082e42ace9cac697308815b3647; exit=0; EXPECT=matched; output-sha256=2099369b0b71a3435c9824ca61026f4e9d575cafc37fe12b2c0228adf5cf3ea7; output-bytes=1343; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: refusal, max_tokens and null-parse paths handled with typed errors
  CHECK: node scripts/verify/leaf-1.3.1.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.1 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=512d8e56de617449da18c1107e8a988acbff6929a7bbde0358ea5d809bd3b4fa; exit=0; EXPECT=matched; output-sha256=4a873d019d442c20edf6a957f4341c347f478430d7d0e1208086ca65a6055b89; output-bytes=1096; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: live smoke test generates 3 valid F1 dinner dishes (HANDOFF if no credentials)
  EVIDENCE: live run 2026-09-27T14:33:19Z at 7ddc752 (leaf 1.3.6, after W-11 budget fix and R-67), claude-fable-5-1: VERIFY leaf-1.3.1 G4 PASSED, 3 candidates in 2 calls; docs/build/live/leaf-1.3.6-1.3.1-G4-run3.log (also run2 at dd3d766 PASSED). Earlier failures kept: docs/build/live/leaf-1.3.1-G4.log (61c3b5b, max_tokens) and leaf-1.3.6-1.3.1-G4.log (d26d83b).

