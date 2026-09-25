# Gates: leaf-1.2.4 Seed dish library

OWNS: docs/decisions/leaf-1.2.4-*.md, data/seed-dishes/**, data/adjusters.json, scripts/verify/leaf-1.2.4.mjs

Scope: Seed dish library, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: at least 60 active dishes across at least 10 cuisines; at least 8 per slot type and 8 served_cold_ok packable
  CHECK: node scripts/verify/leaf-1.2.4.mjs --gate G1
  EXPECT: VERIFY leaf-1.2.4 G1 PASSED
  EVIDENCE: pending

- [ ] G2: at least 70% of dishes have a component with 2+ variants sharing at least 70% of ingredients (DM-3)
  CHECK: node scripts/verify/leaf-1.2.4.mjs --gate G2
  EXPECT: VERIFY leaf-1.2.4 G2 PASSED
  EVIDENCE: pending

- [ ] G3: every variant passes nutrition validation; at least 15 adjuster dishes
  CHECK: node scripts/verify/leaf-1.2.4.mjs --gate G3
  EXPECT: VERIFY leaf-1.2.4 G3 PASSED
  EVIDENCE: pending

- [ ] G4: at least 80% of dishes feasible for both F1 targeted adults at dinner
  CHECK: node scripts/verify/leaf-1.2.4.mjs --gate G4
  EXPECT: VERIFY leaf-1.2.4 G4 PASSED
  EVIDENCE: pending

- [ ] G5: architect review of 10 random recipes for plausibility, UAE availability and step clarity
  EVIDENCE: pending
