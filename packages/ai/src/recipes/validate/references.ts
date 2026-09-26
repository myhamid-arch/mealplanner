// REC-5 step 2: references and structure (leaf-1.3.1 ADR-2).
import { isIngredientCategory, type RecipeCatalogue } from "../catalogue.js";
import type { GeneratedDish, NewIngredient } from "../schema.js";
import type { Reason } from "./types.js";

/** Text limits of the stored rows (the `dish.create` change op), so a survivor can be saved. */
export const TEXT_LIMITS = {
  dishName: 120,
  description: 2000,
  flavourTag: 40,
  componentName: 80,
  unitLabel: 30,
  variantLabel: 60,
} as const;

const NUTRIENT_KEYS = ["kcal", "protein", "carbs", "fat", "satFat", "fibre"] as const;

/** Problems of one proposed ingredient, independent of any dish. */
export function newIngredientProblems(n: NewIngredient, catalogue: RecipeCatalogue): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9_]+$/.test(n.slug)) problems.push(`slug "${n.slug}" is not a lower-case key`);
  if (catalogue.ingredients.some((i) => i.slug === n.slug))
    problems.push(`"${n.slug}" is already in the catalogue`);
  if (!isIngredientCategory(n.category)) problems.push(`unknown category "${n.category}"`);
  if (n.name.trim() === "") problems.push("empty name");
  if (n.sourceNote.trim() === "") problems.push("no source note");
  for (const key of NUTRIENT_KEYS) {
    const v = n.per100g[key];
    if (!(Number.isFinite(v) && v >= 0)) problems.push(`${key} ${String(v)} is not a number >= 0`);
  }
  const soluble = n.per100g.solubleFibre;
  if (soluble !== null && !(Number.isFinite(soluble) && soluble >= 0 && soluble <= n.per100g.fibre))
    problems.push(`solubleFibre ${String(soluble)} is not between 0 and fibre`);
  if (n.per100g.satFat > n.per100g.fat) problems.push("satFat exceeds fat");
  if (n.per100g.protein + n.per100g.carbs + n.per100g.fat + n.per100g.fibre > 101)
    problems.push("protein + carbs + fat + fibre exceed 100 g per 100 g (1 g rounding allowed)");
  return problems;
}

export function checkReferences(
  dish: GeneratedDish,
  catalogue: RecipeCatalogue,
  slotKeys: readonly string[],
  newIngredients: ReadonlyMap<string, NewIngredient>,
): Reason[] {
  const reasons: Reason[] = [];
  const add = (code: Reason["code"], message: string) => reasons.push({ step: 2, code, message });
  const known = new Set(catalogue.ingredients.map((i) => i.slug));
  const methods = new Set<string>(catalogue.methods);
  const cuisines = new Set(catalogue.cuisines);
  const slots = new Set(slotKeys);

  if (dish.name.trim() === "" || dish.name.length > TEXT_LIMITS.dishName)
    add("bad_text", `dish name must be 1–${String(TEXT_LIMITS.dishName)} characters`);
  if (dish.description.length > TEXT_LIMITS.description)
    add("bad_text", `description is longer than ${String(TEXT_LIMITS.description)} characters`);
  for (const tag of dish.flavourTags)
    if (tag.trim() === "" || tag.length > TEXT_LIMITS.flavourTag)
      add(
        "bad_text",
        `flavour tag "${tag}" must be 1–${String(TEXT_LIMITS.flavourTag)} characters`,
      );
  if (!cuisines.has(dish.cuisine)) add("unknown_cuisine", `unknown cuisine "${dish.cuisine}"`);
  if (dish.secondaryCuisine !== undefined && !cuisines.has(dish.secondaryCuisine))
    add("unknown_cuisine", `unknown secondary cuisine "${dish.secondaryCuisine}"`);
  for (const key of dish.slotKeys)
    if (!slots.has(key)) add("unknown_slot", `unknown slot key "${key}"`);

  for (const c of dish.components) {
    const where = `component "${c.name}"`;
    if (c.name.trim() === "" || c.name.length > TEXT_LIMITS.componentName)
      add("bad_text", `component name must be 1–${String(TEXT_LIMITS.componentName)} characters`);
    const bounds = [c.minServingG, c.defaultServingG, c.maxServingG];
    if (
      !bounds.every((g) => Number.isFinite(g) && g >= 0) ||
      !(c.maxServingG > 0) ||
      !(c.minServingG <= c.defaultServingG && c.defaultServingG <= c.maxServingG)
    )
      add(
        "bad_serving_bounds",
        `${where}: needs 0 <= min <= default <= max and max > 0 (got ${String(c.minServingG)} / ${String(c.defaultServingG)} / ${String(c.maxServingG)})`,
      );
    if (c.defaultServingG <= 0)
      add("bad_serving_bounds", `${where}: default serving must be above 0 g`);
    const defaults = c.variants.filter((v) => v.isDefault).length;
    if (defaults !== 1)
      add(
        "bad_component",
        `${where}: exactly one default variant required (got ${String(defaults)})`,
      );
    if (c.portioning === "unit") {
      const label = c.unitLabel?.trim() ?? "";
      if (label === "" || label.length > TEXT_LIMITS.unitLabel)
        add("bad_component", `${where}: unit portioning needs a unit label`);
    }
    for (const v of c.variants) {
      const vwhere = `${where}, variant "${v.label}"`;
      if (v.label.trim() === "" || v.label.length > TEXT_LIMITS.variantLabel)
        add(
          "bad_text",
          `${vwhere}: label must be 1–${String(TEXT_LIMITS.variantLabel)} characters`,
        );
      if (v.steps.some((s) => s.trim() === "")) add("bad_text", `${vwhere}: empty step`);
      if (!methods.has(v.method)) add("unknown_method", `${vwhere}: unknown method "${v.method}"`);
      for (const line of v.ingredients) {
        if (known.has(line.slug)) continue;
        const proposed = newIngredients.get(line.slug);
        if (proposed === undefined) {
          add(
            "unknown_ingredient",
            `${vwhere}: "${line.slug}" is neither in the catalogue nor in newIngredients`,
          );
          continue;
        }
        const problems = newIngredientProblems(proposed, catalogue);
        if (problems.length > 0)
          add(
            "bad_new_ingredient",
            `${vwhere}: new ingredient "${line.slug}": ${problems.join(", ")}`,
          );
      }
    }
  }
  return reasons;
}
