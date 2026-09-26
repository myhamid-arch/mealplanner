// Plan-search constants (04 §6–8, PLN-9 … 12). Constants, not user settings, in v1.

/** PLN-11: candidates kept after the cheap pre-score, then solved. */
export const PRE_SCORE_TOP_K = 12;
/** PLN-11: beam width across the slots of a day. */
export const BEAM_WIDTH = 6;
/** PLN-11: alternatives tried per unlocked meal in the week improvement pass. */
export const IMPROVEMENT_ALTERNATIVES = 5;
/** PLN-11: improvement passes over the week. */
export const IMPROVEMENT_PASSES = 2;

/** PLN-9 §6.3: the same dish is not served to a member within this many days (SPEC-Q-5). */
export const DEFAULT_MIN_GAP_DAYS = 6;

/** PLN-9 §6.1 economy: weight of an ingredient not already in the window. */
export const ECONOMY_NEW_INGREDIENT_WEIGHT = 1.5;
/** PLN-9 §6.1 economy: penalty per variant of a component beyond this many (SPEC-Q-8). */
export const KITCHEN_FREE_VARIANTS = 2;
export const KITCHEN_VARIANT_PENALTY = 0.05;

/** PLN-9 §6.1 variety penalties (SPEC-Q-9). */
export const VARIETY_SAME_CUISINE_AS_PREVIOUS = 0.3;
export const VARIETY_CUISINE_THIRD_TIME = 0.3;
export const VARIETY_SAME_MAIN_PROTEIN = 0.2;
/** A cuisine already on this many other meal-days in the window makes this the third. */
export const VARIETY_CUISINE_REPEAT_LIMIT = 2;

/** PLN-12: generate when fewer candidates than this survive the filters and the solver … */
export const AI_MIN_CANDIDATES = 4;
/** … or the best score is below this. */
export const AI_MIN_BEST_SCORE = 0.55;
/** PLN-12: dishes requested per trigger. */
export const AI_DISH_COUNT = 3;

/**
 * ADR-1 §6: seeded jitter added to each pre-score, in [0, PRE_SCORE_JITTER). Below every weighted
 * score difference the spec's components express with a coefficient of 0.05 or more.
 */
export const PRE_SCORE_JITTER = 0.01;

/** Slack for floating-point comparisons of scores. */
export const SCORE_EPSILON = 1e-9;
/** Slack for kcal and gram comparisons against tolerances (as the solver's CHECK_EPSILON). */
export const MACRO_EPSILON = 1e-6;
