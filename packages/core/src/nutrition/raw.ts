// Raw grams for a cooked quantity (NUT-3 step 4).
import { computeBatch } from "./batch.js";
import { assertNonNegative } from "./catalog.js";
import type { CatalogContext, VariantInput } from "./types.js";

export function rawForCooked(
  v: VariantInput,
  cookedG: number,
  ctx: CatalogContext,
): Array<{ ingredientId: string; rawG: number; discardedFat?: boolean }> {
  assertNonNegative(cookedG, "cookedG");
  const scale = cookedG / computeBatch(v, ctx).cookedG;
  return v.ingredients.map((row) =>
    row.isAbsorbedOil
      ? { ingredientId: row.ingredientId, rawG: row.rawG * scale, discardedFat: true }
      : { ingredientId: row.ingredientId, rawG: row.rawG * scale },
  );
}
