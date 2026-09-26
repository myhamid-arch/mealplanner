# leaf-1.1.3 ADR-6: verify script `scripts/verify/leaf-1.1.3.mjs`

Status: proposed (CP1)
Requirement: BLD-4/BLD-5 (verify script, negative controls, measured counts)

## Decision
- Plain ESM, Node built-ins only, plus `scripts/verify/lib/report.mjs` (`Report`), which it imports and does not modify. It reads only committed files under `data/`, so it needs no network and no database.
- `--gate G1|G2|G3|G4|G5`. Each gate:
  - runs its assertions on the real data;
  - then runs the **same assertion function** on an in-memory known-bad copy (the negative control) and requires it to fail;
  - prints `VERIFY leaf-1.1.3 G<n> PASSED` only if every assertion passed and every negative control failed. Otherwise it exits 1.
- Every count is computed from the files. The spec thresholds (250, 40, 12 %) are the only constants, and they are written once with the requirement ID beside them.
- The DM §3 enums and column lists are encoded in the script from the spec text, independently of any 1.1.2 code.

| Gate | Real-data assertions | Negative control(s) |
|---|---|---|
| G1 | Snapshot parses. ≥ 250 entries, unique slugs. Every DM §3 required column is present with the right type and enum. Nutrients are finite and ≥ 0, with P + C + F ≤ 100.5 g. `sat_fat_g ≤ fat_g`, `sugar_g ≤ carbs_g`, `soluble ≤ fibre`. `nutrition_source` matches a registered prefix, and each prefix is declared in `sources`. `meta.provenance` has dataset, record id and description. `locale_availability.AE` ∈ enum. ≥ 40 entries have `meta.uae_specific` with a reason. Every NUT-7 example is present or listed in `omitted` with a reason. Every `substitutes.csv` slug exists, with weight in 0–1. `cuisines.json` holds exactly the 23 DM keys. | Copy with 249 entries; copy with `AE` removed from one entry; copy with an unregistered source prefix; copy with only 39 UAE items. Each must fail. |
| G2 | For every entry: `|kcal − (4P + 4C + 9F + 2·fibre)| / kcal ≤ 0.12`, or `nutrition_confidence = low` with a non-empty `confidence_reason`. The number of failing entries is printed. | Copy where one high-confidence entry's kcal is scaled by 1.2. It must fail. |
| G3 | `methods` = the 23 DM keys, each with label and description. There is one yield row for every pair in the coverage set (all 506 minus the reasoned exclusions, plus every pair used by `data/seed-dishes/**` when that exists). Each row has `meta.source`, `meta.confidence` ∈ enum and numeric bounds (0 < Y ≤ 4, 0 ≤ R ≤ 1, 0 ≤ A ≤ 40). Any coating slug exists in the catalogue. The five NUT-3 indicative pairs fall inside the NUT-3 ranges (± the "~" tolerance stated in the check). | Copy with one required row deleted; copy with one row's source removed. Each must fail. |
| G4 | CSV parses. Every row has a known slug, a numeric value ≥ 0 and ≤ that entry's `fibre_g`, a registered source prefix, a method ∈ enum and a non-empty citation. The snapshot's `soluble_fibre_g` equals the CSV value for listed slugs and is `null` for all others. The counts of known and null values are printed. | Copy where an unlisted entry has `soluble_fibre_g: 0`; copy with an empty citation. Each must fail. |
| G5 | Every `dietary_flags` value ∈ the 12-flag vocabulary. The consistency rules of ADR-5 hold (category → flag, vegan ⇒ vegetarian, the exclusivity rules, and name keywords for gluten/sesame/dairy). The expansion `sesame` → entries flagged `contains_sesame` includes tahini, hummus and za'atar. | Copy with `contains_sesame` removed from hummus; copy with an unknown flag. Each must fail. |

Negative controls mutate a `structuredClone` of the parsed data. Real files are never written.
