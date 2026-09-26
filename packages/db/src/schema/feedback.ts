// 02 §6 Feedback and learning; composite household FKs (BLD-8 R-8).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { Json } from "@mealplanner/core/types";
import { num, tstz } from "./columns.js";
import {
  aiGenerationMode,
  exclusionKind,
  exclusionReason,
  frequencyEntityType,
  preferenceEntityType,
  preferenceHardness,
  preferenceSource,
  reactionKind,
  reviewTargetType,
} from "./enums.js";
import { memberFk } from "./members.js";
import { planMeal } from "./plans.js";
import { household, user } from "./tenancy.js";

const householdIdColumn = () =>
  uuid("household_id")
    .notNull()
    .references(() => household.id);

export const review = pgTable(
  "review",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => user.id),
    onBehalfOfMemberId: uuid("on_behalf_of_member_id"),
    targetType: reviewTargetType("target_type").notNull(),
    targetId: text("target_id").notNull(),
    planMealId: uuid("plan_meal_id"),
    rating: smallint("rating"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    comment: text("comment"),
    parentReviewId: uuid("parent_review_id"),
    createdAt: tstz("created_at").notNull(),
    editedAt: tstz("edited_at"),
    processedAt: tstz("processed_at"),
  },
  (t) => [
    index("review_household_id_idx").on(t.householdId),
    index("review_target_idx").on(t.householdId, t.targetType, t.targetId),
    unique("review_household_id_id_key").on(t.householdId, t.id),
    memberFk("review_on_behalf_of_member_fk", t.householdId, t.onBehalfOfMemberId),
    foreignKey({
      name: "review_plan_meal_fk",
      columns: [t.householdId, t.planMealId],
      foreignColumns: [planMeal.householdId, planMeal.id],
    }),
    foreignKey({
      name: "review_parent_review_fk",
      columns: [t.householdId, t.parentReviewId],
      foreignColumns: [t.householdId, t.id],
    }),
    check("review_rating_range", sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`),
  ],
);

export const reviewReaction = pgTable(
  "review_reaction",
  {
    householdId: householdIdColumn(),
    reviewId: uuid("review_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    kind: reactionKind("kind").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reviewId, t.userId, t.kind] }),
    index("review_reaction_household_id_idx").on(t.householdId),
    foreignKey({
      name: "review_reaction_review_fk",
      columns: [t.householdId, t.reviewId],
      foreignColumns: [review.householdId, review.id],
    }),
  ],
);

export const preference = pgTable(
  "preference",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    memberId: uuid("member_id"),
    entityType: preferenceEntityType("entity_type").notNull(),
    entityKey: text("entity_key").notNull(),
    score: num("score").notNull(),
    evidenceWeight: num("evidence_weight").notNull().default(0),
    source: preferenceSource("source").notNull(),
    locked: boolean("locked").notNull().default(false),
    hard: preferenceHardness("hard").notNull().default("none"),
    updatedAt: tstz("updated_at").notNull(),
  },
  (t) => [
    index("preference_household_id_idx").on(t.householdId),
    unique("preference_household_member_entity_source_key")
      .on(t.householdId, t.memberId, t.entityType, t.entityKey, t.source)
      .nullsNotDistinct(),
    memberFk("preference_member_fk", t.householdId, t.memberId),
    check("preference_score_range", sql`${t.score} >= -1 AND ${t.score} <= 1`),
    check("preference_evidence_weight_non_negative", sql`${t.evidenceWeight} >= 0`),
  ],
);

export const frequencyRule = pgTable(
  "frequency_rule",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    memberId: uuid("member_id"),
    entityType: frequencyEntityType("entity_type").notNull(),
    entityKey: text("entity_key").notNull(),
    minGapDays: integer("min_gap_days"),
    maxPerWeek: integer("max_per_week"),
    source: preferenceSource("source").notNull(),
    locked: boolean("locked").notNull().default(false),
  },
  (t) => [
    index("frequency_rule_household_id_idx").on(t.householdId),
    unique("frequency_rule_household_member_entity_key")
      .on(t.householdId, t.memberId, t.entityType, t.entityKey)
      .nullsNotDistinct(),
    memberFk("frequency_rule_member_fk", t.householdId, t.memberId),
    check(
      "frequency_rule_has_limit",
      sql`${t.minGapDays} IS NOT NULL OR ${t.maxPerWeek} IS NOT NULL`,
    ),
    check(
      "frequency_rule_limits_positive",
      sql`(${t.minGapDays} IS NULL OR ${t.minGapDays} >= 1) AND (${t.maxPerWeek} IS NULL OR ${t.maxPerWeek} >= 0)`,
    ),
  ],
);

export const exclusion = pgTable(
  "exclusion",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    memberId: uuid("member_id"),
    kind: exclusionKind("kind").notNull(),
    key: text("key").notNull(),
    reason: exclusionReason("reason").notNull(),
    hard: boolean("hard").notNull(),
  },
  (t) => [
    index("exclusion_household_id_idx").on(t.householdId),
    unique("exclusion_household_member_kind_key_key")
      .on(t.householdId, t.memberId, t.kind, t.key)
      .nullsNotDistinct(),
    memberFk("exclusion_member_fk", t.householdId, t.memberId),
    // 02 §6: hard is always true for allergy (DM-5).
    check("exclusion_allergy_is_hard", sql`${t.reason} <> 'allergy' OR ${t.hard}`),
  ],
);

export const planningWeights = pgTable(
  "planning_weights",
  {
    householdId: uuid("household_id")
      .primaryKey()
      .references(() => household.id),
    macroPrecision: num("macro_precision").notNull().default(1),
    appeal: num("appeal").notNull().default(0.6),
    ingredientEconomy: num("ingredient_economy").notNull().default(0.4),
    variety: num("variety").notNull().default(0.3),
    fairness: num("fairness").notNull().default(0.5),
    aiGeneration: aiGenerationMode("ai_generation").notNull().default("auto"),
    economyWindowDays: integer("economy_window_days").notNull().default(7),
    // PLN-6, PLN-9 §6.4 (BLD-8 R-9 d).
    adjustersEnabled: boolean("adjusters_enabled").notNull().default(true),
    maxVariantsPerComponent: integer("max_variants_per_component").notNull().default(3),
    updatedAt: tstz("updated_at").notNull(),
  },
  (t) => [
    check(
      "planning_weights_range",
      sql`${t.macroPrecision} BETWEEN 0 AND 1 AND ${t.appeal} BETWEEN 0 AND 1 AND ${t.ingredientEconomy} BETWEEN 0 AND 1 AND ${t.variety} BETWEEN 0 AND 1 AND ${t.fairness} BETWEEN 0 AND 1`,
    ),
    check("planning_weights_window_positive", sql`${t.economyWindowDays} >= 1`),
    check("planning_weights_max_variants_positive", sql`${t.maxVariantsPerComponent} >= 1`),
  ],
);

export const weightPreset = pgTable(
  "weight_preset",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    name: text("name").notNull(),
    values: jsonb("values").$type<Json>().notNull(),
    appliesToWeekdays: integer("applies_to_weekdays").array(),
  },
  (t) => [
    index("weight_preset_household_id_idx").on(t.householdId),
    unique("weight_preset_household_id_name_key").on(t.householdId, t.name),
  ],
);
