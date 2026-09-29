// BLD-8 R-33 (c): a proposal whose ops the current state already satisfies is not proposed again
// (rules read the whole window, so the evidence for an accepted change is still there).
import type { ParsedChangeOp } from "../../changes/index.js";
import type { HouseholdConfig } from "../../types/index.js";

export interface SatisfactionState {
  config: HouseholdConfig;
  /** Verified state of the ingredients a proposal may name. */
  verifiedIngredientIds: ReadonlySet<string>;
}

/** Whether a row's slot scope (null = every slot) covers an op's scope. */
function scopeCovers(row: readonly string[] | null, op: readonly string[] | null): boolean {
  if (row === null) return true;
  if (op === null) return false;
  return op.every((k) => row.includes(k));
}

function sameScope(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((k) => b.includes(k));
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
      // R-49: an op that changes the reason or hardness of the member's own row for the key
      // changes its protection (DM-5, AGT-5), so it is not satisfied by that row.
      // The op updates only the row of the same slot scope (`exclusion.add`, 1.2.6).
      const own = config.exclusions.find(
        (row) =>
          row.memberId === p.memberId &&
          row.kind === p.kind &&
          row.key === p.key &&
          sameScope(row.slotKeys, p.slotKeys ?? null),
      );
      if (own !== undefined && (own.reason !== p.reason || own.hard !== p.hard)) return false;
      // Any exclusion of the key whose scope covers the op's already keeps it off the member's
      // plates there (R-83): an unscoped row covers every slot, a scoped row only its own slots.
      return config.exclusions.some(
        (row) =>
          (row.memberId === p.memberId || row.memberId === null) &&
          row.kind === p.kind &&
          row.key === p.key &&
          scopeCovers(row.slotKeys, p.slotKeys ?? null),
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
