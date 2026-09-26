// REC-5 step 4: variant discipline (DM-3; leaf-1.3.1 ADR-2, SPEC-Q-2, SPEC-Q-3).
import type { GeneratedComponent, GeneratedVariant } from "../schema.js";
import type { Reason } from "./types.js";

/** Minimum share of core ingredients by weight between a variant and its component's default. */
export const MIN_VARIANT_SHARE = 0.7;

const BREADED_METHODS = new Set(["breaded_baked", "breaded_fried"]);

/** An ingredient's category, from the catalogue or the response's new ingredients. */
export type CategoryOf = (slug: string) => string | undefined;

export function isFatLine(
  line: GeneratedVariant["ingredients"][number],
  categoryOf: CategoryOf,
): boolean {
  return line.isAbsorbedFat || categoryOf(line.slug) === "oil_fat";
}

/** Ingredients of the component that appear only in its breaded variants. */
export function coatingSlugs(component: GeneratedComponent): Set<string> {
  const inBreaded = new Set<string>();
  const inOther = new Set<string>();
  for (const v of component.variants)
    for (const line of v.ingredients)
      (BREADED_METHODS.has(v.method) ? inBreaded : inOther).add(line.slug);
  return new Set([...inBreaded].filter((slug) => !inOther.has(slug)));
}

/** Raw grams per slug over the variant's lines that are neither fat nor coating. */
export function coreWeights(
  variant: GeneratedVariant,
  coating: ReadonlySet<string>,
  categoryOf: CategoryOf,
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const line of variant.ingredients) {
    if (isFatLine(line, categoryOf) || coating.has(line.slug)) continue;
    weights.set(line.slug, (weights.get(line.slug) ?? 0) + line.rawGramsPerBatch);
  }
  return weights;
}

/** Σ min(fA, fB) over slugs of the two weight-normalised compositions, in [0, 1]. */
export function variantShare(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number {
  const total = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((s, g) => s + g, 0);
  const ta = total(a);
  const tb = total(b);
  if (ta === 0 && tb === 0) return 1;
  if (ta === 0 || tb === 0) return 0;
  let share = 0;
  for (const [slug, ga] of a) {
    const gb = b.get(slug);
    if (gb !== undefined) share += Math.min(ga / ta, gb / tb);
  }
  return share;
}

export function checkVariants(
  components: readonly GeneratedComponent[],
  categoryOf: CategoryOf,
): Reason[] {
  const reasons: Reason[] = [];
  for (const c of components) {
    const base = c.variants.find((v) => v.isDefault);
    if (base === undefined || c.variants.length < 2) continue;
    const coating = coatingSlugs(c);
    const baseCore = coreWeights(base, coating, categoryOf);
    for (const v of c.variants) {
      if (v === base) continue;
      const share = variantShare(baseCore, coreWeights(v, coating, categoryOf));
      if (share < MIN_VARIANT_SHARE)
        reasons.push({
          step: 4,
          code: "variant_drift",
          message: `component "${c.name}": variant "${v.label}" shares ${(share * 100).toFixed(0)} % of its core ingredients by weight with "${base.label}" (needs at least ${String(MIN_VARIANT_SHARE * 100)} %); make it the same ingredients prepared differently, or a separate component`,
        });
    }
  }
  return reasons;
}
