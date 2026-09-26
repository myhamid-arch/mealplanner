// The catalogue the recipe generator reads (REC-2 §2, REC-5). Callers load it (db or data files);
// `ai` does no database I/O (ARC-3, R-2). Keys are catalogue slugs; the nutrition engine's
// ingredient id is the slug inside this package.
import type {
  CatalogContext,
  CatalogIngredient,
  IngredientCategory,
  MethodKey,
  MethodYield,
  Nutrients,
} from "@mealplanner/core/nutrition";
import { INGREDIENT_CATEGORIES } from "@mealplanner/core/types";
import type { NewIngredient } from "./schema.js";

/** Source-specific energy factors (R-22), kcal per gram; carbohydrate applies to carbs + fibre. */
export type AtwaterFactors = { protein: number; fat: number; carbohydrate: number };

export type RecipeIngredient = {
  slug: string;
  name: string;
  category: IngredientCategory;
  /** Per 100 g edible raw; carbs are available carbohydrate (R-20). */
  per100gRaw: Nutrients;
  dietaryFlags: readonly string[];
  atwaterFactors: AtwaterFactors | null;
};

export type RecipeCatalogue = {
  ingredients: readonly RecipeIngredient[];
  /** preparation_method keys. */
  methods: readonly MethodKey[];
  /** cuisine keys. */
  cuisines: readonly string[];
  methodYields: readonly MethodYield[];
};

const CATEGORIES: ReadonlySet<string> = new Set(INGREDIENT_CATEGORIES);

export function isIngredientCategory(value: string): value is IngredientCategory {
  return CATEGORIES.has(value);
}

/** A model-proposed ingredient as the engine sees it; unknown nutrients stay null (NUT-8). */
export function newIngredientNutrients(n: NewIngredient): Nutrients {
  return {
    kcal: n.per100g.kcal,
    protein: n.per100g.protein,
    carbs: n.per100g.carbs,
    fat: n.per100g.fat,
    satFat: n.per100g.satFat,
    fibre: n.per100g.fibre,
    solubleFibre: n.per100g.solubleFibre,
    sugar: null,
    sodiumMg: null,
  };
}

/**
 * The engine's CatalogContext over the catalogue plus the response's new ingredients whose
 * category is valid (step 2 rejects the rest before any nutrition is computed).
 */
export function catalogContext(
  catalogue: RecipeCatalogue,
  newIngredients: readonly NewIngredient[] = [],
): CatalogContext {
  const ingredients = new Map<string, CatalogIngredient>();
  for (const i of catalogue.ingredients)
    ingredients.set(i.slug, { id: i.slug, category: i.category, per100gRaw: i.per100gRaw });
  for (const n of newIngredients) {
    if (ingredients.has(n.slug) || !isIngredientCategory(n.category)) continue;
    ingredients.set(n.slug, {
      id: n.slug,
      category: n.category,
      per100gRaw: newIngredientNutrients(n),
    });
  }
  return { ingredients, methodYields: catalogue.methodYields };
}
