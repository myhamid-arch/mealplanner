# Gates: leaf-1.3.4 Knowledge graph

OWNS: docs/decisions/leaf-1.3.4-*.md, packages/graph/**, scripts/kg-rebuild.ts, scripts/verify/leaf-1.3.4.mjs

Scope: Knowledge graph, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: full rebuild equals incremental sync (KG-3)
  CHECK: node scripts/verify/leaf-1.3.4.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.4 G1 PASSED
  EVIDENCE: pending

- [ ] G2: similarDishes ranks a hand-built near-duplicate first; substitutes respect household exclusions (KG-4)
  CHECK: node scripts/verify/leaf-1.3.4.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.4 G2 PASSED
  EVIDENCE: pending

- [ ] G3: no household-scoped edge visible to another household (KG-2)
  CHECK: node scripts/verify/leaf-1.3.4.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.4 G3 PASSED
  EVIDENCE: pending
