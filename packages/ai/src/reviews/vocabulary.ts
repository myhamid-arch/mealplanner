// The FBK-3 tag vocabulary (06 §2): the tags an extraction may return, by group.
export const TAG_GROUPS = {
  taste: [
    "loved_it",
    "tasty",
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
  ],
  quantity: ["too_much", "too_little", "just_right", "still_hungry"],
  frequency: ["more_often", "less_often", "never_again"],
  practical: ["hard_to_pack", "went_soggy_in_box", "cold_is_bad", "took_too_long"],
  kitchen: ["ingredient_unavailable", "recipe_unclear", "quantity_wrong"],
} as const satisfies Record<string, readonly string[]>;

export const REVIEW_TAGS: readonly string[] = Object.values(TAG_GROUPS).flat();

/** Tags that contradict each other: an extracted tag is dropped when the author gave its opposite. */
export const OPPOSITES: ReadonlyArray<readonly [string, string]> = [
  ["too_much", "too_little"],
  ["too_much", "still_hungry"],
  ["too_much", "just_right"],
  ["too_little", "just_right"],
  ["more_often", "less_often"],
  ["more_often", "never_again"],
  ["too_spicy", "not_spicy_enough"],
  ["loved_it", "never_again"],
];
