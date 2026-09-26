// The catalogue loader (BLD-8 R-17, ARC-11 "seed data loads idempotently"): `data/*` into the
// global catalogue tables and the seed library. Rows are mapped by DM column name, slugs and keys
// are resolved to foreign keys, file `meta` is ignored except the R-22 energy factors, and an
// ingredient that fails NUT-4 (generic 4/4/9/2 and, where recorded, its own factors, within 12 %)
// is marked `needs_review`. Seed dishes, components, variants and ingredient lines get
// deterministic ids from their slugs and keys, so a second run updates rows in place and changes
// nothing when the files are unchanged. Global catalogue data is reference data, not household
// configuration, so it is not written through change sets (DM-6).
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { atwaterCheck } from "@mealplanner/core/nutrition";
import type { Executor } from "../repos/index.js";
import {
  component,
  cuisine,
  dish,
  dishNutritionCache,
  ingredient,
  methodYield,
  preparationMethod,
  variant,
  variantIngredient,
} from "../schema/index.js";
import { newId } from "../schema/ids.js";
import { recomputeNutrition } from "../services/plans/nutrition.js";
import { loadDbCatalog } from "../services/plans/catalog.js";
import {
  atwaterFactorsBySlug,
  readCatalogueFiles,
  type CatalogueFiles,
  type IngredientFileRow,
  type SeedDish,
} from "./files.js";
import { seedId } from "./ids.js";

/** NUT-4: the largest accepted |kcal − predicted| as a percentage of kcal (03 §4, R-22). */
const NUT4_TOLERANCE_PCT = 12;

export interface LoadCatalogueOptions {
  /** Directory holding `ingredients.v1.json`, `method-yields.v1.json`, … (the repo's `data/`). */
  dataDir: string;
  now?: Date;
}

export interface LoadCatalogueResult {
  cuisines: number;
  methods: number;
  methodYields: number;
  ingredients: number;
  dishes: number;
  adjusters: number;
  variants: number;
  /** Slugs of ingredients that fail NUT-4 (marked needs_review). */
  ingredientsNeedingReview: string[];
  /** Ids of seed variants that need review (R-22/R-30 variant check, or a needs_review ingredient). */
  variantsNeedingReview: string[];
  /** Every seed and adjuster dish id, for the `kg.sync` dish request. */
  dishIds: string[];
  /** Rows inserted or changed by this run (0 on an unchanged re-run). */
  changedRows: number;
}

/** NUT-4 for one catalogue row: passes with 4/4/9/2 or with the row's own factors (R-22). */
export function ingredientPassesNut4(row: IngredientFileRow): boolean {
  const n = {
    kcal: row.kcal,
    protein: row.protein_g,
    carbs: row.carbs_g,
    fat: row.fat_g,
    satFat: row.sat_fat_g,
    fibre: row.fibre_g,
    solubleFibre: row.soluble_fibre_g,
    sugar: row.sugar_g,
    sodiumMg: row.sodium_mg,
  };
  if (atwaterCheck(n).ok) return true;
  const f = row.meta?.atwater_factors;
  if (f === undefined || f === null) return false;
  const predicted = f.protein * n.protein + f.carbohydrate * (n.carbs + n.fibre) + f.fat * n.fat;
  if (n.kcal === 0) return predicted === 0;
  return (Math.abs(n.kcal - predicted) / n.kcal) * 100 <= NUT4_TOLERANCE_PCT;
}

export async function loadCatalogue(
  db: Executor,
  options: LoadCatalogueOptions,
): Promise<LoadCatalogueResult> {
  const files = readCatalogueFiles(options.dataDir);
  return db.transaction((trx) => loadFiles(trx, files, options.now ?? new Date()));
}

