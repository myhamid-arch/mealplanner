// FBK-4 appeal evaluation for member `m` and plate `p` (used by PLN-9):
//   a = clamp(0.35·dish + 0.20·mean(variants) + 0.15·cuisine + 0.10·mean(methods)
//             + 0.15·ingredientTerm + 0.05·kgSimilarityTerm, −1, 1)
import type { PreferenceEntityType, PreferenceRow, PreferenceSource } from "../../types/index.js";
import { APPEAL_WEIGHTS, INGREDIENT_DISLIKE_DRAG } from "./config.js";
import { variantKey } from "./keys.js";

/** Among rows of one key at one level: locked first, then this source order (SPEC-Q-8). */
const SOURCE_RANK: Record<PreferenceSource, number> = { explicit: 0, proposal: 1, learned: 2 };

type Level = Map<string, PreferenceRow>;

/** Preference rows indexed by level and key, with the SPEC-Q-8 winner kept per key. */
export class PreferenceIndex {
  private readonly levels = new Map<string, Level>();

  constructor(rows: readonly PreferenceRow[]) {
    for (const row of rows) {
      const levelId = row.memberId ?? "";
      let level = this.levels.get(levelId);
      if (level === undefined) {
        level = new Map();
        this.levels.set(levelId, level);
      }
      const id = `${row.entityType}\u0000${row.entityKey}`;
      const current = level.get(id);
      if (current === undefined || outranks(row, current)) level.set(id, row);
    }
  }

  /** The winning row for the key: member-level where one exists, otherwise household-level. */
  resolve(
    memberId: string | null,
    entityType: PreferenceEntityType,
    entityKey: string,
  ): PreferenceRow | undefined {
    const id = `${entityType}\u0000${entityKey}`;
    if (memberId !== null) {
      const own = this.levels.get(memberId)?.get(id);
      if (own !== undefined) return own;
    }
    return this.levels.get("")?.get(id);
  }

  /** FBK-4: the member-level value where it exists, otherwise the household-level value, otherwise 0. */
  score(memberId: string | null, entityType: PreferenceEntityType, entityKey: string): number {
    return this.resolve(memberId, entityType, entityKey)?.score ?? 0;
  }
}

function outranks(a: PreferenceRow, b: PreferenceRow): boolean {
  if (a.locked !== b.locked) return a.locked;
  return SOURCE_RANK[a.source] < SOURCE_RANK[b.source];
}

/** The resolved score of one key (see `PreferenceIndex.score`). */
export function resolveScore(
  prefs: readonly PreferenceRow[] | PreferenceIndex,
  memberId: string | null,
  entityType: PreferenceEntityType,
  entityKey: string,
): number {
  return toIndex(prefs).score(memberId, entityType, entityKey);
}

/** One plate's chosen variants, as appeal evaluation needs them. */
export interface AppealPlate {
  dishId: string;
  cuisineKey: string;
  variants: readonly {
    variantId: string;
    methodKey: string;
    coreIngredientIds: readonly string[];
  }[];
}

export interface AppealTerms {
  dish: number;
  variant: number;
  cuisine: number;
  method: number;
  ingredient: number;
  kgSimilarity: number;
}

export interface Appeal {
  /** a ∈ [−1, 1]. */
  appeal: number;
  terms: AppealTerms;
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

function toIndex(prefs: readonly PreferenceRow[] | PreferenceIndex): PreferenceIndex {
  return prefs instanceof PreferenceIndex ? prefs : new PreferenceIndex(prefs);
}

/**
 * FBK-4 appeal of `plate` for member `memberId`. `kgSimilarityTerm` comes from the knowledge graph
 * (08 §4); it is 0 until the graph supplies it. Methods and core ingredients count once each.
 */
export function evaluateAppeal(
  prefs: readonly PreferenceRow[] | PreferenceIndex,
  memberId: string,
  plate: AppealPlate,
  kgSimilarityTerm = 0,
): Appeal {
  if (!Number.isFinite(kgSimilarityTerm) || kgSimilarityTerm < -1 || kgSimilarityTerm > 1)
    throw new RangeError(
      `kgSimilarityTerm must be within [−1, 1], got ${String(kgSimilarityTerm)}`,
    );
  const index = toIndex(prefs);
  const score = (type: PreferenceEntityType, key: string) => index.score(memberId, type, key);
  const methods = [...new Set(plate.variants.map((v) => v.methodKey))];
  const ingredients = [...new Set(plate.variants.flatMap((v) => v.coreIngredientIds))];
  const ingredientScores = ingredients.map((id) => score("ingredient", id));
  const terms: AppealTerms = {
    dish: score("dish", plate.dishId),
    variant: mean(plate.variants.map((v) => score("dish", variantKey(plate.dishId, v.variantId)))),
    cuisine: score("cuisine", plate.cuisineKey),
    method: mean(methods.map((m) => score("method", m))),
    ingredient:
      ingredientScores.length === 0
        ? 0
        : mean(ingredientScores) -
          INGREDIENT_DISLIKE_DRAG * Math.max(0, -Math.min(...ingredientScores)),
    kgSimilarity: kgSimilarityTerm,
  };
  const a =
    APPEAL_WEIGHTS.dish * terms.dish +
    APPEAL_WEIGHTS.variant * terms.variant +
    APPEAL_WEIGHTS.cuisine * terms.cuisine +
    APPEAL_WEIGHTS.method * terms.method +
    APPEAL_WEIGHTS.ingredient * terms.ingredient +
    APPEAL_WEIGHTS.kgSimilarity * terms.kgSimilarity;
  return { appeal: Math.min(1, Math.max(-1, a)), terms };
}
