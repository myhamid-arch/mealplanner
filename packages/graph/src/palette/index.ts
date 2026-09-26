// KG-4.2 palette-aware generation: @mealplanner/graph/palette. Expands the window's ingredients
// through PAIRS_WITH and TYPICAL_IN(cuisine), so new dishes lean on ingredients the plan already has.
import type { KgNeighbour, KgNodeType, NeighbourOptions } from "../types/index.js";

/** The reads the palette needs; `PostgresGraphStore` provides them. */
export interface PaletteStore {
  findNode(
    type: KgNodeType,
    key: string,
    householdId?: string,
  ): Promise<{ id: string; label: string } | null>;
  neighbours(nodeId: string, edgeType: string, opts?: NeighbourOptions): Promise<KgNeighbour[]>;
  incoming(nodeId: string, edgeType: string, opts?: NeighbourOptions): Promise<KgNeighbour[]>;
}

export interface PaletteRequest {
  householdId: string;
  /** Ingredient ids already in the planning window. */
  ingredientIds: readonly string[];
  /** Cuisines the new dishes should lean towards. */
  cuisineKeys: readonly string[];
  limit: number;
}

export interface PaletteCandidate {
  ingredientId: string;
  label: string;
  /** Σ PAIRS_WITH weight from the window's ingredients + Σ TYPICAL_IN weight to the cuisines. */
  score: number;
  /** The graph paths that contributed (KG-4.4). */
  why: string[];
}

export async function expandPalette(
  store: PaletteStore,
  request: PaletteRequest,
): Promise<PaletteCandidate[]> {
  const window = new Set(request.ingredientIds);
  const found = new Map<string, PaletteCandidate>();
  const add = (n: KgNeighbour, weight: number, why: string) => {
    if (n.type !== "Ingredient" || window.has(n.key)) return;
    const c = found.get(n.key) ?? { ingredientId: n.key, label: n.label, score: 0, why: [] };
    c.score += weight;
    c.why.push(why);
    found.set(n.key, c);
  };
  const opts = { householdId: request.householdId };
  for (const id of window) {
    const node = await store.findNode("Ingredient", id, request.householdId);
    if (node === null) continue;
    for (const n of await store.neighbours(node.id, "PAIRS_WITH", opts))
      add(n, n.weight, `pairs with ${node.label}`);
  }
  for (const key of new Set(request.cuisineKeys)) {
    const node = await store.findNode("Cuisine", key, request.householdId);
    if (node === null) continue;
    for (const n of await store.incoming(node.id, "TYPICAL_IN", opts))
      add(n, n.weight, `typical in ${node.label}`);
  }
  return [...found.values()]
    .map((c) => ({ ...c, score: Math.round(c.score * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || (a.ingredientId < b.ingredientId ? -1 : 1))
    .slice(0, Math.max(0, request.limit));
}
