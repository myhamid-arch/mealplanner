# leaf-1.2.1 ADR-1: engine input and output types

Status: proposed (CP1)
Requirement: 03-nutrition-engine §2, §7; 02-domain-model §3–§4; ARC-3 (core does no I/O)

## Context
03 §7 fixes the function signatures but names `VariantInput`, `CatalogContext` and `NutritionWarning` without defining them. `packages/core/src/types/**` belongs to leaf 1.1.2, which is built in parallel, so the engine cannot import shared domain types from there.

## Decision
The engine defines its own structural input types in `packages/core/src/nutrition/types.ts` and exports them from `@mealplanner/core/nutrition`:

- `Nutrients`: exactly the 03 §7 shape.
- `CatalogIngredient` = `{ id, category, per100gRaw: Nutrients }`: the ingredient columns 02 §3 lists per 100 g edible raw, in the `Nutrients` field names.
- `MethodYield` = `{ method, category, yieldFactor, fatRetention, oilAbsorptionGPer100gRaw }`: the method_yield columns the formula uses. `coating_ingredient_id` / `coating_g_per_100g_raw` are not read (ADR-2 §5).
- `CatalogContext` = `{ ingredients: ReadonlyMap<string, CatalogIngredient>, methodYields: readonly MethodYield[] }`. The caller (db service, planner, tests) loads it; the engine reads only its arguments.
- `VariantIngredientInput` = `{ ingredientId, rawG, isAbsorbedOil, cookingLiquid?, yieldOverride? }`: variant_ingredient plus the two per-ingredient facts NUT-3 step 1 and 03 §2 need (SPEC-Q-2).
- `VariantInput` = `{ method, ingredients }`. The reference batch size is not an input: 03 §3 computes `W` from the raw grams.
- `MethodKey` and `IngredientCategory` are the 02 §3 enums as string-literal unions.
- `NutritionWarning` = NUT-4 failures: `atwater_ingredient` (with `ingredientId`) and `atwater_variant`, each with `deltaPct`.

Invalid input (unknown ingredient id, missing method_yield row, negative or non-finite grams or factors, zero cooked mass) throws `NutritionError` with a `code`. A number is never produced from missing data.

## Consequences
- The types are structural, so 1.1.2's row types can be mapped onto them without importing either way.
- If the architect prefers these types to live in `core/types`, they move there in a later leaf; the public names stay.
