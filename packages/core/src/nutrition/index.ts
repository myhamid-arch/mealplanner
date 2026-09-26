// Public entry of the nutrition engine: @mealplanner/core/nutrition (03-nutrition-engine §7).

/** Bump on any formula change: it invalidates dish_nutrition_cache (DM-4). */
export const ENGINE_VERSION: string = "1.0.0";

export { atwaterCheck } from "./atwater.js";
export { NutritionError, type NutritionErrorCode } from "./errors.js";
export { plateNutrients } from "./plate.js";
export { rawForCooked } from "./raw.js";
export type {
  CatalogContext,
  CatalogIngredient,
  IngredientCategory,
  MethodKey,
  MethodYield,
  Nutrients,
  NutritionWarning,
  VariantIngredientInput,
  VariantInput,
} from "./types.js";
export { variantNutritionPer100gCooked } from "./variant.js";
