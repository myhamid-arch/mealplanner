// Response and request shapes of the API (ARC-5), as Zod schemas. Timestamps are ISO strings,
// dates `YYYY-MM-DD`, nutrients per 02/03. Exclusion keys for `kind = ingredient` are ingredient
// slugs; preference and frequency-rule keys for `entity_type = ingredient` are ingredient ids
// (BLD-8 R-36). Every exclusion row filters, whatever `hard` (R-34); `hard` only protects it.
import { z } from "zod";
import {
  AI_GENERATION_MODES,
  AI_PURPOSES,
  APPETITES,
  CHANGE_ACTORS,
  CHANGE_SOURCES,
  CHAT_ROLES,
  COMPONENT_ROLES,
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
  JOB_STATUSES,
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
} from "@mealplanner/core/types";
import { FOLLOWUP_KINDS } from "@mealplanner/core/onboarding/followups";
import { Id, IsoDate, JsonValue, Time, Timestamp } from "./common.js";

const nullableNumber = z.number().nullable();

// Identity, households, access ---------------------------------------------------------------------

export const UserDto = z.object({ id: Id, email: z.string(), name: z.string() });

export const MembershipDto = z.object({
  householdId: Id,
  householdName: z.string(),
  role: z.enum(HOUSEHOLD_ROLES),
  status: z.enum(HOUSEHOLD_USER_STATUSES),
  memberId: Id.nullable(),
});

export const MeDto = z.object({
  user: UserDto.extend({ twoFactorEnabled: z.boolean() }),
  memberships: z.array(MembershipDto),
  platformOperator: z.boolean(),
});

export const Password = z.string().min(8).max(128);

export const SignupBody = z
  .object({
    email: z.email(),
    password: Password,
    name: z.string().trim().min(1).max(100),
    householdName: z.string().trim().min(1).max(100),
  })
  .strict();

/** A signed-in session: `token` is the bearer token for mobile clients (ARC-6). */
export const SessionDto = z.object({
  user: UserDto,
  householdId: Id.nullable(),
  token: z.string(),
});

export const HouseholdDto = z.object({
  id: Id,
  name: z.string(),
  locale: z.string(),
  timezone: z.string(),
  unitSystem: z.literal("metric"),
  countryCode: z.string(),
  regionNote: z.string().nullable(),
  membersSeePlates: z.boolean(),
  agentMayApply: z.boolean(),
  requireTotpForAdmins: z.boolean(),
  kitchenSeesNames: z.boolean(),
  membersReviewForSiblings: z.boolean(),
  insightFrequency: z.enum(INSIGHT_FREQUENCIES),
  defaultPrecision: z.enum(TOLERANCE_MODES),
  satFatDefaultPct: z.number(),
  suspendedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});

export const DeletionDto = z.object({
  requestedAt: Timestamp.nullable(),
  requestedByUserId: Id.nullable(),
  confirmedAt: Timestamp.nullable(),
  confirmedByUserId: Id.nullable(),
  /** True while a second admin must confirm (R2-ADM-6). */
  awaitingSecondAdmin: z.boolean(),
  /** When the purge runs (confirmation + 14 days); null while not scheduled. */
  purgeAfter: Timestamp.nullable(),
});

export const InviteExpiry = z.enum(["24h", "7d", "30d"]);

export const InviteDto = z.object({
  id: Id,
  code: z.string().length(10),
  link: z.string(),
  role: z.enum(HOUSEHOLD_ROLES),
  memberId: Id.nullable(),
  expiresAt: Timestamp,
  usedAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  status: z.enum(["open", "used", "revoked", "expired"]),
});

export const InviteCreateBody = z
  .object({
    role: z.enum(HOUSEHOLD_ROLES),
    memberId: Id.nullable().default(null),
    expiresIn: InviteExpiry.default("7d"),
    channel: z.enum(["link", "email"]).default("link"),
    email: z.email().optional(),
  })
  .strict()
  .refine(
    (b) => b.channel !== "email" || b.email !== undefined,
    "email is required for channel email",
  );

export const InviteResendBody = z
  .object({ channel: z.enum(["link", "email"]).default("link"), email: z.email().optional() })
  .strict()
  .refine(
    (b) => b.channel !== "email" || b.email !== undefined,
    "email is required for channel email",
  );

export const InviteLookupDto = z.object({
  householdName: z.string(),
  role: z.enum(HOUSEHOLD_ROLES),
  memberName: z.string().nullable(),
  expiresAt: Timestamp,
});

