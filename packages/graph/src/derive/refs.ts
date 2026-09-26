// Node references and shared constants for derivation (leaf-1.3.4 ADR-2).
import type { KgNodeType, NodeRef } from "../types/index.js";

/** Weights and nutrient deltas are stored at the precision of `numeric(10,3)`. */
export function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function ref(type: KgNodeType, key: string, householdId: string | null = null): NodeRef {
  return { householdId, type, key };
}

/** The slug excluded from similarity, PAIRS_WITH and TYPICAL_IN (SPEC-Q-4/5/6, R-35). */
export const WATER_SLUG = "water";

/** OF_CUISINE weights (08 §2). */
export const PRIMARY_CUISINE_WEIGHT = 1;
export const SECONDARY_CUISINE_WEIGHT = 0.5;

/** PAIRS_WITH needs at least this many co-occurring dishes (SPEC-Q-5). */
export const MIN_PAIR_DISHES = 2;

/** "breaded_fried" → "Breaded fried". */
export function humanise(key: string): string {
  const words = key.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
