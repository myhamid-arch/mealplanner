# leaf-1.3.4 ADR-2: graph derivation, sync and rebuild

Status: accepted (CP1 APPROVED, BLD-8 R-35 with the SPEC-Q-4 amendment below)
Requirements: KG-1 … KG-4 (08 §1–§5), FBK-4 (`kgSimilarityTerm`)

## Layers
1. **Derivation (pure).** `packages/graph/src/derive/**` turns core row types (`IngredientRow`, `CuisineRow`, `PreparationMethodRow`, `DishRow`, `ComponentRow`, `VariantRow`, `VariantIngredientRow`, `MemberRow`, `PreferenceRow` from `@mealplanner/core/types`) into `KgNodeInput[]` / `KgEdgeInput[]`. No I/O.
2. **Source port.** `KgSource` returns those rows (catalogue, one dish, one household's members and preferences, the library for PAIRS_WITH/TYPICAL_IN, curated substitutes, exclusions). `PostgresKgSource` implements it by SQL over the relational tables (SPEC-Q-1), plus `data/substitutes.csv` read from a path.
3. **Store.** `PostgresGraphStore` implements the 08 §5 `GraphStore` and the sync-only extension `GraphSyncStore` (replace an owned edge set, delete nodes, collect orphans, dump a canonical snapshot).
4. **Sync.** `syncGraph(store, source, request)` handles one `kg.sync` request; `recomputeLibrary(store, source)` is the nightly `kg.nightly` job; `rebuildGraph(store, source)` is `pnpm kg:rebuild`. The job runner (1.4.1) enqueues and calls these; `scripts/kg-rebuild.ts` calls `rebuildGraph`.

## Nodes (08 §1)
| Type | Key | Scope | Label |
|---|---|---|---|
| Ingredient | ingredient id | global, or `created_by_household_id` | name |
| IngredientCategory | category enum value (all 22) | global | humanised value |
| Cuisine | cuisine key | global | label |
| Method | method key | global | label |
| FlavourTag | tag | global, created when referenced | tag |
| SlotType | slot key | global, created when referenced | label from `DEFAULT_SLOTS`, else the key |
| Dish, Component, Variant | row id | dish's `household_id` | name / name / label |
| Member | member id | household | display name |

Ids are the same keys as preference `entity_key`s (leaf-1.3.2 ADR-1), so LIKES/DISLIKES resolve without a lookup table.

## Edges (08 §2)
| Edge | Weight (3 dp) | Props | Owner (replaced as a set by) |
|---|---|---|---|
| CONTAINS Variant → Ingredient | raw g ÷ variant raw g | `rawG` | dish sync |
| PREPARED_BY Variant → Method | 1 | – | dish sync |
| PART_OF Component → Dish, Variant → Component | 1 | – | dish sync |
| OF_CUISINE Dish → Cuisine | 1 primary, 0.5 secondary | – | dish sync |
| HAS_FLAVOUR Dish → FlavourTag | 1 (seed/derived from `dish.flavour_tags`) | – | dish sync |
| SUITS_SLOT Dish → SlotType | 1 | – | dish sync |
| IN_CATEGORY Ingredient → IngredientCategory | 1 | – | catalogue sync |
| SUBSTITUTES_FOR Ingredient → Ingredient | curated weight | `macroDelta` (Nutrients per 100 g raw, to − from), `context`, `note` | catalogue sync (source `seed`) |
| PAIRS_WITH Ingredient ↔ Ingredient (both directions) | NPMI > 0 | `dishes` (co-occurrence count) | nightly (SPEC-Q-5) |
| TYPICAL_IN Ingredient → Cuisine | typicality 0–1 | `dishes` | nightly (SPEC-Q-6) |
| LIKES / DISLIKES Member → node | score / ‖score‖ | `entityType`, `entityKey`, `source`, `locked`, `hard` | preference sync (SPEC-Q-7) |

Household-scoped: every edge whose source row is household-scoped (a household dish's edges, member edges, a household's own PAIRS_WITH/TYPICAL_IN) carries that `household_id`. Every read filters `household_id IS NULL OR household_id = $hh` on both the edge and the neighbour node (KG-2).

## Sync requests (KG-3)
`{ kind: "catalogue" } | { kind: "dish", dishIds } | { kind: "member", householdId, memberIds } | { kind: "preferences", householdId, memberIds }`.
Each request runs in one transaction: upsert the entity's nodes, replace the edges it owns (delete owned edges not in the new set, upsert the rest), delete the nodes of rows that no longer exist (a removed component, a deleted dish, a draft dish), then delete orphan FlavourTag/SlotType nodes. Running a request twice leaves the graph unchanged (idempotent).
`recomputeLibrary()` replaces all PAIRS_WITH and TYPICAL_IN edges, global and per household, in one transaction.
`rebuildGraph()` deletes every node and edge except `source = 'ai'` edges and the nodes they touch (SPEC-Q-8), then runs catalogue, every dish, every household's members and preferences, and `recomputeLibrary()`, in one transaction.

## KG-4 uses
- **Similarity.** `sim(d₁,d₂) = 0.6·J + 0.2·C + 0.1·M + 0.1·F` (SPEC-Q-4): `J` weighted Jaccard `Σmin/Σmax` over dish core-ingredient vectors (R-35: 1.3.2's `coreIngredients`, which leaves out `herb_spice` and `water`). Each variant's core ingredients are renormalised to shares of their raw grams (the CONTAINS `rawG` prop); a component's vector is the mean over its variants; the dish vector is the mean over the components that have core ingredients; `C = max over cuisines of min(OF_CUISINE weights)`; `M` Jaccard of the dishes' method sets; `F` Jaccard of flavour-tag sets. `why` cites the shared ingredients (top 3 by shared weight, by label), the shared cuisine, methods and flavour tags. Candidates are dishes visible to the household with `sim > 0`, sorted by `sim` desc then dish id. `similarDishes` computes the features of every visible dish per call (one recursive-CTE query); at the seed library's size (62 dishes plus a household's own) that is one query and a few milliseconds of arithmetic.
- **`kgSimilarityTerm`** (FBK-4): `Σ simᵢ·scoreᵢ / Σ simᵢ` over the 10 most similar dishes that the member has a dish score for; 0 when there are none.
- **Substitution.** `substitutes()` returns SUBSTITUTES_FOR neighbours visible to the household, minus any candidate hit by the household's exclusions (SPEC-Q-2; every row whatever its `hard` flag, R-34; ingredient keys are slugs, R-36, and an id also matches), sorted by weight desc, then macro distance `|ΔP|+|ΔC|+|ΔF|` asc, then id (SPEC-Q-3).
- **Palette.** `expandPalette(store, { householdId, ingredientIds, cuisineKeys, limit })` ranks candidate ingredients by `Σ PAIRS_WITH weight from the window's ingredients + Σ TYPICAL_IN weight to the requested cuisines`, excluding the window's own ingredients, with the contributing paths as `why`.
- **Explanations** are the `why` strings of `similarDishes` and `expandPalette` (graph paths by label).
