// Catalogue lookups and input validation (ADR-1, SPEC-Q-6).
import { NutritionError } from "./errors.js";
import { assertValidNutrients } from "./nutrients.js";
import type {
  CatalogContext,
  CatalogIngredient,
  IngredientCategory,
  MethodKey,
  MethodYield,
  VariantIngredientInput,
} from "./types.js";

export function lookupIngredient(ctx: CatalogContext, id: string): CatalogIngredient {
  const ingredient = ctx.ingredients.get(id);
  if (ingredient === undefined) {
    throw new NutritionError("unknown_ingredient", `unknown ingredient "${id}"`);
  }
  assertValidNutrients(ingredient.per100gRaw, `ingredient "${id}"`);
  return ingredient;
}

export function lookupYield(
  ctx: CatalogContext,
  method: MethodKey,
  category: IngredientCategory,
): MethodYield {
  const rows = ctx.methodYields.filter((y) => y.method === method && y.category === category);
  const row = rows[0];
  if (row === undefined) {
    throw new NutritionError(
      "missing_method_yield",
      `no method_yield row for (${method}, ${category})`,
    );
  }
  if (rows.length > 1) {
    throw new NutritionError(
      "duplicate_method_yield",
      `${String(rows.length)} method_yield rows for (${method}, ${category})`,
    );
  }
  const where = `method_yield (${method}, ${category})`;
  assertPositive(row.yieldFactor, `${where}: yieldFactor`);
  assertInRange(row.fatRetention, 0, 1, `${where}: fatRetention`);
  assertNonNegative(row.oilAbsorptionGPer100gRaw, `${where}: oilAbsorptionGPer100gRaw`);
  return row;
}

export function assertValidRow(row: VariantIngredientInput): void {
  const where = `variant ingredient "${row.ingredientId}"`;
  assertNonNegative(row.rawG, `${where}: rawG`);
  if (row.yieldOverride !== undefined) assertPositive(row.yieldOverride, `${where}: yieldOverride`);
  if (row.isAbsorbedOil && row.cookingLiquid !== undefined) {
    throw new NutritionError(
      "invalid_input",
      `${where}: an absorbed cooking fat cannot also be a cooking liquid`,
    );
  }
}

export function assertNonNegative(value: number, what: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new NutritionError(
      "invalid_input",
      `${what} must be a finite number >= 0 (got ${String(value)})`,
    );
  }
}

function assertPositive(value: number, what: string): void {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new NutritionError(
      "invalid_input",
      `${what} must be a finite number > 0 (got ${String(value)})`,
    );
  }
}

function assertInRange(value: number, min: number, max: number, what: string): void {
  if (!(Number.isFinite(value) && value >= min && value <= max)) {
    throw new NutritionError(
      "invalid_input",
      `${what} must be between ${String(min)} and ${String(max)} (got ${String(value)})`,
    );
  }
}
