# leaf-1.1.3 ADR-3: method-yield sourcing

Status: accepted (CP1 APPROVED, rulings R-17 to R-19); built for CP2
Requirement: NUT-3 (yield table), NUT-5, DM §3 `method_yield`

## Context
NUT-3 names the USDA Table of Cooking Yields for Meat and Poultry (2014) and the USDA Nutrient Retention Factors (Release 6) as seed sources. Neither can be reached from this container (ars.usda.gov is blocked). The FDC supporting-data `retention_factor.csv` I do have lists only the retention-factor codes and descriptions (270 rows), with no values.

## Decision: derive yields from paired USDA records, reproducibly
SR Legacy and CoFID publish the **same food raw and cooked by a named method**. USDA computed many SR cooked meat values from raw values using exactly the yield and retention factors NUT-3 asks for, so the pairs carry those factors. For each (method, category) I take one or more pairs of the category's typical ingredients:

- **yield_factor** `Y = P_raw / P_cooked` (protein mass balance: USDA retention for protein on cooking is ~100 %). Water-gaining foods (grains, pasta, dried legumes) use **dry-matter balance** `Y = (100 − water_raw) / (100 − water_cooked)`: protein there is diluted, not lost, and both give the same answer when nothing leaches. Leaching methods for vegetables (boiled) use dry matter and are marked `low` (see "Measured rows").
- **fat_retention** `R = F_cooked · Y / F_raw`, clamped to ≤ 1. A value above 1 means fat was added. Those rows are frying rows and are handled next.
- **oil_absorption_g_per_100g_raw** for frying methods: `A = 100 · (F_cooked · Y − F_raw · R_ref)`, where `R_ref` is the same food's dry-heat retention. The frying fat is named in the source record, e.g. "fried in rapeseed oil".
- **fat-free dry matter**, for foods cooked in fat: `Y = (100 − water − fat)_raw / (100 − water − fat)_cooked`. Plain dry matter would count absorbed oil as retained solids.
- **coating (R-12)**: `breaded_*` rows describe the substrate only. The only measured source is SR "breast, meat only, cooked, fried", which USDA analysed with the coating removed. Breaded rows copy the shallow-fried row of the same category.
- When several pairs exist, I use the median and record every pair's value in `meta.pairs`.

Check against the NUT-3 indicative ranges, computed in this session from the SR Legacy CSV:
- `grilled × poultry`: SR 171077 → 171534 gives Y = 0.737 and R = 0.891 (range 0.70–0.78 / ~0.85).
- `boiled × grain`: SR 169756 → 168935 gives Y = 2.80 (dry matter) (range 2.4–3.0).
- `baked × starch`: SR 170028 → 170434 gives Y = 0.75 (dry matter). The seeded `roasted × starch` row uses CoFID oil-roasted potatoes (below).
- `deep_fried × fish` copies `shallow_fried × fish` (Y 0.767, R 1.0, A 7.95). That is the median of CoFID red snapper (A 1.18) and sprats (A 14.72). It sits inside the NUT-3 range only as a median of two very different pairs, so its confidence is `low`.
- `breaded_fried × poultry` has no NUT-3 check: the NUT-3 range includes the coating, and R-12 excludes it.
- `roasted × starch`: Y 0.741, with oil capacity A 4.13 g per 100 g raw (NUT-3 says "per recipe": the engine caps absorption at the oil the recipe lists).

## Measured rows (39)
They cover poultry, red meat, fish, seafood, egg, grain, starch, legume, vegetable, leafy greens, fruit, nuts and bakery (`paired_records`). Each row lists every pair with its own Y/R/A and working, and the range of the pair yields.
- Confidence is `medium`.
- It is `low` where the pairs disagree widely:
  - boiled vegetables: 0.84–1.48, because raw and boiled records are independent samples and solids leach;
  - boiled leafy greens: 0.80–1.26;
  - shallow-fried fish: 1.2 and 14.7 g oil.

## Rows with no measured pair
Some pairs have no raw/cooked record in any reachable dataset: for example `air_fried` (not in SR or CoFID), `marinated_raw`, `blended`, and methods applied to `herb_spice` or `supplement`. These rows take one of two documented forms:
- **identity by definition**: `raw`, `marinated_raw`, `blended` for any category. No heat is applied, so Y = 1, R = 1 and A = 0. Source `definition`, confidence `high`.
- **analogy**: the row copies a named measured row (for example `air_fried × poultry` ← `roasted × poultry`, `pressure_cooked × legume` ← `boiled × legume`). It names that row and gives the physical reason. Source `analogy:<method>×<category>`, confidence `low`.

An analogy never crosses heat families. Moist methods (water uptake) and dry or frying methods (water loss, oil uptake) do not copy each other.
- Two cross-category fallbacks: seafood uses fish, and starch/legume/fruit/leafy greens use vegetable.
- Plant proteins use vegetable rows under dry heat and frying. Under moist heat they are treated as keeping their mass; they do not copy dried legumes.
- Grain under frying copies fried bread: flour and crumbs behave like a coating. Grain under dry heat is treated as keeping its mass.
- The boiled grain and legume rows apply to dry grain and dried legumes. Canned or cooked items need a per-ingredient yield override (03 §2), and the row notes say so.

No row is presented as measured when it is not.

## Coverage
DM §3 method keys (23) × ingredient categories (22) = 506 pairs (SPEC-Q-1, accepted in R-19). 477 are seeded:
- 66 `definition`;
- 39 measured;
- 372 `analogy`.

29 are excluded with reasons: beverages under dry heat and frying, and supplements under most methods. The G3 verify also derives the used pairs from `data/seed-dishes/**` whenever that directory exists. If it can read no pair from files that exist, it fails.
