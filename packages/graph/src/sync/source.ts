// The port sync reads relational rows through (SPEC-Q-1, R-35). Every household-scoped read takes the
// household and returns only its rows (plus global rows where stated).
import type {
  ExclusionRow,
  IngredientRow,
  MemberRow,
  PreferenceRow,
} from "@mealplanner/core/types";
import type { CatalogueInput, DishBundle, LibraryDish } from "../derive/inputs.js";

export interface KgSource {
  /** Global catalogue: ingredients with no `created_by_household_id`, cuisines, methods, curated substitutes. */
  catalogue(): Promise<CatalogueInput>;
  /** The household's private ingredients. */
  householdIngredients(householdId: string): Promise<IngredientRow[]>;
  households(): Promise<string[]>;
  /** Ids of every dish in exactly this scope (null = global), any status. */
  dishIds(householdId: string | null): Promise<string[]>;
  /** The requested dishes that exist in exactly this scope. */
  dishes(householdId: string | null, dishIds: readonly string[]): Promise<DishBundle[]>;
  /** The household's members (all, or the given ids). */
  members(householdId: string, memberIds?: readonly string[]): Promise<MemberRow[]>;
  /** The household's member-level preferences (all members, or the given ones). */
  preferences(householdId: string, memberIds?: readonly string[]): Promise<PreferenceRow[]>;
  /** Active dishes: global ones for null; global + the household's own for a household. */
  library(householdId: string | null): Promise<LibraryDish[]>;
  exclusions(householdId: string): Promise<ExclusionRow[]>;
}