export const InviteAcceptBody = z
  .object({
    code: z.string().trim().length(10),
    /** A new user signs up with the invite; omitted when already signed in. */
    signup: z
      .object({ email: z.email(), password: Password, name: z.string().trim().min(1).max(100) })
      .strict()
      .optional(),
    /**
     * An existing account that cannot sign in because it has no usable login (removed or blocked
     * everywhere) joins with its credentials, checked server-side.
     */
    credentials: z
      .object({ email: z.email(), password: z.string().min(1).max(128) })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (b) => b.signup === undefined || b.credentials === undefined,
    "give signup or credentials, not both",
  );

export const InviteAcceptDto = z.object({
  householdId: Id,
  role: z.enum(HOUSEHOLD_ROLES),
  userId: Id,
  /** Bearer token of the new session, when the request signed up. */
  token: z.string().nullable(),
});

export const LoginDto = z.object({
  userId: Id,
  name: z.string(),
  email: z.string(),
  role: z.enum(HOUSEHOLD_ROLES),
  status: z.enum(HOUSEHOLD_USER_STATUSES),
  memberId: Id.nullable(),
  memberName: z.string().nullable(),
  lastActiveAt: Timestamp.nullable(),
  blockedReason: z.string().nullable(),
});

export const AccessListDto = z.object({
  logins: z.array(LoginDto),
  membersWithoutLogin: z.array(z.object({ memberId: Id, displayName: z.string() })),
});

export const Reason = z.string().trim().min(1).max(500);

export const AccessChangeDto = z.object({ changeSetId: Id, sessionsRevoked: z.number().int() });

export const SessionRowDto = z.object({
  id: Id,
  createdAt: Timestamp,
  expiresAt: Timestamp,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});

export const NotificationPrefDto = z.object({
  key: z.string().min(1).max(60),
  enabled: z.boolean(),
});

export const AccountDto = z.object({
  user: UserDto,
  twoFactorEnabled: z.boolean(),
  notifications: z.array(NotificationPrefDto),
});

export const TotpEnableDto = z.object({ totpUri: z.string(), backupCodes: z.array(z.string()) });

export const SupportGrantDto = z.object({
  id: Id,
  operatorUserId: Id,
  operatorEmail: z.string(),
  grantedByUserId: Id,
  createdAt: Timestamp,
  expiresAt: Timestamp,
  revokedAt: Timestamp.nullable(),
  active: z.boolean(),
});

// Configuration ----------------------------------------------------------------------------------

export const MemberDto = z.object({
  id: Id,
  displayName: z.string(),
  color: z.string(),
  birthYear: z.number().int().nullable(),
  sex: z.enum(SEXES).nullable(),
  isTargeted: z.boolean(),
  appetite: z.enum(APPETITES),
  notes: z.string().nullable(),
  archivedAt: Timestamp.nullable(),
});

export const TargetProfileDto = z.object({
  id: Id,
  memberId: Id,
  kind: z.enum(TARGET_KINDS),
  kcal: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  satFatMaxG: nullableNumber,
  solubleFibreMinG: nullableNumber,
  fibreMinG: nullableNumber,
  sodiumMaxMg: nullableNumber,
});

export const ToleranceDto = z.object({
  memberId: Id,
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  kcal: z.number(),
  mode: z.enum(TOLERANCE_MODES),
});

export const MemberDetailDto = MemberDto.extend({
  targets: z.array(TargetProfileDto),
  tolerance: ToleranceDto.nullable(),
});

export const TargetsDto = z.object({
  targets: z.array(TargetProfileDto),
  tolerances: z.array(ToleranceDto),
});

export const SlotDto = z.object({
  id: Id,
  key: z.string(),
  label: z.string(),
  icon: z.string(),
  sortOrder: z.number().int(),
  defaultTime: Time,
  isShared: z.boolean(),
  isPacked: z.boolean(),
  reheatAvailable: z.boolean(),
  isTrainingSlot: z.boolean(),
  constraintsNote: z.string().nullable(),
  active: z.boolean(),
});

export const SchedulesDto = z.object({
  slotSchedules: z.array(
    z.object({ memberId: Id, slotTypeId: Id, weekday: z.number().int(), attends: z.boolean() }),
  ),
  training: z.array(
    z.object({
      memberId: Id,
      weekday: z.number().int(),
      sessionTime: Time.nullable(),
      intensity: z.enum(TRAINING_INTENSITIES).nullable(),
    }),
  ),
  dayOverrides: z.array(
    z.object({
      id: Id,
      memberId: Id,
      date: IsoDate,
      kind: z.enum(DAY_OVERRIDE_KINDS),
      slotTypeId: Id.nullable(),
    }),
  ),
  distributions: z.array(
    z.object({ memberId: Id, dayKind: z.enum(DAY_KINDS), slotTypeId: Id, share: z.number() }),
  ),
  slotTargets: z.array(
    z.object({
      memberId: Id,
      dayKind: z.enum(DAY_KINDS),
      slotTypeId: Id,
      kcal: nullableNumber,
      proteinG: nullableNumber,
      carbsG: nullableNumber,
      fatG: nullableNumber,
    }),
  ),
});

export const WeightsDto = z.object({
  macroPrecision: z.number(),
  appeal: z.number(),
  ingredientEconomy: z.number(),
  variety: z.number(),
  fairness: z.number(),
  aiGeneration: z.enum(AI_GENERATION_MODES),
  economyWindowDays: z.number().int(),
  adjustersEnabled: z.boolean(),
  maxVariantsPerComponent: z.number().int(),
  updatedAt: Timestamp,
});

export const PresetDto = z.object({
  id: Id,
  name: z.string(),
  values: JsonValue,
  appliesToWeekdays: z.array(z.number().int()).nullable(),
});

export const ExclusionDto = z.object({
  id: Id,
  memberId: Id.nullable(),
  kind: z.enum(EXCLUSION_KINDS),
  /** Ingredient slug, category or dietary flag (R-36). */
  key: z.string(),
  reason: z.enum(EXCLUSION_REASONS),
  hard: z.boolean(),
  // 1.2.6 (R-62), OQ-9: null = every slot; otherwise only meals of these slot keys.
  slotKeys: z.array(z.string()).nullable(),
});

export const FrequencyRuleDto = z.object({
  id: Id,
  memberId: Id.nullable(),
  entityType: z.enum(FREQUENCY_ENTITY_TYPES),
  entityKey: z.string(),
  minGapDays: z.number().int().nullable(),
  maxPerWeek: z.number().int().nullable(),
  source: z.enum(PREFERENCE_SOURCES),
  locked: z.boolean(),
});

export const MealOverrideDto = z.object({
  id: Id,
  planDate: IsoDate,
  slotTypeId: Id,
  kind: z.enum(MEAL_OVERRIDE_KINDS),
  memberIds: z.array(Id),
});

export const PreferenceDto = z.object({
  id: Id,
  memberId: Id.nullable(),
  entityType: z.enum(PREFERENCE_ENTITY_TYPES),
  entityKey: z.string(),
  score: z.number(),
  evidenceWeight: z.number(),
  source: z.enum(PREFERENCE_SOURCES),
  locked: z.boolean(),
  hard: z.enum(PREFERENCE_HARDNESS),
  updatedAt: Timestamp,
});

export const PreferenceSetBody = z
  .object({
    memberId: Id.nullable(),
    entityType: z.enum(PREFERENCE_ENTITY_TYPES),
    entityKey: z.string().min(1).max(200),
    score: z.number().min(-1).max(1),
    locked: z.boolean().default(true),
    hard: z.enum(PREFERENCE_HARDNESS).default("none"),
  })
  .strict();

export const PreferenceResetBody = z
  .object({
    memberId: Id.nullable(),
    entityType: z.enum(PREFERENCE_ENTITY_TYPES),
    entityKey: z.string().min(1).max(200),
  })
  .strict();

// Catalogue --------------------------------------------------------------------------------------

export const Nutrients = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  satFat: z.number(),
  fibre: z.number(),
  solubleFibre: nullableNumber,
  sugar: nullableNumber,
  sodiumMg: nullableNumber,
});

