# Gates: leaf-1.3.1 Claude client and recipe generator

OWNS: docs/decisions/leaf-1.3.1-*.md, packages/ai/src/client/**, packages/ai/src/recipes/**, packages/ai/test/recipes/**, scripts/verify/leaf-1.3.1.mjs

Scope: Claude client and recipe generator, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: with recorded responses the pipeline accepts a valid batch and rejects one of each REC-5 defect class with its reason surfaced
  CHECK: node scripts/verify/leaf-1.3.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.1 G1 PASSED
  EVIDENCE: pending

- [ ] G2: system and catalogue blocks are byte-identical across calls; no member names or ages in requests (REC-2, REC-3)
  CHECK: node scripts/verify/leaf-1.3.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.1 G2 PASSED
  EVIDENCE: pending

- [ ] G3: refusal, max_tokens and null-parse paths handled with typed errors
  CHECK: node scripts/verify/leaf-1.3.1.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.1 G3 PASSED
  EVIDENCE: pending

- [ ] G4: live smoke test generates 3 valid F1 dinner dishes (HANDOFF if no credentials)
  EVIDENCE: pending
