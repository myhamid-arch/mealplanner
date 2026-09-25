# 08 — Knowledge graph

v1 stores the graph in PostgreSQL (`kg_node`, `kg_edge`; see [02-domain-model.md](02-domain-model.md) §8), behind a `GraphStore` interface. The planner, learning and generation code can then move to a dedicated graph engine (Apache AGE on the same Postgres, or Neo4j) without changes (KG-1). The graph is **derived and augmenting**: the relational tables stay the source of truth for entities, and the graph holds relationships that are expensive or awkward to express relationally.

## 1. Nodes

| Type | Scope | Source |
|---|---|---|
| Ingredient, IngredientCategory, Cuisine, Method, FlavourTag, SlotType(key) | global | catalogue sync |
| Dish, Component, Variant | global (seed) or household | recipe sync |
| Member | household | member sync |

## 2. Edges

| Edge | From → To | Weight meaning | Source |
|---|---|---|---|
| `CONTAINS` | Variant → Ingredient | share of variant raw weight | derived on recipe save |
| `PREPARED_BY` | Variant → Method | 1 | derived |
| `PART_OF` | Component → Dish, Variant → Component | 1 | derived |
| `OF_CUISINE` | Dish → Cuisine | 1 primary, 0.5 secondary | derived |
| `IN_CATEGORY` | Ingredient → IngredientCategory | 1 | seed |
| `TYPICAL_IN` | Ingredient → Cuisine | typicality 0–1 | seed + derived from library frequencies |
| `PAIRS_WITH` | Ingredient ↔ Ingredient | co-occurrence strength (PMI, normalised 0–1) | derived from the library (all households' **seed** dishes plus this household's own) |
| `SUBSTITUTES_FOR` | Ingredient → Ingredient | culinary substitutability 0–1, props: macro delta per 100 g | seed (curated) + AI (flagged `source: ai`) |
| `HAS_FLAVOUR` | Dish/Ingredient → FlavourTag | 0–1 | seed + AI |
| `SUITS_SLOT` | Dish → SlotType | 1 | derived |
| `LIKES` | Member → any node | preference score > 0 | mirrored from `preference` |
| `DISLIKES` | Member → any node | ‖score‖ where score < 0 | mirrored |

Household-scoped edges carry `household_id`. Queries MUST filter `household_id IS NULL OR household_id = :hh` (KG-2).

## 3. Sync (KG-3)

- Recipe, member and preference writes enqueue a `kg.sync` job for the affected entities. The job is idempotent: an upsert by (type, key) and by (src, dst, type).
- `PAIRS_WITH` and `TYPICAL_IN` are recomputed nightly.
- The graph can always be rebuilt from scratch (`pnpm kg:rebuild`). A test asserts that rebuild produces the same graph as the incremental sync.

## 4. Uses in v1 (KG-4)

1. **Dish similarity (appeal prior).** `sim(d₁, d₂)` = weighted Jaccard over the ingredient sets (by `CONTAINS` weight) × 0.6 + same cuisine 0.2 + shared methods 0.1 + shared flavour tags 0.1. `kgSimilarityTerm` for a new dish is the similarity-weighted mean of the member's scores on the 10 most similar reviewed dishes (FBK-4).
2. **Palette-aware generation.** For recipe generation, pick the palette by expanding the window's ingredients through `PAIRS_WITH` and `TYPICAL_IN(cuisine)`. This steers new dishes towards ingredients the plan already has.
3. **Substitution.** Where an excluded or disliked ingredient appears, or the kitchen tags `ingredient_unavailable`, look up `SUBSTITUTES_FOR` with the best weight and the smallest macro delta. Used by `suggest_alternatives` and by recipe-revision proposals.
4. **Explanations.** Score breakdowns cite graph paths, e.g. "Similar to *Grilled chicken fattoush* (you rated 5★): shares chicken, sumac, cucumber".

## 5. Interface

```ts
interface GraphStore {
  upsertNodes(nodes: KgNodeInput[]): Promise<void>;
  upsertEdges(edges: KgEdgeInput[]): Promise<void>;
  neighbours(nodeId: string, edgeType: string, opts?: { minWeight?: number; limit?: number; householdId?: string }): Promise<KgNeighbour[]>;
  similarDishes(dishId: string, householdId: string, limit: number): Promise<Array<{ dishId: string; sim: number; why: string[] }>>;
  substitutes(ingredientId: string, householdId: string, limit: number): Promise<Array<{ ingredientId: string; weight: number; macroDelta: Nutrients }>>;
}
```

`PostgresGraphStore` implements this interface with recursive CTEs where needed. A graph explorer page (admin, read-only, force-directed view of a member's likes and dislikes and their neighbourhood) is **SHOULD** for v1.
