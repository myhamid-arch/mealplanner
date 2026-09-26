// PLN-5 variant combinations: the cartesian product of each component's allowed variants,
// pruned to the member's top-3 appeal variants per component beyond 24 combinations (SPEC-Q-16).
import { MAX_COMBINATIONS, TOP_VARIANTS_WHEN_PRUNED } from "./config.js";
import type { MemberCtx, VariantForSolve } from "./types.js";

export function appealOf(variant: VariantForSolve, member: MemberCtx): number {
  return member.variantAppeal[variant.id] ?? 0;
}

/** Highest appeal first, then the default variant, then input order. */
export function rankVariants(
  variants: readonly VariantForSolve[],
  member: MemberCtx,
): VariantForSolve[] {
  return variants
    .map((variant, index) => ({ variant, index }))
    .sort(
      (a, b) =>
        appealOf(b.variant, member) - appealOf(a.variant, member) ||
        Number(b.variant.isDefault) - Number(a.variant.isDefault) ||
        a.index - b.index,
    )
    .map((x) => x.variant);
}

/**
 * Combinations of one variant per component. A component with no allowed variant takes `null`
 * (served 0 g). Enumeration order is lexicographic in each component's variant order.
 */
export function enumerateCombinations(
  allowed: readonly (readonly VariantForSolve[])[],
  member: MemberCtx,
): { combos: (VariantForSolve | null)[][]; pruned: boolean } {
  const count = allowed.reduce((n, vs) => n * Math.max(1, vs.length), 1);
  const pruned = count > MAX_COMBINATIONS;
  const choices: (VariantForSolve | null)[][] = allowed.map((vs) => {
    if (vs.length === 0) return [null];
    if (!pruned) return [...vs];
    const keep = new Set(rankVariants(vs, member).slice(0, TOP_VARIANTS_WHEN_PRUNED));
    return vs.filter((v) => keep.has(v));
  });
  let combos: (VariantForSolve | null)[][] = [[]];
  for (const options of choices)
    combos = combos.flatMap((prefix) => options.map((option) => [...prefix, option]));
  return { combos, pruned };
}
