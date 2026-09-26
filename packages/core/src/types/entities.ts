// Row shapes of the household-scoped and catalogue tables (02-domain-model, 13-revision-r2,
// BLD-8 R-9 … R-12), as plain TypeScript types that core can use without a database library.
// Keys are camelCase; timestamps are Date; `date` columns are ISO `YYYY-MM-DD` strings; `time`
// columns are `HH:MM:SS` strings; numeric columns are numbers; nullable columns are `| null`.
// packages/db asserts at compile time that each type equals the Drizzle table's select type.
import type {
  AiGenerationMode,
  Appetite,
  ChangeActor,
  ChangeSource,
  ChatRole,
  ComponentRole,
  CookingLiquid,
  DayKind,
  DayOverrideKind,
  DetailLevel,
  DishSource,
  DishStatus,
  ExclusionKind,
  ExclusionReason,
  FitStatus,
  FrequencyEntityType,
  HouseholdRole,
  HouseholdUserStatus,
  IngredientCategory,
  InsightFrequency,
  KgEdgeSource,
  LocaleAvailability,
  MealOverrideKind,
  NutritionConfidence,
  PlanDayStatus,
  PlanMealStatus,
  Portioning,
  PreferenceEntityType,
  PreferenceHardness,
  PreferenceSource,
  ProposalOrigin,
  ProposalStatus,
  ReactionKind,
  ReviewTargetType,
  Sex,
  TargetKind,
  ToleranceMode,
  TrainingIntensity,
  UnitSystem,
  AiPurpose,
} from "./enums.js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// §1 Tenancy -----------------------------------------------------------------------------------

export interface HouseholdRow {
  id: string;
  name: string;
  locale: string;
  timezone: string;
  unitSystem: UnitSystem;
  countryCode: string;
  regionNote: string | null;
  membersSeePlates: boolean;
  agentMayApply: boolean;
  requireTotpForAdmins: boolean;
  kitchenSeesNames: boolean;
  membersReviewForSiblings: boolean;
  insightFrequency: InsightFrequency;
  defaultPrecision: ToleranceMode;
  satFatDefaultPct: number;
  deletionRequestedAt: Date | null;
  deletionRequestedByUserId: string | null;
  suspendedAt: Date | null;
  createdAt: Date;
}

export interface HouseholdUserRow {
  householdId: string;
  userId: string;
  role: HouseholdRole;
  memberId: string | null;
  status: HouseholdUserStatus;
  blockedReason: string | null;
  lastActiveAt: Date | null;
  createdAt: Date;
}

