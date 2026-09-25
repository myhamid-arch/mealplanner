# 03 — Nutrition engine

A pure TypeScript module (`packages/core/src/nutrition`) with no I/O. Given variants, ingredients and method yields, it computes nutrients per 100 g **cooked**, and converts in both directions between cooked plate grams and raw ingredient grams. Everything downstream (solver, cook sheet, UI) uses it. It MUST be deterministic and fully unit-tested (NUT-1).

## 1. Why cooked-weight basis (NUT-2)

The kitchen plates cooked food, so portions are specified in **cooked grams**, weighed at plating. Macros depend on the preparation method: a fried fillet absorbs oil and loses water, a grilled one drips fat and loses water. Two variants built from identical raw ingredients therefore have different nutrients per cooked gram. This is the mechanism behind "grilled vs fried changes macros and appeal".

## 2. Inputs

- Ingredient nutrients per 100 g raw edible (see [02-domain-model.md](02-domain-model.md) §3).
- The variant's ingredient list: raw grams per reference batch, and whether each item is an absorbed cooking fat.
- The method yield row for each (method, ingredient category): `yield_factor`, `fat_retention`, `oil_absorption_g_per_100g_raw`.
- Optional per-ingredient yield overrides on the variant (for example, the recipe states that rice is cooked at a 1 : 1.5 water ratio). Water and stock are ingredients with their own nutrients (water: all zero).

## 3. Computation (NUT-3)

For a variant with ingredients `i` (raw grams `rᵢ`, nutrients per gram `nᵢ`, category `cᵢ`) cooked by method `m`:

1. **Solids and non-absorbed items.** For every ingredient that is not an absorbed cooking fat:
   - nutrients contributed = `rᵢ · nᵢ`, except that fat is scaled by `fat_retention(m, cᵢ)`. Saturated fat scales by the same factor. Energy is reduced by `9 kcal × fat lost`.
   - cooked mass contributed = `rᵢ · yield(m, cᵢ)`. Water-type ingredients contribute mass according to the absorbing ingredient's yield: rice's yield already includes absorbed water, so water listed for boiling contributes 0 mass and 0 nutrients unless marked `retained` (as in soups and stews).
2. **Absorbed cooking fat** (frying oil, ghee used for frying):
   - absorbed grams `A = min(Σ over absorbing solids of rᵢ · absorption(m, cᵢ)/100, listed fat grams)`.
   - nutrients contributed = `A · n_fat`, and cooked mass contributed = `A`. The rest is discarded oil and does not count.
3. **Totals.** `N = Σ nutrients` and `W = Σ cooked mass`. Nutrients per 100 g cooked = `N / W · 100`.
4. **Raw-from-cooked.** For `x` cooked grams of a variant, the raw grams of ingredient `i` = `rᵢ · x / W`. Absorbed fat is reported as the listed frying quantity scaled to the batch (what the kitchen puts in the pan) and flagged "mostly discarded".
5. **Consistency check (NUT-4).** For every ingredient and every computed variant, `|kcal − (4·P + 4·C + 9·F + 2·fibre)| / kcal ≤ 12%`. Violations are data errors: the ingredient or variant is marked `needs_review` and excluded from planning until an admin fixes it.

Default yield rows MUST be seeded for every (method, category) pair used in seed recipes. Seed values come from the USDA Table of Cooking Yields for Meat and Poultry and the USDA Nutrient Retention Factors. Where no USDA value exists, the value is documented with its source and `confidence` (NUT-5). Indicative ranges the builder must reproduce from source rather than copy:

| Method × category | Yield | Fat retention | Oil absorbed g/100 g raw |
|---|---|---|---|
| grilled × poultry | ~0.70–0.78 | ~0.85 | 0 |
| deep_fried × fish (unbreaded) | ~0.75–0.85 | 1.0 | ~5–8 |
| breaded_fried × poultry | ~0.85–0.95 (incl. coating) | 1.0 | ~10–15 |
| boiled × grain (rice) | ~2.4–3.0 | 1.0 | 0 |
| roasted × starch (potato) | ~0.70–0.80 | 1.0 | per recipe |

## 4. Precision requirements that affect the kitchen (NUT-6)

Macro precision is only achievable if the kitchen follows two rules. The cook sheet MUST state both, and recipe generation MUST support them:

- Every fat and oil in a recipe is given in grams (or ml, with the gram equivalent). Nothing is written as "a drizzle" or "to taste". Spices below 5 g may be written "to taste" because they are nutritionally negligible, and are listed with an approximate gram value.
- Plates are portioned by weighing cooked components on a kitchen scale, to the plate's 5 g grid.

## 5. Ingredient catalogue (NUT-7)

- The seed catalogue has at least 250 ingredients commonly available in the UAE. Examples: basmati rice, Arabic bread (khubz), labneh, halloumi, akkawi, laban, freekeh, bulgur, dates, hammour, sherry (sheri) fish, kingfish (kanaad), shrimp, lamb, camel meat, chickpeas, fava beans (foul), za'atar, sumac, tahini, ghee, and major supermarket staples. Each entry sets `locale_availability.AE`.
- Values come from USDA FoodData Central (SR Legacy or Foundation), using nutrient IDs 1008 energy, 1003 protein, 1005 carbohydrate, 1004 fat, 1258 saturated fat, 1079 fibre, 1082 soluble fibre, 2000 sugars and 1093 sodium. Local items without an FDC entry use a documented alternative source, or are marked `confidence: low`.
- **Soluble fibre (NUT-8)** is missing for many FDC foods. The catalogue holds a curated override table (`data/soluble-fibre.csv`: ingredient slug, g/100 g, source citation). Where no value exists, the field is `null`, not 0, and the solver treats null as 0 while the UI shows "unknown" (it is never displayed as 0).
- The importer (`scripts/import-fdc.ts`) needs an FDC API key and network access. It writes a versioned JSON snapshot (`data/ingredients.v<N>.json`) that is committed, so builds and tests never call FDC. The build container cannot reach FDC; the builder MUST produce the snapshot from a documented source and mark every entry's `nutrition_source`.
- Households can add private ingredients manually, or the AI can add them during recipe generation (`nutrition_source: ai_estimate`, `confidence: low`). These show a "verify" badge, and an insight proposal is raised to verify them.

## 6. Units and display (NUT-9)

- Metric only in v1. Solid mass below 1000 g is shown in g, rounded to 5 g above 100 g and 1 g below. From 1000 g it is shown in kg with 2 decimals. Liquids with a density use ml or L. Unit-counted items show both: "4 eggs (≈200 g)".
- Plate grams are always integers on the component's `step_g` grid.

## 7. Public interface (contract for other leaves)

```ts
// packages/core/src/nutrition/index.ts
export type Nutrients = { kcal: number; protein: number; carbs: number; fat: number; satFat: number;
  fibre: number; solubleFibre: number | null; sugar: number | null; sodiumMg: number | null };
export function variantNutritionPer100gCooked(v: VariantInput, ctx: CatalogContext): { per100g: Nutrients; batchCookedG: number; warnings: NutritionWarning[] };
export function rawForCooked(v: VariantInput, cookedG: number, ctx: CatalogContext): Array<{ ingredientId: string; rawG: number; discardedFat?: boolean }>;
export function plateNutrients(items: Array<{ per100g: Nutrients; cookedG: number }>): Nutrients;
export function atwaterCheck(n: Nutrients): { ok: boolean; deltaPct: number };
export const ENGINE_VERSION: string; // bump on any formula change → dish_nutrition_cache invalidation
```
