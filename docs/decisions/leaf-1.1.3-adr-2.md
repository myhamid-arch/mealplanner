# leaf-1.1.3 ADR-2: data file formats and how they load into 1.1.2's tables

Status: accepted (CP1 APPROVED, rulings R-17 to R-19); built for CP2
Requirement: DM §3 (ingredient, preparation_method, method_yield, cuisine), ARC-2 (`data/` file names), NUT-7, NUT-8, KG `SUBSTITUTES_FOR` seed

## Principle
Every table row lives in the file as a JSON object whose keys are the DM §3 column names (snake_case), with DM value types and enums.

- A loader maps objects to rows by name: `id` and timestamps are generated at load, and foreign keys are resolved from slugs or keys.
- Keys that are not DM columns are grouped under one `meta` object (provenance, reasons, flags used by gates). The loader ignores it.

That way nothing outside the schema can leak into a column, and nothing needed for review is lost. Who writes the loader (seed step) is SPEC-Q-3.

## `data/ingredients.v1.json` (snapshot written by `scripts/import-fdc.ts`, committed)
```jsonc
{
  "snapshot_version": 1,
  "generated_by": "scripts/import-fdc.ts",
  "generated_at": "<ISO date>",
  "sources": { "<prefix>": { "dataset": "...", "release": "...", "licence": "...", "retrieved_via": "...", "sha256": "..." } },
  "omitted": [ { "name": "Sumac", "reason": "no record with per-100 g values in any reachable source" } ],
  "ingredients": [
    {
      "slug": "chickpeas-dried", "name": "Chickpeas, dried", "aliases": ["garbanzo", "hummus beans", "حمص"],
      "category": "legume",
      "kcal": 378, "protein_g": 20.47, "carbs_g": 62.95, "fat_g": 6.04, "sat_fat_g": 0.603,
      "fibre_g": 12.2, "soluble_fibre_g": null, "sugar_g": 10.7, "sodium_mg": 24,
      "density_g_per_ml": null, "unit_weight_g": null, "unit_label": null,
      "edible_portion": 1.0,
      "dietary_flags": ["vegan", "vegetarian"],
      "nutrition_source": "usda_fdc:173756", "nutrition_confidence": "high",
      "locale_availability": { "AE": "common" },
      "created_by_household_id": null,
      "meta": {
        "provenance": { "dataset": "sr_legacy", "record_id": "173756", "record_description": "Chickpeas (garbanzo beans, bengal gram), mature seeds, raw", "retrieved_via": "...", "proxy_note": null },
        "confidence_reason": null,
        "uae_specific": true, "uae_specific_reason": "NUT-7 example",
        "availability_basis": "builder assessment of UAE retail",
        "derivations": { "edible_portion": "...", "density_g_per_ml": "...", "unit_weight_g": "..." }
      }
    }
  ]
}
```
(The numbers above only illustrate the shape. Real values come from the importer.)

- `ingredients.v<N>.json` is versioned per NUT-7. A later re-import writes v2; v1 stays for reproducibility.
- `data/ingredients.manifest.json` (also inside `data/ingredients.*`) is the importer's hand-curated input: for each slug, the name, aliases, category, flags, availability, `uae_specific`, and the source record reference (dataset + record id). For tier 4–5 records that the importer cannot fetch offline, it also holds the label values with their record id. Nutrient values for tiers 1–3 are **never** typed by hand: the importer reads them from the dataset.
- `soluble_fibre_g` in the snapshot is filled only from `data/soluble-fibre.csv` (below).
- `edible_portion`, in order of preference:
  - SR "Refuse" (SR28 `FOOD_DES.txt` for the NDB number mapped from `sr_legacy_food.csv`);
  - 1.0 when the record describes the food in the form sold (fillet, cheese, flour), with the reason in `meta.derivations`.
- `density_g_per_ml`:
  - from an SR `food_portion` volume measure (cup = 236.588 ml, tbsp = 14.787 ml, tsp = 4.929 ml, fl oz = 29.574 ml), with the source portion recorded;
  - otherwise `null`. It is used only for liquids and pourable items.