export interface InviteRow {
  id: string;
  householdId: string;
  code: string;
  role: HouseholdRole;
  memberId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface SupportGrantRow {
  id: string;
  householdId: string;
  operatorUserId: string;
  grantedByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface DetailLevelRow {
  id: string;
  householdId: string;
  memberId: string | null;
  section: string;
  level: DetailLevel;
}

// §2 Members, targets, schedules -----------------------------------------------------------------

export interface MemberRow {
  id: string;
  householdId: string;
  displayName: string;
  color: string;
  birthYear: number | null;
  sex: Sex | null;
  isTargeted: boolean;
  appetite: Appetite;
  notes: string | null;
  archivedAt: Date | null;
}

export interface TargetProfileRow {
  id: string;
  householdId: string;
  memberId: string;
  kind: TargetKind;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  satFatMaxG: number | null;
  solubleFibreMinG: number | null;
  fibreMinG: number | null;
  sodiumMaxMg: number | null;
}

export interface ToleranceRow {
  memberId: string;
  householdId: string;
  proteinG: number;
  carbsG: number;
  fatG: number;
  kcal: number;
  mode: ToleranceMode;
}

export interface SlotTypeRow {
  id: string;
  householdId: string;
  key: string;
  label: string;
  icon: string;
  sortOrder: number;
  defaultTime: string;
  isShared: boolean;
  isPacked: boolean;
  reheatAvailable: boolean;
  isTrainingSlot: boolean;
  constraintsNote: string | null;
  active: boolean;
}

export interface MemberSlotScheduleRow {
  householdId: string;
  memberId: string;
  slotTypeId: string;
  weekday: number;
  attends: boolean;
}

export interface TrainingScheduleRow {
  householdId: string;
  memberId: string;
  weekday: number;
  sessionTime: string | null;
  intensity: TrainingIntensity | null;
}

export interface DayOverrideRow {
  id: string;
  householdId: string;
  memberId: string;
  date: string;
  kind: DayOverrideKind;
  slotTypeId: string | null;
}

export interface MealDistributionRow {
  householdId: string;
  memberId: string;
  dayKind: DayKind;
  slotTypeId: string;
  share: number;
}

export interface SlotTargetOverrideRow {
  householdId: string;
  memberId: string;
  dayKind: DayKind;
  slotTypeId: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/** FBK-5 learned_role_bias (BLD-8 R-9 e), bounded to [0.6, 1.6]. */
export interface PortionBiasRow {
  householdId: string;
  memberId: string;
  componentRole: ComponentRole;
  bias: number;
}

// §3 Catalogue ---------------------------------------------------------------------------------

export interface IngredientRow {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  category: IngredientCategory;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  satFatG: number;
  fibreG: number;
  solubleFibreG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  densityGPerMl: number | null;
  unitWeightG: number | null;
  unitLabel: string | null;
  ediblePortion: number;
  dietaryFlags: string[];
  nutritionSource: string;
  nutritionConfidence: NutritionConfidence;
  localeAvailability: Record<string, LocaleAvailability>;
  createdByHouseholdId: string | null;
  needsReview: boolean;
  verifiedAt: Date | null;
  verifiedByUserId: string | null;
}

export interface PreparationMethodRow {
  id: string;
  key: string;
  label: string;
  description: string;
  appealTags: string[];
}

export interface MethodYieldRow {
  methodId: string;
  ingredientCategory: IngredientCategory;
  yieldFactor: number;
  fatRetention: number;
  oilAbsorptionGPer100gRaw: number;
}

export interface CuisineRow {
  id: string;
  key: string;
  label: string;
  parentKey: string | null;
}

// §4 Recipes -----------------------------------------------------------------------------------

export interface DishRow {
  id: string;
  householdId: string | null;
  name: string;
  slug: string;
  description: string;
  cuisineId: string;
  secondaryCuisineId: string | null;
  slotKeys: string[];
  flavourTags: string[];
  isPackable: boolean;
  servedColdOk: boolean;
  source: DishSource;
  status: DishStatus;
  aiGenerationId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ComponentRow {
  id: string;
  householdId: string | null;
  dishId: string;
  name: string;
  role: ComponentRole;
  portioning: Portioning;
  unitLabel: string | null;
  minServingG: number;
  maxServingG: number;
  defaultServingG: number;
  stepG: number;
  sortOrder: number;
  required: boolean;
}

export interface VariantRow {
  id: string;
  householdId: string | null;
  componentId: string;
  methodId: string;
  label: string;
  isDefault: boolean;
  steps: string[];
  cookTimeMin: number | null;
  notes: string | null;
  referenceBatchCookedG: number;
  needsReview: boolean;
}

export interface VariantIngredientRow {
  id: string;
  householdId: string | null;
  variantId: string;
  ingredientId: string;
  rawGPerBatch: number;
  roleNote: string | null;
  isAbsorbedOil: boolean;
  cookingLiquid: CookingLiquid | null;
  yieldOverride: number | null;
}

export interface DishNutritionCacheRow {
  variantId: string;
  householdId: string | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  satFat: number;
  fibre: number;
  solubleFibre: number | null;
  sugar: number | null;
  sodium: number | null;
  cookedYieldGPerBatch: number;
  computedAt: Date;
  engineVersion: string;
}

/** PLN-6 household adjuster list (BLD-8 R-9 d). */
export interface HouseholdAdjusterRow {
  householdId: string;
  dishId: string;
  enabled: boolean;
}

// §5 Plans -------------------------------------------------------------------------------------

export interface PlanDayRow {
  id: string;
  householdId: string;
  date: string;
  status: PlanDayStatus;
  weightsSnapshot: Json;
  generatedAt: Date;
  generatorVersion: string;
}

export interface PlanMealRow {
  id: string;
  householdId: string;
  planDayId: string;
  slotTypeId: string;
  dishId: string;
  dishVersion: number;
  /** `shared`, or the uuid of the member for a per-member slot. */
  memberScope: string;
  locked: boolean;
  scoreBreakdown: Json;
  status: PlanMealStatus;
}

export interface PlateRow {
  id: string;
  householdId: string;
  planMealId: string;
  memberId: string;
  fitStatus: FitStatus;
  target: Json;
  actual: Json;
  deviation: Json;
}

export interface PlateItemRow {
  id: string;
  householdId: string;
  plateId: string;
  componentId: string;
  variantId: string;
  cookedG: number;
  rawEquivalent: Record<string, number>;
}

export interface CookBatchRow {
  id: string;
  householdId: string;
  planMealId: string;
  variantId: string;
  totalCookedG: number;
  rawIngredients: Record<string, number>;
  servings: number;
}

/** R2-MEAL-2. */
export interface MealOverrideRow {
  id: string;
  householdId: string;
  planDate: string;
  slotTypeId: string;
  kind: MealOverrideKind;
  memberIds: string[];
  createdBy: string;
  createdAt: Date;
}

// §6 Feedback and learning ---------------------------------------------------------------------

export interface ReviewRow {
  id: string;
  householdId: string;
  authorUserId: string;
  onBehalfOfMemberId: string | null;
  targetType: ReviewTargetType;
  targetId: string;
  planMealId: string | null;
  rating: number | null;
  tags: string[];
  comment: string | null;
  parentReviewId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  processedAt: Date | null;
}

export interface ReviewReactionRow {
  householdId: string;
  reviewId: string;
  userId: string;
  kind: ReactionKind;
}

export interface PreferenceRow {
  id: string;
  householdId: string;
  memberId: string | null;
  entityType: PreferenceEntityType;
  entityKey: string;
  score: number;
  evidenceWeight: number;
  source: PreferenceSource;
  locked: boolean;
  hard: PreferenceHardness;
  updatedAt: Date;
}

export interface FrequencyRuleRow {
  id: string;
  householdId: string;
  memberId: string | null;
  entityType: FrequencyEntityType;
  entityKey: string;
  minGapDays: number | null;
  maxPerWeek: number | null;
  source: PreferenceSource;
  locked: boolean;
}

export interface ExclusionRow {
  id: string;
  householdId: string;
  memberId: string | null;
  kind: ExclusionKind;
  key: string;
  reason: ExclusionReason;
  hard: boolean;
}

export interface PlanningWeightsRow {
  householdId: string;
  macroPrecision: number;
  appeal: number;
  ingredientEconomy: number;
  variety: number;
  fairness: number;
  aiGeneration: AiGenerationMode;
  economyWindowDays: number;
  adjustersEnabled: boolean;
  maxVariantsPerComponent: number;
  updatedAt: Date;
}

export interface WeightPresetRow {
  id: string;
  householdId: string;
  name: string;
  values: Json;
  appliesToWeekdays: number[] | null;
}

// §7 Agent, proposals, change log --------------------------------------------------------------

export interface ConversationRow {
  id: string;
  householdId: string;
  userId: string;
  title: string;
  createdAt: Date;
  archivedAt: Date | null;
}

export interface ChatMessageRow {
  id: string;
  householdId: string;
  conversationId: string;
  role: ChatRole;
  content: Json;
  createdAt: Date;
}

export interface ProposalRow {
  id: string;
  householdId: string;
  origin: ProposalOrigin;
  conversationId: string | null;
  messageId: string | null;
  kind: string;
  payload: Json;
  rationale: string;
  evidence: Json;
  fingerprint: string;
  status: ProposalStatus;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  changeSetId: string | null;
  expiresAt: Date;
}

export interface ChangeSetRow {
  id: string;
  householdId: string;
  actor: ChangeActor;
  actorUserId: string | null;
  source: ChangeSource;
  summary: string;
  forward: Json;
  inverse: Json;
  appliedAt: Date;
  undoneAt: Date | null;
  undoneByChangeSetId: string | null;
}

// §8 Knowledge graph, §9 AI audit --------------------------------------------------------------

export interface KgNodeRow {
  id: string;
  householdId: string | null;
  type: string;
  key: string;
  label: string;
  props: Json;
}

export interface KgEdgeRow {
  id: string;
  householdId: string | null;
  srcId: string;
  dstId: string;
  type: string;
  weight: number;
  props: Json;
  source: KgEdgeSource;
  updatedAt: Date;
}

export interface AiGenerationRow {
  id: string;
  householdId: string;
  purpose: AiPurpose;
  model: string;
  requestSummary: Json;
  responseRaw: Json;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  stopReason: string;
  validationErrors: Json | null;
  createdAt: Date;
}

/**
 * Row type of every entity the change-op registry can read or write, keyed by table name.
 * Each of these is written only through the change-set service (DM-6).
 */
export interface MutableEntityRows {
  household: HouseholdRow;
  household_user: HouseholdUserRow;
  support_grant: SupportGrantRow;
  member: MemberRow;
  target_profile: TargetProfileRow;
  tolerance: ToleranceRow;
  slot_type: SlotTypeRow;
  member_slot_schedule: MemberSlotScheduleRow;
  training_schedule: TrainingScheduleRow;
  day_override: DayOverrideRow;
  meal_distribution: MealDistributionRow;
  slot_target_override: SlotTargetOverrideRow;
  portion_bias: PortionBiasRow;
  ingredient: IngredientRow;
  dish: DishRow;
  component: ComponentRow;
  variant: VariantRow;
  variant_ingredient: VariantIngredientRow;
  dish_nutrition_cache: DishNutritionCacheRow;
  household_adjuster: HouseholdAdjusterRow;
  plan_day: PlanDayRow;
  plan_meal: PlanMealRow;
  plate: PlateRow;
  plate_item: PlateItemRow;
  cook_batch: CookBatchRow;
  meal_override: MealOverrideRow;
  preference: PreferenceRow;
  frequency_rule: FrequencyRuleRow;
  exclusion: ExclusionRow;
  planning_weights: PlanningWeightsRow;
  weight_preset: WeightPresetRow;
}

/** Entities the registry reads but never writes. */
export interface ReadOnlyEntityRows {
  review: ReviewRow;
  cuisine: CuisineRow;
  preparation_method: PreparationMethodRow;
}

export type EntityRows = MutableEntityRows & ReadOnlyEntityRows;
export type EntityName = keyof EntityRows;
export type MutableEntityName = keyof MutableEntityRows;

/** Primary-key columns of each entity (02, BLD-8 R-8). */
export const ENTITY_KEYS = {
  household: ["id"],
  household_user: ["householdId", "userId"],
  support_grant: ["id"],
  member: ["id"],
  target_profile: ["id"],
  tolerance: ["memberId"],
  slot_type: ["id"],
  member_slot_schedule: ["memberId", "slotTypeId", "weekday"],
  training_schedule: ["memberId", "weekday"],
  day_override: ["id"],
  meal_distribution: ["memberId", "dayKind", "slotTypeId"],
  slot_target_override: ["memberId", "dayKind", "slotTypeId"],
  portion_bias: ["memberId", "componentRole"],
  ingredient: ["id"],
  dish: ["id"],
  component: ["id"],
  variant: ["id"],
  variant_ingredient: ["id"],
  dish_nutrition_cache: ["variantId"],
  household_adjuster: ["householdId", "dishId"],
  plan_day: ["id"],
  plan_meal: ["id"],
  plate: ["id"],
  plate_item: ["id"],
  cook_batch: ["id"],
  meal_override: ["id"],
  preference: ["id"],
  frequency_rule: ["id"],
  exclusion: ["id"],
  planning_weights: ["householdId"],
  weight_preset: ["id"],
  review: ["id"],
  cuisine: ["id"],
  preparation_method: ["id"],
} as const satisfies { [E in EntityName]: readonly (keyof EntityRows[E])[] };

/** The primary-key subset of an entity's row. */
export type EntityKey<E extends EntityName> = Pick<
  EntityRows[E],
  (typeof ENTITY_KEYS)[E][number] & keyof EntityRows[E]
>;
