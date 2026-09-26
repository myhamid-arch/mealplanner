// Scope and references of every table reachable through a household context (DM-1, BLD-8 R-8).
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import * as s from "../schema/index.js";

/**
 * - `household`: the row belongs to exactly one household (`household_id` not null).
 * - `self`: the household row itself.
 * - `shared`: `household_id` null = global seed row (readable by every household, writable by none).
 * - `global`: catalogue tables without a household column (read-only).
 */
export type Scope = "household" | "self" | "shared" | "global";

export interface TableSpec {
  table: PgTable;
  scope: Scope;
  /** The TypeScript key of the scoping column (`householdId`, or `createdByHouseholdId`). */
  householdKey?: string;
  /** TypeScript keys of the primary-key columns. */
  key: readonly string[];
  /** Columns that reference another entity, checked for household ownership before a write. */
  refs: Readonly<Record<string, string>>;
  /** uuid[] columns whose elements reference another entity. */
  arrayRefs?: Readonly<Record<string, string>>;
}

const household = (
  table: PgTable,
  key: readonly string[],
  refs: Record<string, string> = {},
  arrayRefs?: Record<string, string>,
): TableSpec => ({
  table,
  scope: "household",
  householdKey: "householdId",
  key,
  refs,
  ...(arrayRefs === undefined ? {} : { arrayRefs }),
});
const shared = (
  table: PgTable,
  key: readonly string[],
  refs: Record<string, string> = {},
  householdKey = "householdId",
): TableSpec => ({
  table,
  scope: "shared",
  householdKey,
  key,
  refs,
});
const global = (table: PgTable, key: readonly string[]): TableSpec => ({
  table,
  scope: "global",
  key,
  refs: {},
});

/** Every table a household context can reach, by spec table name. */
export const TABLES = {
  household: { table: s.household, scope: "self", householdKey: "id", key: ["id"], refs: {} },
  household_user: household(s.householdUser, ["householdId", "userId"], { memberId: "member" }),
  invite: household(s.invite, ["id"], { memberId: "member" }),
  support_grant: household(s.supportGrant, ["id"]),
  detail_level: household(s.detailLevel, ["id"], { memberId: "member" }),
  member: household(s.member, ["id"]),
  target_profile: household(s.targetProfile, ["id"], { memberId: "member" }),
  tolerance: household(s.tolerance, ["memberId"], { memberId: "member" }),
  slot_type: household(s.slotType, ["id"]),
  member_slot_schedule: household(s.memberSlotSchedule, ["memberId", "slotTypeId", "weekday"], {
    memberId: "member",
    slotTypeId: "slot_type",
  }),
  training_schedule: household(s.trainingSchedule, ["memberId", "weekday"], { memberId: "member" }),
  day_override: household(s.dayOverride, ["id"], { memberId: "member", slotTypeId: "slot_type" }),
  meal_distribution: household(s.mealDistribution, ["memberId", "dayKind", "slotTypeId"], {
    memberId: "member",
    slotTypeId: "slot_type",
  }),
  slot_target_override: household(s.slotTargetOverride, ["memberId", "dayKind", "slotTypeId"], {
    memberId: "member",
    slotTypeId: "slot_type",
  }),
  portion_bias: household(s.portionBias, ["memberId", "componentRole"], { memberId: "member" }),
  household_adjuster: household(s.householdAdjuster, ["householdId", "dishId"], { dishId: "dish" }),
  plan_day: household(s.planDay, ["id"]),
  plan_meal: household(s.planMeal, ["id"], {
    planDayId: "plan_day",
    slotTypeId: "slot_type",
    dishId: "dish",
  }),
  plate: household(s.plate, ["id"], { planMealId: "plan_meal", memberId: "member" }),
  plate_item: household(s.plateItem, ["id"], {
    plateId: "plate",
    componentId: "component",
    variantId: "variant",
  }),
  cook_batch: household(s.cookBatch, ["id"], { planMealId: "plan_meal", variantId: "variant" }),
  meal_override: household(
    s.mealOverride,
    ["id"],
    { slotTypeId: "slot_type" },
    { memberIds: "member" },
  ),
  review: household(s.review, ["id"], {
    onBehalfOfMemberId: "member",
    planMealId: "plan_meal",
    parentReviewId: "review",
  }),
  review_reaction: household(s.reviewReaction, ["reviewId", "userId", "kind"], {
    reviewId: "review",
  }),
  review_revision: household(s.reviewRevision, ["id"], { reviewId: "review" }),
  preference: household(s.preference, ["id"], { memberId: "member" }),
  frequency_rule: household(s.frequencyRule, ["id"], { memberId: "member" }),
  exclusion: household(s.exclusion, ["id"], { memberId: "member" }),
  planning_weights: household(s.planningWeights, ["householdId"]),
  weight_preset: household(s.weightPreset, ["id"]),
  conversation: household(s.conversation, ["id"]),
  chat_message: household(s.chatMessage, ["id"], { conversationId: "conversation" }),
  proposal: household(s.proposal, ["id"], {
    conversationId: "conversation",
    messageId: "chat_message",
    changeSetId: "change_set",
  }),
  change_set: household(s.changeSet, ["id"], { undoneByChangeSetId: "change_set" }),
  ai_generation: household(s.aiGeneration, ["id"]),
  ingredient: shared(s.ingredient, ["id"], {}, "createdByHouseholdId"),
  dish: shared(s.dish, ["id"], {
    cuisineId: "cuisine",
    secondaryCuisineId: "cuisine",
    aiGenerationId: "ai_generation",
  }),
  component: shared(s.component, ["id"], { dishId: "dish" }),
  variant: shared(s.variant, ["id"], { componentId: "component", methodId: "preparation_method" }),
  variant_ingredient: shared(s.variantIngredient, ["id"], {
    variantId: "variant",
    ingredientId: "ingredient",
  }),
  dish_nutrition_cache: shared(s.dishNutritionCache, ["variantId"], { variantId: "variant" }),
  kg_node: shared(s.kgNode, ["id"]),
  kg_edge: shared(s.kgEdge, ["id"], { srcId: "kg_node", dstId: "kg_node" }),
  cuisine: global(s.cuisine, ["id"]),
  preparation_method: global(s.preparationMethod, ["id"]),
  method_yield: global(s.methodYield, ["methodId", "ingredientCategory"]),
} as const satisfies Record<string, TableSpec>;

