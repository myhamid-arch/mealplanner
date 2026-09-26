// REC-5 step 6: duplication (leaf-1.3.1 ADR-2, SPEC-Q-4).
import type { GeneratedComponent } from "../schema.js";
import type { ExistingDish, Reason } from "./types.js";
import { isFatLine, type CategoryOf } from "./variants.js";

export const NAME_SIMILARITY_LIMIT = 0.85;
export const INGREDIENT_JACCARD_LIMIT = 0.8;

/** pg_trgm trigrams: lower-case alphanumeric words, each padded "  word ". */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word === "") continue;
    const padded = `  ${word} `;
    // Code points, as pg_trgm reads multibyte characters (words hold only letters and digits).
    const chars = Array.from(padded);
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(""));
  }
  return out;
}

/** pg_trgm `similarity`: shared trigrams over the union. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let shared = 0;
  for (const x of sa) if (sb.has(x)) shared++;
  return shared / (sa.size + sb.size - shared);
}

/**
 * A dish's core ingredients: over its components, the default variant's slugs that are neither fat
 * nor `herb_spice`. Callers use the same rule for existing dishes.
 */
export function coreIngredientSlugs(
  components: readonly GeneratedComponent[],
  categoryOf: CategoryOf,
): string[] {
  const out = new Set<string>();
  for (const c of components) {
    const base = c.variants.find((v) => v.isDefault) ?? c.variants[0];
    for (const line of base?.ingredients ?? []) {
      if (isFatLine(line, categoryOf) || categoryOf(line.slug) === "herb_spice") continue;
      out.add(line.slug);
    }
  }
  return [...out].sort();
}

export function checkDuplication(
  name: string,
  core: readonly string[],
  others: readonly ExistingDish[],
): Reason[] {
  const reasons: Reason[] = [];
  for (const other of others) {
    const similarity = trigramSimilarity(name, other.name);
    if (similarity >= NAME_SIMILARITY_LIMIT)
      reasons.push({
        step: 6,
        code: "duplicate_name",
        message: `the name is ${(similarity * 100).toFixed(0)} % trigram-similar to the existing dish "${other.name}" (limit ${String(NAME_SIMILARITY_LIMIT * 100)} %)`,
      });
    const overlap = jaccard(core, other.coreIngredients);
    if (overlap >= INGREDIENT_JACCARD_LIMIT)
      reasons.push({
        step: 6,
        code: "duplicate_ingredients",
        message: `its core ingredients overlap ${(overlap * 100).toFixed(0)} % (Jaccard) with the existing dish "${other.name}" (limit ${String(INGREDIENT_JACCARD_LIMIT * 100)} %)`,
      });
  }
  return reasons;
}
