// Inputs and outputs of the insights engine (FBK-7, leaf-1.3.3 ADR-1). Pure data: the db service
// loads it, the rules read it, and synthesis (packages/ai) adds to the drafts.
import { z } from "zod";
import { ChangeOpSchema, type ChangeOp } from "../../changes/index.js";
import type {
  ComponentRole,
  FitStatus,
  HouseholdConfig,
  PlanMealStatus,
  ProposalOrigin,
  ReviewTargetType,
} from "../../types/index.js";

/** A review the rules read: top-level (no parent) and on behalf of a member. */
export interface InsightReview {
  id: string;
  memberId: string;
  targetType: ReviewTargetType;
  targetId: string;
  planMealId: string | null;
  rating: number | null;
  tags: readonly string[];
  comment: string | null;
  createdAt: Date;
}

export interface InsightVariant {
  id: string;
  label: string;
  isDefault: boolean;
  /** Every ingredient of the variant. */
  ingredientIds: readonly string[];
  /** The FBK-4 core ingredients (1.3.2 `coreIngredients`). */
  coreIngredientIds: readonly string[];
}

export interface InsightComponent {
  id: string;
  name: string;
  role: ComponentRole;
  variants: readonly InsightVariant[];
}

export interface InsightDish {
  id: string;
  name: string;
  components: readonly InsightComponent[];
}

export interface InsightIngredient {
  id: string;
  slug: string;
  name: string;
  nutritionSource: string;
  /** Only household-private ingredients can be verified by a household (ingredient.verify). */
  householdPrivate: boolean;
  verified: boolean;
}

export interface InsightPlate {
  id: string;
  memberId: string;
  fitStatus: FitStatus;
  /** `deviation.kcal` of the plate (actual − target), or null when not recorded. */
  kcalDeviation: number | null;
  items: readonly { componentId: string; variantId: string }[];
}

export interface InsightMeal {
  id: string;
  /** The plan day's date, `YYYY-MM-DD`. */
  date: string;
  slotTypeId: string;
  dishId: string;
  status: PlanMealStatus;
  plates: readonly InsightPlate[];
}

export interface InsightInput {
  /** The run time. */
  now: Date;
  /** Today's date in the household's time zone, `YYYY-MM-DD`. */
  today: string;
  config: HouseholdConfig;
  /** Reviews in the rule window (REVIEW_WINDOW_DAYS). */
  reviews: readonly InsightReview[];
  /** Every dish a review or a meal refers to. */
  dishes: readonly InsightDish[];
  /** Ingredients the rules may name (reviewed dishes' and planned dishes' ingredients). */
  ingredients: readonly InsightIngredient[];
  /** Plan meals from REVIEW_WINDOW_DAYS ago onwards, with their plates. */
  meals: readonly InsightMeal[];
}

export const RULE_IDS = [
  "variant_dislike",
  "dish_dislike",
  "ingredient_dislike",
  "recipe_notes",
  "plate_misses",
  "ai_ingredient",
  "more_often",
  "less_often",
  "never_again",
  "observed_frequency",
  "targeted_quantity",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export const EvidenceSchema = z
  .object({
    reviewIds: z.array(z.uuid()).max(200),
    /** The size of the evidence: distinct reviews, or miss days / meals (SPEC-Q-9). */
    count: z.number().int().nonnegative(),
    metrics: z.record(z.string(), z.number()).default({}),
  })
  .strict();
export type Evidence = z.output<typeof EvidenceSchema>;

/** A proposal before guardrails: rule candidates and synthesised proposals alike. */
export interface ProposalDraft {
  origin: ProposalOrigin;
  /** Which rule produced it (rule origin only). */
  rule?: RuleId;
  title: string;
  rationale: string;
  ops: readonly ChangeOp[];
  evidence: Evidence;
  /** 1 (low) … 5 (high). */
  priority: number;
}

/** Validates a draft: every op through the registry's ChangeOpSchema (FBK-7). */
export const ProposalDraftSchema = z
  .object({
    origin: z.enum(["agent_chat", "insights", "rule"]),
    rule: z.enum(RULE_IDS).optional(),
    title: z.string().trim().min(1).max(200),
    rationale: z.string().trim().min(1).max(4000),
    ops: z.array(ChangeOpSchema).min(1).max(20),
    evidence: EvidenceSchema,
    priority: z.number().int().min(1).max(5),
  })
  .strict();

/** The stored `proposal.payload` (leaf-1.3.3 SPEC-Q-2). */
export const ProposalPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    ops: z.array(ChangeOpSchema).min(1).max(20),
  })
  .strict();
export type ProposalPayload = z.output<typeof ProposalPayloadSchema>;

/** A rule finding that cannot be a proposal (FBK-7 rule 3 while RECIPE_REVISION_OP is null). */
export interface InsightNote {
  rule: RuleId;
  title: string;
  rationale: string;
  /** What the note is about, e.g. `{ dishId, variantId, tags }`. */
  subject: Record<string, string | number | null | Record<string, number>>;
  evidence: Evidence;
}

export interface RuleOutput {
  candidates: ProposalDraft[];
  notes: InsightNote[];
}
