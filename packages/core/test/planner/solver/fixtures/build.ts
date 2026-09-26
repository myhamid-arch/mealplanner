// Builds the solver's test dishes (DishForSolve) from ./dishes.ts with the 1.2.1 nutrition engine.
import {
  variantNutritionPer100gCooked,
  type CatalogContext,
  type CatalogIngredient,
  type VariantInput,
} from "../../../../src/nutrition/index.js";
import type {
  ComponentForSolve,
  DishForSolve,
  VariantForSolve,
} from "../../../../src/planner/solver/index.js";
import { TEST_INGREDIENTS, TEST_YIELDS } from "./catalog.js";
import { ADJUSTERS, DISHES, type ComponentSpec, type VariantSpec } from "./dishes.js";

export function testCatalog(): CatalogContext {
  const ingredients = new Map<string, CatalogIngredient>();
  for (const i of TEST_INGREDIENTS)
    ingredients.set(i.slug, {
      id: i.slug,
      category: i.category,
      per100gRaw: {
        kcal: i.kcal,
        protein: i.proteinG,
        carbs: i.carbsG,
        fat: i.fatG,
        satFat: i.satFatG,
        fibre: i.fibreG,
        solubleFibre: i.solubleFibreG,
        sugar: i.sugarG,
        sodiumMg: i.sodiumMg,
      },
    });
  return { ingredients, methodYields: TEST_YIELDS };
}

function ingredientOf(slug: string) {
  const found = TEST_INGREDIENTS.find((i) => i.slug === slug);
  if (found === undefined) throw new Error(`test catalogue has no ingredient "${slug}"`);
  return found;
}

function buildVariant(id: string, spec: VariantSpec, ctx: CatalogContext): VariantForSolve {
  const input: VariantInput = {
    method: spec.method,
    ingredients: spec.lines.map(([slug, rawG, how, yieldOverride]) => ({
      ingredientId: slug,
      rawG,
      isAbsorbedOil: how === "oil",
      ...(how === "absorbed" || how === "retained" ? { cookingLiquid: how } : {}),
      ...(yieldOverride === undefined ? {} : { yieldOverride }),
    })),
  };
  const { per100g } = variantNutritionPer100gCooked(input, ctx);
  const seen = new Set<string>();
  const ingredients = spec.lines
    .map(([slug]) => ingredientOf(slug))
    .filter((i) => (seen.has(i.slug) ? false : (seen.add(i.slug), true)))
    .map((i) => ({ id: i.slug, category: i.category, dietaryFlags: i.dietaryFlags }));
  return { id, isDefault: spec.isDefault ?? false, per100g, ingredients };
}

function buildComponent(
  dishKey: string,
  spec: ComponentSpec,
  ctx: CatalogContext,
): ComponentForSolve {
  const id = `${dishKey}.${spec.key}`;
  return {
    id,
    role: spec.role,
    portioning: spec.portioning ?? "continuous",
    minServingG: spec.min,
    maxServingG: spec.max,
    defaultServingG: spec.def,
    stepG: spec.step ?? 5,
    unitWeightG: spec.unitWeightG ?? null,
    required: spec.required ?? true,
    variants: spec.variants.map((v) => buildVariant(`${id}.${v.key}`, v, ctx)),
  };
}

let cache: { dishes: DishForSolve[]; adjusters: DishForSolve[] } | undefined;

/** The test dishes and adjusters (computed once). */
export function testDishes(): { dishes: DishForSolve[]; adjusters: DishForSolve[] } {
  if (cache !== undefined) return cache;
  const ctx = testCatalog();
  const dishes = DISHES.map((d) => ({
    id: d.key,
    isPackable: d.packable,
    servedColdOk: d.cold,
    components: d.components.map((c) => buildComponent(d.key, c, ctx)),
  }));
  const adjusters = ADJUSTERS.map((a) => ({
    id: `adjuster.${a.key}`,
    isPackable: a.packable,
    servedColdOk: a.cold,
    components: [
      buildComponent(
        `adjuster.${a.key}`,
        {
          key: "side",
          role: "adjuster",
          min: a.min,
          max: a.max,
          def: a.def,
          ...(a.step === undefined ? {} : { step: a.step }),
          variants: a.variants,
        },
        ctx,
      ),
    ],
  }));
  cache = { dishes, adjusters };
  return cache;
}

/** Slot keys each test dish suits. */
export function dishSlots(dishId: string): string[] {
  return DISHES.find((d) => d.key === dishId)?.slots ?? [];
}