export const IngredientDto = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  category: z.enum(INGREDIENT_CATEGORIES),
  per100gRaw: Nutrients,
  dietaryFlags: z.array(z.string()),
  unitWeightG: nullableNumber,
  unitLabel: z.string().nullable(),
  nutritionSource: z.string(),
  nutritionConfidence: z.enum(NUTRITION_CONFIDENCES),
  needsReview: z.boolean(),
  householdPrivate: z.boolean(),
});

export const CuisineDto = z.object({
  id: Id,
  key: z.string(),
  label: z.string(),
  parentKey: z.string().nullable(),
});

export const MethodDto = z.object({
  id: Id,
  key: z.string(),
  label: z.string(),
  description: z.string(),
  appealTags: z.array(z.string()),
});

export const DishSummaryDto = z.object({
  id: Id,
  householdId: Id.nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  cuisineKey: z.string(),
  secondaryCuisineKey: z.string().nullable(),
  slotKeys: z.array(z.string()),
  flavourTags: z.array(z.string()),
  isPackable: z.boolean(),
  servedColdOk: z.boolean(),
  source: z.enum(DISH_SOURCES),
  status: z.enum(DISH_STATUSES),
  version: z.number().int(),
  createdAt: Timestamp,
  isAdjuster: z.boolean(),
});

