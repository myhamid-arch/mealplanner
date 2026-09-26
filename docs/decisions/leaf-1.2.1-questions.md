# leaf-1.2.1 spec questions

Each question states the conservative reading this leaf builds on. None blocks a gate.

## SPEC-Q-1: engine input types are not defined in the spec
03 §7 names `VariantInput`, `CatalogContext` and `NutritionWarning` but does not define them, and `core/types` belongs to 1.1.2. The engine defines structural types in `nutrition/types.ts` (ADR-1). 1.1.2 can map its rows onto them.

## SPEC-Q-2: how a water-type ingredient is identified, and what absorbed stock contributes
NUT-3 step 1 says water listed for boiling contributes 0 mass and 0 nutrients "unless marked `retained`". Neither 02 `variant_ingredient` nor `ingredient` has a field that says an item is a cooking liquid or is retained.
- Reading taken: an optional per-row `cookingLiquid: "absorbed" | "retained"` on the variant ingredient. Unmarked rows are ordinary ingredients. 1.1.2 would need a matching column (e.g. `variant_ingredient.cooking_liquid`), and recipe generation would need to set it.
- An absorbed liquid adds 0 mass. It counts its own nutrients (zero for water, so this matches the spec for water). For stock absorbed into rice this counts the stock's kcal and sodium. The literal alternative, "0 nutrients" for any absorbed liquid, would drop them. Please confirm.

## SPEC-Q-3: coating
03's indicative table gives breaded_fried × poultry a yield "incl. coating". DM-3 says variants differ in coating, so the coating is a variant ingredient. If the poultry yield includes the coating's mass and the breadcrumbs are also listed, their mass is counted twice. Reading taken: each ingredient, the coating included, uses its own category's row. The engine does not read `method_yield.coating_*`. 1.1.3 should seed breaded poultry yields that exclude the coating's mass.

## SPEC-Q-4: unknown (null) nutrients in sums
NUT-8 says null is unknown and never displayed as 0, and that the solver treats null as 0. Reading taken: a variant's or plate's soluble fibre, sugar or sodium is `null` if any contributing ingredient's value is `null`. A partial sum is not presented as known. The solver then treats that null as 0, per NUT-8.

## SPEC-Q-5: more than one absorbed fat in one variant
NUT-3 step 2 has one `n_fat`. With oil and ghee both marked `is_absorbed_oil`, the absorbed grams `A` (capped by the total listed fat) are split in proportion to the listed grams.

## SPEC-Q-6: missing catalogue data
A missing ingredient or (method, category) yield row throws `NutritionError`, rather than falling back to a default. 03 §3 requires the rows to be seeded. A NUT-4 violation is returned as a warning, and the caller marks `needs_review`.

## SPEC-Q-7: `discardedFat` when the cap binds
Step 4 flags absorbed fat "mostly discarded". The flag is set on every `is_absorbed_oil` row, including when the listed oil is less than the absorption capacity and nothing is actually discarded. The flag marks the row's role (frying fat), not a measured discard.
