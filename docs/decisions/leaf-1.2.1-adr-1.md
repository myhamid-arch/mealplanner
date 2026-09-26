# leaf-1.2.1 ADR-1: engine input and output types

Status: accepted (CP1 APPROVED, BLD-8 R-12 to R-14; built for CP2)
Requirement: 03-nutrition-engine §2, §7; 02-domain-model §3–§4; ARC-3 (core does no I/O)

## Context
03 §7 fixes the function signatures but names `VariantInput`, `CatalogContext` and `NutritionWarning` without defining them. `packages/core/src/types/**` belongs to leaf 1.1.2, which is built in parallel, so the engine cannot import shared domain types from there.

## Decision
The engine defines its own structural input types in `packages/core/src/nutrition/types.ts` and exports them from `@mealplanner/core/nutrition`:

- `Nutrients`: exactly the 03 §7 shape.
- `CatalogIngredient` = `{ id, category, per100gRaw: Nutrients }`: the ingredient columns 02 §3 lists per 100 g edible raw, in the `Nutrients` field names.
- `MethodYield` = `{ method, category, yieldFactor, fatRetention, oilAbsorptionGPer100gRaw }`: the method_yield columns the formula uses. The `coating_*` columns are removed from the spec (R-12).
- `CatalogContext` = `{ ingredients: ReadonlyMap<string, CatalogIngredient>, methodYields: readonly MethodYield[] }`. The caller (db service, planner, tests) loads it; the engine reads only its arguments.
- `VariantIngredientInput` = `{ ingredientId, rawG, isAbsorbedOil, cookingLiquid?, yieldOverride? }`: variant_ingredient plus the two per-ingredient facts NUT-3 step 1 and 03 §2 need (SPEC-Q-2).
- `VariantInput` = `{ method, ingredients }`. The reference batch size is not an input: 03 §3 computes `W` from the raw grams.
- `MethodKey` and `IngredientCategory` are the 02 §3 enums as string-literal unions.
- `NutritionWarning` = NUT-4 failures: `atwater_ingredient` (with `ingredientId`) and `atwater_variant`, each with `deltaPct`.

Invalid input throws `NutritionError` with a `code`: `unknown_ingredient`, `missing_method_yield`, `duplicate_method_yield`, `zero_cooked_mass`, or `invalid_input` (negative or non-finite grams, nutrients or factors; fat retention outside 0–1; a row that is both frying fat and cooking liquid; a yield override on a row that has no cooked mass of its own). A number is never produced from missing data.

## Consequences
- The types are structural, so 1.1.2's row types can be mapped onto them without importing either way.
- R-14: the types stay in `@mealplanner/core/nutrition`; the db loaders and the planner map rows onto them.