export const VariantDto = z.object({
  id: Id,
  methodKey: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  steps: z.array(z.string()),
  cookTimeMin: z.number().int().nullable(),
  notes: z.string().nullable(),
  referenceBatchCookedG: z.number(),
  needsReview: z.boolean(),
  /** Per 100 g cooked (dish_nutrition_cache); null before the first recompute. */
  per100gCooked: Nutrients.nullable(),
  ingredients: z.array(
    z.object({
      ingredientId: Id,
      slug: z.string(),
      name: z.string(),
      rawGPerBatch: z.number(),
      roleNote: z.string().nullable(),
      isAbsorbedOil: z.boolean(),
      cookingLiquid: z.enum(["absorbed", "retained"]).nullable(),
    }),
  ),
});

export const ComponentDto = z.object({
  id: Id,
  name: z.string(),
  role: z.enum(COMPONENT_ROLES),
  portioning: z.enum(PORTIONINGS),
  unitLabel: z.string().nullable(),
  minServingG: z.number(),
  maxServingG: z.number(),
  defaultServingG: z.number(),
  stepG: z.number(),
  required: z.boolean(),
  variants: z.array(VariantDto),
});

export const DishDto = DishSummaryDto.extend({ components: z.array(ComponentDto) });

// Plans ------------------------------------------------------------------------------------------

export const ScoreBreakdownDto = z.object({
  macroFit: z.number(),
  appeal: z.number(),
  economy: z.number(),
  variety: z.number(),
  total: z.number(),
  weights: z.object({
    macroPrecision: z.number(),
    appeal: z.number(),
    ingredientEconomy: z.number(),
    variety: z.number(),
  }),
  reasons: z.array(z.string()),
});

export const MacroSet = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

export const PlateItemDto = z.object({
  componentId: Id,
  variantId: Id,
  cookedG: z.number(),
  /** True for an adjuster side (PLN-6). */
  side: z.boolean(),
});

export const PlateDto = z.object({
  id: Id,
  planMealId: Id,
  memberId: Id,
  fitStatus: z.enum(FIT_STATUSES),
  items: z.array(PlateItemDto),
  actual: Nutrients.nullable(),
  /** The slot target and deviation; null where the viewer may not see this member's targets. */
  target: MacroSet.extend({ tolerance: MacroSet, carbBasis: z.string() }).nullable(),
  deviation: MacroSet.nullable(),
});

export const PlanMealDto = z.object({
  id: Id,
  date: IsoDate,
  slotTypeId: Id,
  slotKey: z.string(),
  slotLabel: z.string(),
  time: Time,
  kind: z.enum(["shared", "individual"]),
  memberScope: z.string(),
  attendees: z.array(Id),
  splitMembers: z.array(Id),
  dishId: Id,
  dishName: z.string(),
  dishVersion: z.number().int(),
  locked: z.boolean(),
  status: z.enum(PLAN_MEAL_STATUSES),
  /** Admin only (the "why this dish" breakdown). */
  scoreBreakdown: ScoreBreakdownDto.nullable(),
  /** Plates the viewer may see (ARC-6; empty for kitchen, who use the cook sheet). */
  plates: z.array(PlateDto),
});

export const PlanDayDto = z.object({
  id: Id,
  date: IsoDate,
  status: z.enum(PLAN_DAY_STATUSES),
  generatedAt: Timestamp,
  meals: z.array(PlanMealDto),
});

export const PlansDto = z.object({ days: z.array(PlanDayDto) });

export const GenerateBody = z
  .object({
    dates: z.array(IsoDate).min(1).max(14),
    seed: z.number().int().min(0).max(2_147_483_647).default(1),
  })
  .strict();

export const AlternativeDto = z.object({
  dishId: Id,
  dishName: z.string(),
  scoreBreakdown: ScoreBreakdownDto,
  plates: z.array(z.object({ memberId: Id, fitStatus: z.enum(FIT_STATUSES) })),
});

export const AlternativesDto = z.object({
  current: ScoreBreakdownDto,
  alternatives: z.array(AlternativeDto).max(5),
});

export const SwapBody = z.object({ dishId: Id }).strict();

export const PlateOverrideBody = z
  .object({
    items: z
      .array(
        z.object({ componentId: Id, variantId: Id, cookedG: z.number().min(0).max(5000) }).strict(),
      )
      .min(1),
  })
  .strict();

