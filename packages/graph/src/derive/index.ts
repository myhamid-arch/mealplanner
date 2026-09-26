// Pure derivation of graph nodes and edges from relational rows: @mealplanner/graph/derive.
export * from "./inputs.js";
export {
  WATER_SLUG,
  MIN_PAIR_DISHES,
  PRIMARY_CUISINE_WEIGHT,
  SECONDARY_CUISINE_WEIGHT,
  ref,
  round3,
} from "./refs.js";
export {
  type Derived,
  deriveGlobalCatalogue,
  deriveHouseholdCatalogue,
  ingredientNode,
  ingredientNutrients,
  macroDelta,
} from "./catalogue.js";
export {
  DISH_EDGE_TYPES,
  type DerivedDish,
  deriveDish,
  flavourNode,
  isSyncedDish,
  slotNode,
} from "./dish.js";
export {
  PREFERENCE_EDGE_TYPES,
  type PreferenceEdgeDraft,
  derivePreferenceDrafts,
  memberNode,
  preferenceTarget,
} from "./members.js";
export { deriveLibrary, npmi } from "./library.js";
