// PLN-9 §6.2: weights from planning_weights, or from a weight_preset matching the weekday
// (SPEC-Q-13: the first matching preset by name overrides the weights it names).
import { weekdayOf, type HouseholdConfig } from "../../types/index.js";
import type { PlanWeights } from "./types.js";

const PRESET_KEYS = [
  "macroPrecision",
  "appeal",
  "ingredientEconomy",
  "variety",
  "fairness",
] as const;

export function weightsFor(cfg: HouseholdConfig, date: string): PlanWeights {
  const w = cfg.planningWeights;
  const base: PlanWeights = {
    macroPrecision: w.macroPrecision,
    appeal: w.appeal,
    ingredientEconomy: w.ingredientEconomy,
    variety: w.variety,
    fairness: w.fairness,
    aiGeneration: w.aiGeneration,
    economyWindowDays: w.economyWindowDays,
    adjustersEnabled: w.adjustersEnabled,
    maxVariantsPerComponent: w.maxVariantsPerComponent,
    presetName: null,
  };
  const weekday = weekdayOf(date);
  const preset = [...cfg.weightPresets]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .find((p) => p.appliesToWeekdays?.includes(weekday) ?? false);
  if (preset === undefined) return base;
  const values = preset.values;
  if (values === null || typeof values !== "object" || Array.isArray(values)) return base;
  const merged = { ...base, presetName: preset.name };
  for (const key of PRESET_KEYS) {
    const v = values[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) merged[key] = v;
  }
  return merged;
}
