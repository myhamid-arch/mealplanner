// KG-4.1 dish similarity and its explanation (08 §4; SPEC-Q-4 as amended by R-35).
//   sim(d₁, d₂) = 0.6·J + 0.2·C + 0.1·M + 0.1·F
// J: weighted Jaccard over the dishes' core-ingredient vectors (1.3.2 `coreIngredients`: no
//    herb_spice, no water); C: shared cuisine, max over cuisines of min(OF_CUISINE weights);
// M: Jaccard of method sets; F: Jaccard of flavour-tag sets.
import { coreIngredients } from "@mealplanner/core/learning/preferences";
import type { IngredientCategory } from "@mealplanner/core/types";
import type { SimilarDish } from "../types/index.js";

export const SIMILARITY_WEIGHTS = {
  ingredients: 0.6,
  cuisine: 0.2,
  methods: 0.1,
  flavours: 0.1,
} as const;

/** Shared ingredients named in the explanation. */
export const WHY_INGREDIENTS = 3;

export interface VariantFeature {
  variantId: string;
  componentId: string;
  method: { key: string; label: string };
  items: Array<{
    ingredientId: string;
    label: string;
    slug: string;
    category: IngredientCategory;
    rawG: number;
  }>;
}

export interface DishFeatureInput {
  dishId: string;
  variants: VariantFeature[];
  cuisines: Array<{ key: string; label: string; weight: number }>;
  flavourTags: string[];
}

export interface DishFeatures {
  dishId: string;
  /** Core-ingredient vector: mean over components of the mean over variants of raw-weight shares. */
  ingredients: Map<string, number>;
  labels: Map<string, string>;
  cuisines: Map<string, { label: string; weight: number }>;
  methods: Map<string, string>;
  flavours: Set<string>;
}

export function dishFeatures(input: DishFeatureInput): DishFeatures {
  const labels = new Map<string, string>();
  const byComponent = new Map<string, Array<Map<string, number>>>();
  const methods = new Map<string, string>();
  for (const v of input.variants) {
    methods.set(v.method.key, v.method.label);
    const core = new Set(coreIngredients(v.items));
    const total = v.items.filter((i) => core.has(i.ingredientId)).reduce((s, i) => s + i.rawG, 0);
    const shares = new Map<string, number>();
    if (total > 0)
      for (const i of v.items)
        if (core.has(i.ingredientId)) {
          labels.set(i.ingredientId, i.label);
          shares.set(i.ingredientId, (shares.get(i.ingredientId) ?? 0) + i.rawG / total);
        }
    const list = byComponent.get(v.componentId) ?? [];
    list.push(shares);
    byComponent.set(v.componentId, list);
  }
  // Components whose variants hold no core ingredient (e.g. a spice rub) carry no vector.
  const components = [...byComponent.values()]
    .map((variants) => {
      const mean = new Map<string, number>();
      for (const shares of variants)
        for (const [id, s] of shares) mean.set(id, (mean.get(id) ?? 0) + s / variants.length);
      return mean;
    })
    .filter((m) => m.size > 0);
  const ingredients = new Map<string, number>();
  for (const c of components)
    for (const [id, s] of c)
      ingredients.set(id, (ingredients.get(id) ?? 0) + s / components.length);
  return {
    dishId: input.dishId,
    ingredients,
    labels,
    cuisines: new Map(input.cuisines.map((c) => [c.key, { label: c.label, weight: c.weight }])),
    methods,
    flavours: new Set(input.flavourTags),
  };
}

function jaccard<T>(
  a: ReadonlySet<T> | ReadonlyMap<T, unknown>,
  b: ReadonlySet<T> | ReadonlyMap<T, unknown>,
): number {
  const keysA = [...a.keys()];
  const union = new Set([...keysA, ...b.keys()]);
  if (union.size === 0) return 0;
  return keysA.filter((k) => b.has(k)).length / union.size;
}

export interface SimilarityTerms {
  ingredients: number;
  cuisine: number;
  methods: number;
  flavours: number;
}

export function similarityTerms(a: DishFeatures, b: DishFeatures): SimilarityTerms {
  let min = 0;
  let max = 0;
  for (const id of new Set([...a.ingredients.keys(), ...b.ingredients.keys()])) {
    const x = a.ingredients.get(id) ?? 0;
    const y = b.ingredients.get(id) ?? 0;
    min += Math.min(x, y);
    max += Math.max(x, y);
  }
  let cuisine = 0;
  for (const [key, { weight }] of a.cuisines) {
    const other = b.cuisines.get(key);
    if (other !== undefined) cuisine = Math.max(cuisine, Math.min(weight, other.weight));
  }
  return {
    ingredients: max > 0 ? min / max : 0,
    cuisine,
    methods: jaccard(a.methods, b.methods),
    flavours: jaccard(a.flavours, b.flavours),
  };
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** KG-4.1 `sim(a, b)` in [0, 1], rounded to 4 decimals. */
export function dishSimilarity(a: DishFeatures, b: DishFeatures): number {
  const t = similarityTerms(a, b);
  return round4(
    SIMILARITY_WEIGHTS.ingredients * t.ingredients +
      SIMILARITY_WEIGHTS.cuisine * t.cuisine +
      SIMILARITY_WEIGHTS.methods * t.methods +
      SIMILARITY_WEIGHTS.flavours * t.flavours,
  );
}

/** KG-4.4: the graph paths behind a similarity, by label. */
export function similarityWhy(a: DishFeatures, b: DishFeatures): string[] {
  const why: string[] = [];
  const shared = [...a.ingredients.keys()]
    .filter((id) => b.ingredients.has(id))
    .map((id) => ({
      label: a.labels.get(id) ?? id,
      w: Math.min(a.ingredients.get(id) ?? 0, b.ingredients.get(id) ?? 0),
    }))
    .sort((x, y) => y.w - x.w || x.label.localeCompare(y.label))
    .slice(0, WHY_INGREDIENTS);
  if (shared.length > 0) why.push(`shares ${shared.map((s) => s.label).join("; ")}`);
  let cuisine: { label: string; w: number } | null = null;
  for (const [key, { label, weight }] of a.cuisines) {
    const other = b.cuisines.get(key);
    if (other === undefined) continue;
    const w = Math.min(weight, other.weight);
    if (cuisine === null || w > cuisine.w) cuisine = { label, w };
  }
  if (cuisine !== null) why.push(`same cuisine: ${cuisine.label}`);
  const methods = [...a.methods]
    .filter(([k]) => b.methods.has(k))
    .map(([, l]) => l)
    .sort();
  if (methods.length > 0) why.push(`same method: ${methods.join(", ")}`);
  const flavours = [...a.flavours].filter((f) => b.flavours.has(f)).sort();
  if (flavours.length > 0) why.push(`shared flavour: ${flavours.join(", ")}`);
  return why;
}

/** The candidates most similar to `target` (sim > 0), best first, ties by dish id. */
export function rankSimilar(
  target: DishFeatures,
  candidates: readonly DishFeatures[],
  limit: number,
): SimilarDish[] {
  return candidates
    .filter((c) => c.dishId !== target.dishId)
    .map((c) => ({ c, sim: dishSimilarity(target, c) }))
    .filter((r) => r.sim > 0)
    .sort((x, y) => y.sim - x.sim || (x.c.dishId < y.c.dishId ? -1 : 1))
    .slice(0, Math.max(0, limit))
    .map(({ c, sim }) => ({ dishId: c.dishId, sim, why: similarityWhy(target, c) }));
}
