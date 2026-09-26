// Postgres enums, built from the value arrays in @mealplanner/core/types (ADR-1).
import {
  AI_GENERATION_MODES,
  AI_PURPOSES,
  APPETITES,
  CHANGE_ACTORS,
  CHANGE_SOURCES,
  CHAT_ROLES,
  COMPONENT_ROLES,
  COOKING_LIQUIDS,
  DAY_KINDS,
  DAY_OVERRIDE_KINDS,
  DETAIL_LEVELS,
  DISH_SOURCES,
  DISH_STATUSES,
  EXCLUSION_KINDS,
  EXCLUSION_REASONS,
  FIT_STATUSES,
  FREQUENCY_ENTITY_TYPES,
  HOUSEHOLD_ROLES,
  HOUSEHOLD_USER_STATUSES,
  INGREDIENT_CATEGORIES,
  INSIGHT_FREQUENCIES,
  KG_EDGE_SOURCES,
  MEAL_OVERRIDE_KINDS,
  NUTRITION_CONFIDENCES,
  PLAN_DAY_STATUSES,
  PLAN_MEAL_STATUSES,
  PORTIONINGS,
  PREFERENCE_ENTITY_TYPES,
  PREFERENCE_HARDNESS,
  PREFERENCE_SOURCES,
  PROPOSAL_ORIGINS,
  PROPOSAL_STATUSES,
  REACTION_KINDS,
  REVIEW_TARGET_TYPES,
  SEXES,
  TARGET_KINDS,
  TOLERANCE_MODES,
  TRAINING_INTENSITIES,
  UNIT_SYSTEMS,
} from "@mealplanner/core/types";
import { pgEnum } from "drizzle-orm/pg-core";

export const householdRole = pgEnum("household_role", HOUSEHOLD_ROLES);
export const householdUserStatus = pgEnum("household_user_status", HOUSEHOLD_USER_STATUSES);
export const unitSystem = pgEnum("unit_system", UNIT_SYSTEMS);
export const insightFrequency = pgEnum("insight_frequency", INSIGHT_FREQUENCIES);
export const sex = pgEnum("sex", SEXES);
export const appetite = pgEnum("appetite", APPETITES);
export const targetKind = pgEnum("target_kind", TARGET_KINDS);
export const toleranceMode = pgEnum("tolerance_mode", TOLERANCE_MODES);
export const trainingIntensity = pgEnum("training_intensity", TRAINING_INTENSITIES);
export const dayOverrideKind = pgEnum("day_override_kind", DAY_OVERRIDE_KINDS);
export const dayKind = pgEnum("day_kind", DAY_KINDS);
export const ingredientCategory = pgEnum("ingredient_category", INGREDIENT_CATEGORIES);
export const nutritionConfidence = pgEnum("nutrition_confidence", NUTRITION_CONFIDENCES);
export const componentRole = pgEnum("component_role", COMPONENT_ROLES);
export const portioning = pgEnum("portioning", PORTIONINGS);
export const cookingLiquid = pgEnum("cooking_liquid", COOKING_LIQUIDS);
export const dishSource = pgEnum("dish_source", DISH_SOURCES);
export const dishStatus = pgEnum("dish_status", DISH_STATUSES);
export const planDayStatus = pgEnum("plan_day_status", PLAN_DAY_STATUSES);
export const planMealStatus = pgEnum("plan_meal_status", PLAN_MEAL_STATUSES);
export const fitStatus = pgEnum("fit_status", FIT_STATUSES);
export const mealOverrideKind = pgEnum("meal_override_kind", MEAL_OVERRIDE_KINDS);
export const reviewTargetType = pgEnum("review_target_type", REVIEW_TARGET_TYPES);
export const reactionKind = pgEnum("reaction_kind", REACTION_KINDS);
export const preferenceEntityType = pgEnum("preference_entity_type", PREFERENCE_ENTITY_TYPES);
export const preferenceSource = pgEnum("preference_source", PREFERENCE_SOURCES);
export const preferenceHardness = pgEnum("preference_hardness", PREFERENCE_HARDNESS);
export const frequencyEntityType = pgEnum("frequency_entity_type", FREQUENCY_ENTITY_TYPES);
export const exclusionKind = pgEnum("exclusion_kind", EXCLUSION_KINDS);
export const exclusionReason = pgEnum("exclusion_reason", EXCLUSION_REASONS);
export const aiGenerationMode = pgEnum("ai_generation_mode", AI_GENERATION_MODES);
export const detailLevelValue = pgEnum("detail_level_value", DETAIL_LEVELS);
export const chatRole = pgEnum("chat_role", CHAT_ROLES);
export const proposalOrigin = pgEnum("proposal_origin", PROPOSAL_ORIGINS);
export const proposalStatus = pgEnum("proposal_status", PROPOSAL_STATUSES);
export const changeActor = pgEnum("change_actor", CHANGE_ACTORS);
export const changeSource = pgEnum("change_source", CHANGE_SOURCES);
export const kgEdgeSource = pgEnum("kg_edge_source", KG_EDGE_SOURCES);
export const aiPurpose = pgEnum("ai_purpose", AI_PURPOSES);
