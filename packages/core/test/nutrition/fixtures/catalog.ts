// Fixture catalogue for the nutrition tests: this leaf's own round, USDA-like values chosen for
// hand arithmetic. They are not catalogue data (leaf 1.1.3 owns data/).
// lemon_juice fails NUT-4 on purpose (organic acids carry energy the Atwater factors omit).
import type {
  CatalogContext,
  CatalogIngredient,
  IngredientCategory,
  MethodKey,
  MethodYield,
  Nutrients,
} from "../../../src/nutrition/index.js";

function per100g(
  values: [
    number,
    number,
    number,
    number,
    number,
    number,
    number | null,
    number | null,
    number | null,
  ],
): Nutrients {
  const [kcal, protein, carbs, fat, satFat, fibre, solubleFibre, sugar, sodiumMg] = values;
  return { kcal, protein, carbs, fat, satFat, fibre, solubleFibre, sugar, sodiumMg };
}

/** Per 100 g raw: kcal, protein, carbs, fat, satFat, fibre, solubleFibre, sugar, sodiumMg. */
export const FIXTURE_INGREDIENTS: CatalogIngredient[] = [
  {
    id: "chicken_breast",
    category: "poultry",
    per100gRaw: per100g([120, 22.5, 0, 2.6, 0.6, 0, null, null, 45]),
  },
  { id: "white_fish", category: "fish", per100gRaw: per100g([90, 19, 0, 1.2, 0.3, 0, 0, 0, 60]) },
  { id: "egg", category: "egg", per100gRaw: per100g([143, 12.6, 0.7, 9.5, 3.1, 0, 0, 0.4, 142]) },
  {
    id: "breadcrumbs",
    category: "bakery",
    per100gRaw: per100g([395, 13.4, 72, 5.3, 1.2, 4.5, 1.5, 6.2, 732]),
  },
  {
    id: "sunflower_oil",
    category: "oil_fat",
    per100gRaw: per100g([884, 0, 0, 100, 10, 0, null, null, 0]),
  },
  { id: "olive_oil", category: "oil_fat", per100gRaw: per100g([884, 0, 0, 100, 14, 0, 0, 0, 2]) },
  { id: "ghee", category: "oil_fat", per100gRaw: per100g([876, 0.3, 0, 99.5, 62, 0, 0, 0, 2]) },
  {
    id: "basmati_rice",
    category: "grain",
    per100gRaw: per100g([360, 7.5, 79, 0.9, 0.2, 1.3, 0.4, 0.2, 1]),
  },
  { id: "water", category: "beverage", per100gRaw: per100g([0, 0, 0, 0, 0, 0, 0, 0, 0]) },
  {
    id: "chicken_stock",
    category: "beverage",
    per100gRaw: per100g([17, 2.5, 0.9, 0.5, 0.15, 0, 0, 0.4, 340]),
  },
  {
    id: "red_lentils",
    category: "legume",
    per100gRaw: per100g([358, 24.6, 63.1, 2.2, 0.3, 10.8, 2, 2, 7]),
  },
  {
    id: "onion",
    category: "vegetable",
    per100gRaw: per100g([40, 1.1, 8.6, 0.1, 0.04, 1.7, 0.9, 4.2, 4]),
  },
  {
    id: "carrot",
    category: "vegetable",
    per100gRaw: per100g([41, 0.9, 8.2, 0.2, 0.03, 2.8, 1.2, 4.7, 69]),
  },
  {
    id: "halloumi",
    category: "dairy",
    per100gRaw: per100g([321, 21, 2.2, 25, 17, 0, 0, 2.2, 1200]),
  },
  { id: "potato", category: "starch", per100gRaw: per100g([77, 2, 16, 0.1, 0.03, 2.2, 1, 0.8, 6]) },
  { id: "lamb_leg", category: "red_meat", per100gRaw: per100g([230, 17, 0, 18, 8, 0, 0, 0, 60]) },
  {
    id: "cucumber",
    category: "vegetable",
    per100gRaw: per100g([15, 0.7, 3, 0.1, 0.04, 0.5, 0.2, 1.7, 2]),
  },
  {
    id: "tomato",
    category: "vegetable",
    per100gRaw: per100g([18, 0.9, 2.7, 0.2, 0.03, 1.2, 0.2, 2.6, 5]),
  },
  {
    id: "tahini",
    category: "nut_seed",
    per100gRaw: per100g([595, 17, 21, 54, 7.5, 9.3, 1.5, 0.5, 35]),
  },
  {
    id: "salt",
    category: "herb_spice",
    per100gRaw: per100g([0, 0, 0, 0, 0, 0, null, null, 38758]),
  },
  {
    id: "black_pepper",
    category: "herb_spice",
    per100gRaw: per100g([251, 10.4, 38.7, 3.3, 1.4, 25.3, null, 0.6, 20]),
  },
  {
    id: "zucchini",
    category: "vegetable",
    per100gRaw: per100g([17, 1.2, 2.2, 0.3, 0.08, 1, 0.4, null, 8]),
  },
  {
    id: "lemon_juice",
    category: "fruit",
    per100gRaw: per100g([22, 0.4, 6.9, 0.2, 0.02, 0.3, 0.1, 2.5, 1]),
  },
];

