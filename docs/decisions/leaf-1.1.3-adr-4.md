# leaf-1.1.3 ADR-4: the importer `scripts/import-fdc.ts`

Status: proposed (CP1)
Requirement: NUT-7 (importer, versioned snapshot, `nutrition_source` per entry)

## Decision
- Plain TypeScript run by Node 22 type stripping (`node scripts/import-fdc.ts`). Measured in this session: Node v22.22.2 runs an erasable-syntax `.ts` file without flags.
- Node built-ins only (`node:fs`, `node:path`, `node:crypto`, global `fetch`). No new dependency.
- The input is `data/ingredients.manifest.json` (ADR-2). The output is `data/ingredients.v<N>.json`, written deterministically: stable key order, entries sorted by slug, numbers as given by the source, and no timestamp apart from `generated_at`, which is taken from `--date`.
- **Modes.**
  - `--fdc-api` (spec default): reads `FDC_API_KEY` and fetches `POST /v1/foods` in batches of 20 `fdcIds`, taking the nutrient IDs of NUT-7.
  - `--fdc-csv <dir>...`: reads one or more FDC CSV download directories (the `food.csv` / `food_nutrient.csv` / `food_portion.csv` / `sr_legacy_food.csv` layout, common to SR Legacy, Foundation and Branded).
  - `--cofid <csv>`, `--afcd <csv>`, `--fineli <dir>`, `--sr28-food-des <FOOD_DES.txt>`: the other ADR-1 datasets, and the refuse data for `edible_portion`.
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
  - carbohydrate: `CHO` (available carbohydrate, UK) / "Available carbohydrate, without sugar alcohols" + "Total dietary fibre". This converts AFCD to the by-difference basis that FDC uses, so the NUT-4 formula means the same thing for every source; the conversion is recorded in `meta.derivations`.
  - Fibre: `AOACFIB` / "Total dietary fibre".
  - Saturated fat: `SATFOD` / "Total saturated fatty acids".
  - Sugars: `TOTSUG` / "Total sugars".
  - Sodium: `NA` / "Sodium (Na)".
  - UK `CHO` excludes fibre. For CoFID the importer stores carbs as `CHO + AOACFIB`, the same by-difference basis, and records this.

## Lint / typecheck
`eslint.config.mjs` (1.1.1) applies `projectService` to every `**/*.ts`. No tsconfig includes `scripts/`, so I expect `pnpm lint` to reject `scripts/import-fdc.ts` ("not found by the project service"). I could not confirm this locally: installing workspace dependencies was not permitted in this session. It goes to the architect as a request (a `scripts/tsconfig.json`, or `allowDefaultProject` for `scripts/*.ts`); both are outside my OWNS.
