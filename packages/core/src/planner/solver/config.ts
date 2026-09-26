// Portion-solver constants (04 §4 PLN-5; kept here, not in planner/config.ts: SPEC-Q-9, BLD-8 R-25).
// They are constants, not user settings, in v1.

/** Weight of plate naturalness: Σ |g − ρ·G| / G_ref. */
export const LAMBDA_RATIO = 0.5;
/**
 * Fibre goals (OQ-4, R-28, leaf-1.2.2 ADR-2): penalty per gram of shortfall below the slot's
 * total-fibre and soluble-fibre goals. Soft goals, not constraints; unknown soluble fibre counts
 * as 0 (NUT-8).
 */
export const LAMBDA_FIBRE_SHORTFALL = 0.05;
export const LAMBDA_SOLUBLE_FIBRE_SHORTFALL = 0.1;
/** Saturated-fat pressure, per gram. */
export const LAMBDA_SAT_FAT = 0.02;
/** Tie-break towards the member's preferred variants, per unit of mean appeal. */
export const LAMBDA_APPEAL = 0.3;
/**
 * Per adjuster used (SPEC-Q-9): the retry prefers one adjuster over two. It is above the whole
 * centring term of an in-tolerance plate (at most 4), so a second adjuster is used only when one
 * cannot reach tolerance.
 */
export const LAMBDA_ADJUSTER = 5;

/** More combinations than this and only the top-3 appeal variants per component are kept. */
export const MAX_COMBINATIONS = 24;
export const TOP_VARIANTS_WHEN_PRUNED = 3;

/** PLN-6: at most this many adjusters on a plate. */
export const MAX_ADJUSTERS = 2;
/** PLN-6: an adjuster needs at least this appeal for the member. */
export const MIN_ADJUSTER_APPEAL = -0.2;

/** PLN-5: HiGHS time limit per combination, seconds. */
export const TIME_LIMIT_PER_COMBINATION_S = 0.25;

/** PLN-7 appetite factors for untargeted plates. */
export const APPETITE_FACTORS = { small: 0.75, medium: 1.0, large: 1.3 } as const;

/** Slack for floating-point comparisons against tolerances and caps (grams or kcal). */
export const CHECK_EPSILON = 1e-6;
