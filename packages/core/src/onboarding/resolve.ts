// Resolves a never-eat term against the catalogue (R2-ONB-3): allergen words become a
// `dietary_flag` exclusion, which covers every ingredient carrying that flag (sesame → tahini,
// hummus, za'atar …); other foods become ingredient exclusions keyed by slug (R-36). This is the
// deterministic part: it never depends on the model. W-28: group words ("seafood", "red meat")
// become `category` exclusions, and terms are matched loosely: modifiers ("raw", "fresh") are
// dropped, word order and "minced"/"ground" don't matter, and an animal word ("chicken", "beef")
// covers every cut of it.
import { DIETARY_FLAGS, type DietaryFlag } from "../types/index.js";
import type { InferContext, NeverEatTarget } from "./types.js";
import { sameWords, words } from "./text.js";

/** Allergen and rule words that name a whole dietary flag (02 §3 dietary_flags). */
const FLAG_WORDS: readonly (readonly [string, DietaryFlag])[] = [
  ["sesame", "contains_sesame"],
  ["sesame seed", "contains_sesame"],
  ["nut", "contains_nuts"],
  ["tree nut", "contains_nuts"],
  ["peanut", "contains_nuts"],
  ["gluten", "contains_gluten"],
  ["wheat", "contains_gluten"],
  ["dairy", "contains_dairy"],
  ["milk", "contains_dairy"],
  ["lactose", "contains_dairy"],
  ["egg", "contains_egg"],
  ["fish", "contains_fish"],
  ["shellfish", "contains_shellfish"],
  ["soy", "contains_soy"],
  ["soya", "contains_soy"],
  ["pork", "contains_pork"],
  ["pig", "contains_pork"],
  ["alcohol", "contains_alcohol"],
];

/** Group words that name whole catalogue categories (02 §3 ingredient categories). */
const CATEGORY_WORDS: readonly (readonly [string, readonly string[]])[] = [
  ["seafood", ["seafood", "fish"]],
  ["sea food", ["seafood", "fish"]],
  ["poultry", ["poultry"]],
  ["red meat", ["red_meat"]],
  ["meat", ["red_meat", "poultry"]],
  ["legume", ["legume"]],
  ["pulse", ["legume"]],
];

/** Words describing a state the catalogue does not distinguish; dropped before matching. */
const MODIFIERS = new Set(["raw", "fresh", "cooked", "uncooked", "plain"]);

/** Word forms the catalogue spells differently. */
const SYNONYMS: ReadonlyMap<string, string> = new Map([
  ["minced", "mince"],
  ["ground", "mince"],
  ["prawn", "shrimp"],
]);

/** Categories in which a single word covers every item naming it ("chicken" → every cut). */
const ANIMAL_CATEGORIES = new Set(["poultry", "red_meat", "seafood", "fish"]);

export type Resolution = (
  | { kind: "dietary_flag"; flag: DietaryFlag; slugs: string[] }
  | { kind: "category"; categories: string[]; slugs: string[] }
  | { kind: "ingredient"; slugs: string[] }
  | { kind: "unknown" }
) & {
  /** Modifier words dropped from the term ("raw"): the rule covers every form of the food. */
  dropped?: string[];
};

type Ingredient = InferContext["ingredients"][number];

function nameWords(ingredient: Ingredient): string[] {
  return words(ingredient.name);
}

/** The name before its first comma: "Beef mince, 80% lean" → beef mince. */
function headWords(ingredient: Ingredient): string[] {
  return words(ingredient.name.split(",")[0] ?? "");
}

/** The term's words without modifiers, with synonyms mapped to the catalogue's form. */
function termWords(term: string): { words: string[]; dropped: string[] } {
  const all = words(term);
  const kept = all.filter((w) => !MODIFIERS.has(w)).map((w) => SYNONYMS.get(w) ?? w);
  return { words: kept, dropped: all.filter((w) => MODIFIERS.has(w)) };
}

/** Every ingredient carrying the flag, in catalogue order. */
export function flagCoverage(flag: DietaryFlag, ingredients: readonly Ingredient[]): Ingredient[] {
  return ingredients.filter((i) => i.dietaryFlags.includes(flag));
}

