// Arithmetic on Nutrients with NUT-8 unknowns (ADR-2 §4, BLD-8 R-13).
import { NutritionError } from "./errors.js";
import type { Nutrients } from "./types.js";

const REQUIRED = ["kcal", "protein", "carbs", "fat", "satFat", "fibre"] as const;
const NULLABLE = ["solubleFibre", "sugar", "sodiumMg"] as const;

export function zeroNutrients(): Nutrients {
  return {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    satFat: 0,
    fibre: 0,
    solubleFibre: 0,
    sugar: 0,
    sodiumMg: 0,
  };
}

/**
 * R-13: an unknown value that a known bound makes zero is zero. Soluble fibre cannot exceed
 * fibre and sugar cannot exceed carbohydrate, so `null` becomes 0 when the bound is 0.
 */
export function applyKnownBounds(n: Nutrients): Nutrients {
  return {
    ...n,
    solubleFibre: n.solubleFibre === null && n.fibre === 0 ? 0 : n.solubleFibre,
    sugar: n.sugar === null && n.carbs === 0 ? 0 : n.sugar,
  };
}

/**
 * `acc + n · factor`. A contribution with factor 0 adds nothing, so its unknowns do not
 * propagate; otherwise an unknown term makes the sum unknown (SPEC-Q-4).
 */
export function addScaled(acc: Nutrients, n: Nutrients, factor: number): Nutrients {
  if (factor === 0) return acc;
  const sum = { ...acc };
  for (const key of REQUIRED) sum[key] = acc[key] + n[key] * factor;
  for (const key of NULLABLE) {
    const a = acc[key];
    const b = n[key];
    sum[key] = a === null || b === null ? null : a + b * factor;
  }
  return sum;
}

/** Throws unless every known value is a finite number ≥ 0. */
export function assertValidNutrients(n: Nutrients, subject: string): void {
  for (const key of [...REQUIRED, ...NULLABLE]) {
    const value = n[key];
    if (value !== null && !(Number.isFinite(value) && value >= 0)) {
      throw new NutritionError(
        "invalid_input",
        `${subject}: ${key} must be a finite number >= 0 (got ${String(value)})`,
      );
    }
  }
}
