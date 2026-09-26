// Member nodes and the LIKES / DISLIKES mirror of `preference` (08 §2; SPEC-Q-7, SPEC-Q-10).
import { PreferenceIndex, parseVariantKey } from "@mealplanner/core/learning/preferences";
import type { MemberRow, PreferenceRow } from "@mealplanner/core/types";
import type { KgEdgeType, KgNodeInput, KgNodeType } from "../types/index.js";
import { ref, round3 } from "./refs.js";

export const PREFERENCE_EDGE_TYPES: readonly KgEdgeType[] = ["LIKES", "DISLIKES"];

export function memberNode(row: MemberRow): KgNodeInput {
  return {
    ...ref("Member", row.id, row.householdId),
    label: row.displayName,
    props: { isTargeted: row.isTargeted, archived: row.archivedAt !== null },
  };
}

/** A LIKES / DISLIKES edge before its target node's scope is resolved. */
export interface PreferenceEdgeDraft {
  memberId: string;
  type: "LIKES" | "DISLIKES";
  target: { type: KgNodeType; key: string };
  weight: number;
  props: {
    entityType: string;
    entityKey: string;
    source: string;
    locked: boolean;
    hard: string;
  };
}

/** The graph node a preference key names, or null for `component_role` (no node type). */
export function preferenceTarget(
  row: Pick<PreferenceRow, "entityType" | "entityKey">,
): { type: KgNodeType; key: string } | null {
  switch (row.entityType) {
    case "dish": {
      const variant = parseVariantKey(row.entityKey);
      return variant === null
        ? { type: "Dish", key: row.entityKey }
        : { type: "Variant", key: variant.variantId };
    }
    case "ingredient":
      return { type: "Ingredient", key: row.entityKey };
    case "cuisine":
      return { type: "Cuisine", key: row.entityKey };
    case "method":
      return { type: "Method", key: row.entityKey };
    case "flavour_tag":
      return { type: "FlavourTag", key: row.entityKey };
    case "component_role":
      return null;
  }
}

/**
 * One draft per (member, key) with a non-zero effective score: the member-level winner by 1.3.2's
 * precedence (locked, then explicit, proposal, learned). Household-level rows are not mirrored.
 */
export function derivePreferenceDrafts(
  memberIds: readonly string[],
  rows: readonly PreferenceRow[],
): PreferenceEdgeDraft[] {
  const drafts: PreferenceEdgeDraft[] = [];
  for (const memberId of memberIds) {
    const own = rows.filter((r) => r.memberId === memberId);
    const index = new PreferenceIndex(own);
    const keys = new Map(own.map((r) => [`${r.entityType}\u0000${r.entityKey}`, r]));
    for (const row of keys.values()) {
      const winner = index.resolve(memberId, row.entityType, row.entityKey);
      if (winner === undefined) continue;
      const target = preferenceTarget(winner);
      const score = round3(winner.score);
      if (target === null || score === 0) continue;
      drafts.push({
        memberId,
        type: score > 0 ? "LIKES" : "DISLIKES",
        target,
        weight: Math.abs(score),
        props: {
          entityType: winner.entityType,
          entityKey: winner.entityKey,
          source: winner.source,
          locked: winner.locked,
          hard: winner.hard,
        },
      });
    }
  }
  return drafts;
}
