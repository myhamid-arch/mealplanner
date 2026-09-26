// PLN-4 steps 4 and 5: slot shares and whole-unit slot values (SPEC-Q-4 … 6, BLD-8 R-25).
import {
  CUSTOM_SLOT_DEFAULT_WEIGHT,
  DEFAULT_SLOTS,
  type DayKind,
  type HouseholdConfig,
  type SlotTypeRow,
} from "../../types/index.js";

/** PLN-2 default weight of a slot; custom slots weigh 0.10. */
export function slotWeight(slot: SlotTypeRow): number {
  return DEFAULT_SLOTS.find((d) => d.key === slot.key)?.defaultWeight ?? CUSTOM_SLOT_DEFAULT_WEIGHT;
}

/**
 * Shares of the attended slots, in the order given, summing to 1.
 * Detailed layer: the member's `meal_distribution` rows for the day kind, if they cover every
 * attended slot and their shares there are positive in total; renormalised over the attended slots.
 * Otherwise the coarse layer: `wₛ / Σ w` over the attended slots.
 */
export function slotShares(
  cfg: HouseholdConfig,
  memberId: string,
  dayKind: DayKind,
  slots: readonly SlotTypeRow[],
): number[] {
  const rows = cfg.mealDistributions.filter(
    (r) => r.memberId === memberId && r.dayKind === dayKind,
  );
  const detailed = slots.map((slot) => rows.find((r) => r.slotTypeId === slot.id)?.share);
  const shares = detailed.filter((s): s is number => s !== undefined);
  if (rows.length > 0 && shares.length === slots.length) {
    const sum = shares.reduce((a, b) => a + b, 0);
    if (sum > 0) return shares.map((s) => s / sum);
  }
  const weights = slots.map(slotWeight);
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

/**
 * Largest-remainder apportionment: whole numbers ≥ 0, proportional to `weights`, summing exactly
 * to `total` (a whole number ≥ 0). Ties go to the earlier index. With all weights 0 the total is
 * spread evenly.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const effective = sum > 0 ? weights : weights.map(() => 1);
  const effectiveSum = sum > 0 ? sum : weights.length;
  const quotas = effective.map((w) => (total * w) / effectiveSum);
  const result = quotas.map((q) => Math.floor(q + 1e-9));
  let left = total - result.reduce((a, b) => a + b, 0);
  const order = quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    left -= 1;
  }
  return result;
}

/**
 * Whole-unit slot values for one nutrient (steps 4 and 5). `fixed[i]` is an expert override
 * (`slot_target_override`) or undefined. Fixed values are rounded and kept; the remainder of the
 * rounded daily value, clamped at 0, is apportioned over the other slots by share.
 */
export function slotValues(
  daily: number,
  shares: readonly number[],
  fixed: readonly (number | undefined)[],
): number[] {
  const free = shares.map((_, i) => fixed[i] === undefined);
  const fixedTotal = fixed.reduce<number>((a, f) => a + (f === undefined ? 0 : Math.round(f)), 0);
  const remainder = Math.max(0, Math.round(daily) - fixedTotal);
  const freeShares = shares.filter((_, i) => free[i]);
  const spread = apportion(remainder, freeShares);
  let next = 0;
  return shares.map((_, i) => {
    const f = fixed[i];
    if (f !== undefined) return Math.round(f);
    const value = spread[next] ?? 0;
    next += 1;
    return value;
  });
}

/** Rounds to 0.1. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
