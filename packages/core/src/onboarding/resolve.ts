// Resolves a never-eat term against the catalogue (R2-ONB-3): allergen words become a
// `dietary_flag` exclusion, which covers every ingredient carrying that flag (sesame → tahini,
// hummus, za'atar …); other foods become ingredient exclusions keyed by slug (R-36). This is the
// deterministic part: it never depends on the model.
import type { DietaryFlag } from "../types/index.js";
import type { InferContext } from "./types.js";
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

export type Resolution =
  | { kind: "dietary_flag"; flag: DietaryFlag; slugs: string[] }
  | { kind: "ingredient"; slugs: string[] }
  | { kind: "unknown" };

type Ingredient = InferContext["ingredients"][number];

function nameWords(ingredient: Ingredient): string[] {
  return words(ingredient.name);
}

/** Every ingredient carrying the flag, in catalogue order. */
export function flagCoverage(flag: DietaryFlag, ingredients: readonly Ingredient[]): Ingredient[] {
  return ingredients.filter((i) => i.dietaryFlags.includes(flag));
}

/**
 * A term matches an ingredient when it equals its slug, name or an alias, or the head noun of its
 * name (the last word: "liver" → beef liver, chicken liver; "kidney" does not match kidney beans).
 */
export function matchIngredients(term: string, ingredients: readonly Ingredient[]): Ingredient[] {
  const t = words(term);
  if (t.length === 0) return [];
  const exact = ingredients.filter(
    (i) =>
      sameWords(words(i.slug.replace(/-/g, " ")), t) ||
      sameWords(nameWords(i), t) ||
      i.aliases.some((a) => sameWords(words(a), t)),
  );
  if (exact.length > 0) return exact;
  if (t.length !== 1) return [];
  return ingredients.filter((i) => {
    const n = nameWords(i);
    return n.length > 1 && n[n.length - 1] === t[0];
  });
}

export function resolveTerm(term: string, ingredients: readonly Ingredient[]): Resolution {
  const t = words(term);
  const flag = FLAG_WORDS.find(([w]) => sameWords(words(w), t))?.[1];
  if (flag !== undefined)
    return {
      kind: "dietary_flag",
      flag,
      slugs: flagCoverage(flag, ingredients).map((i) => i.slug),
    };
  const found = matchIngredients(term, ingredients);
  if (found.length === 0) return { kind: "unknown" };
  return { kind: "ingredient", slugs: found.map((i) => i.slug) };
}
