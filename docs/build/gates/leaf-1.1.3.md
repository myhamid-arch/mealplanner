# Gates: leaf-1.1.3 Catalogue data

OWNS: docs/decisions/leaf-1.1.3-*.md, data/ingredients.*, data/method-yields.*, data/cuisines.json, data/soluble-fibre.csv, data/substitutes.csv, scripts/import-fdc.ts, scripts/verify/leaf-1.1.3.mjs

Scope: Catalogue data, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: at least 250 ingredients with required fields, source and AE availability; at least 40 UAE-specific items (NUT-7)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G1
  EXPECT: VERIFY leaf-1.1.3 G1 PASSED
  EVIDENCE: pending

- [ ] G2: every ingredient passes the Atwater check or is marked confidence low with a reason (NUT-4)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G2
  EXPECT: VERIFY leaf-1.1.3 G2 PASSED
  EVIDENCE: pending

- [ ] G3: method-yield rows exist with a source for every (method, category) used by the seed library (NUT-5)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G3
  EXPECT: VERIFY leaf-1.1.3 G3 PASSED
  EVIDENCE: pending

- [ ] G4: soluble-fibre values carry citations; unknowns are null, not 0 (NUT-8)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G4
  EXPECT: VERIFY leaf-1.1.3 G4 PASSED
  EVIDENCE: pending

- [ ] G5: allergen dietary_flags present so sesame expands to tahini, hummus and za'atar (R2-ONB-3)
  CHECK: node scripts/verify/leaf-1.1.3.mjs --gate G5
  EXPECT: VERIFY leaf-1.1.3 G5 PASSED
  EVIDENCE: pending

- [ ] G6: architect spot-check of 20 random ingredients against cited sources
  EVIDENCE: pending
