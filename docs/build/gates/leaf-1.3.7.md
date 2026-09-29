# Gates: leaf-1.3.7 Contract gaps in learning and recipes

OWNS: docs/decisions/leaf-1.3.7-*.md, packages/core/src/learning/rules/practical.ts, packages/core/test/learning/rules/practical*.test.ts, packages/db/test/nutrition-recompute*.int.test.ts, apps/web/test/api/recipe-draft*.int.test.ts, scripts/verify/leaf-1.3.7.mjs

Scope: R-82: close the contract gaps the root review (R9) found in node-1.3's scope — FBK-3's practical tags (W-23, not implemented), DM-4's nutrition recompute on change (untested) and REC-6's admin-initiated draft job (untested past queueing), as specified in docs/spec (06 §2 FBK-3, 02 DM-4, 05 §6 REC-6, 11-build-plan.md §8 R-82)

- [ ] G1: FBK-3 practical tags (W-23, R-82): at least 2 household reviews tagging one dish hard_to_pack, went_soggy_in_box or cold_is_bad on meals in packed slots give one pending proposal of a soft exclusion of that dish scoped to the household's packed slot keys; took_too_long gives a digest note and no op; one such review gives no proposal (negative control)
  CHECK: node scripts/verify/leaf-1.3.7.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.7 G1 PASSED
  EVIDENCE: pending

- [ ] G2: DM-4 nutrition recompute: a recipe change set that changes a variant's ingredient grams queues nutrition.recompute; the worker job rewrites that variant's dish_nutrition_cache row to the engine's new per-100 g values with a later computed_at and leaves other variants' rows unchanged; the stale row fails the same comparison (negative control)
  CHECK: node scripts/verify/leaf-1.3.7.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.7 G2 PASSED
  EVIDENCE: pending

- [ ] G3: REC-6 admin-initiated generation: the recipe.draft job with a recorded model response saves a draft dish (not active) with example plates for the requested day and slot, and the save path activates it; a schema-failing recorded response saves nothing (negative control)
  CHECK: node scripts/verify/leaf-1.3.7.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.7 G3 PASSED
  EVIDENCE: pending

- [ ] G4: no regression: leaf-1.3.3 G1 and G2, and apps/web test:integration, pass
  CHECK: node scripts/verify/leaf-1.3.7.mjs --gate G4
  EXPECT: VERIFY leaf-1.3.7 G4 PASSED
  EVIDENCE: pending
