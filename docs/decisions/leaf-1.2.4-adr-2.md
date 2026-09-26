# leaf-1.2.4 ADR-2: variant-level energy check with source-specific factors (R-22, R-30)

Status: proposed (CP1)

## Context
NUT-4's generic check `4P + 4C + 9F + 2·fibre` fails correct USDA data for foods whose energy the source computes with food-specific factors (R-22). 296 of 363 catalogue ingredients carry `meta.atwater_factors` (`protein`, `fat`, `carbohydrate`). R-30 assigns this leaf a variant-level check in `packages/core/src/nutrition/atwater.ts`: the variant's kcal compared with the sum of its ingredients' predicted energy, each ingredient using its own factors where recorded (carbohydrate factor on `carbs + fibre`, no fibre term) and 4/4/9/2 otherwise, within 12 %. `atwaterCheck` stays unchanged.

The engine's `CatalogIngredient` has no factor field and `batch.ts` is outside this leaf's OWNS, so the factors come in as a separate argument and the per-ingredient attribution is computed in `atwater.ts`.

## Decision
```ts
// @mealplanner/core/nutrition
export type AtwaterFactors = { protein: number; fat: number; carbohydrate: number };
export function variantAtwaterCheck(
  v: VariantInput,
  ctx: CatalogContext,
  factors: ReadonlyMap<string, AtwaterFactors>, // ingredient id → its source factors
): { ok: boolean; deltaPct: number; kcal: number; predictedKcal: number };
```
- `kcal` is the batch energy the engine computes (`variantNutritionPer100gCooked` basis, whole batch).
- `predictedKcal = Σᵢ` predicted energy of what ingredient `i` contributes to the batch, using exactly the NUT-3 attribution: a non-absorbed ingredient contributes its raw grams with its fat scaled by `fat_retention(m, cᵢ)` (an absorbed cooking liquid keeps all its fat, as in `batch.ts`); an absorbed cooking fat contributes its share of `A = min(Σ absorption, listed fat)`. R-13 known zeros are applied first, as the engine does.
  - with factors: `f_P·P + f_C·(C + fibre) + f_F·F`;
  - without: `4P + 4C + 9F + 2·fibre`.
- `deltaPct = |kcal − predictedKcal| / kcal · 100`, `ok = deltaPct ≤ ATWATER_TOLERANCE_PCT` (12). Zero kcal follows `atwaterCheck`'s rule.
- Unit test invariant: with an empty factor map the result equals `atwaterCheck` on the variant's per-100 g nutrients (same attribution as the engine), so the new code cannot drift from `batch.ts` unnoticed.

## Alternatives
- Adding `atwaterFactors` to `CatalogIngredient`: changes the engine's input type outside OWNS. Rejected.
- Comparing per-100 g values with a weighted-average factor: equivalent only when every ingredient has the same macro profile. Rejected.

## Consequences
- `variantNutritionPer100gCooked` still emits its generic `atwater_variant` warning; callers that have catalogue factors (the loader of 1.4.1, 1.3.1's REC-5 step 5, this leaf's G3) decide `needs_review` with `variantAtwaterCheck`. 1.2.1 G1–G4, including 100 % line coverage of `nutrition/`, must still pass.
- `ENGINE_VERSION` is unchanged: no computed nutrient value changes.
