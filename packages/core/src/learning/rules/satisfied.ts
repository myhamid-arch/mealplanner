// BLD-8 R-33 (c): a proposal whose ops the current state already satisfies is not proposed again
// (rules read the whole window, so the evidence for an accepted change is still there).
import type { ParsedChangeOp } from "../../changes/index.js";
import type { HouseholdConfig } from "../../types/index.js";

export interface SatisfactionState {
  config: HouseholdConfig;
  /** Verified state of the ingredients a proposal may name. */
  verifiedIngredientIds: ReadonlySet<string>;
}

const SCORE_EPSILON = 1e-3;
const SHARE_EPSILON = 1e-3;

function opSatisfied(op: ParsedChangeOp, state: SatisfactionState): boolean {
  const { config } = state;
  switch (op.kind) {
    case "preference.set": {
      const p = op.payload;
      const rows = config.preferences.filter(
        (row) =>
          row.memberId === p.memberId &&
          row.entityType === p.entityType &&
          row.entityKey === p.entityKey,
      );
      // A dislike is already in effect when the key is marked "never" (FBK-6).
      if (p.score < 0 && p.hard !== "always_ok" && rows.some((row) => row.hard === "never"))
        return true;
      return rows.some(
        (row) =>
          Math.abs(row.score - p.score) <= SCORE_EPSILON &&
          (p.locked === undefined || row.locked === p.locked) &&
          (p.hard === undefined || row.hard === p.hard),
      );
    }
    case "exclusion.add": {
      const p = op.payload;
      // Any exclusion of the key already keeps it off the member's plates.
      return config.exclusions.some(
        (row) =>
          (row.memberId === p.memberId || row.memberId === null) &&
          row.kind === p.kind &&
          row.key === p.key,
      );
    }
    case "frequency.set": {
      const p = op.payload;
      return config.frequencyRules.some(
        (row) =>
          row.memberId === p.memberId &&
          row.entityType === p.entityType &&
          row.entityKey === p.entityKey &&
          row.minGapDays === p.minGapDays &&
          row.maxPerWeek === p.maxPerWeek,
      );
    }
    case "distribution.set": {
      const p = op.payload;
      const rows = config.mealDistributions.filter(
        (r) => r.memberId === p.memberId && r.dayKind === p.dayKind,
      );
      if (p.shares === null) return rows.length === 0;
      return (
        rows.length === p.shares.length &&
        p.shares.every((s) =>
          rows.some(
            (r) => r.slotTypeId === s.slotTypeId && Math.abs(r.share - s.share) <= SHARE_EPSILON,
          ),
        )
      );
    }
    case "ingredient.verify":
      return state.verifiedIngredientIds.has(op.payload.ingredientId);
    default:
      return false;
  }
}

/** True when every op of a proposal is already in effect. */
export function isSatisfied(ops: readonly ParsedChangeOp[], state: SatisfactionState): boolean {
  return ops.length > 0 && ops.every((op) => opSatisfied(op, state));
}