export const CookSheetDto = z.object({
  date: IsoDate,
  banner: z.array(z.string()),
  meals: z.array(
    z.object({
      planMealId: Id,
      slotKey: z.string(),
      slotLabel: z.string(),
      time: z.string(),
      kind: z.enum(["shared", "individual"]),
      dishId: Id,
      dishName: z.string(),
      cuisineKey: z.string(),
      batches: z.array(
        z.object({
          kind: z.enum(["component", "adjuster"]),
          componentName: z.string(),
          variantId: Id,
          variantLabel: z.string(),
          methodKey: z.string(),
          totalCookedG: z.number(),
          servings: z.number().int(),
          raw: z.array(z.object({ ingredientId: Id, slug: z.string(), rawG: z.number() })),
          discardedFat: z.array(z.object({ ingredientId: Id, slug: z.string(), rawG: z.number() })),
          steps: z.array(z.string()),
        }),
      ),
      plating: z.object({
        columns: z.array(
          z.object({ componentId: Id, name: z.string(), unitLabel: z.string().nullable() }),
        ),
        rows: z.array(
          z.object({
            memberId: Id,
            memberName: z.string(),
            cells: z.array(
              z.object({
                componentId: Id,
                variantLabel: z.string().nullable(),
                cookedG: z.number(),
                units: z.number().nullable(),
              }),
            ),
            sides: z.array(
              z.object({ dishName: z.string(), cookedG: z.number(), label: z.string() }),
            ),
          }),
        ),
      }),
      notes: z.array(z.string()),
      allergyBanners: z.array(
        z.object({ memberName: z.string(), allergen: z.string(), text: z.string() }),
      ),
    }),
  ),
});

/** R2-UX-1 kitchen flags on the cook sheet. */
export const KitchenFlagBody = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("unavailable"),
      ingredientId: Id,
      planMealId: Id.optional(),
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unclear"),
      variantId: Id,
      planMealId: Id.optional(),
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
]);

export const KitchenFlagDto = z.object({ reviewId: Id, jobId: Id.nullable() });

// Reviews ----------------------------------------------------------------------------------------

export const ReviewDto = z.object({
  id: Id,
  authorUserId: Id,
  authorName: z.string(),
  onBehalfOfMemberId: Id.nullable(),
  targetType: z.enum(REVIEW_TARGET_TYPES),
  targetId: z.string(),
  planMealId: Id.nullable(),
  rating: z.number().int().nullable(),
  tags: z.array(z.string()),
  comment: z.string().nullable(),
  parentReviewId: Id.nullable(),
  createdAt: Timestamp,
  editedAt: Timestamp.nullable(),
  reactions: z.object({
    agree: z.number().int(),
    disagree: z.number().int(),
    helpful: z.number().int(),
  }),
});

export const ReviewCreateBody = z
  .object({
    targetType: z.enum(REVIEW_TARGET_TYPES),
    targetId: z.string().min(1).max(200),
    onBehalfOfMemberId: Id.nullable().optional(),
    planMealId: Id.nullable().optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).default([]),
    comment: z.string().max(4000).nullable().optional(),
  })
  .strict();

export const ReviewEditBody = z
  .object({
    rating: z.number().int().min(1).max(5).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    comment: z.string().max(4000).nullable().optional(),
  })
  .strict();

export const ReplyBody = z.object({ comment: z.string().trim().min(1).max(4000) }).strict();

export const ReactionBody = z.object({ kind: z.enum(REACTION_KINDS) }).strict();

export const ReviewRevisionDto = z.object({
  id: Id,
  rating: z.number().int().nullable(),
  tags: z.array(z.string()),
  comment: z.string().nullable(),
  replacedAt: Timestamp,
  editedByUserId: Id,
});

// Proposals, change log, conversations, jobs -----------------------------------------------------

export const ProposalDto = z.object({
  id: Id,
  origin: z.enum(PROPOSAL_ORIGINS),
  conversationId: Id.nullable(),
  kind: z.string(),
  payload: JsonValue,
  rationale: z.string(),
  evidence: JsonValue,
  status: z.enum(PROPOSAL_STATUSES),
  decidedByUserId: Id.nullable(),
  decidedAt: Timestamp.nullable(),
  decisionNote: z.string().nullable(),
  changeSetId: Id.nullable(),
  expiresAt: Timestamp,
});

export const RejectBody = z.object({ note: z.string().trim().max(200).optional() }).strict();

export const FieldChangeDto = z.object({
  entity: z.string(),
  key: z.record(z.string(), JsonValue),
  field: z.string(),
  before: JsonValue.optional(),
  after: JsonValue.optional(),
});

export const DescriptionDto = z.object({
  kind: z.string(),
  area: z.string(),
  title: z.string(),
  changes: z.array(FieldChangeDto),
});

export const ChangeLogEntryDto = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("change_set"),
    id: Id,
    actor: z.enum(CHANGE_ACTORS),
    actorUserId: Id.nullable(),
    source: z.enum(CHANGE_SOURCES),
    summary: z.string(),
    areas: z.array(z.string()),
    appliedAt: Timestamp,
    undoneAt: Timestamp.nullable(),
    undoneByChangeSetId: Id.nullable(),
    undo: z.object({ available: z.boolean(), reason: z.string().nullable() }),
    // 1.4.10 (R-68, W-14): what the entry changed, resolved when the log is read from the ops and
    // their before-images; absent when the subject no longer exists or spans several subjects.
    detail: z
      .object({
        title: z.string(),
        subject: z.string(),
        changes: z.array(
          z.object({
            label: z.string(),
            before: z.string().nullable(),
            after: z.string().nullable(),
          }),
        ),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("support_view"),
    id: Id,
    operatorUserId: Id,
    operatorEmail: z.string(),
    method: z.string(),
    path: z.string(),
    at: Timestamp,
    undo: z.object({ available: z.literal(false), reason: z.string() }),
  }),
]);

