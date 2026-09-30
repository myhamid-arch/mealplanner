# Gates: leaf-1.3.7 Contract gaps in learning and recipes

OWNS: docs/decisions/leaf-1.3.7-*.md, packages/core/src/learning/rules/practical.ts, packages/core/test/learning/rules/practical*.test.ts, packages/db/test/nutrition-recompute*.int.test.ts, apps/web/test/api/recipe-draft*.int.test.ts, scripts/verify/leaf-1.3.7.mjs, packages/core/src/types/enums.ts, packages/db/src/migrations/0008_*.sql, packages/db/src/migrations/meta/**, packages/core/src/planner/select/members.ts, packages/core/src/planner/select/filters.ts, packages/core/src/changes/ops/taste.ts, packages/core/src/learning/rules/satisfied.ts, packages/core/src/learning/rules/config.ts, packages/core/src/learning/rules/index.ts, packages/core/src/learning/rules/run.ts, packages/core/test/planner/select/dish-exclusion*.test.ts, apps/web/components/config/never-serve.tsx, packages/core/src/learning/rules/types.ts, packages/core/src/planner/select/run.ts, packages/graph/src/store/exclusions.ts

Scope: R-82: close the contract gaps the root review (R9) found in node-1.3's scope — FBK-3's practical tags (W-23, not implemented), DM-4's nutrition recompute on change (untested) and REC-6's admin-initiated draft job (untested past queueing), as specified in docs/spec (06 §2 FBK-3, 02 DM-4, 05 §6 REC-6, 11-build-plan.md §8 R-82)

- [x] G1: FBK-3 practical tags (W-23, R-82): at least 2 household reviews tagging one dish hard_to_pack, went_soggy_in_box or cold_is_bad on meals in packed slots give one pending proposal of a dish exclusion (kind dish, not protected) scoped to the household's packed slot keys; once accepted, planned weeks keep that dish out of the packed slots and still offer it in others; took_too_long gives a digest note and no op; one such review gives no proposal (negative control)
  CHECK: node scripts/verify/leaf-1.3.7.mjs --gate G1
  EXPECT: VERIFY leaf-1.3.7 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=86169e1c9d7bba8c6651738969eec41a72f9178917387b6d19a3d666be4ebd2e; exit=0; EXPECT=matched; output-sha256=3a0f3893a509b2cebabf82fc80fcdafd6397eb8f0bb6e8797f02ae3aaab921c5; output-bytes=3469; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: DM-4 nutrition recompute: a recipe change set that changes a variant's ingredient grams queues nutrition.recompute; the worker job rewrites that variant's dish_nutrition_cache row to the engine's new per-100 g values with a later computed_at and leaves other variants' rows unchanged; the stale row fails the same comparison (negative control)
  CHECK: node scripts/verify/leaf-1.3.7.mjs --gate G2
  EXPECT: VERIFY leaf-1.3.7 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=e6df1cd9f65edb61a7e332c520f0f98a318b1db2036f6a23213e128bf51d9c7a; exit=0; EXPECT=matched; output-sha256=bfae81e983cda412e5e112fd15d280586a1569130244514f6fdd1cb61732b270; output-bytes=932; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: REC-6 admin-initiated generation: the recipe.draft job with a recorded model response saves a draft dish (not active) with example plates for the requested day and slot, and the save path activates it; a schema-failing recorded response saves nothing (negative control)
  CHECK: node scripts/verify/leaf-1.3.7.mjs --gate G3
  EXPECT: VERIFY leaf-1.3.7 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b665e53d65e27077ccb40929ad87981595ec7418f61041fc89f5508f89f82585; exit=0; EXPECT=matched; output-sha256=f93d3c548f6aeaa7caf24885dd71a1e926d5e87fa5793bd8fde1dc38bda35ff1; output-bytes=962; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: no regression: leaf-1.3.3 G1 and G2, and apps/web test:integration, pass
  CHECK: node scripts/verify/leaf-1.3.7.mjs --gate G4
  EXPECT: VERIFY leaf-1.3.7 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ced1e95f53d42699cf15bfe46a1494efd9a0631a6ed298f916508f3e675a12af; exit=0; EXPECT=matched; output-sha256=57314ed8a5a6ed659b428460701bd76ef70995f40cae3635993f413eb3b3e172; output-bytes=891; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
