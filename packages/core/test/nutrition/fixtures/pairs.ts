// G3 ingredient sets: identical raw ingredients, cooked either grilled or deep-fried. The frying
// oil is listed in both; grilling absorbs none of it (absorption 0 in every grilled row).
import type {
  MethodKey,
  VariantInput,
  VariantIngredientInput,
} from "../../../src/nutrition/index.js";

export const METHOD_PAIR_SETS: { name: string; ingredients: VariantIngredientInput[] }[] = [
  {
    name: "chicken breast",
    ingredients: [
      { ingredientId: "chicken_breast", rawG: 1000, isAbsorbedOil: false },
      { ingredientId: "sunflower_oil", rawG: 300, isAbsorbedOil: true },
    ],
  },
  {
    name: "white fish",
    ingredients: [
      { ingredientId: "white_fish", rawG: 1000, isAbsorbedOil: false },
      { ingredientId: "sunflower_oil", rawG: 500, isAbsorbedOil: true },
    ],
  },
  {
    name: "potato",
    ingredients: [
      { ingredientId: "potato", rawG: 1000, isAbsorbedOil: false },
      { ingredientId: "sunflower_oil", rawG: 1000, isAbsorbedOil: true },
    ],
  },
];

/** A fresh, independently built variant: no object is shared between two calls. */
export function pairVariant(setName: string, method: MethodKey): VariantInput {
  const set = METHOD_PAIR_SETS.find((s) => s.name === setName);
  if (set === undefined) throw new Error(`unknown pair set ${setName}`);
  return { method, ingredients: set.ingredients.map((row) => ({ ...row })) };
}