function row(
  method: MethodKey,
  category: IngredientCategory,
  yieldFactor: number,
  fatRetention: number,
  oilAbsorptionGPer100gRaw: number,
): MethodYield {
  return { method, category, yieldFactor, fatRetention, oilAbsorptionGPer100gRaw };
}

/** (method, category): yield, fat retention, oil absorbed g per 100 g raw. */
export const FIXTURE_METHOD_YIELDS: MethodYield[] = [
  row("grilled", "poultry", 0.75, 0.85, 0),
  row("grilled", "fish", 0.8, 0.9, 0),
  row("grilled", "red_meat", 0.7, 0.7, 0),
  row("grilled", "herb_spice", 1, 1, 0),
  row("deep_fried", "poultry", 0.8, 1, 7),
  row("deep_fried", "fish", 0.8, 1, 6),
  row("deep_fried", "starch", 0.55, 1, 10),
  row("breaded_fried", "poultry", 0.88, 1, 12),
  row("breaded_fried", "egg", 0.9, 1, 5),
  row("breaded_fried", "bakery", 1, 1, 20),
  row("breaded_baked", "poultry", 0.8, 0.95, 0),
  row("breaded_baked", "egg", 0.9, 1, 0),
  row("breaded_baked", "bakery", 0.95, 1, 0),
  row("breaded_baked", "oil_fat", 1, 1, 0),
  row("boiled", "grain", 2.8, 1, 0),
  row("boiled", "herb_spice", 1, 1, 0),
  row("stewed", "legume", 1, 1, 0),
  row("stewed", "beverage", 0.8, 1, 0),
  row("stewed", "vegetable", 0.9, 1, 0),
  row("stewed", "poultry", 0.9, 0.9, 0),
  row("stewed", "oil_fat", 1, 1, 0),
  row("stewed", "herb_spice", 1, 1, 0),
  row("shallow_fried", "dairy", 0.9, 0.95, 10),
  row("shallow_fried", "starch", 0.7, 1, 6),
  row("roasted", "starch", 0.75, 1, 0),
  row("roasted", "oil_fat", 1, 1, 0),
  row("roasted", "herb_spice", 1, 1, 0),
  row("raw", "vegetable", 1, 1, 0),
  row("raw", "nut_seed", 1, 1, 0),
  row("raw", "oil_fat", 1, 1, 0),
  row("sauteed", "vegetable", 0.85, 1, 0),
  row("sauteed", "oil_fat", 1, 1, 0),
  row("grilled", "starch", 0.8, 1, 0),
  row("raw", "fruit", 1, 1, 0),
];

export function fixtureCatalog(): CatalogContext {
  return {
    ingredients: new Map(FIXTURE_INGREDIENTS.map((i) => [i.id, i])),
    methodYields: FIXTURE_METHOD_YIELDS,
  };
}
