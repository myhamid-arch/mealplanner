// R2-DL logic without React: levels, automatic meal shares, the proportional rebalance of
// R2-DL-4 and the recovery of which stored shares are "yours" (leaf-1.4.3 SPEC-Q-15, R-47).
import { CUSTOM_SLOT_DEFAULT_WEIGHT, DEFAULT_SLOTS } from "@mealplanner/core/types";

export const LEVELS = ["basic", "detailed", "expert"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABEL: Readonly<Record<Level, string>> = {
  basic: "Basic",
  detailed: "Detailed",
  expert: "Expert",
};

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

/** PLN-2 weight of a slot key; custom slots weigh 0.10. */
export function slotWeight(key: string): number {
  return DEFAULT_SLOTS.find((s) => s.key === key)?.defaultWeight ?? CUSTOM_SLOT_DEFAULT_WEIGHT;
}

/** Coarse layer (PLN-4 step 4): wₛ / Σ w over the given slots. */
export function autoShares(keys: readonly string[]): Record<string, number> {
  const total = keys.reduce((sum, k) => sum + slotWeight(k), 0);
  return Object.fromEntries(keys.map((k) => [k, total > 0 ? slotWeight(k) / total : 0]));
}

const DECIMALS = 4;
const round = (n: number) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;

/**
 * R2-DL-4: the user's values are kept; every other slot gets its automatic share scaled so the
 * day sums to exactly 1 (rounded to 4 decimals, the rounding remainder on the largest sibling).
 * Throws when the user's values alone exceed 100 %.
 */
export function rebalance(
  auto: Readonly<Record<string, number>>,
  yours: Readonly<Record<string, number>>,
): Record<string, number> {
  const keys = Object.keys(auto);
  const fixed = keys.filter((k) => yours[k] !== undefined);
  const fixedSum = fixed.reduce((s, k) => s + (yours[k] ?? 0), 0);
  if (fixedSum > 1 + 1e-9) throw new Error("your shares add up to more than 100 %");
  const siblings = keys.filter((k) => yours[k] === undefined);
  const autoSum = siblings.reduce((s, k) => s + (auto[k] ?? 0), 0);
  const out: Record<string, number> = {};
  for (const k of fixed) out[k] = round(yours[k] ?? 0);
  for (const k of siblings)
    out[k] = round(autoSum > 0 ? ((auto[k] ?? 0) / autoSum) * (1 - fixedSum) : 0);
  const residual = round(1 - Object.values(out).reduce((s, v) => s + v, 0));
  if (residual !== 0) {
    const target =
      [...siblings].sort((a, b) => (out[b] ?? 0) - (out[a] ?? 0))[0] ??
      [...fixed].sort((a, b) => (out[b] ?? 0) - (out[a] ?? 0))[0];
    if (target !== undefined) out[target] = round((out[target] ?? 0) + residual);
  }
  return out;
}

/** Relative tolerance for "the same ratio": 4-decimal rounding moves a 5 % share by < 0.2 %. */
const RATIO_TOLERANCE = 0.004;

/**
 * Which stored shares the user set (SPEC-Q-15). Siblings were rebalanced in proportion to their
 * automatic shares, so they share one `stored / auto` ratio; the user's values do not. The
 * siblings are the one group of ≥ 2 slots with a common ratio that is larger than the rest; when
 * no group qualifies (ambiguous), every stored value is shown as yours. A stored split equal to
 * the automatic one has no user values.
 */
export function inferYours(
  stored: Readonly<Record<string, number>>,
  auto: Readonly<Record<string, number>>,
): Set<string> {
  const keys = Object.keys(stored).filter((k) => auto[k] !== undefined);
  if (keys.length === 0) return new Set();
  const ratio = (k: string) => {
    const a = auto[k] ?? 0;
    return a > 0 ? (stored[k] ?? 0) / a : Number.NaN;
  };
  const same = (x: number, y: number) =>
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x - y) <= RATIO_TOLERANCE * Math.max(x, y, 1e-9);
  if (keys.every((k) => same(ratio(k), 1))) return new Set();
  const groups: string[][] = [];
  for (const k of keys) {
    const group = groups.find((g) => same(ratio(g[0] ?? ""), ratio(k)));
    if (group === undefined) groups.push([k]);
    else group.push(k);
  }
  const sorted = groups.sort((a, b) => b.length - a.length);
  const best = sorted[0] ?? [];
  const rest = keys.length - best.length;
  const tie = (sorted[1]?.length ?? 0) === best.length;
  if (best.length < 2 || tie || best.length <= rest) return new Set(keys);
  return new Set(keys.filter((k) => !best.includes(k)));
}

/** Percent text of a share: 0.3158 → "32 %". */
export function percent(share: number): string {
  return `${String(Math.round(share * 100))} %`;
}
