# leaf-1.3.4 spec questions

Each question states the reading this leaf builds on (the more conservative one) until the architect rules. None blocks a gate.

## SPEC-Q-1: where sync reads the relational rows
08 §3 says recipe, member and preference writes enqueue `kg.sync`, and 10 §2 puts "sync" in `packages/graph`. R-2 forbids `graph → db` imports. The sync must still read dishes, members, preferences, exclusions and the catalogue.
Reading: sync logic depends only on a `KgSource` port whose methods return core row types. `packages/graph` also ships `PostgresKgSource`, which implements the port with parameterised SQL over the relational tables (no `db` import; the integration tests run on the migrated schema, so a column change in `db` fails them). The worker (1.4.1) and `scripts/kg-rebuild.ts` use it with one line of wiring. Alternative, if the architect prefers: the port stays, `PostgresKgSource` is dropped, and 1.4.1 writes the adapter over `db` repositories in `apps/worker`. The gates would be unaffected; `scripts/kg-rebuild.ts` would then wait for 1.4.1.

## SPEC-Q-2: which exclusions `substitutes()` respects
`substitutes(ingredientId, householdId, limit)` has no member argument. 02 §6: household-level exclusions apply to all members; member-level ones to that member.
Reading: a candidate is dropped when **any** exclusion row of the household (household-level or any member's, hard or not) matches it:
- `kind = ingredient`: `key` equals the candidate's ingredient id **or** slug. Existing leaves disagree on the key: 1.2.2's solver matches ids, 1.3.1's validator matches slugs. Matching both is the safe reading.
- `kind = category`: `key` equals its category.
- `kind = dietary_flag`: `key` is in its `dietary_flags`.

The exclusions come from an injected reader (`PostgresKgSource.exclusions` in production), not from graph edges, because 08 §2 has no exclusion edge.

## SPEC-Q-3: "best weight and the smallest macro delta"
Reading: sort by weight descending, then by macro distance `|Δprotein| + |Δcarbs| + |Δfat|` (g per 100 g raw) ascending, then by ingredient id. `macroDelta` is the full `Nutrients` difference (substitute − original) per 100 g raw. A field is `null` when either side is `null` (NUT-8). It is computed at catalogue sync and stored in the edge props.

## SPEC-Q-4: the similarity formula's open parts
08 KG-4.1 fixes the weights (0.6 / 0.2 / 0.1 / 0.1) but not the dish vector or how the cuisine, method and flavour terms are graded.
Reading (ADR-2):
- Dish ingredient vector: the mean over components of the mean over each component's variants of CONTAINS weights. Every component counts equally, whatever its raw mass.
- `water` is excluded from the vector: it is the largest raw mass in every boiled-grain variant, and it would make any two rice dishes look alike.
- Cuisine term: `max over cuisines c of min(w₁(c), w₂(c))`, where w is the OF_CUISINE weight (primary 1, secondary 0.5).
- Methods and flavour tags: Jaccard of the two sets.
- Candidates are dishes visible to the household with status `active` or `retired`. Retired dishes stay in the graph so that reviews on them still inform `kgSimilarityTerm`. Draft dishes are not in the graph (SPEC-Q-10).

## SPEC-Q-5: PAIRS_WITH
"Co-occurrence strength (PMI, normalised 0–1)" from "all households' seed dishes plus this household's own".
Reading:
- The unit is a dish's distinct ingredient set (water excluded), over `active` dishes.
- The weight is normalised PMI, `log(p(i,j)/(p(i)p(j))) / −log p(i,j)`, kept only when > 0 and when the pair co-occurs in at least 2 dishes. A single co-occurrence of two rare ingredients has NPMI = 1, which is noise.
- Global edges (household_id null) are computed over the seed library.
- A household that has its own active dishes gets household-scoped edges computed over seed + its own dishes. A read for that household prefers its own edge for a pair over the global one.
- Edges are stored in both directions, so `neighbours()` works from either ingredient.

## SPEC-Q-6: TYPICAL_IN
"Seed + derived from library frequencies". The catalogue data has no curated typicality, so the edges are derived only.
Reading: `typicality(i, c) = Σ_{d ∋ i} w_d(c) / Σ_d w_d(c)`, where `w_d(c)` is dish d's OF_CUISINE weight to c (1 primary, 0.5 secondary). The library, the scope and the household rule are the same as in SPEC-Q-5.

## SPEC-Q-7: LIKES / DISLIKES
"Member → any node, mirrored from `preference`".
Reading:
- Only member-level rows are mirrored. Household-level rows have no member, and 08 §1 has no household node.
- The row that counts for each (member, entity_type, entity_key) is chosen by core's precedence (leaf-1.3.2 SPEC-Q-8: locked, then explicit, then proposal, then learned).
- Score > 0 gives LIKES (weight = score). Score < 0 gives DISLIKES (weight = |score|). 0 gives no edge.
- `entity_type = dish` with a variant key `dish#variant` targets the Variant node.
- `component_role` has no node type and is not mirrored.
- A preference whose target is not in the graph (for example, a deleted dish) is skipped.

## SPEC-Q-8: what a rebuild "from scratch" may delete
`SUBSTITUTES_FOR` and `HAS_FLAVOUR` may come from AI (`source: ai`). No relational table holds those edges, so a literal from-scratch rebuild would lose them.
Reading: rebuild keeps `source = 'ai'` edges and the nodes they touch, and rebuilds everything else. This leaf writes no `ai` edges. The G1 comparison covers every non-`ai` node and edge.

## SPEC-Q-9: nodes without a relational table
FlavourTag and SlotType(key) have no global table (slot types are per household, and flavour tags are free text).
Reading:
- These nodes are created when a dish (HAS_FLAVOUR / SUITS_SLOT) or a preference references them.
- They are deleted when nothing references them any more. Without that, an incremental sync would leave orphans that a rebuild does not create.
- IngredientCategory nodes are the 22 enum values, always present.

## SPEC-Q-10: dish status and archived members
Reading:
- `draft` dishes are not synced: they are not in the library yet.
- `active` and `retired` dishes are synced, with `status` in their props.
- PAIRS_WITH and TYPICAL_IN use `active` dishes only.
- Archived members stay as nodes, with `archived: true` in their props, and their preference edges are kept, so history-based explanations still resolve.

## SPEC-Q-11: `neighbours()` scope and direction
Reading: outgoing edges only (PAIRS_WITH is stored in both directions). Without `opts.householdId`, only global edges to global nodes are returned. An unknown node, or a node that is not visible to the given household, returns `[]`. `similarDishes` and `substitutes` also return `[]` for a dish or ingredient that is not visible to the household, so nothing reveals whether it exists.

## SPEC-Q-12: what G1 compares
Reading: G1 builds one relational state (the 62-dish seed library, the catalogue, the F1 household and a second household with its own dishes, members, preferences and exclusions) in two fresh databases.
- **A** is produced by `rebuildGraph`.
- **B** is produced incrementally. Catalogue sync; one `kg.sync` per dish, member and preference write, in write order, including edits: a variant losing an ingredient, a component removed, a dish retired, a dish deleted, a preference flipped from like to dislike, a member archived. Then the nightly `recomputeLibrary`.
- The canonical snapshots must be equal: nodes by (household, type, key, label, props), edges by (household, src natural key, dst natural key, type, weight, props, source). Ids and `updated_at` are excluded.
- Syncs are repeated to show idempotence.
- Negative controls: a snapshot with one skipped sync, and one with a perturbed weight, must both compare unequal.
