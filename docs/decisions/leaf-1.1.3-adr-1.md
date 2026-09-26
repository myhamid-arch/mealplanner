# leaf-1.1.3 ADR-1: nutrition sources, provenance and confidence

Status: accepted (CP1 APPROVED, rulings R-17 to R-19); built for CP2
Requirement: NUT-7, NUT-8, NUT-4, DM §3 (`nutrition_source`, `nutrition_confidence`)

## Context
NUT-7 wants values from USDA FoodData Central (SR Legacy or Foundation) and says the build container cannot reach FDC. Measured in this session (2026-09-26):
- `api.nal.usda.gov` and `fdc.nal.usda.gov`: the egress proxy answers `403` to CONNECT (curl and the server-side fetch tool both blocked).
- Also blocked: `ars.usda.gov`, `data.nal.usda.gov`, `pmc.ncbi.nlm.nih.gov`, `huggingface.co`, `zenodo.org`, `wikipedia.org`, `openfoodfacts.org`.
- Reachable: `github.com` over git, `raw.githubusercontent.com`, GitHub release downloads, `registry.npmjs.org`, `pypi.org`.

## Decision: source priority
Each ingredient takes its values from exactly one record. Use the first tier that has a record for the food, with all required nutrients present (see "Required nutrients").

| Tier | Dataset (release) | `nutrition_source` | Default confidence |
|---|---|---|---|
| 1 | USDA FDC **SR Legacy** (April 2018 data, FDC CSV release 2019-04-02) | `usda_fdc:<fdc_id>` | high |
| 2 | USDA FDC **Foundation** foods | `usda_fdc:<fdc_id>` | high |
| 3 | UK **CoFID** 2019 (McCance & Widdowson's Composition of Foods Integrated Dataset, PHE) | `cofid:<food code>` | high |
| 3 | **AFCD** Release 1 (Australian Food Composition Database, FSANZ) | `afcd:<public food key>` | high |
| 4 | USDA FDC **Branded** foods (label-declared values) | `usda_fdc:<fdc_id>` | low |
| 5 | Open Food Facts (label transcriptions, ODbL) | `off:<barcode>` | low |

Tiers 3–5 are used only where tiers 1–2 have no record of that food. NUT-7 calls these "documented alternative sources".

The non-FDC prefixes (`cofid:`, `afcd:`, `off:`) extend DM §3's `nutrition_source` examples. They follow the same `<dataset>:<record id>` shape as `usda_fdc:<id>` so the source stays machine-checkable. See SPEC-Q-2.

## Confidence rules
- **high**: an analytical or official compiled value for the same food.
- **medium**: an official value for a documented proxy. Examples: a congeneric species (kingfish/kanaad from *Scomberomorus maculatus*), or a regional product sold under another name (khubz from SR "Bread, pita, white"). The proxy is named in `provenance.proxy_note`.
- **low**: label-derived values (tiers 4–5); a proxy with no close relative in any dataset; or an entry that fails NUT-4 for a documented reason. Every `low` entry has a non-empty `confidence_reason`.
- **NUT-4 with source factors (R-22).** When the source publishes food-specific energy factors, they are stored in `meta.atwater_factors` (`protein`, `fat`, `carbohydrate`, `source`). SR Legacy provides them as `food_calorie_conversion_factor` joined through `food_nutrient_conversion_factor`; the FDC API gives the same as `nutrientConversionFactors`.
  - An entry passes NUT-4 if either check is within 12 %:
    - the generic 4/4/9/2 check on available carbohydrate;
    - its own factors applied to carbohydrate by difference (`carbs_g + fibre_g`), with no fibre term.
  - Passing never lowers confidence.
  - v1: 296 entries carry factors. 357 of 363 pass: 332 on the generic check alone, 25 more with their own factors.
  - The 6 that still fail are both vinegars (acetic acid energy), brewed coffee (1 kcal/100 g rounding), both cooking wines and vanilla extract (alcohol energy). They stay `low` with a reason.

## How each dataset was obtained (provenance chain)
- **SR Legacy.** These are the official FDC CSV files `FoodData_Central_sr_legacy_food_csv_ 2019-04-02/` (food.csv, food_nutrient.csv, food_portion.csv, sr_legacy_food.csv …), committed unmodified to the public repo `github.com/tomwhite/ingreedy-data` (`data/raw/`). The rows match the file's own `all_downloaded_table_record_counts.csv` (food 7,793). I checked independently against the SR28 `ABBREV.txt` in the npm package `fda-nutrient-database@1.0.2`, joined on NDB number: energy, protein, fat and carbohydrate agree on 30,459 of 31,016 compared values. That is 98.2 %. The rest are SR28→SR Legacy revisions, mostly branded snack and fast-food records.
- **Foundation and Branded.** These come from the SQLite build `foods-US.db` in the GitHub release `codejetnet/food-data` `data-20260925-3` (public-domain USDA rows, ODbL database). That build carries `fdc_id` as `source_id`. Its SR Legacy rows are identical to the official CSV on all 58,680 compared values (8 nutrients, 7,681 foods, 0 differences). I take that as evidence that its USDA extraction is faithful. It is not proof for the Branded and Foundation rows, so those entries note the route in `provenance.retrieved_via`.
- **CoFID 2019 and AFCD Release 1.** These are the government files in the same `ingreedy-data/data/raw/`. The CoFID 2019 workbook's sheets "1.3 Proximates" and "1.4 Inorganics" were saved as CSV by a one-off reshaping script (recorded in the PR). The script copies cell values verbatim and computes nothing.
  - The older CoFID CSV in that directory uses pre-2019 food codes. Every `cofid:` code here is a 2019 code.
- **Saturated fat in AFCD.** AFCD reports saturated fatty acids as % of total fatty acids. The importer stores `% / 100 × total fat` as an upper bound and records the working in `meta.derivations.sat_fat_g`. Fatty acids are a fraction of total lipid, so the true value is lower.
- **Soluble fibre.** Sources are in ADR-2 §soluble-fibre.csv.

- **Missing AOAC fibre in CoFID.** When CoFID gives no AOAC fibre value but the same record reports carbohydrate 0 and non-starch polysaccharide 0, fibre is 0. AOAC fibre is NSP plus resistant starch plus lignin. The derivation is recorded. Only flesh foods meet this condition.
- **Carbohydrate basis (SPEC-Q-13).** `carbs_g` is **available** carbohydrate:
  - FDC 1005 − 1079 and US label total carbohydrate − fibre, each recorded in `meta.derivations.carbs_g`;
  - CoFID `CHO` and AFCD "available carbohydrate, without sugar alcohols" as reported.

  The manifest's `carbs_basis` switches this to `by_difference`. This was ruled in R-20. An entry where fibre exceeds carbohydrate by difference is clamped to 0, says so in `meta`, and is `low`.

Every entry records `provenance`: dataset, release, record id, the record's own description, retrieval route and, for proxies, the proxy note. With that, the architect can check any value against the cited record (G6).

## Required nutrients
DM §3 makes `kcal, protein_g, carbs_g, fat_g, sat_fat_g, fibre_g` non-null. If the chosen record lacks one of them, I take the next record or tier. **No value is filled by estimate.** `sugar_g` and `sodium_mg` are nullable: they stay `null` when the record lacks them. The FDC nutrient IDs mapped are 1008, 1003, 1005, 1004, 1258, 1079, 2000 and 1093 (NUT-7). CoFID and AFCD columns are mapped by name in the importer, with the mapping in ADR-4. AFCD energy is reported in kJ, "with dietary fibre", and is converted at 4.184 kJ/kcal.

## What is not claimed
- `locale_availability.AE` (`common` | `available` | `rare`) is the builder's assessment of UAE retail availability. It is not measured, and `provenance.availability_basis` says so (SPEC-Q-8).
- A citation is only ever to a record I actually read in this session. If a food has no usable record anywhere, it is left out of the catalogue and listed in the PR. It is not estimated.
