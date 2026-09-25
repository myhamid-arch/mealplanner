# Gates: leaf-1.3.5 Admin agent loop and tools

OWNS: docs/decisions/leaf-1.3.5-*.md, packages/ai/src/agent/**, packages/ai/test/agent/**, evals/agent/**, scripts/verify/leaf-1.3.5.mjs

Scope: Admin agent loop and tools, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: scripted stub model: parallel tool results in one message, invalid tool JSON returns is_error, refusal/max_tokens/pause_turn handled, iteration cap enforced (AGT-2)
  CHECK: node scripts/verify/leaf-1.3.5.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.5 G1 PASSED
  EVIDENCE: pending

- [ ] G2: protected ops sent via apply_change become proposals, enforced server-side (AGT-5)
  CHECK: node scripts/verify/leaf-1.3.5.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.5 G2 PASSED
  EVIDENCE: pending

- [ ] G3: history append-only: replayed stored blocks are byte-identical (AGT-8)
  CHECK: node scripts/verify/leaf-1.3.5.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.5 G3 PASSED
  EVIDENCE: pending

- [ ] G4: agent eval set passes at least 90% (HANDOFF if no credentials) (AGT-9)
  EVIDENCE: pending