async function loadFiles(
  db: Executor,
  files: CatalogueFiles,
  now: Date,
): Promise<LoadCatalogueResult> {
  // Serialise concurrent loaders (two worker replicas starting together).
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('mealplanner.seed'))`);
  let changed = 0;
  const count = (r: { rowCount?: number | null }) => {
    changed += r.rowCount ?? 0;
  };

  count(
    await db
      .insert(cuisine)
      .values(
        files.cuisines.map((c) => ({
          id: newId(),
          key: c.key,
          label: c.label,
          parentKey: c.parent_key,
        })),
      )
      .onConflictDoUpdate({
        target: cuisine.key,
        set: { label: sql`excluded.label`, parentKey: sql`excluded.parent_key` },
        setWhere: sql`(${cuisine.label}, ${cuisine.parentKey}) IS DISTINCT FROM (excluded.label, excluded.parent_key)`,
      }),
  );
  count(
    await db
      .insert(preparationMethod)
      .values(
        files.methods.map((m) => ({
          id: newId(),
          key: m.key,
          label: m.label,
          description: m.description,
          appealTags: m.appeal_tags,
        })),
      )
      .onConflictDoUpdate({
        target: preparationMethod.key,
        set: {
          label: sql`excluded.label`,
          description: sql`excluded.description`,
          appealTags: sql`excluded.appeal_tags`,
        },
        setWhere: sql`(${preparationMethod.label}, ${preparationMethod.description}, ${preparationMethod.appealTags}) IS DISTINCT FROM (excluded.label, excluded.description, excluded.appeal_tags)`,
      }),
  );
  const methodIds = new Map((await db.select().from(preparationMethod)).map((m) => [m.key, m.id]));
  const cuisineIds = new Map((await db.select().from(cuisine)).map((c) => [c.key, c.id]));
  const need = (map: Map<string, string>, key: string, what: string) => {
    const id = map.get(key);
    if (id === undefined) throw new Error(`catalogue loader: unknown ${what} ${key}`);
    return id;
  };

  count(
    await db
      .insert(methodYield)
      .values(
        files.yields.map((y) => ({
          methodId: need(methodIds, y.method, "method"),
          ingredientCategory: y.ingredient_category,
          yieldFactor: y.yield_factor,
          fatRetention: y.fat_retention,
          oilAbsorptionGPer100gRaw: y.oil_absorption_g_per_100g_raw,
        })),
      )
      .onConflictDoUpdate({
        target: [methodYield.methodId, methodYield.ingredientCategory],
        set: {
          yieldFactor: sql`excluded.yield_factor`,
          fatRetention: sql`excluded.fat_retention`,
          oilAbsorptionGPer100gRaw: sql`excluded.oil_absorption_g_per_100g_raw`,
        },
        setWhere: sql`(${methodYield.yieldFactor}, ${methodYield.fatRetention}, ${methodYield.oilAbsorptionGPer100gRaw}) IS DISTINCT FROM (excluded.yield_factor, excluded.fat_retention, excluded.oil_absorption_g_per_100g_raw)`,
      }),
  );

  const ingredientsNeedingReview: string[] = [];
  const ingredientRows = files.ingredients.map((i) => {
    const needsReview = !ingredientPassesNut4(i);
    if (needsReview) ingredientsNeedingReview.push(i.slug);
    return {
      id: newId(),
      slug: i.slug,
      name: i.name,
      aliases: i.aliases,
      category: i.category,
      kcal: i.kcal,
      proteinG: i.protein_g,
      carbsG: i.carbs_g,
      fatG: i.fat_g,
      satFatG: i.sat_fat_g,
      fibreG: i.fibre_g,
      solubleFibreG: i.soluble_fibre_g,
      sugarG: i.sugar_g,
      sodiumMg: i.sodium_mg,
      densityGPerMl: i.density_g_per_ml,
      unitWeightG: i.unit_weight_g,
      unitLabel: i.unit_label,
      ediblePortion: i.edible_portion,
      dietaryFlags: i.dietary_flags,
      nutritionSource: i.nutrition_source,
      nutritionConfidence: i.nutrition_confidence,
      localeAvailability: i.locale_availability,
      createdByHouseholdId: null,
      needsReview,
    };
  });
  const ingredientCols = [
    "name",
    "aliases",
    "category",
    "kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
    "sat_fat_g",
    "fibre_g",
    "soluble_fibre_g",
    "sugar_g",
    "sodium_mg",
    "density_g_per_ml",
    "unit_weight_g",
    "unit_label",
    "edible_portion",
    "dietary_flags",
    "nutrition_source",
    "nutrition_confidence",
    "locale_availability",
    "needs_review",
  ];
  for (const chunk of chunks(ingredientRows, 200))
    count(
      await db
        .insert(ingredient)
        .values(chunk)
        .onConflictDoUpdate({
          target: ingredient.slug,
          set: Object.fromEntries(ingredientCols.map((c) => [camel(c), sql.raw(`excluded.${c}`)])),
          // Never overwrite a household-private ingredient that happens to share a slug.
          setWhere: sql.raw(
            `ingredient.created_by_household_id IS NULL AND (${ingredientCols
              .map((c) => `ingredient.${c}`)
              .join(
                ", ",
              )}) IS DISTINCT FROM (${ingredientCols.map((c) => `excluded.${c}`).join(", ")})`,
          ),
        }),
    );
  const globalIngredients = await db
    .select({ id: ingredient.id, slug: ingredient.slug })
    .from(ingredient)
    .where(isNull(ingredient.createdByHouseholdId));
  const ingredientIds = new Map(globalIngredients.map((i) => [i.slug, i.id]));
  for (const i of files.ingredients)
    if (!ingredientIds.has(i.slug))
      throw new Error(
        `catalogue loader: slug ${i.slug} is taken by a household-private ingredient`,
      );

  const library = [...files.dishes, ...files.adjusters];
  const dishIds: string[] = [];
  let variants = 0;
  for (const d of library) {
    const result = await upsertSeedDish(db, d, { cuisineIds, methodIds, ingredientIds, need }, now);
    dishIds.push(result.dishId);
    variants += result.variants;
    changed += result.changed;
  }

  const catalog = await loadDbCatalog(db, null);
  const recompute = await recomputeNutrition(
    db,
    {
      householdId: null,
      variantIds: undefined,
      factorsBySlug: atwaterFactorsBySlug(files.ingredients),
      now,
    },
    catalog,
  );
  return {
    cuisines: files.cuisines.length,
    methods: files.methods.length,
    methodYields: files.yields.length,
    ingredients: files.ingredients.length,
    dishes: files.dishes.length,
    adjusters: files.adjusters.length,
    variants,
    ingredientsNeedingReview: ingredientsNeedingReview.sort(),
    variantsNeedingReview: recompute.needsReview.sort(),
    dishIds,
    changedRows: changed,
  };
}

interface Refs {
  cuisineIds: Map<string, string>;
  methodIds: Map<string, string>;
  ingredientIds: Map<string, string>;
  need: (map: Map<string, string>, key: string, what: string) => string;
}

async function upsertSeedDish(
  db: Executor,
  d: SeedDish,
  refs: Refs,
  now: Date,
): Promise<{ dishId: string; variants: number; changed: number }> {
  let changed = 0;
  const count = (r: { rowCount?: number | null }) => {
    changed += r.rowCount ?? 0;
  };
  const dishId = seedId("dish", d.slug);
  const dishCols = {
    name: d.name,
    slug: d.slug,
    description: d.description,
    cuisineId: refs.need(refs.cuisineIds, d.cuisine, "cuisine"),
    secondaryCuisineId:
      d.secondary_cuisine === null
        ? null
        : refs.need(refs.cuisineIds, d.secondary_cuisine, "cuisine"),
    slotKeys: d.slot_keys,
    flavourTags: d.flavour_tags,
    isPackable: d.is_packable,
    servedColdOk: d.served_cold_ok,
    source: "seed" as const,
    status: d.status,
    version: d.version,
  };
  count(
    await db
      .insert(dish)
      .values({
        id: dishId,
        householdId: null,
        aiGenerationId: null,
        createdAt: now,
        updatedAt: now,
        ...dishCols,
      })
      .onConflictDoUpdate({
        target: dish.id,
        set: { ...dishCols, updatedAt: now },
        setWhere: sql`(${dish.name}, ${dish.description}, ${dish.cuisineId}, ${dish.secondaryCuisineId}, ${dish.slotKeys}, ${dish.flavourTags}, ${dish.isPackable}, ${dish.servedColdOk}, ${dish.status}, ${dish.version}) IS DISTINCT FROM (excluded.name, excluded.description, excluded.cuisine_id, excluded.secondary_cuisine_id, excluded.slot_keys, excluded.flavour_tags, excluded.is_packable, excluded.served_cold_ok, excluded.status, excluded.version)`,
      }),
  );

  const componentIds: string[] = [];
  const variantIds: string[] = [];
  const lineIds: string[] = [];
  for (const c of d.components) {
    const componentId = seedId("component", d.slug, c.key);
    componentIds.push(componentId);
    const cols = {
      dishId,
      name: c.name,
      role: c.role,
      portioning: c.portioning,
      unitLabel: c.unit_label,
      minServingG: c.min_serving_g,
      maxServingG: c.max_serving_g,
      defaultServingG: c.default_serving_g,
      stepG: c.step_g,
      sortOrder: c.sort_order,
      required: c.required,
    };
    count(
      await db
        .insert(component)
        .values({ id: componentId, householdId: null, ...cols })
        .onConflictDoUpdate({
          target: component.id,
          set: cols,
          setWhere: sql`(${component.name}, ${component.role}, ${component.portioning}, ${component.unitLabel}, ${component.minServingG}, ${component.maxServingG}, ${component.defaultServingG}, ${component.stepG}, ${component.sortOrder}, ${component.required}) IS DISTINCT FROM (excluded.name, excluded.role, excluded.portioning, excluded.unit_label, excluded.min_serving_g, excluded.max_serving_g, excluded.default_serving_g, excluded.step_g, excluded.sort_order, excluded.required)`,
        }),
    );
    for (const v of c.variants) {
      const variantId = seedId("variant", d.slug, c.key, v.key);
      variantIds.push(variantId);
      const vcols = {
        componentId,
        methodId: refs.need(refs.methodIds, v.method, "method"),
        label: v.label,
        isDefault: v.is_default,
        steps: v.steps,
        cookTimeMin: v.cook_time_min,
        notes: v.notes,
        referenceBatchCookedG: v.reference_batch_cooked_g,
      };
      count(
        await db
          .insert(variant)
          .values({ id: variantId, householdId: null, needsReview: false, ...vcols })
          .onConflictDoUpdate({
            target: variant.id,
            set: vcols,
            setWhere: sql`(${variant.methodId}, ${variant.label}, ${variant.isDefault}, ${variant.steps}, ${variant.cookTimeMin}, ${variant.notes}, ${variant.referenceBatchCookedG}) IS DISTINCT FROM (excluded.method_id, excluded.label, excluded.is_default, excluded.steps, excluded.cook_time_min, excluded.notes, excluded.reference_batch_cooked_g)`,
          }),
      );
      const lines = v.ingredients.map((l, index) => {
        const id = seedId("variant_ingredient", d.slug, c.key, v.key, String(index));
        lineIds.push(id);
        return {
          id,
          householdId: null,
          variantId,
          ingredientId: refs.need(refs.ingredientIds, l.ingredient_slug, "ingredient"),
          rawGPerBatch: l.raw_g_per_batch,
          roleNote: l.role_note,
          isAbsorbedOil: l.is_absorbed_oil,
          cookingLiquid: l.cooking_liquid,
          yieldOverride: l.yield_override,
        };
      });
      count(
        await db
          .insert(variantIngredient)
          .values(lines)
          .onConflictDoUpdate({
            target: variantIngredient.id,
            set: {
              variantId: sql`excluded.variant_id`,
              ingredientId: sql`excluded.ingredient_id`,
              rawGPerBatch: sql`excluded.raw_g_per_batch`,
              roleNote: sql`excluded.role_note`,
              isAbsorbedOil: sql`excluded.is_absorbed_oil`,
              cookingLiquid: sql`excluded.cooking_liquid`,
              yieldOverride: sql`excluded.yield_override`,
            },
            setWhere: sql`(${variantIngredient.variantId}, ${variantIngredient.ingredientId}, ${variantIngredient.rawGPerBatch}, ${variantIngredient.roleNote}, ${variantIngredient.isAbsorbedOil}, ${variantIngredient.cookingLiquid}, ${variantIngredient.yieldOverride}) IS DISTINCT FROM (excluded.variant_id, excluded.ingredient_id, excluded.raw_g_per_batch, excluded.role_note, excluded.is_absorbed_oil, excluded.cooking_liquid, excluded.yield_override)`,
          }),
      );
    }
  }

  // Rows the files no longer contain: stale lines of the file's variants go; a variant or component
  // the files dropped goes, with its lines, when nothing references it (a plate or batch of a past
  // meal keeps the whole variant, lines included, so the dish stays readable and plannable).
  const oldVariants = await db
    .select({ id: variant.id })
    .from(variant)
    .innerJoin(component, eq(component.id, variant.componentId))
    .where(eq(component.dishId, dishId));
  const allVariantIds = oldVariants.map((v) => v.id);
  if (variantIds.length > 0)
    count(
      await db
        .delete(variantIngredient)
        .where(
          and(
            inArray(variantIngredient.variantId, variantIds),
            notInArray(variantIngredient.id, lineIds),
          ),
        ),
    );
  const staleVariants = allVariantIds.filter((id) => !variantIds.includes(id));
  for (const id of staleVariants) changed += await deleteIfUnreferenced(db, "variant", id);
  const staleComponents = (
    await db.select({ id: component.id }).from(component).where(eq(component.dishId, dishId))
  )
    .map((c) => c.id)
    .filter((id) => !componentIds.includes(id));
  for (const id of staleComponents) changed += await deleteIfUnreferenced(db, "component", id);
  return { dishId, variants: variantIds.length, changed };
}

async function deleteIfUnreferenced(
  db: Executor,
  kind: "variant" | "component",
  id: string,
): Promise<number> {
  const refs = await db.execute<{ n: string }>(
    kind === "variant"
      ? sql`SELECT (SELECT count(*) FROM plate_item WHERE variant_id = ${id}) + (SELECT count(*) FROM cook_batch WHERE variant_id = ${id}) AS n`
      : sql`SELECT (SELECT count(*) FROM plate_item WHERE component_id = ${id}) + (SELECT count(*) FROM variant WHERE component_id = ${id}) AS n`,
  );
  if (Number(refs.rows[0]?.n ?? 0) > 0) return 0;
  if (kind === "variant") {
    await db.delete(variantIngredient).where(eq(variantIngredient.variantId, id));
    await db.delete(dishNutritionCache).where(eq(dishNutritionCache.variantId, id));
    return (await db.delete(variant).where(eq(variant.id, id))).rowCount ?? 0;
  }
  return (await db.delete(component).where(eq(component.id, id))).rowCount ?? 0;
}

function camel(column: string): string {
  return column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
