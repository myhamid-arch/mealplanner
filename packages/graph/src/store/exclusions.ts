// Household exclusions applied to substitute candidates (KG-4.3; SPEC-Q-2, R-35, R-36).
import type { ExclusionRow } from "@mealplanner/core/types";

/** Reads every exclusion row of a household (household-level and every member's). */
export type ExclusionReader = (householdId: string) => Promise<ExclusionRow[]>;

export interface ExclusionCandidate {
  id: string;
  slug: string;
  category: string;
  dietaryFlags: readonly string[];
}

/**
 * True when any row excludes the candidate, whatever its `hard` flag (R-34). `kind = ingredient`
 * keys are slugs (R-36); an id also matches, and the two cannot collide.
 */
export function isExcluded(
  candidate: ExclusionCandidate,
  rows: readonly Pick<ExclusionRow, "kind" | "key">[],
): boolean {
  return rows.some((row) => {
    switch (row.kind) {
      case "ingredient":
        return row.key === candidate.slug || row.key === candidate.id;
      case "category":
        return row.key === candidate.category;
      case "dietary_flag":
        return candidate.dietaryFlags.includes(row.key);
    }
  });
}
