// 02 §4 Recipes. household_id null = global seed library (BLD-8 R-8), R-9 a–d, R-12.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { num, tstz } from "./columns.js";
import { componentRole, cookingLiquid, dishSource, dishStatus, portioning } from "./enums.js";
import { cuisine, ingredient, preparationMethod } from "./catalog.js";
import { aiGeneration } from "./audit.js";
import { household } from "./tenancy.js";

const optionalHouseholdId = () => uuid("household_id").references(() => household.id);

export const dish = pgTable(
  "dish",
  {
    id: uuid("id").primaryKey(),
    householdId: optionalHouseholdId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull(),
    cuisineId: uuid("cuisine_id")
      .notNull()
      .references(() => cuisine.id),
    secondaryCuisineId: uuid("secondary_cuisine_id").references(() => cuisine.id),
    slotKeys: text("slot_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    flavourTags: text("flavour_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isPackable: boolean("is_packable").notNull(),
    servedColdOk: boolean("served_cold_ok").notNull(),
    source: dishSource("source").notNull(),
    status: dishStatus("status").notNull(),
    aiGenerationId: uuid("ai_generation_id").references(() => aiGeneration.id),
    version: integer("version").notNull().default(1),
    createdAt: tstz("created_at").notNull(),
    updatedAt: tstz("updated_at").notNull(),
  },
  (t) => [
    index("dish_household_id_idx").on(t.householdId),
    unique("dish_household_id_slug_key").on(t.householdId, t.slug).nullsNotDistinct(),
    check("dish_version_positive", sql`${t.version} >= 1`),
  ],
);

export const component = pgTable(
  "component",
  {
    id: uuid("id").primaryKey(),
    householdId: optionalHouseholdId(),
    dishId: uuid("dish_id")
      .notNull()
      .references(() => dish.id),
    name: text("name").notNull(),
    role: componentRole("role").notNull(),
    portioning: portioning("portioning").notNull(),
    unitLabel: text("unit_label"),
    minServingG: num("min_serving_g").notNull(),
    maxServingG: num("max_serving_g").notNull(),
    defaultServingG: num("default_serving_g").notNull(),
    stepG: num("step_g").notNull().default(5),
    sortOrder: integer("sort_order").notNull(),
    required: boolean("required").notNull(),
  },
  (t) => [
    index("component_household_id_idx").on(t.householdId),
    index("component_dish_id_idx").on(t.dishId),
    check(
      "component_serving_bounds",
      sql`${t.minServingG} >= 0 AND ${t.minServingG} <= ${t.defaultServingG} AND ${t.defaultServingG} <= ${t.maxServingG}`,
    ),
    check("component_step_positive", sql`${t.stepG} > 0`),
  ],
);

export const variant = pgTable(
  "variant",
  {
    id: uuid("id").primaryKey(),
    householdId: optionalHouseholdId(),
    componentId: uuid("component_id")
      .notNull()
      .references(() => component.id),
    methodId: uuid("method_id")
      .notNull()
      .references(() => preparationMethod.id),
    label: text("label").notNull(),
    isDefault: boolean("is_default").notNull(),
    steps: jsonb("steps").$type<string[]>().notNull(),
    cookTimeMin: integer("cook_time_min"),
    notes: text("notes"),
    referenceBatchCookedG: num("reference_batch_cooked_g").notNull().default(1000),
    needsReview: boolean("needs_review").notNull().default(false),
  },
  (t) => [
    index("variant_household_id_idx").on(t.householdId),
    index("variant_component_id_idx").on(t.componentId),
    check("variant_reference_batch_positive", sql`${t.referenceBatchCookedG} > 0`),
  ],
);

export const variantIngredient = pgTable(
  "variant_ingredient",
  {
    id: uuid("id").primaryKey(),
    householdId: optionalHouseholdId(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variant.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredient.id),
    rawGPerBatch: num("raw_g_per_batch").notNull(),
    roleNote: text("role_note"),
    isAbsorbedOil: boolean("is_absorbed_oil").notNull(),
    cookingLiquid: cookingLiquid("cooking_liquid"),
    yieldOverride: num("yield_override"),
  },
  (t) => [
    index("variant_ingredient_household_id_idx").on(t.householdId),
    index("variant_ingredient_variant_id_idx").on(t.variantId),
    check("variant_ingredient_raw_positive", sql`${t.rawGPerBatch} > 0`),
    check(
      "variant_ingredient_yield_override_positive",
      sql`${t.yieldOverride} IS NULL OR ${t.yieldOverride} > 0`,
    ),
  ],
);

export const dishNutritionCache = pgTable(
  "dish_nutrition_cache",
  {
    variantId: uuid("variant_id")
      .primaryKey()
      .references(() => variant.id),
    householdId: optionalHouseholdId(),
    // Per 100 g cooked.
    kcal: num("kcal").notNull(),
    protein: num("protein").notNull(),
    carbs: num("carbs").notNull(),
    fat: num("fat").notNull(),
    satFat: num("sat_fat").notNull(),
    fibre: num("fibre").notNull(),
    solubleFibre: num("soluble_fibre"),
    sugar: num("sugar"),
    sodium: num("sodium"),
    cookedYieldGPerBatch: num("cooked_yield_g_per_batch").notNull(),
    computedAt: tstz("computed_at").notNull(),
    engineVersion: text("engine_version").notNull(),
  },
  (t) => [index("dish_nutrition_cache_household_id_idx").on(t.householdId)],
);

/** PLN-6: the household's adjuster list (BLD-8 R-9 d). */
export const householdAdjuster = pgTable(
  "household_adjuster",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    dishId: uuid("dish_id")
      .notNull()
      .references(() => dish.id),
    enabled: boolean("enabled").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.dishId] }),
    index("household_adjuster_household_id_idx").on(t.householdId),
  ],
);
