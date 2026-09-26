// Test-only: the real catalogue from data/*.v1.json as a RecipeCatalogue (R-17: until the 1.4.1
// loader exists, leaves read the JSON files directly in tests).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IngredientCategory, MethodKey } from "@mealplanner/core/nutrition";
import type { RecipeCatalogue } from "../../../src/recipes/index.js";

type RawIngredient = {
  slug: string;
  name: string;
  category: IngredientCategory;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sat_fat_g: number;
  fibre_g: number;
  soluble_fibre_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  dietary_flags: string[];
  meta: { atwater_factors: { protein: number; fat: number; carbohydrate: number } | null };
};

type RawYield = {
  method: MethodKey;
  ingredient_category: IngredientCategory;
  yield_factor: number;
  fat_retention: number;
  oil_absorption_g_per_100g_raw: number;
};

/** The repository root: the nearest ancestor holding data/ingredients.v1.json. */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "data", "ingredients.v1.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("data/ingredients.v1.json not found above the test");
    dir = parent;
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot(), path), "utf8"));
}

let cached: RecipeCatalogue | undefined;

export function loadCatalogue(): RecipeCatalogue {
  if (cached !== undefined) return cached;
  const ingredients = readJson("data/ingredients.v1.json") as { ingredients: RawIngredient[] };
  const yields = readJson("data/method-yields.v1.json") as {
    methods: Array<{ key: MethodKey }>;
    yields: RawYield[];
  };
  const cuisines = readJson("data/cuisines.json") as Array<{ key: string }>;
  cached = {
    ingredients: ingredients.ingredients.map((i) => ({
      slug: i.slug,
      name: i.name,
      category: i.category,
      per100gRaw: {
        kcal: i.kcal,
        protein: i.protein_g,
        carbs: i.carbs_g,
        fat: i.fat_g,
        satFat: i.sat_fat_g,
        fibre: i.fibre_g,
        solubleFibre: i.soluble_fibre_g,
        sugar: i.sugar_g,
        sodiumMg: i.sodium_mg,
      },
      dietaryFlags: i.dietary_flags,
      atwaterFactors:
        i.meta.atwater_factors === null
          ? null
          : {
              protein: i.meta.atwater_factors.protein,
              fat: i.meta.atwater_factors.fat,
              carbohydrate: i.meta.atwater_factors.carbohydrate,
            },
    })),
    methods: yields.methods.map((m) => m.key),
    cuisines: cuisines.map((c) => c.key),
    methodYields: yields.yields.map((y) => ({
      method: y.method,
      category: y.ingredient_category,
      yieldFactor: y.yield_factor,
      fatRetention: y.fat_retention,
      oilAbsorptionGPer100gRaw: y.oil_absorption_g_per_100g_raw,
    })),
  };
  return cached;
}
