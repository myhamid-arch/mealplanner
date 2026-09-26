// The catalogue and seed-library data files (leaf 1.1.3 `data/*`, leaf 1.2.4 `data/seed-dishes/**`,
// `data/adjusters.json`), read and checked before anything is written (BLD-8 R-17).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  COMPONENT_ROLES,
  COOKING_LIQUIDS,
  DISH_STATUSES,
  INGREDIENT_CATEGORIES,
  NUTRITION_CONFIDENCES,
  PORTIONINGS,
} from "@mealplanner/core/types";

const nullableNum = z.number().nullable();

const AtwaterFactorsSchema = z.object({
  protein: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  carbohydrate: z.number().nonnegative(),
});

export const IngredientFileRowSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  category: z.enum(INGREDIENT_CATEGORIES),
  kcal: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  sat_fat_g: z.number().nonnegative(),
  fibre_g: z.number().nonnegative(),
  soluble_fibre_g: nullableNum,
  sugar_g: nullableNum,
  sodium_mg: nullableNum,
  density_g_per_ml: nullableNum,
  unit_weight_g: nullableNum,
  unit_label: z.string().nullable(),
  edible_portion: z.number().positive().max(1),
  dietary_flags: z.array(z.string()),
  nutrition_source: z.string().min(1),
  nutrition_confidence: z.enum(NUTRITION_CONFIDENCES),
  locale_availability: z.record(z.string(), z.enum(["common", "available", "rare"])),
  meta: z
    .object({ atwater_factors: AtwaterFactorsSchema.nullable().optional() })
    .loose()
    .optional(),
});
export type IngredientFileRow = z.infer<typeof IngredientFileRowSchema>;

const MethodSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  appeal_tags: z.array(z.string()),
});

const YieldSchema = z.object({
  method: z.string().min(1),
  ingredient_category: z.enum(INGREDIENT_CATEGORIES),
  yield_factor: z.number().positive(),
  fat_retention: z.number().min(0).max(1),
  oil_absorption_g_per_100g_raw: z.number().nonnegative(),
});

const CuisineSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  parent_key: z.string().nullable(),
});

const VariantIngredientSchema = z.object({
  ingredient_slug: z.string().min(1),
  raw_g_per_batch: z.number().positive(),
  role_note: z.string().nullable(),
  is_absorbed_oil: z.boolean(),
  cooking_liquid: z.enum(COOKING_LIQUIDS).nullable(),
  yield_override: z.number().positive().nullable(),
});

const VariantSchema = z.object({
  key: z.string().min(1),
  method: z.string().min(1),
  label: z.string().min(1),
  is_default: z.boolean(),
  reference_batch_cooked_g: z.number().positive(),
  cook_time_min: z.number().int().positive().nullable(),
  notes: z.string().nullable(),
  steps: z.array(z.string().min(1)).min(1),
  ingredients: z.array(VariantIngredientSchema).min(1),
});

const ComponentSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(COMPONENT_ROLES),
  portioning: z.enum(PORTIONINGS),
  unit_label: z.string().nullable(),
  min_serving_g: z.number().nonnegative(),
  max_serving_g: z.number().positive(),
  default_serving_g: z.number().nonnegative(),
  step_g: z.number().positive(),
  sort_order: z.number().int(),
  required: z.boolean(),
  variants: z.array(VariantSchema).min(1),
});

export const SeedDishSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  cuisine: z.string().min(1),
  secondary_cuisine: z.string().nullable(),
  slot_keys: z.array(z.string()).min(1),
  flavour_tags: z.array(z.string()),
  is_packable: z.boolean(),
  served_cold_ok: z.boolean(),
  source: z.literal("seed"),
  status: z.enum(DISH_STATUSES),
  version: z.number().int().positive(),
  components: z.array(ComponentSchema).min(1),
});
export type SeedDish = z.infer<typeof SeedDishSchema>;

export interface CatalogueFiles {
  ingredients: IngredientFileRow[];
  methods: z.infer<typeof MethodSchema>[];
  yields: z.infer<typeof YieldSchema>[];
  cuisines: z.infer<typeof CuisineSchema>[];
  dishes: SeedDish[];
  adjusters: SeedDish[];
}

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Reads and validates every data file; throws before any write if one is malformed. */
export function readCatalogueFiles(dataDir: string): CatalogueFiles {
  const ingredients = z
    .object({ ingredients: z.array(IngredientFileRowSchema) })
    .parse(json(join(dataDir, "ingredients.v1.json"))).ingredients;
  const yields = z
    .object({ methods: z.array(MethodSchema), yields: z.array(YieldSchema) })
    .parse(json(join(dataDir, "method-yields.v1.json")));
  const cuisines = z.array(CuisineSchema).parse(json(join(dataDir, "cuisines.json")));
  const dishDir = join(dataDir, "seed-dishes");
  const dishes = readdirSync(dishDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => SeedDishSchema.parse(json(join(dishDir, f))));
  const adjusters = z
    .object({ adjusters: z.array(SeedDishSchema) })
    .parse(json(join(dataDir, "adjusters.json"))).adjusters;
  return {
    ingredients,
    methods: yields.methods,
    yields: yields.yields,
    cuisines,
    dishes,
    adjusters,
  };
}

/** R-22: the source-specific energy factors recorded in each ingredient's `meta`, by slug. */
export function atwaterFactorsBySlug(
  ingredients: readonly IngredientFileRow[],
): Map<string, z.infer<typeof AtwaterFactorsSchema>> {
  const out = new Map<string, z.infer<typeof AtwaterFactorsSchema>>();
  for (const i of ingredients) {
    const f = i.meta?.atwater_factors;
    if (f !== undefined && f !== null)
      out.set(i.slug, { protein: f.protein, fat: f.fat, carbohydrate: f.carbohydrate });
  }
  return out;
}
