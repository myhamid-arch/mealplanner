# leaf-1.1.3 ADR-4: the importer `scripts/import-fdc.ts`

Status: accepted (CP1 APPROVED, rulings R-17 to R-19); built for CP2
Requirement: NUT-7 (importer, versioned snapshot, `nutrition_source` per entry)

## Decision
- Plain TypeScript run by Node 22 type stripping (`node scripts/import-fdc.ts`). Measured in this session: Node v22.22.2 runs an erasable-syntax `.ts` file without flags.
- Node built-ins only (`node:fs`, `node:path`, `node:crypto`, global `fetch`). No new dependency.
- The input is `data/ingredients.manifest.json` (ADR-2). The output is `data/ingredients.v<N>.json`, written deterministically: stable key order, entries sorted by slug, numbers as given by the source, and no timestamp apart from `generated_at`, which is taken from `--date`.
- **Modes.**
  - `--fdc-api` (spec default): reads `FDC_API_KEY` and fetches `POST /v1/foods` in batches of 20 `fdcIds`, taking the nutrient IDs of NUT-7, `foodPortions` and `ndbNumber`. `--fdc-api-base` overrides the base URL.
    - FDC is unreachable here. I exercised this path against a local server that serves FDC-shaped JSON built from the same SR Legacy and extra CSVs. Its `ingredients` output was identical to the CSV mode.
    - The `yields` command reads local datasets only, because most of its pairs are CoFID and AFCD records.
  - `--sr-legacy <dir>` and `--fdc-extra <dir>` (repeatable): FDC CSV download directories (`food.csv`, `food_nutrient.csv`, plus `food_portion.csv` and `sr_legacy_food.csv` for SR Legacy). The extra directory holds the Branded rows in the same layout.
  - `--cofid-proximates <csv> --cofid-inorganics <csv>`, `--afcd <csv>`, `--off <csv>`: the other ADR-1 datasets.
  - `--sr28-food-des <FOOD_DES.txt>`: SR refuse for `edible_portion`.
  - `--soluble-fibre data/soluble-fibre.csv`: merged into `soluble_fibre_g`.
- It records the sha256 of every input file in `sources`, so a re-run on the same inputs is byte-identical.
- It fails loudly on:
  - a missing record;
  - a missing required nutrient (ADR-1);
  - an unknown category or flag;
  - a duplicate slug;
  - a soluble-fibre row whose slug is not in the manifest.
- **How v1 is built here.** It runs in `--fdc-csv` mode on the mirrored official SR Legacy CSV (ADR-1). The few Foundation/Branded records are exported from the `codejetnet/food-data` SQLite into the same FDC CSV layout (`food.csv`, `food_nutrient.csv`) by a one-off command that is recorded verbatim in the PR; the columns are reshaped, never edited. With a key and network, `--fdc-api` reproduces the FDC-sourced part of the snapshot.
- CoFID/AFCD column mapping:
  - kcal: `KCALS` / "Energy, with dietary fibre" ÷ 4.184;
  - protein: `PROT` / "Protein";
  - fat: `FAT` / "Total Fat";
  - carbohydrate: `CHO` / "Available carbohydrate, without sugar alcohols". Both are already available carbohydrate, the basis chosen in SPEC-Q-13. FDC and US-label values are converted by subtracting fibre, recorded in `meta.derivations.carbs_g`.
  - Fibre: `AOACFIB` / "Total dietary fibre".
  - Saturated fat: `SATFOD` / "Total saturated fatty acids".
  - Sugars: `TOTSUG` / "Total sugars".
  - Sodium: `NA` / "Sodium (Na)".
  - AFCD energy is converted from kJ at 4.184. AFCD saturated fatty acids (% of fatty acids) become grams as an upper bound (ADR-1).

## Lint / typecheck
`scripts/tsconfig.json` (R-18) covers the importer. `pnpm lint`, `pnpm format:check` and `tsc -p scripts` pass (output in the PR).

## Commands
- `node scripts/import-fdc.ts ingredients --manifest data/ingredients.manifest.json …`
- `node scripts/import-fdc.ts yields --manifest data/method-yields.manifest.json …`

The full invocation with this session's input paths is in the PR. Running it twice gives byte-identical output (sha256 checked).