- `unit_weight_g` / `unit_label`: from an SR `food_portion` count measure ("1 large" egg = 50 g), otherwise `null`.

## `data/method-yields.v1.json`
```jsonc
{
  "snapshot_version": 1,
  "methods": [ { "key": "grilled", "label": "Grilled", "description": "...", "appeal_tags": ["smoky", "charred"] } ],   // preparation_method rows, all 23 DM keys
  "yields": [
    { "method": "grilled", "ingredient_category": "poultry", "yield_factor": 0.737, "fat_retention": 0.891,
      "oil_absorption_g_per_100g_raw": 0,
      "meta": { "source": "paired_records:sr_legacy:171077→sr_legacy:171534", "method": "protein mass balance", "confidence": "medium", "note": "...", "pairs": [ ... ], "pair_yield_range": [0.737, 0.737] } }
  ],
  "coverage": { "required_pairs": "all", "excluded": [ { "method": "grilled", "ingredient_category": "beverage", "reason": "..." } ] }
}
```
- `method` is the `preparation_method.key`.
- There are no coating columns (R-12): `breaded_*` rows describe the substrate only, and a coating is its own variant ingredient.
- `meta.source` is one of:
  - `definition` (no heat);
  - `paired_records:<raw>→<cooked>,…`;
  - `analogy:<method>×<category>`.
- Derivation and sources are in ADR-3.
- `data/method-yields.manifest.json` is the importer's input: method texts, and the record pairs or analogy for each row.

## `data/cuisines.json`
An array of `{ key, label, parent_key }` for the 23 DM §3 keys.
- No `flag_emoji` key: R-23 removed the column from 02 (R2-UX-5, no emoji in data). G1 asserts it is absent.
- `parent_key` is `null` for all: no spec rule uses the hierarchy, and inventing one would be drift (SPEC-Q-12).

## `data/soluble-fibre.csv` (NUT-8 override table)
Header: `ingredient_slug,soluble_fibre_g_per_100g,source,method,citation`
- `source`: `usda_fdc:<id>` (FDC nutrient 1082, Foundation) or `fineli:<FOODID>` (Fineli, Finnish food composition database, THL, CC-BY 4.0).
- `method`:
  - `measured`: the source reports soluble fibre directly;
  - `total_minus_insoluble`: Fineli `FIBC` − `FIBINS`, which is valid because both are AOAC totals, TDF = IDF + SDF.
- `citation`: the full reference (dataset, release, record id, record description, and the two component values).
- A Fineli row is used only when both of these hold:
  - both fibre values are Fineli's own analytical or calculated values: `FIBC` acquisition type is not F or L, and both method types are in A/AG/CG/D/S. A total borrowed from another table is not comparable with Fineli's insoluble value; without this rule oat bran would get 0.8 g soluble.
  - Fineli's total fibre is within ±25 % of the catalogue's own `fibre_g`, so the two records describe comparable food.
- 28 rows met these rules. Legumes have none: their Fineli totals are borrowed values, or disagree with SR by more than 25 %.
- R-13 known zeros are not rows in this file. When an ingredient's own record reports total fibre 0, the importer sets `soluble_fibre_g` to 0 and cites that record in `meta.derivations.soluble_fibre_g`. Likewise, sugar is 0 when available carbohydrate is 0.
- Every other ingredient has `soluble_fibre_g: null`, never 0.

Fineli data: `github.com/theel0ja/fineli-data` `basic-package-2` (Fineli release 18, THL, CC-BY 4.0). The selection rules are in the `method` bullets above. The row-by-row computation is in the PR.

## `data/substitutes.csv` (seed for KG `SUBSTITUTES_FOR`, 08-knowledge-graph)
Header: `from_slug,to_slug,weight,context,note`
- `weight` in 0–1 is the curated culinary substitutability.
- `context` is the culinary role in which the swap holds (for example `grilled protein`, `creamy dairy`).
- The macro delta is **not** stored: 1.3.4 computes it from the snapshot, so it cannot drift from the nutrient values.
- Every slug must exist in the snapshot; a verify assertion checks this under G1.
