// Catalogue nodes and edges: Ingredient, IngredientCategory, Cuisine, Method; IN_CATEGORY and the
// curated SUBSTITUTES_FOR (08 §1, §2; SPEC-Q-3, SPEC-Q-9).
import type { Nutrients } from "@mealplanner/core/nutrition";
import { INGREDIENT_CATEGORIES, type IngredientRow } from "@mealplanner/core/types";
import type { KgEdgeInput, KgNodeInput } from "../types/index.js";
import type { CatalogueInput } from "./inputs.js";
import { humanise, ref, round3 } from "./refs.js";

export interface Derived {
  nodes: KgNodeInput[];
  edges: KgEdgeInput[];
}

/** The per-100 g raw nutrients of a catalogue row, in the engine's shape (03 §7). */
export function ingredientNutrients(row: IngredientRow): Nutrients {
  return {
    kcal: row.kcal,
    protein: row.proteinG,
    carbs: row.carbsG,
    fat: row.fatG,
    satFat: row.satFatG,
    fibre: row.fibreG,
    solubleFibre: row.solubleFibreG,
    sugar: row.sugarG,
    sodiumMg: row.sodiumMg,
  };
}

const delta = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : round3(b - a);

/** Substitute − original, per 100 g raw (SPEC-Q-3); unknown on either side stays unknown (NUT-8). */
export function macroDelta(from: IngredientRow, to: IngredientRow): Nutrients {
  const a = ingredientNutrients(from);
  const b = ingredientNutrients(to);
  return {
    kcal: round3(b.kcal - a.kcal),
    protein: round3(b.protein - a.protein),
    carbs: round3(b.carbs - a.carbs),
    fat: round3(b.fat - a.fat),
    satFat: round3(b.satFat - a.satFat),
    fibre: round3(b.fibre - a.fibre),
    solubleFibre: delta(a.solubleFibre, b.solubleFibre),
    sugar: delta(a.sugar, b.sugar),
    sodiumMg: delta(a.sodiumMg, b.sodiumMg),
  };
}

export function ingredientNode(row: IngredientRow): KgNodeInput {
  return {
    ...ref("Ingredient", row.id, row.createdByHouseholdId),
    label: row.name,
    props: { slug: row.slug, category: row.category, dietaryFlags: [...row.dietaryFlags].sort() },
  };
}

function inCategory(row: IngredientRow): KgEdgeInput {
  return {
    householdId: row.createdByHouseholdId,
    type: "IN_CATEGORY",
    src: ref("Ingredient", row.id, row.createdByHouseholdId),
    dst: ref("IngredientCategory", row.category),
    weight: 1,
    props: {},
    source: "seed",
  };
}

/**
 * The global catalogue: every global ingredient, the 22 categories, cuisines and methods, their
 * IN_CATEGORY edges, and the curated substitutes. Throws on a substitute naming an unknown slug.
 */
export function deriveGlobalCatalogue(input: CatalogueInput): Derived {
  const ingredients = input.ingredients.filter((i) => i.createdByHouseholdId === null);
  const bySlug = new Map(ingredients.map((i) => [i.slug, i]));
  const nodes: KgNodeInput[] = [
    ...ingredients.map(ingredientNode),
    ...INGREDIENT_CATEGORIES.map((c) => ({
      ...ref("IngredientCategory", c),
      label: humanise(c),
      props: {},
    })),
    ...input.cuisines.map((c) => ({
      ...ref("Cuisine", c.key),
      label: c.label,
      props: { parentKey: c.parentKey },
    })),
    ...input.methods.map((m) => ({
      ...ref("Method", m.key),
      label: m.label,
      props: { appealTags: [...m.appealTags] },
    })),
  ];
  const edges: KgEdgeInput[] = ingredients.map(inCategory);
  for (const s of input.substitutes) {
    const from = bySlug.get(s.fromSlug);
    const to = bySlug.get(s.toSlug);
    if (from === undefined || to === undefined)
      throw new Error(
        `substitute ${s.fromSlug} → ${s.toSlug}: unknown ingredient slug ${from === undefined ? s.fromSlug : s.toSlug}`,
      );
    if (!(s.weight > 0 && s.weight <= 1))
      throw new Error(`substitute ${s.fromSlug} → ${s.toSlug}: weight must be in (0, 1]`);
    edges.push({
      householdId: null,
      type: "SUBSTITUTES_FOR",
      src: ref("Ingredient", from.id),
      dst: ref("Ingredient", to.id),
      weight: round3(s.weight),
      props: { macroDelta: macroDelta(from, to), context: s.context, note: s.note },
      source: "seed",
    });
  }
  return { nodes, edges };
}

/** One household's private ingredients (`created_by_household_id`) and their IN_CATEGORY edges. */
export function deriveHouseholdCatalogue(
  householdId: string,
  ingredients: readonly IngredientRow[],
): Derived {
  const own = ingredients.filter((i) => i.createdByHouseholdId === householdId);
  return { nodes: own.map(ingredientNode), edges: own.map(inCategory) };
}