export type TableName = keyof typeof TABLES;

/** Row type of every table in TABLES. */
export interface TableRows {
  household: typeof s.household.$inferSelect;
  household_user: typeof s.householdUser.$inferSelect;
  invite: typeof s.invite.$inferSelect;
  support_grant: typeof s.supportGrant.$inferSelect;
  detail_level: typeof s.detailLevel.$inferSelect;
  member: typeof s.member.$inferSelect;
  target_profile: typeof s.targetProfile.$inferSelect;
  tolerance: typeof s.tolerance.$inferSelect;
  slot_type: typeof s.slotType.$inferSelect;
  member_slot_schedule: typeof s.memberSlotSchedule.$inferSelect;
  training_schedule: typeof s.trainingSchedule.$inferSelect;
  day_override: typeof s.dayOverride.$inferSelect;
  meal_distribution: typeof s.mealDistribution.$inferSelect;
  slot_target_override: typeof s.slotTargetOverride.$inferSelect;
  portion_bias: typeof s.portionBias.$inferSelect;
  household_adjuster: typeof s.householdAdjuster.$inferSelect;
  plan_day: typeof s.planDay.$inferSelect;
  plan_meal: typeof s.planMeal.$inferSelect;
  plate: typeof s.plate.$inferSelect;
  plate_item: typeof s.plateItem.$inferSelect;
  cook_batch: typeof s.cookBatch.$inferSelect;
  meal_override: typeof s.mealOverride.$inferSelect;
  review: typeof s.review.$inferSelect;
  review_reaction: typeof s.reviewReaction.$inferSelect;
  review_revision: typeof s.reviewRevision.$inferSelect;
  preference: typeof s.preference.$inferSelect;
  frequency_rule: typeof s.frequencyRule.$inferSelect;
  exclusion: typeof s.exclusion.$inferSelect;
  planning_weights: typeof s.planningWeights.$inferSelect;
  weight_preset: typeof s.weightPreset.$inferSelect;
  conversation: typeof s.conversation.$inferSelect;
  chat_message: typeof s.chatMessage.$inferSelect;
  proposal: typeof s.proposal.$inferSelect;
  change_set: typeof s.changeSet.$inferSelect;
  ai_generation: typeof s.aiGeneration.$inferSelect;
  ingredient: typeof s.ingredient.$inferSelect;
  dish: typeof s.dish.$inferSelect;
  component: typeof s.component.$inferSelect;
  variant: typeof s.variant.$inferSelect;
  variant_ingredient: typeof s.variantIngredient.$inferSelect;
  dish_nutrition_cache: typeof s.dishNutritionCache.$inferSelect;
  kg_node: typeof s.kgNode.$inferSelect;
  kg_edge: typeof s.kgEdge.$inferSelect;
  cuisine: typeof s.cuisine.$inferSelect;
  preparation_method: typeof s.preparationMethod.$inferSelect;
  method_yield: typeof s.methodYield.$inferSelect;
}

/** Tables whose rows belong to households (the ones G2 must prove are isolated). */
export const HOUSEHOLD_TABLES = (Object.keys(TABLES) as TableName[]).filter(
  (name) => TABLES[name].scope !== "global",
);

export function columnsOf(spec: TableSpec): Record<string, PgColumn> {
  return getTableColumns(spec.table);
}
