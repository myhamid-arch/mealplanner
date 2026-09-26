// Closed enumerations of the domain model (02-domain-model, 13-revision-r2).
// The database enums (packages/db/src/schema/enums.ts) and the change-op schemas are built from
// these arrays, so the three cannot drift apart.

export const HOUSEHOLD_ROLES = ["admin", "member", "kitchen"] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

/** R2-ADM-3: status of a login in a household. */
export const HOUSEHOLD_USER_STATUSES = ["active", "invited", "blocked"] as const;
export type HouseholdUserStatus = (typeof HOUSEHOLD_USER_STATUSES)[number];

export const UNIT_SYSTEMS = ["metric"] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

/** R2-ADM-6 "insight check-in frequency" (SPEC-Q-4h). */
export const INSIGHT_FREQUENCIES = ["nightly", "weekly", "on_demand"] as const;
export type InsightFrequency = (typeof INSIGHT_FREQUENCIES)[number];

export const SEXES = ["female", "male", "unspecified"] as const;
export type Sex = (typeof SEXES)[number];

export const APPETITES = ["small", "medium", "large"] as const;
export type Appetite = (typeof APPETITES)[number];

export const TARGET_KINDS = ["default", "training"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** Also the "default precision" household setting (R2-ADM-6). */
export const TOLERANCE_MODES = ["strict", "flexible"] as const;
export type ToleranceMode = (typeof TOLERANCE_MODES)[number];

export const TRAINING_INTENSITIES = ["light", "moderate", "hard"] as const;
export type TrainingIntensity = (typeof TRAINING_INTENSITIES)[number];

export const DAY_OVERRIDE_KINDS = ["training", "rest", "absent_slot", "extra_slot"] as const;
export type DayOverrideKind = (typeof DAY_OVERRIDE_KINDS)[number];

export const DAY_KINDS = ["default", "training"] as const;
export type DayKind = (typeof DAY_KINDS)[number];

export const INGREDIENT_CATEGORIES = [
  "poultry",
  "red_meat",
  "fish",
  "seafood",
  "egg",
  "dairy",
  "plant_protein",
  "grain",
  "starch",
  "legume",
  "vegetable",
  "leafy_green",
  "fruit",
  "nut_seed",
  "oil_fat",
  "sauce_condiment",
  "herb_spice",
  "sweetener",
  "bakery",
  "beverage",
  "supplement",
  "other",
] as const;
export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

/** 02 §3: dietary_flags is a text[] with this vocabulary. */
export const DIETARY_FLAGS = [
  "contains_nuts",
  "contains_gluten",
  "contains_dairy",
  "contains_egg",
  "contains_fish",
  "contains_shellfish",
  "contains_soy",
  "contains_sesame",
  "contains_pork",
  "contains_alcohol",
  "vegan",
  "vegetarian",
] as const;
export type DietaryFlag = (typeof DIETARY_FLAGS)[number];

export const NUTRITION_CONFIDENCES = ["high", "medium", "low"] as const;
export type NutritionConfidence = (typeof NUTRITION_CONFIDENCES)[number];

export const LOCALE_AVAILABILITIES = ["common", "available", "rare"] as const;
export type LocaleAvailability = (typeof LOCALE_AVAILABILITIES)[number];

/** 02 §3 preparation_method.key (unique keys of the seeded methods). */
export const PREPARATION_METHOD_KEYS = [
  "raw",
  "boiled",
  "steamed",
  "poached",
  "grilled",
  "broiled",
  "roasted",
  "baked",
  "air_fried",
  "pan_seared",
  "sauteed",
  "stir_fried",
  "shallow_fried",
  "deep_fried",
  "breaded_baked",
  "breaded_fried",
  "braised",
  "stewed",
  "slow_cooked",
  "pressure_cooked",
  "smoked",
  "blended",
  "marinated_raw",
] as const;

export const COMPONENT_ROLES = [
  "protein",
  "carb",
  "vegetable",
  "sauce",
  "fat",
  "garnish",
  "side",
  "drink",
  "adjuster",
] as const;
export type ComponentRole = (typeof COMPONENT_ROLES)[number];

export const PORTIONINGS = ["continuous", "unit", "fixed"] as const;
export type Portioning = (typeof PORTIONINGS)[number];

/** BLD-8 R-12: how a cooking liquid counts (null = an ordinary ingredient). */
export const COOKING_LIQUIDS = ["absorbed", "retained"] as const;
export type CookingLiquid = (typeof COOKING_LIQUIDS)[number];

export const DISH_SOURCES = ["seed", "ai", "admin"] as const;
export type DishSource = (typeof DISH_SOURCES)[number];

export const DISH_STATUSES = ["draft", "active", "retired"] as const;
export type DishStatus = (typeof DISH_STATUSES)[number];

export const PLAN_DAY_STATUSES = ["draft", "published", "cooked"] as const;
export type PlanDayStatus = (typeof PLAN_DAY_STATUSES)[number];

export const PLAN_MEAL_STATUSES = ["planned", "cooked", "skipped"] as const;
export type PlanMealStatus = (typeof PLAN_MEAL_STATUSES)[number];

export const FIT_STATUSES = ["in_tolerance", "flexible_miss", "infeasible", "untargeted"] as const;
export type FitStatus = (typeof FIT_STATUSES)[number];

/** R2-MEAL-2 one-off overrides. */
export const MEAL_OVERRIDE_KINDS = ["split_member", "make_individual"] as const;
export type MealOverrideKind = (typeof MEAL_OVERRIDE_KINDS)[number];

export const REVIEW_TARGET_TYPES = [
  "dish",
  "component",
  "variant",
  "ingredient",
  "plan_meal",
  "plate",
  "plan_day",
  "cuisine",
  "method",
] as const;
export type ReviewTargetType = (typeof REVIEW_TARGET_TYPES)[number];

export const REACTION_KINDS = ["agree", "disagree", "helpful"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const PREFERENCE_ENTITY_TYPES = [
  "dish",
  "ingredient",
  "cuisine",
  "method",
  "flavour_tag",
  "component_role",
] as const;
export type PreferenceEntityType = (typeof PREFERENCE_ENTITY_TYPES)[number];

export const PREFERENCE_SOURCES = ["explicit", "learned", "proposal"] as const;
export type PreferenceSource = (typeof PREFERENCE_SOURCES)[number];

export const PREFERENCE_HARDNESS = ["none", "never", "always_ok"] as const;
export type PreferenceHardness = (typeof PREFERENCE_HARDNESS)[number];

export const FREQUENCY_ENTITY_TYPES = ["dish", "ingredient", "cuisine", "method"] as const;
export type FrequencyEntityType = (typeof FREQUENCY_ENTITY_TYPES)[number];

export const EXCLUSION_KINDS = ["ingredient", "category", "dietary_flag"] as const;
export type ExclusionKind = (typeof EXCLUSION_KINDS)[number];

export const EXCLUSION_REASONS = ["allergy", "religious", "dislike", "medical", "other"] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const AI_GENERATION_MODES = ["auto", "ask", "off"] as const;
export type AiGenerationMode = (typeof AI_GENERATION_MODES)[number];

/** R2-DL-1 detail levels (SPEC-Q-4f). */
export const DETAIL_LEVELS = ["basic", "detailed", "expert"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export const CHAT_ROLES = ["user", "assistant", "tool", "event"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const PROPOSAL_ORIGINS = ["agent_chat", "insights", "rule"] as const;
export type ProposalOrigin = (typeof PROPOSAL_ORIGINS)[number];

export const PROPOSAL_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "expired",
  "superseded",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const CHANGE_ACTORS = ["user", "agent", "system"] as const;
export type ChangeActor = (typeof CHANGE_ACTORS)[number];

export const CHANGE_SOURCES = ["ui", "agent_apply", "proposal_accept", "learning"] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

export const KG_EDGE_SOURCES = ["seed", "derived", "learned", "ai"] as const;
export type KgEdgeSource = (typeof KG_EDGE_SOURCES)[number];

export const AI_PURPOSES = ["recipe", "insights", "chat", "comment_extraction"] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

/** Weekdays are 0 = Monday … 6 = Sunday (ISO order minus one) everywhere in the domain model. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Weekday of an ISO calendar date (`YYYY-MM-DD`), 0 = Monday. */
export function weekdayOf(isoDate: string): Weekday {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return ((day + 6) % 7) as Weekday;
}
