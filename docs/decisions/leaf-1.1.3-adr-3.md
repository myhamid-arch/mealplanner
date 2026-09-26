# leaf-1.1.3 ADR-3: method-yield sourcing

Status: proposed (CP1)
Requirement: NUT-3 (yield table), NUT-5, DM §3 `method_yield`

## Context
NUT-3 names the USDA Table of Cooking Yields for Meat and Poultry (2014) and the USDA Nutrient Retention Factors (Release 6) as seed sources. Neither can be reached from this container (ars.usda.gov is blocked). The FDC supporting-data `retention_factor.csv` I do have lists only the retention-factor codes and descriptions (270 rows), with no values.

## Decision: derive yields from paired USDA records, reproducibly
SR Legacy and CoFID publish the **same food raw and cooked by a named method**. USDA computed many SR cooked meat values from raw values using exactly the yield and retention factors NUT-3 asks for, so the pairs carry those factors. For each (method, category) I take one or more pairs of the category's typical ingredients:

- **yield_factor** `Y = P_raw / P_cooked` (protein mass balance: USDA retention for protein on cooking is ~100 %). Water-gaining foods (grains, pasta, dried legumes) use **dry-matter balance** `Y = (100 − water_raw) / (100 − water_cooked)`: protein there is diluted, not lost, and both give the same answer when nothing leaches. Leaching methods for vegetables (boiled) use dry matter and are marked `medium`.
- **fat_retention** `R = F_cooked · Y / F_raw`, clamped to ≤ 1. A value above 1 means fat was added. Those rows are frying rows and are handled next.
- **oil_absorption_g_per_100g_raw** for frying methods: `A = 100 · (F_cooked · Y − F_raw · R_ref)`, where `R_ref` is the same food's dry-heat retention. The frying fat is named in the source record, e.g. "fried in rapeseed oil".
- **coating** (`breaded_*`): the coating mass is `100 · (C_cooked · Y_total − C_raw) / c_coating`, where `c_coating` is the carbohydrate fraction of the named coating (breadcrumbs). `coating_ingredient_slug` points at that catalogue entry.
- When several pairs exist, I use the median and record every pair's value in `meta.pairs`.

Check against the NUT-3 indicative ranges, computed in this session from the SR Legacy CSV:
- `grilled × poultry`: SR 171077 → 171534 gives Y = 0.737 and R = 0.891 (range 0.70–0.78 / ~0.85).
- `boiled × grain`: SR 169756 → 168935 gives Y = 2.80 (dry matter) (range 2.4–3.0).
- `roasted × starch` (baked potato): SR 170028 → 170434 gives Y = 0.75 (dry matter) (range 0.70–0.80).
- The frying and breaded rows are derived the same way at build time. If a derived value falls outside the NUT-3 range, it is reported as a deviation. It is **not** adjusted to fit.

## Rows with no measured pair
Some pairs have no raw/cooked record in any reachable dataset: for example `air_fried` (not in SR or CoFID), `marinated_raw`, `blended`, and methods applied to `herb_spice` or `supplement`. These rows take one of two documented forms:
- **identity by definition**: `raw`, `marinated_raw`, `blended` for any category. No heat is applied, so Y = 1, R = 1 and A = 0. Source `definition`, confidence `high`.
- **analogy**: the row copies a named measured row (for example `air_fried × poultry` ← `roasted × poultry`, `pressure_cooked × legume` ← `boiled × legume`). It names that row and gives the physical reason. Source `analogy:<method>×<category>`, confidence `low`.

No row is presented as measured when it is not.

## Coverage
DM §3 method keys (23) × ingredient categories (22) = 506 pairs. Before 1.2.4 exists, "used by the seed library" cannot be measured (SPEC-Q-1). I propose seeding **every pair** except those in `coverage.excluded` (each with a reason, e.g. `deep_fried × beverage`). 1.2.4's G3 ("every variant passes nutrition validation") then cannot hit a missing row. The G3 verify also derives the used pairs from `data/seed-dishes/**` whenever that directory exists, so the gate keeps its meaning after 1.2.4 merges.
