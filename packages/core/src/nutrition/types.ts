// Input and output shapes of the nutrition engine (03-nutrition-engine §2, §7).
// Field meanings follow 02-domain-model §3 (ingredient, method_yield) and §4 (variant_ingredient).

/** preparation_method.key (02-domain-model §3). */
export type MethodKey =
  | "raw"
  | "boiled"
  | "steamed"
  | "poached"
  | "grilled"
  | "broiled"
  | "roasted"
  | "baked"
  | "air_fried"
  | "pan_seared"
  | "sauteed"
  | "stir_fried"
  | "shallow_fried"
  | "deep_fried"
  | "breaded_baked"
  | "breaded_fried"
  | "braised"
  | "stewed"
  | "slow_cooked"
  | "pressure_cooked"
  | "smoked"
  | "blended"
  | "marinated_raw";

/** ingredient.category (02-domain-model §3). */
export type IngredientCategory =
  | "poultry"
  | "red_meat"
  | "fish"
  | "seafood"
  | "egg"
  | "dairy"
  | "plant_protein"
  | "grain"
  | "starch"
  | "legume"
  | "vegetable"
  | "leafy_green"
  | "fruit"
  | "nut_seed"
  | "oil_fat"
  | "sauce_condiment"
  | "herb_spice"
  | "sweetener"
  | "bakery"
  | "beverage"
  | "supplement"
  | "other";

/**
 * Nutrients of a quantity of food (03 §7). Grams except `kcal` and `sodiumMg`.
 * `null` means unknown, never zero (NUT-8).
 */
export type Nutrients = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  satFat: number;
  fibre: number;
  solubleFibre: number | null;
  sugar: number | null;
  sodiumMg: number | null;
};

/** A catalogue ingredient: nutrients per 100 g edible raw weight. */
export type CatalogIngredient = {
  id: string;
  category: IngredientCategory;
  per100gRaw: Nutrients;
};

/** A method_yield row for one (method, ingredient category) pair. */
export type MethodYield = {
  method: MethodKey;
  category: IngredientCategory;
  /** Cooked ÷ raw weight. */
  yieldFactor: number;
  /** Share of the ingredient's own fat retained, 0–1. */
  fatRetention: number;
  /** Cooking fat absorbed, grams per 100 g raw. */
  oilAbsorptionGPer100gRaw: number;
};

/** The catalogue data the engine reads. The engine does no I/O (ARC-3); callers load this. */
export type CatalogContext = {
  ingredients: ReadonlyMap<string, CatalogIngredient>;
  methodYields: readonly MethodYield[];
};

/** One variant_ingredient row. */
export type VariantIngredientInput = {
  ingredientId: string;
  /** raw_g_per_batch: raw edible grams in the variant's reference batch. */
  rawG: number;
  /** is_absorbed_oil: counts through absorption (NUT-3 step 2), the rest is discarded. */
  isAbsorbedOil: boolean;
  /**
   * Cooking liquid role (NUT-3 step 1). `absorbed`: the liquid is taken up by another
   * ingredient whose yield already includes it (rice boiling water), so it adds no mass.
   * `retained`: it stays in the dish (soups, stews) and is treated like any other ingredient.
   * Omitted for every other ingredient.
   */
  cookingLiquid?: "absorbed" | "retained";
  /** Per-ingredient yield override stated by the recipe (cooked ÷ raw), replacing the method yield. */
  yieldOverride?: number;
};

/** A preparation variant: one method applied to a reference batch of raw ingredients. */
export type VariantInput = {
  method: MethodKey;
  ingredients: readonly VariantIngredientInput[];
};

/** A data problem found while computing (NUT-4). Callers mark the subject `needs_review`. */
export type NutritionWarning =
  | { code: "atwater_ingredient"; ingredientId: string; deltaPct: number }
  | { code: "atwater_variant"; deltaPct: number };
