# leaf-1.2.1 ADR-2: how each NUT-3 step is computed

Status: proposed (CP1)
Requirement: NUT-2, NUT-3, NUT-4, NUT-8; 03 §7

Notation: raw grams `rᵢ`, nutrients per gram raw `nᵢ` (= `per100gRaw / 100`), method `m`, row `Y(m, cᵢ)`.

## 1. Solids and non-absorbed items (step 1)
For every ingredient with `isAbsorbedOil = false` and `cookingLiquid ≠ "absorbed"`:
- `fatLost = rᵢ · fatᵢ · (1 − fatRetention)`;
- fat and satFat are multiplied by `fatRetention`; kcal = `rᵢ · kcalᵢ − 9 · fatLost`; all other nutrients `rᵢ · nᵢ` unchanged;
- cooked mass = `rᵢ · (yieldOverride ?? yieldFactor)`.

A `cookingLiquid: "retained"` item is treated exactly like this (its own category's row, e.g. stewed × beverage, sets evaporation).

## 2. Absorbed cooking liquid
`cookingLiquid: "absorbed"`: cooked mass 0 (the absorbing ingredient's yield already includes it). Nutrients are `rᵢ · nᵢ` without fat retention; for water they are all zero, which is the spec's "0 mass and 0 nutrients". For stock this counts its nutrients (SPEC-Q-2).

## 3. Absorbed cooking fat (step 2)
- Absorbing solids = every item that is neither absorbed oil nor a cooking liquid.
- `capacity = Σ rᵢ · oilAbsorptionGPer100gRaw(m, cᵢ) / 100` over absorbing solids; `L = Σ` listed grams of the `isAbsorbedOil` items.
- `A = min(capacity, L)`.
- With several absorbed-fat items (oil and ghee), each item j contributes `A · Lⱼ / L` grams of itself: nutrients `A · Lⱼ / L · nⱼ` (no fat retention), cooked mass the same grams (SPEC-Q-5).
- The absorbed fat's own method_yield row is not read.

## 4. Totals (step 3)
`N = Σ nutrients`, `W = Σ cooked mass`; per 100 g cooked = `N / W · 100`. `W = 0` throws. No rounding anywhere in the engine.

Nullable nutrients (solubleFibre, sugar, sodiumMg): if any ingredient that contributes nutrients (`rᵢ > 0`, or `A > 0` for fats) has `null`, the variant value is `null` (SPEC-Q-4). `plateNutrients` applies the same rule to items with `cookedG > 0`.

## 5. Coating
A coating (breadcrumbs, egg wash) is an ordinary variant ingredient with its own category's row. The method_yield `coating_*` columns are not read by the engine (SPEC-Q-3).

## 6. Raw-from-cooked (step 4)
`rawForCooked(v, x)` returns one entry per listed variant ingredient, in order: `rawG = rᵢ · x / W`. Absorbed-oil items return their listed quantity scaled the same way (what goes in the pan) with `discardedFat: true` (SPEC-Q-7). Absorbed cooking liquid is returned too (the kitchen needs the water). `x = 0` returns zeros; `x < 0` throws.

## 7. NUT-4 check (step 5)
- `atwaterCheck(n)`: `predicted = 4·protein + 4·carbs + 9·fat + 2·fibre`, `deltaPct = |kcal − predicted| / kcal · 100`, `ok = deltaPct ≤ 12`. `kcal = 0`: `predicted = 0` gives `{ ok: true, deltaPct: 0 }`, otherwise `{ ok: false, deltaPct: Infinity }`.
- `variantNutritionPer100gCooked` returns an `atwater_ingredient` warning for each distinct listed ingredient that fails, and an `atwater_variant` warning when the per-100 g result fails. It does not throw on these: marking `needs_review` and excluding from planning is the caller's job.

## 8. plateNutrients
`Σ per100gᵢ · cookedGᵢ / 100` for each field: the absolute nutrients of the plate.

## 9. ENGINE_VERSION
`"1.0.0"`. Any change to these formulas bumps it (DM-4 cache invalidation).
