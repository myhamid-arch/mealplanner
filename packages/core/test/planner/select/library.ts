// The seed library (data/seed-dishes/*.json, data/adjusters.json; leaf-1.2.4 ADR-1) as planner
// input, following the toSolve() mapping of scripts/verify/leaf-1.2.4.mjs. Until the 1.4.1 loader
// exists (R-17), tests build it from the JSON files: the Vitest suites import them as modules
// (seed-files.ts) and the verify script reads them; core itself does no I/O (ARC-3). Ingredient
// ids are `ing:<slug>`, deliberately not the slug, so every exclusion goes through the R-36
// slug → id resolution.
import {
  variantNutritionPer100gCooked,
  type CatalogContext,
  type MethodKey,
  type VariantInput,
} from "../../../src/nutrition/index.js";
import type { PlanDish } from "../../../src/planner/select/index.js";
import type { ComponentRole, IngredientCategory, Portioning } from "../../../src/types/index.js";

type SeedIngredientRow = {
  ingredient_slug: string;
  raw_g_per_batch: number;
  is_absorbed_oil: boolean;
  cooking_liquid: "absorbed" | "retained" | null;
  yield_override: number | null;
};
type SeedVariant = {
  key: string;
  method: MethodKey;
  label: string;
  is_default: boolean;
  steps: string[];
  ingredients: SeedIngredientRow[];
};
type SeedComponent = {
  key: string;
  name: string;
  role: ComponentRole;
  portioning: Portioning;
  unit_label: string | null;
  min_serving_g: number;
  max_serving_g: number;
  default_serving_g: number;
  step_g: number;
  required: boolean;
  variants: SeedVariant[];
};
export type SeedDish = {
  slug: string;
  name: string;
  cuisine: string;
  slot_keys: string[];
  is_packable: boolean;
  served_cold_ok: boolean;
  status: "draft" | "active" | "retired";
  version: number;
  components: SeedComponent[];
};
type CatalogRow = {
  slug: string;
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
  unit_weight_g: number | null;
  dietary_flags: string[];
};

export const ingredientId = (slug: string): string => `ing:${slug}`;

/** The raw seed and catalogue files, as parsed JSON. */
export type SeedFiles = {
  ingredients: { ingredients: CatalogRow[] };
  methodYields: {
    yields: Array<{
      method: MethodKey;
      ingredient_category: IngredientCategory;
      yield_factor: number;
      fat_retention: number;
      oil_absorption_g_per_100g_raw: number;
    }>;
  };
  dishes: SeedDish[];
  adjusters: { adjusters: SeedDish[] };
};

export type SeedLibrary = {
  dishes: PlanDish[];
  adjusters: PlanDish[];
  catalog: CatalogContext;
  /** Catalogue rows by slug, for independent checks. */
  rows: Map<string, CatalogRow>;
  seed: { dishes: SeedDish[]; adjusters: SeedDish[] };
};

export function buildCatalog(files: SeedFiles): {
  catalog: CatalogContext;
  rows: Map<string, CatalogRow>;
} {
  const snapshot = files.ingredients;
  const rows = new Map(snapshot.ingredients.map((i) => [i.slug, i]));
  const catalog: CatalogContext = {
    ingredients: new Map(
      snapshot.ingredients.map((i) => [
        ingredientId(i.slug),
        {
          id: ingredientId(i.slug),
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
        },
      ]),
    ),
    methodYields: files.methodYields.yields.map((r) => ({
      method: r.method,
      category: r.ingredient_category,
      yieldFactor: r.yield_factor,
      fatRetention: r.fat_retention,
      oilAbsorptionGPer100gRaw: r.oil_absorption_g_per_100g_raw,
    })),
  };
  return { catalog, rows };
}

function variantInput(v: SeedVariant): VariantInput {
  return {
    method: v.method,
    ingredients: v.ingredients.map((r) => ({
      ingredientId: ingredientId(r.ingredient_slug),
      rawG: r.raw_g_per_batch,
      isAbsorbedOil: r.is_absorbed_oil,
      ...(r.cooking_liquid === null ? {} : { cookingLiquid: r.cooking_liquid }),
      ...(r.yield_override === null ? {} : { yieldOverride: r.yield_override }),
    })),
  };
}

/** One seed record as a `PlanDish`. */
export function toPlanDish(
  d: SeedDish,
  catalog: CatalogContext,
  rows: ReadonlyMap<string, CatalogRow>,
): PlanDish {
  return {
    id: d.slug,
    version: d.version,
    name: d.name,
    cuisineKey: d.cuisine,
    slotKeys: d.slot_keys,
    status: d.status,
    isPackable: d.is_packable,
    servedColdOk: d.served_cold_ok,
    components: d.components.map((c) => ({
      id: `${d.slug}.${c.key}`,
      name: c.name,
      role: c.role,
      portioning: c.portioning,
      unitLabel: c.unit_label,
      minServingG: c.min_serving_g,
      maxServingG: c.max_serving_g,
      defaultServingG: c.default_serving_g,
      stepG: c.step_g,
      unitWeightG: null,
      required: c.required,
      variants: c.variants.map((v) => {
        const input = variantInput(v);
        return {
          id: `${d.slug}.${c.key}.${v.key}`,
          isDefault: v.is_default,
          label: v.label,
          methodKey: v.method,
          needsReview: false,
          steps: v.steps,
          input,
          per100g: variantNutritionPer100gCooked(input, catalog).per100g,
          ingredients: [...new Set(v.ingredients.map((r) => r.ingredient_slug))].map((slug) => {
            const row = rows.get(slug);
            if (row === undefined) throw new Error(`unknown ingredient ${slug} in ${d.slug}`);
            return {
              id: ingredientId(slug),
              slug,
              category: row.category,
              dietaryFlags: row.dietary_flags,
            };
          }),
        };
      }),
    })),
  };
}

/** The seed library and adjusters as planner input, with the catalogue context. */
export function buildSeedLibrary(files: SeedFiles): SeedLibrary {
  const { catalog, rows } = buildCatalog(files);
  const seedDishes = [...files.dishes].sort((a, b) =>
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0,
  );
  const seedAdjusters = files.adjusters.adjusters;
  return {
    dishes: seedDishes.map((d) => toPlanDish(d, catalog, rows)),
    adjusters: seedAdjusters.map((d) => toPlanDish(d, catalog, rows)),
    catalog,
    rows,
    seed: { dishes: seedDishes, adjusters: seedAdjusters },
  };
}