/**
 * A term matches an ingredient when it equals its slug, name, the name before its comma or an
 * alias. Failing that, a phrase matches names containing all its words in any order ("minced beef"
 * → beef mince); a single word matches the head noun (the last word: "liver" → beef liver, chicken
 * liver; "kidney" does not match kidney beans). A single word also matches any word of an animal
 * item's name, alongside exact matches ("chicken" → every chicken cut; "lamb" → every lamb cut).
 */
export function matchIngredients(term: string, ingredients: readonly Ingredient[]): Ingredient[] {
  const t = termWords(term).words;
  if (t.length === 0) return [];
  const exact = ingredients.filter(
    (i) =>
      sameWords(words(i.slug.replace(/-/g, " ")), t) ||
      sameWords(nameWords(i), t) ||
      sameWords(headWords(i), t) ||
      i.aliases.some((a) => sameWords(words(a), t)),
  );
  if (t.length === 1) {
    const word = t[0] ?? "";
    const animal = ingredients.filter(
      (i) =>
        i.category !== undefined &&
        ANIMAL_CATEGORIES.has(i.category) &&
        headWords(i).includes(word),
    );
    const found = [...new Set([...exact, ...animal])];
    if (found.length > 0) return ingredients.filter((i) => found.includes(i));
    return ingredients.filter((i) => {
      const n = headWords(i);
      return n.length > 1 && n[n.length - 1] === word;
    });
  }
  if (exact.length > 0) return exact;
  return ingredients.filter((i) => {
    const n = headWords(i);
    return t.every((w) => n.includes(w));
  });
}

export function resolveTerm(term: string, ingredients: readonly Ingredient[]): Resolution {
  const { words: t, dropped } = termWords(term);
  const extra = dropped.length > 0 ? { dropped } : {};
  const flag = FLAG_WORDS.find(([w]) => sameWords(words(w), t))?.[1];
  if (flag !== undefined)
    return {
      kind: "dietary_flag",
      flag,
      slugs: flagCoverage(flag, ingredients).map((i) => i.slug),
      ...extra,
    };
  const categories = CATEGORY_WORDS.find(([w]) => sameWords(words(w), t))?.[1];
  if (categories !== undefined) {
    const slugs = ingredients
      .filter((i) => i.category !== undefined && categories.includes(i.category))
      .map((i) => i.slug);
    if (slugs.length > 0) return { kind: "category", categories: [...categories], slugs, ...extra };
  }
  const found = matchIngredients(term, ingredients);
  if (found.length === 0) return { kind: "unknown" };
  return { kind: "ingredient", slugs: found.map((i) => i.slug), ...extra };
}

/**
 * R-88: the assistant's mapping, checked against the catalogue. A flag covers what the catalogue
 * flags (the model cannot widen or narrow it); a category covers its catalogue items; unknown
 * slugs are dropped. Nothing left → unknown.
 */
export function resolveTarget(
  target: NeverEatTarget,
  ingredients: readonly Ingredient[],
): Resolution {
  if (target.kind === "dietary_flag") {
    const flag = target.keys[0];
    if (target.keys.length !== 1 || !(DIETARY_FLAGS as readonly string[]).includes(flag ?? ""))
      return { kind: "unknown" };
    return {
      kind: "dietary_flag",
      flag: flag as DietaryFlag,
      slugs: flagCoverage(flag as DietaryFlag, ingredients).map((i) => i.slug),
    };
  }
  if (target.kind === "category") {
    const categories = target.keys.filter((k) => ingredients.some((i) => i.category === k));
    if (categories.length === 0) return { kind: "unknown" };
    return {
      kind: "category",
      categories,
      slugs: ingredients
        .filter((i) => i.category !== undefined && categories.includes(i.category))
        .map((i) => i.slug),
    };
  }
  const known = new Set(ingredients.map((i) => i.slug));
  const slugs = [...new Set(target.keys)].filter((k) => known.has(k));
  return slugs.length === 0 ? { kind: "unknown" } : { kind: "ingredient", slugs };
}
