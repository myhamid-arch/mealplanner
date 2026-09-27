// The nutrition engine's catalogue (03 §7) read from the database: global catalogue ingredients plus
// the household's private ones, keyed by ingredient id, with the slug maps the planner and the
// recipe generator need (BLD-8 R-36: exclusion keys are slugs, engine ids are ingredient ids).
import { isNull, or, eq } from "drizzle-orm";
import type {
  AtwaterFactors,
  CatalogContext,
  IngredientCategory,
  MethodKey,
  MethodYield,
  Nutrients,
} from "@mealplanner/core/nutrition";
import type { Executor } from "../../repos/index.js";
import { cuisine, ingredient, methodYield, preparationMethod } from "../../schema/index.js";

export interface CatalogIngredientRow {
  id: string;
  slug: string;
  name: string;
  category: IngredientCategory;
  dietaryFlags: string[];
  per100gRaw: Nutrients;
  needsReview: boolean;
  nutritionSource: string;
  unitWeightG: number | null;
  householdId: string | null;
}

export interface DbCatalog {
  context: CatalogContext;
  ingredients: Map<string, CatalogIngredientRow>;
  idBySlug: Map<string, string>;
  methodKeyById: Map<string, MethodKey>;
  methodIdByKey: Map<string, string>;
  cuisineKeyById: Map<string, string>;
  cuisineIdByKey: Map<string, string>;
  /** 1.4.10 (R-68): cuisine key → label, for the planner's plain reasons (W-12). */
  cuisineLabelByKey: Map<string, string>;
  methodYields: MethodYield[];
}

export function per100gOf(row: typeof ingredient.$inferSelect): Nutrients {
  return {
    kcal: row.kcal,
    protein: row.proteinG,
    carbs: row.carbsG,
    fat: row.fatG,
    satFat: row.satFatG,
    fibre: row.fibreG,
    solubleFibre: row.solubleFibreG,
    sugar: row.sugarG,
    sodiumMg: row.sodiumMg,
  };
}

/**
 * The catalogue visible to a household (`householdId`), or the global catalogue only (`null`).
 * Catalogue tables are global reference data; this read filters household-private ingredients by
 * the given household, so it never returns another household's rows (DM-1).
 */
export async function loadDbCatalog(db: Executor, householdId: string | null): Promise<DbCatalog> {
  const ingredientRows = await db
    .select()
    .from(ingredient)
    .where(
      householdId === null
        ? isNull(ingredient.createdByHouseholdId)
        : or(
            isNull(ingredient.createdByHouseholdId),
            eq(ingredient.createdByHouseholdId, householdId),
          ),
    );
  const methods = await db.select().from(preparationMethod);
  const cuisines = await db.select().from(cuisine);
  const yields = await db.select().from(methodYield);
  const methodKeyById = new Map(methods.map((m) => [m.id, m.key as MethodKey]));
  const ingredients = new Map<string, CatalogIngredientRow>();
  for (const row of ingredientRows)
    ingredients.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      dietaryFlags: row.dietaryFlags,
      per100gRaw: per100gOf(row),
      needsReview: row.needsReview,
      nutritionSource: row.nutritionSource,
      unitWeightG: row.unitWeightG,
      householdId: row.createdByHouseholdId,
    });
  const methodYields: MethodYield[] = yields.flatMap((y) => {
    const method = methodKeyById.get(y.methodId);
    return method === undefined
      ? []
      : [
          {
            method,
            category: y.ingredientCategory,
            yieldFactor: y.yieldFactor,
            fatRetention: y.fatRetention,
            oilAbsorptionGPer100gRaw: y.oilAbsorptionGPer100gRaw,
          },
        ];
  });
  return {
    context: {
      ingredients: new Map(
        [...ingredients.values()].map((i) => [
          i.id,
          { id: i.id, category: i.category, per100gRaw: i.per100gRaw },
        ]),
      ),
      methodYields,
    },
    ingredients,
    idBySlug: new Map([...ingredients.values()].map((i) => [i.slug, i.id])),
    methodKeyById,
    methodIdByKey: new Map(methods.map((m) => [m.key, m.id])),
    cuisineKeyById: new Map(cuisines.map((c) => [c.id, c.key])),
    cuisineIdByKey: new Map(cuisines.map((c) => [c.key, c.id])),
    // 1.4.10 (R-68): cuisine labels for the planner's plain reasons (W-12).
    cuisineLabelByKey: new Map(cuisines.map((c) => [c.key, c.label])),
    methodYields,
  };
}

/** R-22 factors by slug (from the catalogue data file) re-keyed by ingredient id. */
export function factorsById(
  catalog: DbCatalog,
  bySlug: ReadonlyMap<string, AtwaterFactors>,
): Map<string, AtwaterFactors> {
  const out = new Map<string, AtwaterFactors>();
  for (const [slug, f] of bySlug) {
    const id = catalog.idBySlug.get(slug);
    if (id !== undefined) out.set(id, f);
  }
  return out;
}
