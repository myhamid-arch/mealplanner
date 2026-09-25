# Gates: leaf-1.3.3 Insights engine and proposals

OWNS: docs/decisions/leaf-1.3.3-*.md, packages/core/src/learning/rules/**, packages/core/test/learning/rules/**, packages/ai/src/insights/**, packages/db/src/services/proposals/**, scripts/verify/leaf-1.3.3.mjs

Scope: Insights engine and proposals, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: every FBK-7 rule has triggering and non-triggering fixture tests
  CHECK: node scripts/verify/leaf-1.3.3.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.3 G1 PASSED
  EVIDENCE: pending

- [ ] G2: FBK-8 guardrails: fingerprint suppression, pending budget, protected ops never proposed, expiry
  CHECK: node scripts/verify/leaf-1.3.3.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.3 G2 PASSED
  EVIDENCE: pending

- [ ] G3: LLM synthesis output Zod-validated; invalid kinds dropped and logged (stubbed model)
  CHECK: node scripts/verify/leaf-1.3.3.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.3 G3 PASSED
  EVIDENCE: pending
