// PAIRS_WITH (normalised PMI) and TYPICAL_IN (cuisine typicality) from library frequencies
// (08 §2, KG-3 nightly; SPEC-Q-5, SPEC-Q-6).
import type { KgEdgeInput } from "../types/index.js";
import type { LibraryDish } from "./inputs.js";
import { MIN_PAIR_DISHES, ref, round3 } from "./refs.js";

/**
 * NPMI = log(p(i,j) / (p(i)·p(j))) / −log p(i,j), in (−1, 1]. When every dish holds both
 * ingredients (p(i,j) = 1) the pair is perfectly associated: 1.
 */
export function npmi(nI: number, nJ: number, nIJ: number, n: number): number {
  const pIJ = nIJ / n;
  if (pIJ >= 1) return 1;
  return Math.log(pIJ / ((nI / n) * (nJ / n))) / -Math.log(pIJ);
}

/**
 * The library edges of one scope. `householdId` null = the global library (seed dishes); otherwise
 * the given dishes are seed + that household's own, and every edge carries the household.
 */
export function deriveLibrary(
  dishes: readonly LibraryDish[],
  householdId: string | null,
): KgEdgeInput[] {
  const edges: KgEdgeInput[] = [];
  const n = dishes.length;
  if (n === 0) return edges;
  const scopeOf = new Map<string, string | null>();
  const sets = dishes.map((d) => {
    for (const i of d.ingredients) scopeOf.set(i.id, i.householdId);
    return [...new Set(d.ingredients.map((i) => i.id))].sort();
  });

  // PAIRS_WITH
  const single = new Map<string, number>();
  const pair = new Map<string, number>();
  for (const set of sets) {
    for (let a = 0; a < set.length; a += 1) {
      const i = set[a] as string;
      single.set(i, (single.get(i) ?? 0) + 1);
      for (let b = a + 1; b < set.length; b += 1) {
        const key = `${i}\u0000${set[b] as string}`;
        pair.set(key, (pair.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, nIJ] of pair) {
    if (nIJ < MIN_PAIR_DISHES) continue;
    const [i, j] = key.split("\u0000") as [string, string];
    const weight = round3(npmi(single.get(i) ?? 0, single.get(j) ?? 0, nIJ, n));
    if (weight <= 0) continue;
    for (const [src, dst] of [
      [i, j],
      [j, i],
    ] as const)
      edges.push({
        householdId,
        type: "PAIRS_WITH",
        src: ref("Ingredient", src, scopeOf.get(src) ?? null),
        dst: ref("Ingredient", dst, scopeOf.get(dst) ?? null),
        weight,
        props: { dishes: nIJ },
        source: "derived",
      });
  }

  // TYPICAL_IN: Σ_{d ∋ i} w_d(c) / Σ_d w_d(c)
  const cuisineTotal = new Map<string, number>();
  const held = new Map<string, { weight: number; dishes: number }>();
  dishes.forEach((d, index) => {
    for (const c of d.cuisines) {
      cuisineTotal.set(c.key, (cuisineTotal.get(c.key) ?? 0) + c.weight);
      for (const i of sets[index] ?? []) {
        const key = `${i}\u0000${c.key}`;
        const seen = held.get(key) ?? { weight: 0, dishes: 0 };
        held.set(key, { weight: seen.weight + c.weight, dishes: seen.dishes + 1 });
      }
    }
  });
  for (const [key, { weight, dishes: count }] of held) {
    const [i, c] = key.split("\u0000") as [string, string];
    const typicality = round3(weight / (cuisineTotal.get(c) ?? 1));
    if (typicality <= 0) continue;
    edges.push({
      householdId,
      type: "TYPICAL_IN",
      src: ref("Ingredient", i, scopeOf.get(i) ?? null),
      dst: ref("Cuisine", c),
      weight: typicality,
      props: { dishes: count },
      source: "derived",
    });
  }
  return edges;
}
