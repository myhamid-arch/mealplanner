// The kitchen's cook sheet (04 §10 PLN-14, R2-UX-2, NUT-6). Quantities are exact numbers; display
// rounding (NUT-9) belongs to the UI.
import type { MealKind } from "../select/index.js";

export type CookIngredient = { ingredientId: string; slug: string; rawG: number };

/** One batch per distinct variant the meal serves (component variants and adjuster sides). */
export type CookBatch = {
  kind: "component" | "adjuster";
  dishId: string;
  componentId: string;
  componentName: string;
  variantId: string;
  variantLabel: string;
  methodKey: string;
  totalCookedG: number;
  /** Plates served from the batch. */
  servings: number;
  /** Raw quantities to prepare, from `rawForCooked` over the batch total. */
  raw: CookIngredient[];
  /** Frying fat put in the pan and mostly discarded, shown separately (PLN-14). */
  discardedFat: CookIngredient[];
  steps: string[];
};

export type PlatingCell = {
  componentId: string;
  variantId: string | null;
  variantLabel: string | null;
  cookedG: number;
  /** Units for `unit` portioning (e.g. 2 eggs); null otherwise. */
  units: number | null;
};

export type PlatingRow = {
  memberId: string;
  memberName: string;
  cells: PlatingCell[];
  /** Adjuster sides, "+ side for <member>" (PLN-6). */
  sides: Array<{
    dishId: string;
    dishName: string;
    variantId: string;
    cookedG: number;
    label: string;
  }>;
};

export type AllergyBanner = {
  memberId: string;
  memberName: string;
  allergen: string;
  text: string;
  /** Batches of this meal that contain the allergen (normally none; the planner filters them). */
  presentIn: string[];
};

/** Raw equivalents of one plate (plate_item.raw_equivalent), ingredient id → raw grams. */
export type PlateRaw = {
  memberId: string;
  items: Array<{
    componentId: string;
    variantId: string;
    cookedG: number;
    rawEquivalent: Record<string, number>;
  }>;
  adjusters: Array<{
    dishId: string;
    variantId: string;
    cookedG: number;
    rawEquivalent: Record<string, number>;
  }>;
};

export type CookMeal = {
  date: string;
  slotKey: string;
  slotLabel: string;
  time: string;
  kind: MealKind;
  memberScope: string;
  dishId: string;
  dishName: string;
  cuisineKey: string;
  batches: CookBatch[];
  plating: {
    columns: Array<{ componentId: string; name: string; unitLabel: string | null }>;
    rows: PlatingRow[];
  };
  notes: string[];
  allergyBanners: AllergyBanner[];
  plates: PlateRaw[];
};

export type CookSheet = {
  /** NUT-6 precision rules, shown on every sheet. */
  banner: string[];
  days: Array<{ date: string; meals: CookMeal[] }>;
};
