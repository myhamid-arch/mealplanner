// Constants of the insights engine (FBK-6, FBK-7, FBK-8; leaf-1.3.3 SPEC-Q-4 … 16, BLD-8 R-33).
// They are constants in v1.
import {
  MAIN_MIN_GAP_DAYS,
  SHORT_GAP_SLOT_KEYS,
  SHORT_MIN_GAP_DAYS,
} from "../../planner/select/config.js";
import { NEGATIVE_TASTE_TAGS } from "../preferences/config.js";

/** FBK-7: the insights job runs after every 10 unprocessed reviews (SPEC-Q-8). */
export const INSIGHTS_REVIEW_TRIGGER = 10;
/** FBK-7: synthesis sees the last 20 rejected proposals with their notes. */
export const SYNTHESIS_REJECTED_LIMIT = 20;

/** Rules read reviews from this window (SPEC-Q-8, SPEC-Q-13). */
export const REVIEW_WINDOW_DAYS = 30;
/** FBK-7 rule 4: "≥ 3 days in 14". */
export const PLATE_MISS_WINDOW_DAYS = 14;
export const PLATE_MISS_MIN_DAYS = 3;
/** FBK-5 targeted quantity feedback window and count (SPEC-Q-14). */
export const QUANTITY_WINDOW_DAYS = 14;
export const QUANTITY_MIN_SIGNALS = 2;
/** FBK-6 observed frequency: "more than 2× in 7 days" with a mean rating below 3. */
export const OBSERVED_WINDOW_DAYS = 7;
export const OBSERVED_MAX_SERVINGS = 2;
export const OBSERVED_MAX_MEAN_RATING = 3;

/** FBK-7 rule 1: mean ≤ 2.5 over ≥ 3 reviews from the same member. */
export const VARIANT_DISLIKE_MIN_REVIEWS = 3;
/** SPEC-Q-12 (SC-3): the dish-level twin needs ≥ 2 ratings. */
export const DISH_DISLIKE_MIN_REVIEWS = 2;
export const DISLIKE_MAX_MEAN_RATING = 2.5;
/** Score and lock proposed for a disliked dish or variant. */
export const DISLIKE_SCORE = -0.8;
/** SPEC-Q-15: a sibling variant this well rated is named in the rationale. */
export const SIBLING_MIN_MEAN_RATING = 3.5;

/** FBK-7 rule 2: ≥ 3 negative component reviews (SPEC-Q-11). */
export const INGREDIENT_DISLIKE_MIN_REVIEWS = 3;
/** A negative component review: rating ≤ 2 or a negative taste tag. */
export const NEGATIVE_RATING_MAX = 2;

/** FBK-7 rule 3: a recipe note tag repeated ≥ 2 times. */
export const RECIPE_NOTE_MIN_REPEATS = 2;
/** FBK-3: the quality notes (negative taste tags) and the kitchen tags that feed a recipe revision. */
export const RECIPE_NOTE_TAGS: readonly string[] = [
  ...NEGATIVE_TASTE_TAGS,
  "recipe_unclear",
  "quantity_wrong",
];
/**
 * BLD-8 R-33 / W-2: the op kind a recipe revision is proposed with. `null` while the registry had
 * no such op (rule 3's candidates were digest notes); R-40 added `recipe.revise`, so rule 3's
 * findings are proposals.
 */
export const RECIPE_REVISION_OP: string | null = "recipe.revise";

/** FBK-7 rule 5: an AI-estimated ingredient used in ≥ 3 planned meals (SPEC-Q-16). */
export const AI_INGREDIENT_MIN_MEALS = 3;
export const AI_ESTIMATE_SOURCE = "ai_estimate";

/**
 * FBK-3 practical tags (W-23, R-82, R-83): the packing tags, counted together on meals in packed
 * slots, propose a `dish` exclusion scoped to the household's packed slots; `took_too_long` has
 * no slot meaning and becomes a digest note (leaf-1.3.7 SPEC-Q-4, SPEC-Q-5).
 */
export const PACKING_TAGS: readonly string[] = ["hard_to_pack", "went_soggy_in_box", "cold_is_bad"];
export const SLOW_TAG = "took_too_long";
export const PRACTICAL_MIN_REVIEWS = 2;
/** Not protected (AGT-5, SPEC-Q-7): a practical exclusion is advisory, never an allergy or a rule. */
export const PRACTICAL_EXCLUSION_REASON = "other";

/** FBK-6. */
export const FREQUENCY_MIN_SIGNALS = 2;
export const MORE_OFTEN_MIN_GAP_DAYS = 3;
export const LESS_OFTEN_MIN_GAP_DAYS = 14;
/**
 * 1.2.6 (R-62, R-63, R-14), OQ-8: the planner's default repeat gap (PLN-9 §6.3), which a frequency
 * proposal starts from: 7 days for main meals, 4 for snack and workout meals.
 */
export const DEFAULT_MIN_GAP_DAYS = MAIN_MIN_GAP_DAYS;
/**
 * The default gap for a dish served in these slots: 4 when every one is a snack or workout slot,
 * else 7 (a pair of servings takes the larger gap of its two slots, R-63).
 */
export function defaultMinGapDays(slotKeys: readonly string[]): number {
  return slotKeys.length > 0 && slotKeys.every((k) => SHORT_GAP_SLOT_KEYS.includes(k))
    ? SHORT_MIN_GAP_DAYS
    : MAIN_MIN_GAP_DAYS;
}

/** FBK-5 targeted: preference boost for higher-volume plates (SPEC-Q-14). */
export const VEGETABLE_BOOST_SCORE = 0.5;

/** SPEC-Q-4: share moved per distribution proposal, and the smallest share a slot may keep. */
export const SHARE_SHIFT = 0.05;
export const MIN_SLOT_SHARE = 0.05;

/** FBK-8. */
export const PENDING_BUDGET = 5;
export const PROPOSAL_EXPIRY_DAYS = 14;
export const REJECTION_COOLDOWN_DAYS = 30;
/** BLD-8 R-33 (b). */
export const ACCEPTANCE_COOLDOWN_DAYS = 30;
/** FBK-8: "unless new evidence has doubled". */
export const EVIDENCE_MULTIPLIER = 2;

/** R-10: never proposed, whatever the origin (SPEC-Q-6). */
export const NEVER_PROPOSED_KINDS: readonly string[] = [
  "access.block",
  "access.remove",
  "access.link_member",
  "support.grant",
];

/** Priorities, 1 (low) … 5 (high); the budget keeps the highest first (R-33). */
export const PRIORITY = {
  neverAgain: 5,
  plateMisses: 4,
  dishDislike: 3,
  variantDislike: 3,
  frequency: 3,
  ingredientDislike: 2,
  recipeNotes: 2,
  aiIngredient: 2,
  targetedQuantity: 2,
  practical: 2,
} as const;

/** Review ids kept in one proposal's evidence (the most recent); `count` keeps the full size. */
export const MAX_EVIDENCE_IDS = 50;

export const DAY_MS = 24 * 60 * 60 * 1000;
