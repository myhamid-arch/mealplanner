// KG-4.3 substitute ranking: household exclusions removed, then best weight, then the smallest macro
// delta (SPEC-Q-2, SPEC-Q-3).
import type { ExclusionRow, Json } from "@mealplanner/core/types";
import type { KgNeighbour, Substitute } from "../types/index.js";
import { isExcluded } from "./exclusions.js";

/** SPEC-Q-3: |Δprotein| + |Δcarbs| + |Δfat|, grams per 100 g raw. */
export function macroDistance(delta: Substitute["macroDelta"]): number {
  return Math.abs(delta.protein) + Math.abs(delta.carbs) + Math.abs(delta.fat);
}

const asObject = (value: Json): Record<string, Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};

const text = (value: Json | undefined): string => (typeof value === "string" ? value : "");

/**
 * `candidates` are SUBSTITUTES_FOR neighbours already filtered for visibility (KG-2); `exclusions`
 * are the household's rows (household-level and every member's; rows of any other household are
 * ignored).
 */
export function rankSubstitutes(
  candidates: readonly KgNeighbour[],
  exclusions: readonly ExclusionRow[],
  householdId: string,
  limit: number,
): Substitute[] {
  const own = exclusions.filter((x) => x.householdId === householdId);
  return candidates
    .filter((c) => {
      const props = asObject(c.props);
      const flags = props.dietaryFlags;
      return !isExcluded(
        {
          id: c.key,
          slug: text(props.slug),
          category: text(props.category),
          dietaryFlags: Array.isArray(flags)
            ? flags.filter((f): f is string => typeof f === "string")
            : [],
        },
        own,
      );
    })
    .map((c) => ({
      ingredientId: c.key,
      weight: c.weight,
      macroDelta: asObject(c.edgeProps).macroDelta as unknown as Substitute["macroDelta"],
    }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        macroDistance(a.macroDelta) - macroDistance(b.macroDelta) ||
        (a.ingredientId < b.ingredientId ? -1 : 1),
    )
    .slice(0, Math.max(0, limit));
}
