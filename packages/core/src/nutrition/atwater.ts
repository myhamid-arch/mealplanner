// NUT-4 energy consistency check (ADR-2 §7).
import type { Nutrients } from "./types.js";

/** Largest accepted |kcal − Atwater kcal| as a percentage of kcal. */
export const ATWATER_TOLERANCE_PCT = 12;

export function atwaterCheck(n: Nutrients): { ok: boolean; deltaPct: number } {
  const predicted = 4 * n.protein + 4 * n.carbs + 9 * n.fat + 2 * n.fibre;
  if (n.kcal === 0) {
    return predicted === 0 ? { ok: true, deltaPct: 0 } : { ok: false, deltaPct: Infinity };
  }
  const deltaPct = (Math.abs(n.kcal - predicted) / n.kcal) * 100;
  return { ok: deltaPct <= ATWATER_TOLERANCE_PCT, deltaPct };
}
