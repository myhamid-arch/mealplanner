// Rows the derivation reads (core row types plus the natural keys a join supplies).
import type {
  ComponentRow,
  CuisineRow,
  DishRow,
  IngredientRow,
  PreparationMethodRow,
  VariantIngredientRow,
  VariantRow,
} from "@mealplanner/core/types";

/** One curated row of `data/substitutes.csv`. */
export interface SubstituteSeed {
  fromSlug: string;
  toSlug: string;
  weight: number;
  context: string;
  note: string;
}

/** The global catalogue, or one household's private ingredients (`ingredients` only). */
export interface CatalogueInput {
  ingredients: IngredientRow[];
  cuisines: CuisineRow[];
  methods: PreparationMethodRow[];
  substitutes: SubstituteSeed[];
}

export type BundleVariant = VariantRow & { methodKey: string };
export type BundleIngredient = VariantIngredientRow & {
  /** The ingredient's `created_by_household_id` (its node's scope). */
  ingredientHouseholdId: string | null;
};

/** A dish with everything its graph nodes and edges are derived from. */
export interface DishBundle {
  dish: DishRow;
  cuisineKey: string;
  secondaryCuisineKey: string | null;
  components: ComponentRow[];
  variants: BundleVariant[];
  ingredients: BundleIngredient[];
}

/** An active dish as the library statistics see it (SPEC-Q-5/6). */
export interface LibraryDish {
  dishId: string;
  householdId: string | null;
  /** Primary weight 1, secondary 0.5. */
  cuisines: Array<{ key: string; weight: number }>;
  /** Distinct ingredients of every variant, water excluded. */
  ingredients: Array<{ id: string; householdId: string | null }>;
}