export const ChangeSetDto = z.object({
  id: Id,
  actor: z.enum(CHANGE_ACTORS),
  actorUserId: Id.nullable(),
  source: z.enum(CHANGE_SOURCES),
  summary: z.string(),
  forward: JsonValue,
  appliedAt: Timestamp,
  undoneAt: Timestamp.nullable(),
  undoneByChangeSetId: Id.nullable(),
});

export const ChangeSetBody = z
  .object({ summary: z.string().trim().min(1).max(200), ops: z.array(JsonValue).min(1).max(200) })
  .strict();

export const PreviewBody = z.object({ ops: z.array(JsonValue).min(1).max(200) }).strict();

export const AppliedDto = z.object({ changeSetId: Id, descriptions: z.array(DescriptionDto) });

export const ConversationDto = z.object({
  id: Id,
  title: z.string(),
  createdAt: Timestamp,
  archivedAt: Timestamp.nullable(),
});

export const ChatMessageDto = z.object({
  id: Id,
  role: z.enum(CHAT_ROLES),
  content: JsonValue,
  createdAt: Timestamp,
});

/** `POST /conversations/{id}/messages` (AGT-7): the admin's message and the panel's screen. */
export const ChatSendBody = z
  .object({
    text: z.string().trim().min(1).max(4000),
    /** What the side panel is showing, e.g. "Recipe: Chicken shawarma bowl" (07 §5). */
    screen: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

/** One Server-Sent Event of a chat turn (`event:` = type, `data:` = this object; SPEC-Q-12). */
export const ChatStreamEventDto = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), message: ChatMessageDto }),
  z.object({ type: z.literal("text_delta"), text: z.string() }),
  z.object({ type: z.literal("thinking") }),
  z.object({
    type: z.literal("tool_start"),
    toolUseId: z.string(),
    name: z.string(),
    label: z.string(),
  }),
  z.object({
    type: z.literal("tool_done"),
    toolUseId: z.string(),
    name: z.string(),
    ok: z.boolean(),
    cards: z.array(JsonValue),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({
    type: z.literal("done"),
    stopReason: z.string(),
    modelCalls: z.number().int(),
  }),
]);

export const JobDto = z.object({
  id: Id,
  kind: z.string(),
  status: z.enum(JOB_STATUSES),
  error: JsonValue.nullable(),
  createdAt: Timestamp,
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
});

/** One SSE event of a job (`id:` = seq, `event:` = type, `data:` = this object). */
export const JobEventDto = z.object({
  jobId: Id,
  seq: z.number().int(),
  type: z.string(),
  payload: JsonValue,
  createdAt: Timestamp,
});

export const AiGenerationDto = z.object({
  id: Id,
  purpose: z.enum(AI_PURPOSES),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  stopReason: z.string(),
  hasValidationErrors: z.boolean(),
  createdAt: Timestamp,
});

export const DiagnosticsDto = z.object({
  aiCalls: z.array(AiGenerationDto).max(50),
  failedJobs: z.array(JobDto),
});

// Platform (R2-ADM-8) ----------------------------------------------------------------------------

/** Platform data only: counts and account metadata, no household-internal content (SPEC-Q-7). */
export const PlatformHouseholdDto = z.object({
  id: Id,
  name: z.string(),
  admins: z.number().int(),
  logins: z.number().int(),
  plans30d: z.number().int(),
  aiCalls30d: z.number().int(),
  status: z.enum(["active", "suspended", "deletion_pending"]),
  createdAt: Timestamp,
});

export const PlatformUserDto = z.object({
  id: Id,
  email: z.string(),
  name: z.string(),
  platformBlocked: z.boolean(),
  memberships: z.array(
    z.object({
      householdId: Id,
      householdName: z.string(),
      role: z.enum(HOUSEHOLD_ROLES),
      status: z.enum(HOUSEHOLD_USER_STATUSES),
    }),
  ),
});

export const AiUsageDto = z.object({
  from: Timestamp,
  to: Timestamp,
  rows: z.array(
    z.object({
      model: z.string(),
      purpose: z.enum(AI_PURPOSES),
      calls: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      cacheReadTokens: z.number().int(),
      /** USD at the price table's rates; null for a model the table does not list. */
      costUsd: z.number().nullable(),
    }),
  ),
  totalCostUsd: z.number(),
});

