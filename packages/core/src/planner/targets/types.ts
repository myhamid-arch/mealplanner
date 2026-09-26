// Output of the target resolver (04 §3 PLN-4, with the BLD-8 R-25 additions).
import type { DayKind, ToleranceMode } from "../../types/index.js";
import type { CarbBasis } from "./config.js";

/** Per-meal tolerance: kcal in kcal, the rest in grams. */
export type MacroTolerance = { kcal: number; protein: number; carbs: number; fat: number };

export type SlotTarget = {
  memberId: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  slotKey: string;
  slotTypeId: string;
  dayKind: DayKind;
  /** Whole kcal and grams (PLN-4 step 5); the slots of a member-day sum to the daily target. */
  kcal: number;
  protein: number;
  /** Carbohydrate on `carbBasis`: total (`carbs + fibre`) or available (`carbs`). */
  carbs: number;
  fat: number;
  /** Saturated-fat cap for this slot, grams (0.1 g). */
  satFatMax?: number;
  /** Total-fibre goal for this slot, grams (0.1 g); a soft goal (OQ-4, R-28). */
  fibreGoal?: number;
  /** Soluble-fibre goal for this slot, grams (0.1 g); a soft goal (OQ-4, R-28). */
  solubleFibreGoal?: number;
  /**
   * P/C/F: the member's per-meal tolerance. kcal: this slot's part of the member's daily kcal band
   * (OQ-2, R-28); the slot bands of a member-day sum to the daily band.
   */
  tol: MacroTolerance;
  mode: ToleranceMode;
  carbBasis: CarbBasis;
};

export interface ResolveOptions {
  /** Defaults to CARB_TARGET_BASIS. */
  carbBasis?: CarbBasis;
}
