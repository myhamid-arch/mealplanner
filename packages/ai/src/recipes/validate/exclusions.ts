// REC-5 step 3: hard exclusions. The model is never trusted on allergies.
import type { RecipeCatalogue } from "../catalogue.js";
import type { GenerationContext } from "../context.js";
import type { GeneratedDish, NewIngredient } from "../schema.js";
import type { Reason } from "./types.js";

export function checkExclusions(
  dish: GeneratedDish,
  catalogue: RecipeCatalogue,
  exclusions: GenerationContext["exclusions"],
  newIngredients: ReadonlyMap<string, NewIngredient>,
): Reason[] {
  const reasons: Reason[] = [];
  const seen = new Set<string>();
  const add = (code: Reason["code"], message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    reasons.push({ step: 3, code, message });
  };
  const bySlug = new Map(catalogue.ingredients.map((i) => [i.slug, i]));
  const ingredients = new Set(exclusions.ingredients);
  const categories = new Set(exclusions.categories);
  const flags = new Set(exclusions.dietaryFlags);

  for (const c of dish.components)
    for (const v of c.variants)
      for (const line of v.ingredients) {
        const where = `"${line.slug}" in ${c.name} (${v.label})`;
        if (ingredients.has(line.slug))
          add("excluded_ingredient", `${where} is an excluded ingredient`);
        const known = bySlug.get(line.slug);
        if (known !== undefined) {
          if (categories.has(known.category))
            add("excluded_category", `${where} is in the excluded category ${known.category}`);
          for (const flag of known.dietaryFlags)
            if (flags.has(flag))
              add("excluded_dietary_flag", `${where} carries the excluded flag ${flag}`);
          continue;
        }
        const proposed = newIngredients.get(line.slug);
        if (proposed === undefined) continue; // step 2 rejects unknown slugs
        if (categories.has(proposed.category))
          add("excluded_category", `${where} is in the excluded category ${proposed.category}`);
        if (flags.size > 0)
          add(
            "unverifiable_new_ingredient",
            `${where} is a new ingredient whose dietary flags are unverified, and the meal excludes ${[...flags].sort().join(", ")}`,
          );
      }
  return reasons;
}
