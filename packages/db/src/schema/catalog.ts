// 02 §3 Catalogue (global, not household-scoped), BLD-8 R-9 b, l, R-12.
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import type { LocaleAvailability } from "@mealplanner/core/types";
import { num, tstz } from "./columns.js";
import { ingredientCategory, nutritionConfidence } from "./enums.js";
import { household, user } from "./tenancy.js";

export const ingredient = pgTable(
  "ingredient",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    category: ingredientCategory("category").notNull(),
    // Per 100 g edible raw.
    kcal: num("kcal").notNull(),
    proteinG: num("protein_g").notNull(),
    carbsG: num("carbs_g").notNull(),
    fatG: num("fat_g").notNull(),
    satFatG: num("sat_fat_g").notNull(),
    fibreG: num("fibre_g").notNull(),
    solubleFibreG: num("soluble_fibre_g"),
    sugarG: num("sugar_g"),
    sodiumMg: num("sodium_mg"),
    densityGPerMl: num("density_g_per_ml"),
    unitWeightG: num("unit_weight_g"),
    unitLabel: text("unit_label"),
    ediblePortion: num("edible_portion").notNull(),
    dietaryFlags: text("dietary_flags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    nutritionSource: text("nutrition_source").notNull(),
    nutritionConfidence: nutritionConfidence("nutrition_confidence").notNull(),
    localeAvailability: jsonb("locale_availability")
      .$type<Record<string, LocaleAvailability>>()
      .notNull(),
    createdByHouseholdId: uuid("created_by_household_id").references(() => household.id),
    // NUT-4 / PLN-9 §6.3 (R-9 b), ingredient.verify (R-9 l).
    needsReview: boolean("needs_review").notNull().default(false),
    verifiedAt: tstz("verified_at"),
    verifiedByUserId: uuid("verified_by_user_id").references(() => user.id),
  },
  (t) => [
    index("ingredient_created_by_household_id_idx").on(t.createdByHouseholdId),
    check(
      "ingredient_edible_portion_range",
      sql`${t.ediblePortion} > 0 AND ${t.ediblePortion} <= 1`,
    ),
    check(
      "ingredient_nutrients_non_negative",
      sql`${t.kcal} >= 0 AND ${t.proteinG} >= 0 AND ${t.carbsG} >= 0 AND ${t.fatG} >= 0 AND ${t.satFatG} >= 0 AND ${t.fibreG} >= 0`,
    ),
  ],
);

export const preparationMethod = pgTable("preparation_method", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description").notNull(),
  appealTags: text("appeal_tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
});

/** Coating columns removed by BLD-8 R-12: a coating is an ordinary variant ingredient. */
export const methodYield = pgTable(
  "method_yield",
  {
    methodId: uuid("method_id")
      .notNull()
      .references(() => preparationMethod.id),
    ingredientCategory: ingredientCategory("ingredient_category").notNull(),
    yieldFactor: num("yield_factor").notNull(),
    fatRetention: num("fat_retention").notNull(),
    oilAbsorptionGPer100gRaw: num("oil_absorption_g_per_100g_raw").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.methodId, t.ingredientCategory] }),
    check("method_yield_yield_factor_positive", sql`${t.yieldFactor} > 0`),
    check(
      "method_yield_fat_retention_range",
      sql`${t.fatRetention} >= 0 AND ${t.fatRetention} <= 1`,
    ),
    check("method_yield_oil_absorption_non_negative", sql`${t.oilAbsorptionGPer100gRaw} >= 0`),
  ],
);

export const cuisine = pgTable("cuisine", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  parentKey: text("parent_key"),
});