export const PlatformJobDto = JobDto.extend({ householdId: Id.nullable() });

export const SupportSummaryDto = z.object({
  household: HouseholdDto,
  members: z.number().int(),
  logins: z.number().int(),
  planDays: z.number().int(),
  pendingProposals: z.number().int(),
});

// Detail levels (R2-DL-1; leaf 1.4.3, BLD-8 R-47) ------------------------------------------------

/** A section key: `targets`, `meal_split`, `taste` (per member); `slots`, `planning`, `taste` (household). */
export const DetailSection = z.string().regex(/^[a-z][a-z_]{0,39}$/);

export const DetailLevelDto = z.object({
  memberId: Id.nullable(),
  section: DetailSection,
  level: z.enum(DETAIL_LEVELS),
});

export const DetailLevelSetBody = z
  .object({ memberId: Id.nullable(), section: DetailSection, level: z.enum(DETAIL_LEVELS) })
  .strict();

// Portion biases (FBK-5, FBK-9; leaf 1.4.5, BLD-8 R-53) ------------------------------------------

/** One learned role bias of an untargeted member's portions (FBK-5: 0.6 … 1.6, starts at 1). */
export const PortionBiasDto = z.object({
  memberId: Id,
  componentRole: z.enum(COMPONENT_ROLES),
  factor: z.number(),
});

// W-5 (1.4.7, R-55): onboarding parse, planning preview, first-days follow-ups ------------------

/** R2-ONB-3: one free-text answer for the assistant to read (leaf-1.4.7 SPEC-Q-2 … 5). */
export const OnboardingParseBody = z
  .object({
    field: z.enum(["people", "targets", "never_eat"]),
    text: z.string().trim().min(1).max(2000),
    /** Question 1's names, for `never_eat`. */
    people: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    /** R-88: question 1's ages, in the order of `people` ("the kids" names them). */
    ages: z.array(z.number().int().min(0).max(120).nullable()).max(20).optional(),
    /** R-88: the whole never-eat answer, for context; `text` is the one statement to read. */
    context: z.string().trim().max(2000).optional(),
  })
  .strict();

const PersonAnswerDto = z.object({
  name: z.string(),
  age: z.number().int().nullable(),
  sex: z.enum(SEXES).nullable(),
});

const DayTargetsDto = z.object({
  kcal: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  satFatMaxG: z.number().optional(),
  solubleFibreMinG: z.number().optional(),
  fibreMinG: z.number().optional(),
  sodiumMaxMg: z.number().optional(),
});

