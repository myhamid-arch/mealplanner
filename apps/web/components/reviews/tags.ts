// The review tag vocabulary (FBK-3) as the screens show it, plus the three custom tags that only the
// mockups use (leaf-1.4.5 SPEC-Q-6: stored as custom tags, no signal). Tags are stored as keys.
import type { Tone } from "@mealplanner/ui-tokens/tokens";

export const TASTE_TAGS = [
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
] as const;
export const QUANTITY_TAGS = ["too_much", "too_little", "just_right", "still_hungry"] as const;
export const FREQUENCY_TAGS = ["more_often", "less_often", "never_again"] as const;
export const PRACTICAL_TAGS = [
  "hard_to_pack",
  "went_soggy_in_box",
  "cold_is_bad",
  "took_too_long",
] as const;
export const KITCHEN_TAGS = ["ingredient_unavailable", "recipe_unclear", "quantity_wrong"] as const;
/** SPEC-Q-6: ReviewComposePhone's part chips that FBK-3 does not name. */
export const CUSTOM_TAGS = ["crispy", "too_sour", "not_for_me"] as const;

const LABELS: Readonly<Record<string, string>> = {
  loved_it: "Loved it",
  tasty: "Tasty",
  bland: "Bland",
  too_salty: "Too salty",
  too_spicy: "Too spicy",
  not_spicy_enough: "Not spicy enough",
  too_sweet: "Too sweet",
  too_oily: "Too oily",
  dry: "Dry",
  soggy: "Soggy",
  overcooked: "Overcooked",
  undercooked: "Undercooked",
  too_much: "Too much",
  too_little: "Too little",
  just_right: "Just right",
  still_hungry: "Still hungry",
  more_often: "More often",
  less_often: "Less often",
  never_again: "Never again",
  hard_to_pack: "Hard to pack",
  went_soggy_in_box: "Went soggy in the box",
  cold_is_bad: "Not good cold",
  took_too_long: "Took too long",
  ingredient_unavailable: "Ingredient unavailable",
  recipe_unclear: "Recipe unclear",
  quantity_wrong: "Quantity wrong",
  crispy: "Crispy",
  too_sour: "Too sour",
  not_for_me: "Not for me",
};

/** "too_salty" → "Too salty"; an unknown custom tag reads as its words. */
export function tagLabel(tag: string): string {
  const known = LABELS[tag];
  if (known !== undefined) return known;
  const words = tag.replace(/[_-]+/g, " ").trim();
  return words === "" ? tag : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** QuickRatePhone's one-tap chips, in the mockup's order. */
export const QUICK_TAGS = [
  "loved_it",
  "too_much",
  "too_little",
  "more_often",
  "too_spicy",
  "bland",
] as const;

/** The "How often?" choice of the detailed review: at most one. */
export const HOW_OFTEN = FREQUENCY_TAGS;

const POSITIVE = new Set<string>(["loved_it", "tasty", "crispy", "just_right", "more_often"]);
const NEGATIVE = new Set<string>([
  ...TASTE_TAGS.filter((t) => t !== "loved_it" && t !== "tasty"),
  "too_sour",
  "not_for_me",
  "never_again",
  "less_often",
]);
const AMOUNT = new Set<string>(["too_much", "too_little", "still_hungry"]);

/** Chip tone of a posted tag: green for liked, amber for amounts, red for dislikes (ReviewsFeed). */
export function tagTone(tag: string): Tone {
  if (POSITIVE.has(tag)) return "basil";
  if (AMOUNT.has(tag)) return "saffron";
  if (NEGATIVE.has(tag)) return "pomegranate";
  return "neutral";
}

/** The chips a part offers, by component role (ReviewComposePhone: fish, rice, salad rows). */
export function partTags(role: string): readonly string[] {
  switch (role) {
    case "protein":
      return ["crispy", "dry", "too_oily", "loved_it"];
    case "carb":
      return ["too_little", "too_much", "just_right"];
    case "vegetable":
      return ["not_for_me", "too_sour", "loved_it"];
    case "sauce":
      return ["loved_it", "too_salty", "too_spicy", "bland"];
    default:
      return ["loved_it", "not_for_me", "too_much", "too_little"];
  }
}

/** The part's summary on the right of its row ("Loved", "Too much", "Not for me", "—"). */
export function partSummary(tags: readonly string[]): { text: string; tone: Tone } {
  if (tags.includes("not_for_me")) return { text: "Not for me", tone: "pomegranate" };
  if (tags.includes("too_much")) return { text: "Too much", tone: "saffron" };
  if (tags.includes("too_little")) return { text: "Too little", tone: "saffron" };
  if (tags.some((t) => NEGATIVE.has(t))) return { text: "Not quite", tone: "pomegranate" };
  if (tags.includes("just_right")) return { text: "Just right", tone: "basil" };
  if (tags.some((t) => POSITIVE.has(t))) return { text: "Loved", tone: "basil" };
  return { text: "—", tone: "neutral" };
}

/** Quantity tags (the feed's "Portions" filter). */
export const isQuantityTag = (tag: string): boolean =>
  (QUANTITY_TAGS as readonly string[]).includes(tag);
/** Frequency tags (the feed's "How often" filter). */
export const isFrequencyTag = (tag: string): boolean =>
  (FREQUENCY_TAGS as readonly string[]).includes(tag);
/** Kitchen tags (the feed's "Kitchen" chip; SPEC-Q-15). */
export const isKitchenTag = (tag: string): boolean =>
  (KITCHEN_TAGS as readonly string[]).includes(tag);
