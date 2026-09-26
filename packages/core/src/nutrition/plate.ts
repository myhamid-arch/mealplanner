// Absolute nutrients of a plate of cooked components (ADR-2 §8).
import { assertNonNegative } from "./catalog.js";
import { addScaled, applyKnownBounds, assertValidNutrients, zeroNutrients } from "./nutrients.js";
import type { Nutrients } from "./types.js";

export function plateNutrients(items: Array<{ per100g: Nutrients; cookedG: number }>): Nutrients {
  let total = zeroNutrients();
  items.forEach((item, i) => {
    assertNonNegative(item.cookedG, `plate item ${String(i)}: cookedG`);
    assertValidNutrients(item.per100g, `plate item ${String(i)}`);
    total = addScaled(total, applyKnownBounds(item.per100g), item.cookedG / 100);
  });
  return total;
}