/** The shape of `TargetParse` (@mealplanner/core/onboarding). */
const TargetParseDto = z.union([
  z.object({
    ok: z.literal(true),
    value: DayTargetsDto.extend({ training: DayTargetsDto.optional() }),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

/** The shape of `NeverEatItem` (@mealplanner/core/onboarding); R-88 adds the mapping. */
const NeverEatItemDto = z.object({
  who: z.string(),
  term: z.string(),
  reason: z.enum(EXCLUSION_REASONS),
  target: z
    .object({
      kind: z.enum(["dietary_flag", "category", "ingredient"]),
      keys: z.array(z.string()),
    })
    .optional(),
  keeps: z.string().optional(),
});

export const OnboardingParseDto = z.union([
  z.object({ people: z.array(PersonAnswerDto) }),
  z.object({ targets: TargetParseDto }),
  z.object({
    neverEat: z.array(NeverEatItemDto),
    /** R-88: what the assistant asks when the answer can be read more than one way. */
    questions: z
      .array(
        z.object({
          who: z.string(),
          said: z.string(),
          question: z.string(),
          options: z.array(z.object({ label: z.string(), items: z.array(NeverEatItemDto) })),
        }),
      )
      .optional(),
    /** R-88: words that name no food in the catalogue, with why. */
    unclear: z.array(z.object({ who: z.string(), said: z.string(), why: z.string() })).optional(),
  }),
]);

/** UX-4: weights to preview; the five numeric weights of `weights.set`, any subset. */
export const PlanPreviewBody = z
  .object({
    dates: z.array(IsoDate).min(1).max(7),
    weights: z
      .object({
        macroPrecision: z.number().min(0).max(1),
        appeal: z.number().min(0).max(1),
        ingredientEconomy: z.number().min(0).max(1),
        variety: z.number().min(0).max(1),
        fairness: z.number().min(0).max(1),
      })
      .partial()
      .strict(),
    seed: z.number().int().min(0).max(2_147_483_647).default(1),
  })
  .strict();

const PreviewMetricsDto = z.object({
  /** Distinct core ingredients over the dates' meals (SC-2's count). */
  distinctIngredients: z.number().int(),
  /** Targeted plates in tolerance, in %; null when no plate is targeted. */
  inTolerancePct: z.number().nullable(),
  meals: z.number().int(),
  targetedPlates: z.number().int(),
});

const PreviewSideDto = z.object({
  dishId: Id,
  dishName: z.string(),
  /** A member's variant choices (`kind: variant`), e.g. "Fried eggs". */
  variants: z.array(z.string()),
});

/** The job result of `plans.preview` (leaf-1.4.7 SPEC-Q-6), the `done` event's payload. */
export const PlanPreviewDto = z.object({
  dates: z.array(IsoDate),
  seed: z.number().int(),
  currentSource: z.enum(["saved", "computed"]),
  current: PreviewMetricsDto,
  proposed: PreviewMetricsDto,
  changes: z.array(
    z.object({
      date: IsoDate,
      slotKey: z.string(),
      slotLabel: z.string(),
      /** `shared`, or the member of an individual meal. */
      memberScope: z.string(),
      kind: z.enum(["dish", "variant", "added", "removed"]),
      /** The member whose variants change (`kind: variant`). */
      memberId: Id.nullable(),
      before: PreviewSideDto.nullable(),
      after: PreviewSideDto.nullable(),
    }),
  ),
  /** PLN-12 requests for new recipes the replan would make (a preview generates none). */
  generationRequests: z.number().int(),
});

const LinkDto = z.object({ label: z.string(), href: z.string() });

export const FollowupDto = z.object({
  key: z.string(),
  kind: z.enum(FOLLOWUP_KINDS),
  question: z.string(),
  choices: z.array(z.object({ id: z.string(), label: z.string(), then: LinkDto.nullable() })),
  more: LinkDto.nullable(),
});

/** R2-ONB-6 (FirstDaysPhone): today's card, what comes next, and the checklist. */
export const SetupFollowupsDto = z.object({
  today: IsoDate,
  /** "day N": the household's first local day is 1. */
  day: z.number().int(),
  card: FollowupDto.nullable(),
  position: z.number().int(),
  total: z.number().int(),
  upcoming: z.array(FollowupDto),
  checklist: z.object({
    items: z.array(z.object({ key: z.string(), label: z.string(), done: z.boolean() })),
    done: z.number().int(),
    total: z.number().int(),
  }),
});

export const FollowupKey = z.string().regex(/^[a-z_]{1,40}(:[0-9a-f-]{36})?$/);

export const FollowupAnswerBody = z.object({ choice: z.string().min(1).max(20) }).strict();

export const FollowupAnswerDto = z.object({
  /** The change set the answer applied; null when it changed nothing. */
  changeSetId: Id.nullable(),
  /** Where the rest of the answer is entered ("Go up": the training-day numbers). */
  then: LinkDto.nullable(),
  followups: SetupFollowupsDto,
});

// BLD-8 R-52 (leaf 1.4.4) ------------------------------------------------------------------------

/** One changed meal of a `plates.substitute` run (R2-UX-1). */
export const SubstitutedMealDto = z.object({
  planMealId: Id,
  date: IsoDate,
  slotLabel: z.string(),
  fromDishName: z.string(),
  toDishName: z.string(),
});

/** A kitchen flag of a date with its substitution job and result (R2-UX-1, SPEC-Q-1). */
export const KitchenFlagViewDto = z.object({
  reviewId: Id,
  kind: z.enum(["unavailable", "unclear"]),
  ingredientId: Id.nullable(),
  ingredientName: z.string().nullable(),
  variantId: Id.nullable(),
  planMealId: Id.nullable(),
  note: z.string().nullable(),
  authorName: z.string(),
  createdAt: Timestamp,
  job: z
    .object({ id: Id, status: z.enum(JOB_STATUSES), finishedAt: Timestamp.nullable() })
    .nullable(),
  result: z
    .object({
      substituteId: Id.nullable(),
      substituteName: z.string().nullable(),
      changeSetId: Id.nullable(),
      meals: z.array(SubstitutedMealDto),
      unresolved: z.array(Id),
    })
    .nullable(),
});

export const KitchenFlagsDto = z.object({ flags: z.array(KitchenFlagViewDto) });

export const PlanMealStatusBody = z.object({ status: z.enum(PLAN_MEAL_STATUSES) }).strict();

// 1.4.8 (R-58) ------------------------------------------------------------------------------------

/** Move a meal to the same slot on another planned draft day (UX-4 drag to move). */
export const PlanMealMoveBody = z.object({ toDate: IsoDate }).strict();

/** The moved meal first, then the meal it exchanged places with, if any. */
export const PlanMealMoveResultDto = z.object({ changeSetId: Id, meals: z.array(PlanMealDto) });
