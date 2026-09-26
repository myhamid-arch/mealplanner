// `nutrition.recompute` (ARC-7, DM-4): per-100 g cooked nutrition of each variant into
// `dish_nutrition_cache`, and the variant's `needs_review` flag (PLN-9 §6.3). A variant needs review
// when its energy fails the R-22/R-30 variant check, or when it uses an ingredient that failed NUT-4
// (`ingredient.needs_review`): its numbers cannot be trusted either way (leaf-1.4.1 SPEC-Q-20).
// Both are derived values of the recipe, not configuration, so they are written directly (the
// change-set service writes the recipe itself; DM-6).
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  ENGINE_VERSION,
  variantAtwaterCheck,
  variantNutritionPer100gCooked,
  type AtwaterFactors,
  type VariantInput,
} from "@mealplanner/core/nutrition";
import type { Executor } from "../../repos/index.js";
import {
  component,
  dish,
  dishNutritionCache,
  variant,
  variantIngredient,
} from "../../schema/index.js";
import { factorsById, loadDbCatalog, type DbCatalog } from "./catalog.js";

export interface RecomputeInput {
  /** The household whose dishes to recompute; null = the global seed library. */
  householdId: string | null;
  /** Limit to these variants; all of the scope's variants when omitted. */
  variantIds?: readonly string[];
  /** R-22 source-specific energy factors by ingredient slug (catalogue data file). */
  factorsBySlug: ReadonlyMap<string, AtwaterFactors>;
  now?: Date;
}

export interface RecomputeResult {
  variants: number;
  needsReview: string[];
}

/** The engine input of one variant from its stored rows (engine ids are ingredient ids). */
export function variantInputOf(
  methodKey: VariantInput["method"],
  lines: readonly (typeof variantIngredient.$inferSelect)[],
): VariantInput {
  return {
    method: methodKey,
    ingredients: lines.map((l) => ({
      ingredientId: l.ingredientId,
      rawG: l.rawGPerBatch,
      isAbsorbedOil: l.isAbsorbedOil,
      ...(l.cookingLiquid === null ? {} : { cookingLiquid: l.cookingLiquid }),
      ...(l.yieldOverride === null ? {} : { yieldOverride: l.yieldOverride }),
    })),
  };
}

export async function recomputeNutrition(
  db: Executor,
  input: RecomputeInput,
  catalog?: DbCatalog,
): Promise<RecomputeResult> {
  const cat = catalog ?? (await loadDbCatalog(db, input.householdId));
  const factors = factorsById(cat, input.factorsBySlug);
  const now = input.now ?? new Date();
  const scope =
    input.householdId === null ? isNull(dish.householdId) : eq(dish.householdId, input.householdId);
  const rows = await db
    .select({ variant, dishHouseholdId: dish.householdId })
    .from(variant)
    .innerJoin(component, eq(component.id, variant.componentId))
    .innerJoin(dish, eq(dish.id, component.dishId))
    .where(
      input.variantIds === undefined
        ? scope
        : and(scope, inArray(variant.id, [...input.variantIds])),
    );
  if (rows.length === 0) return { variants: 0, needsReview: [] };
  const lines = await db
    .select()
    .from(variantIngredient)
    .where(
      inArray(
        variantIngredient.variantId,
        rows.map((r) => r.variant.id),
      ),
    );
  const linesByVariant = new Map<string, (typeof variantIngredient.$inferSelect)[]>();
  for (const l of lines) {
    const list = linesByVariant.get(l.variantId) ?? [];
    list.push(l);
    linesByVariant.set(l.variantId, list);
  }
  const needsReview: string[] = [];
  const cacheRows: (typeof dishNutritionCache.$inferInsert)[] = [];
  const flags: { id: string; needsReview: boolean }[] = [];
  for (const { variant: v, dishHouseholdId } of rows) {
    const method = cat.methodKeyById.get(v.methodId);
    const own = (linesByVariant.get(v.id) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    if (method === undefined || own.length === 0) {
      needsReview.push(v.id);
      flags.push({ id: v.id, needsReview: true });
      continue;
    }
    const engineInput = variantInputOf(method, own);
    const { per100g, batchCookedG } = variantNutritionPer100gCooked(engineInput, cat.context);
    const check = variantAtwaterCheck(engineInput, cat.context, factors);
    const badIngredient = own.some(
      (l) => cat.ingredients.get(l.ingredientId)?.needsReview === true,
    );
    const review = !check.ok || badIngredient;
    if (review) needsReview.push(v.id);
    flags.push({ id: v.id, needsReview: review });
    cacheRows.push({
      variantId: v.id,
      householdId: dishHouseholdId,
      kcal: per100g.kcal,
      protein: per100g.protein,
      carbs: per100g.carbs,
      fat: per100g.fat,
      satFat: per100g.satFat,
      fibre: per100g.fibre,
      solubleFibre: per100g.solubleFibre,
      sugar: per100g.sugar,
      sodium: per100g.sodiumMg,
      cookedYieldGPerBatch: batchCookedG,
      computedAt: now,
      engineVersion: ENGINE_VERSION,
    });
  }
  for (const chunk of chunks(cacheRows, 500))
    await db
      .insert(dishNutritionCache)
      .values(chunk)
      .onConflictDoUpdate({
        target: dishNutritionCache.variantId,
        set: {
          kcal: sql`excluded.kcal`,
          protein: sql`excluded.protein`,
          carbs: sql`excluded.carbs`,
          fat: sql`excluded.fat`,
          satFat: sql`excluded.sat_fat`,
          fibre: sql`excluded.fibre`,
          solubleFibre: sql`excluded.soluble_fibre`,
          sugar: sql`excluded.sugar`,
          sodium: sql`excluded.sodium`,
          cookedYieldGPerBatch: sql`excluded.cooked_yield_g_per_batch`,
          computedAt: sql`excluded.computed_at`,
          engineVersion: sql`excluded.engine_version`,
        },
        // Unchanged values keep their row (and computed_at): an idempotent re-run writes nothing.
        setWhere: sql`(${dishNutritionCache.kcal}, ${dishNutritionCache.protein}, ${dishNutritionCache.carbs}, ${dishNutritionCache.fat}, ${dishNutritionCache.satFat}, ${dishNutritionCache.fibre}, ${dishNutritionCache.solubleFibre}, ${dishNutritionCache.sugar}, ${dishNutritionCache.sodium}, ${dishNutritionCache.cookedYieldGPerBatch}, ${dishNutritionCache.engineVersion}) IS DISTINCT FROM (excluded.kcal, excluded.protein, excluded.carbs, excluded.fat, excluded.sat_fat, excluded.fibre, excluded.soluble_fibre, excluded.sugar, excluded.sodium, excluded.cooked_yield_g_per_batch, excluded.engine_version)`,
      });
  for (const value of [true, false]) {
    const ids = flags.filter((f) => f.needsReview === value).map((f) => f.id);
    for (const chunk of chunks(ids, 1000))
      await db
        .update(variant)
        .set({ needsReview: value })
        .where(and(inArray(variant.id, chunk), sql`${variant.needsReview} <> ${value}`));
  }
  return { variants: rows.length, needsReview };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
