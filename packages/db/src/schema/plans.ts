// 02 §5 Plans, 13 R2-MEAL-2 meal_override; composite household FKs (BLD-8 R-8).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { Json } from "@mealplanner/core/types";
import { num, tstz } from "./columns.js";
import { fitStatus, mealOverrideKind, planDayStatus, planMealStatus } from "./enums.js";
import { memberFk, slotTypeFk } from "./members.js";
import { component, dish, variant } from "./recipes.js";
import { household, user } from "./tenancy.js";

const householdIdColumn = () =>
  uuid("household_id")
    .notNull()
    .references(() => household.id);

export const planDay = pgTable(
  "plan_day",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    date: date("date", { mode: "string" }).notNull(),
    status: planDayStatus("status").notNull(),
    weightsSnapshot: jsonb("weights_snapshot").$type<Json>().notNull(),
    generatedAt: tstz("generated_at").notNull(),
    generatorVersion: text("generator_version").notNull(),
  },
  (t) => [
    index("plan_day_household_id_idx").on(t.householdId),
    unique("plan_day_household_id_date_key").on(t.householdId, t.date),
    unique("plan_day_household_id_id_key").on(t.householdId, t.id),
  ],
);

export const planMeal = pgTable(
  "plan_meal",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    planDayId: uuid("plan_day_id").notNull(),
    slotTypeId: uuid("slot_type_id").notNull(),
    dishId: uuid("dish_id")
      .notNull()
      .references(() => dish.id),
    dishVersion: integer("dish_version").notNull(),
    memberScope: text("member_scope").notNull(),
    locked: boolean("locked").notNull().default(false),
    scoreBreakdown: jsonb("score_breakdown").$type<Json>().notNull(),
    status: planMealStatus("status").notNull(),
  },
  (t) => [
    index("plan_meal_household_id_idx").on(t.householdId),
    index("plan_meal_plan_day_id_idx").on(t.planDayId),
    unique("plan_meal_household_id_id_key").on(t.householdId, t.id),
    foreignKey({
      name: "plan_meal_plan_day_fk",
      columns: [t.householdId, t.planDayId],
      foreignColumns: [planDay.householdId, planDay.id],
    }),
    slotTypeFk("plan_meal_slot_type_fk", t.householdId, t.slotTypeId),
    check(
      "plan_meal_member_scope_format",
      sql`${t.memberScope} = 'shared' OR ${t.memberScope} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
  ],
);

function planMealFk(name: string, householdId: AnyPgColumn, planMealId: AnyPgColumn) {
  return foreignKey({
    name,
    columns: [householdId, planMealId],
    foreignColumns: [planMeal.householdId, planMeal.id],
  });
}

export const plate = pgTable(
  "plate",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    planMealId: uuid("plan_meal_id").notNull(),
    memberId: uuid("member_id").notNull(),
    fitStatus: fitStatus("fit_status").notNull(),
    target: jsonb("target").$type<Json>().notNull(),
    actual: jsonb("actual").$type<Json>().notNull(),
    deviation: jsonb("deviation").$type<Json>().notNull(),
  },
  (t) => [
    index("plate_household_id_idx").on(t.householdId),
    index("plate_plan_meal_id_idx").on(t.planMealId),
    unique("plate_household_id_id_key").on(t.householdId, t.id),
    unique("plate_plan_meal_id_member_id_key").on(t.planMealId, t.memberId),
    planMealFk("plate_plan_meal_fk", t.householdId, t.planMealId),
    memberFk("plate_member_fk", t.householdId, t.memberId),
  ],
);

export const plateItem = pgTable(
  "plate_item",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    plateId: uuid("plate_id").notNull(),
    componentId: uuid("component_id")
      .notNull()
      .references(() => component.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variant.id),
    cookedG: num("cooked_g").notNull(),
    rawEquivalent: jsonb("raw_equivalent").$type<Record<string, number>>().notNull(),
  },
  (t) => [
    index("plate_item_household_id_idx").on(t.householdId),
    index("plate_item_plate_id_idx").on(t.plateId),
    foreignKey({
      name: "plate_item_plate_fk",
      columns: [t.householdId, t.plateId],
      foreignColumns: [plate.householdId, plate.id],
    }),
    check("plate_item_cooked_g_non_negative", sql`${t.cookedG} >= 0`),
  ],
);

/** Derived, materialised on publish. */
export const cookBatch = pgTable(
  "cook_batch",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    planMealId: uuid("plan_meal_id").notNull(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variant.id),
    totalCookedG: num("total_cooked_g").notNull(),
    rawIngredients: jsonb("raw_ingredients").$type<Record<string, number>>().notNull(),
    servings: integer("servings").notNull(),
  },
  (t) => [
    index("cook_batch_household_id_idx").on(t.householdId),
    index("cook_batch_plan_meal_id_idx").on(t.planMealId),
    planMealFk("cook_batch_plan_meal_fk", t.householdId, t.planMealId),
    check("cook_batch_servings_positive", sql`${t.servings} >= 1`),
  ],
);

/** R2-MEAL-2: one-off override of one slot on one date. */
export const mealOverride = pgTable(
  "meal_override",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    planDate: date("plan_date", { mode: "string" }).notNull(),
    slotTypeId: uuid("slot_type_id").notNull(),
    kind: mealOverrideKind("kind").notNull(),
    memberIds: uuid("member_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: tstz("created_at").notNull(),
  },
  (t) => [
    index("meal_override_household_id_idx").on(t.householdId),
    unique("meal_override_household_date_slot_key").on(t.householdId, t.planDate, t.slotTypeId),
    slotTypeFk("meal_override_slot_type_fk", t.householdId, t.slotTypeId),
    check(
      "meal_override_members_match_kind",
      sql`(${t.kind} = 'split_member') = (cardinality(${t.memberIds}) > 0)`,
    ),
  ],
);
