// FBK-4 constants. FBK-4 names `learning/config.ts`; this leaf owns `learning/preferences/**`, so
// the preference-model constants live here (leaf-1.3.2 SPEC-Q-3). They are constants in v1.

/** Shrinkage `k` in `score = Σ(wᵢ·sᵢ) / (Σwᵢ + k)`: one review moves a score at most 1/3 of the way. */
export const SHRINKAGE_K = 2;

/** Stored `score` and `evidence_weight` are `numeric(10,3)`. */
export const SCORE_DECIMALS = 3;

/** Taste tags that add to the review signal (FBK-3, FBK-4). */
export const POSITIVE_TASTE_TAGS = { loved_it: 1, tasty: 0.5 } as const;

/** The FBK-3 taste tags other than `loved_it` and `tasty`; each adds −0.5 (SPEC-Q-5). */
export const NEGATIVE_TASTE_TAGS = [
  "bland",
  "too_salty",
  "too_spicy",
  "not_spicy_enough",
  "too_sweet",
  "too_oily",
  "dry",
  "soggy",
  "overcooked",
  "undercooked",
] as const;
export const NEGATIVE_TASTE_TAG_SIGNAL = -0.5;
/** The negative taste tags together add at most −1. */
export const NEGATIVE_TASTE_TAG_CAP = -1;

/**
 * FBK-4 propagation weights, by the reviewed target. Ingredient weights are divided by √n, n being
 * the number of distinct core ingredients the review reaches.
 */
export const PROPAGATION = {
  dish: { dish: 1, cuisine: 0.3, method: 0.3, ingredient: 0.15 },
  variant: { variant: 1, method: 0.5, dish: 0.3 },
  component: { variant: 0.8, ingredient: 0.2 },
  /** ingredient, cuisine and method reviews: that entity only. */
  direct: 1,
} as const;

/** FBK-4 appeal evaluation weights. */
export const APPEAL_WEIGHTS = {
  dish: 0.35,
  variant: 0.2,
  cuisine: 0.15,
  method: 0.1,
  ingredient: 0.15,
  kgSimilarity: 0.05,
} as const;

/** `ingredientTerm = mean − 0.5·max(0, −min)`: one disliked ingredient drags hard. */
export const INGREDIENT_DISLIKE_DRAG = 0.5;

/** Core ingredients exclude these (PLN-9 Economy; SPEC-Q-6: salt and pepper are herb_spice). */
export const NON_CORE_CATEGORIES: readonly string[] = ["herb_spice"];
export const NON_CORE_SLUGS: readonly string[] = ["water"];
