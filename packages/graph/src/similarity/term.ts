// FBK-4 `kgSimilarityTerm` (08 KG-4.1): the similarity-weighted mean of the member's scores on the
// 10 most similar reviewed dishes.
import type { SimilarDish } from "../types/index.js";

export const SIMILARITY_TERM_NEIGHBOURS = 10;

/**
 * `similar` is `similarDishes` output (best first); `memberDishScores` maps dish id → the member's
 * resolved dish score for the dishes the member has reviewed. Returns a value in [−1, 1]; 0 when no
 * similar dish has a score.
 */
export function kgSimilarityTerm(
  similar: readonly Pick<SimilarDish, "dishId" | "sim">[],
  memberDishScores: ReadonlyMap<string, number>,
): number {
  const scored = [...similar]
    .filter((s) => s.sim > 0 && memberDishScores.has(s.dishId))
    .sort((a, b) => b.sim - a.sim || (a.dishId < b.dishId ? -1 : 1))
    .slice(0, SIMILARITY_TERM_NEIGHBOURS);
  const total = scored.reduce((sum, s) => sum + s.sim, 0);
  if (total === 0) return 0;
  const mean =
    scored.reduce((sum, s) => sum + s.sim * (memberDishScores.get(s.dishId) ?? 0), 0) / total;
  return Math.min(1, Math.max(-1, mean));
}
