# Gates: leaf-1.2.1 Nutrition engine

OWNS: docs/decisions/leaf-1.2.1-*.md, packages/core/src/nutrition/**, packages/core/test/nutrition/**, scripts/verify/leaf-1.2.1.mjs

Scope: Nutrition engine, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: at least 15 hand-computed golden variants (grilled vs fried, breaded, boiled grain, retained-water stew, absorbed-oil cap) match within 0.5% (NUT-3)
  CHECK: node scripts/verify/leaf-1.2.1.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.1 G1 PASSED
  EVIDENCE: pending

- [ ] G2: rawForCooked round-trips to batch totals within 0.1%
  CHECK: node scripts/verify/leaf-1.2.1.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.1 G2 PASSED
  EVIDENCE: pending

- [ ] G3: same raw ingredients grilled vs deep_fried give fat per 100 g cooked in the expected direction; identical methods give identical output (negative control)
  CHECK: node scripts/verify/leaf-1.2.1.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.1 G3 PASSED
  EVIDENCE: pending

- [ ] G4: 100% line coverage of nutrition/ (NUT-1)
  CHECK: node scripts/verify/leaf-1.2.1.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.1 G4 PASSED
  EVIDENCE: pending
