# leaf-1.1.3 ADR-6: verify script `scripts/verify/leaf-1.1.3.mjs`

Status: accepted (CP1 APPROVED, rulings R-17 to R-19); built for CP2
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
| G1 | Snapshot parses. ≥ 250 entries, unique slugs. Every DM §3 required column is present with the right type and enum. Nutrients are finite and ≥ 0, with P + C + F ≤ 100.5 g. `sat_fat_g ≤ fat_g + 0.01` (per-nutrient rounding in SR), `soluble ≤ fibre`. Sugar above available carbohydrate is reported, not asserted, because SR analyses sugars and carbohydrate separately. Label and proxy rules follow CP1 amendment 6. `nutrition_source` matches a registered prefix, and each prefix is declared in `sources`. `meta.provenance` has dataset, record id and description. `locale_availability.AE` ∈ enum. ≥ 40 entries have `meta.uae_specific` with a reason. Every NUT-7 example is present or listed in `omitted` with a reason. Every `substitutes.csv` slug exists, with weight in 0–1. `cuisines.json` holds exactly the 23 DM keys. | Copy with 249 entries; `AE` removed from one entry; an unregistered source prefix; only 39 UAE items; a NUT-7 example removed without an omission; label values marked high. |
| G2 | For every entry: `|kcal − (4P + 4C + 9F + 2·fibre)| / kcal ≤ 0.12`, or `nutrition_confidence = low` with a non-empty `confidence_reason`. The number of failing entries is printed. | One high-confidence entry's kcal scaled by 1.2; a failing entry's reason removed. |
| G3 | `methods` = the 23 DM keys, each with label and description. There is one yield row for every pair in the coverage set (all 506 minus the reasoned exclusions, plus every pair used by `data/seed-dishes/**` when that exists). Each row has `meta.source`, `meta.confidence` ∈ enum and numeric bounds (0 < Y ≤ 4, 0 ≤ R ≤ 1, 0 ≤ A ≤ 40). No coating column exists (R-12). Four NUT-3 indicative pairs fall inside their ranges. | One required row deleted; one row's source removed; grilled × poultry moved outside the range; a coating column added. |
| G4 | CSV parses. Every row has a known slug, a numeric value ≥ 0 and ≤ that entry's `fibre_g`, a registered source prefix, a method ∈ enum and a non-empty citation. The snapshot's `soluble_fibre_g` equals the CSV value for listed slugs. For all others it is `null`, or it is an R-13 zero that cites the entry's own total-fibre-0 record. The counts are printed. | An unlisted entry with fibre > 0 set to 0; an empty citation; a snapshot value that differs from the CSV. |
| G5 | Every `dietary_flags` value ∈ the 12-flag vocabulary. The consistency rules of ADR-5 hold (category → flag, vegan ⇒ vegetarian, the exclusivity rules, and name keywords for gluten/sesame/dairy). The expansion `sesame` → entries flagged `contains_sesame` includes tahini, hummus and za'atar. | `contains_sesame` removed from hummus; an unknown flag; `vegan` added to labneh. |

Negative controls mutate a `structuredClone` of the parsed data. Real files are never written.

Each control names the problem it must cause. It counts only if its mutation adds a new problem containing that text, so a problem the real data already has can never make a control pass. I found this defect in the first version: two G1 controls were "failing" on an unrelated real-data problem.

Final G3 behaviour:
- It asserts the four NUT-3 ranges it can apply (grilled × poultry, deep_fried × fish, boiled × grain, roasted × starch); breaded_fried × poultry is superseded by R-12.
- It asserts that analogy rows equal their source row and are `low`.
- It asserts that no coating column exists.

G4 accepts a 0 without a CSV row only when the entry's `fibre_g` is 0 and the derivation cites the entry's own record (R-13).
