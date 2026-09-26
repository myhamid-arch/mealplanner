// Catalogue importer (NUT-7, leaf 1.1.3 ADR-1, ADR-2, ADR-4).
//
//   node scripts/import-fdc.ts ingredients [dataset options] --out data/ingredients.v1.json
//   node scripts/import-fdc.ts yields [dataset options] --out data/method-yields.v1.json
//
// Nutrient values are never typed by hand: every number comes from the cited dataset record,
// read either from local copies of the datasets or, for FDC records, from the FDC API
// (`--fdc-api`, needs FDC_API_KEY). The output is deterministic for the same inputs.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------------------------
// Vocabularies (02-domain-model §3)

const CATEGORIES = [
  "poultry",
  "red_meat",
  "fish",
  "seafood",
  "egg",
  "dairy",
  "plant_protein",
  "grain",
  "starch",
  "legume",
  "vegetable",
  "leafy_green",
  "fruit",
  "nut_seed",
  "oil_fat",
  "sauce_condiment",
  "herb_spice",
  "sweetener",
  "bakery",
  "beverage",
  "supplement",
  "other",
] as const;

const DIETARY_FLAGS = [
  "contains_nuts",
  "contains_gluten",
  "contains_dairy",
  "contains_egg",
  "contains_fish",
  "contains_shellfish",
  "contains_soy",
  "contains_sesame",
  "contains_pork",
  "contains_alcohol",
  "vegan",
  "vegetarian",
] as const;

const AVAILABILITY = ["common", "available", "rare"] as const;

const METHODS = [
  "raw",
  "boiled",
  "steamed",
  "poached",
  "grilled",
  "broiled",
  "roasted",
  "baked",
  "air_fried",
  "pan_seared",
  "sauteed",
  "stir_fried",
  "shallow_fried",
  "deep_fried",
  "breaded_baked",
  "breaded_fried",
  "braised",
  "stewed",
  "slow_cooked",
  "pressure_cooked",
  "smoked",
  "blended",
  "marinated_raw",
] as const;

/** NUT-7 FDC nutrient ids. */
const FDC = {
  kcal: "1008",
  protein: "1003",
  carbs: "1005",
  fat: "1004",
  satFat: "1258",
  fibre: "1079",
  solubleFibre: "1082",
  sugar: "2000",
  sodium: "1093",
} as const;

/** NUT-4 relative tolerance, as in @mealplanner/core/nutrition atwaterCheck. */
const ATWATER_TOLERANCE_PCT = 12;

/** Millilitres per household measure (US customary, as used by SR Legacy portions). */
const ML_PER_MEASURE: Record<string, number> = {
  cup: 236.588,
  tbsp: 14.787,
  tablespoon: 14.787,
  tsp: 4.929,
  teaspoon: 4.929,
  "fl oz": 29.574,
};

type Dataset = "sr_legacy" | "fdc_foundation" | "fdc_branded" | "cofid_2019" | "afcd_r1" | "off";

const DATASET_INFO: Record<
  Dataset,
  { prefix: string; name: string; release: string; licence: string; confidence: Confidence }
> = {
  sr_legacy: {
    prefix: "usda_fdc",
    name: "USDA FoodData Central, SR Legacy",
    release: "April 2018 data, FDC CSV release 2019-04-02",
    licence: "Public domain (USDA)",
    confidence: "high",
  },
  fdc_foundation: {
    prefix: "usda_fdc",
    name: "USDA FoodData Central, Foundation Foods",
    release: "as published in FDC",
    licence: "Public domain (USDA)",
    confidence: "high",
  },
  fdc_branded: {
    prefix: "usda_fdc",
    name: "USDA FoodData Central, Branded Foods",
    release: "as published in FDC",
    licence: "Public domain (USDA)",
    confidence: "low",
  },
  cofid_2019: {
    prefix: "cofid",
    name: "McCance and Widdowson's Composition of Foods Integrated Dataset (CoFID)",
    release: "2019",
    licence: "Open Government Licence v3.0 (Public Health England)",
    confidence: "high",
  },
  afcd_r1: {
    prefix: "afcd",
    name: "Australian Food Composition Database (AFCD, FSANZ)",
    release: "Release 1",
    licence: "CC BY 4.0 (Food Standards Australia New Zealand)",
    confidence: "high",
  },
  off: {
    prefix: "off",
    name: "Open Food Facts",
    release: "product records as retrieved",
    licence: "ODbL 1.0 (database), DbCL 1.0 (contents)",
    confidence: "low",
  },
};

type Confidence = "high" | "medium" | "low";

// ---------------------------------------------------------------------------------------------
// Small utilities

function fail(message: string): never {
  throw new Error(message);
}

/** numeric(10,3) in the database (02-domain-model): values are stored to three decimals. */
function round3(x: number): number {
  const r = Math.round(x * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF). */
function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsvObjects(path: string, encoding: BufferEncoding = "utf8"): Record<string, string>[] {
  const [header, ...rows] = parseCsv(readFileSync(path, encoding));
  if (header === undefined) fail(`${path}: empty CSV`);
  return rows
    .filter((r) => r.length > 1 || (r[0] ?? "") !== "")
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** A reported number, or null for "not reported". "Tr" (trace) counts as 0; "N" and "" are missing. */
function reported(value: string | undefined): number | null {
  const v = (value ?? "").trim();
  if (v === "" || v === "N" || v === "NA") return null;
  if (v === "Tr" || v === "tr") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`not a number: "${v}"`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// Dataset records, normalised

/** One source record's values per 100 g, before the catalogue's derivations. */
type SourceRecord = {
  description: string;
  kcal: number | null;
  protein: number | null;
  /** Carbohydrate as the source reports it. */
  carbs: number | null;
  /** `by_difference` includes dietary fibre (FDC 1005, US labels); `available` excludes it. */
  carbsBasis: "by_difference" | "available";
  fat: number | null;
  satFat: number | null;
  fibre: number | null;
  sugar: number | null;
  sodiumMg: number | null;
  derivations: Record<string, string>;
  /** SR Legacy food_portion rows: modifier text → grams per 1 unit. */
  portions: Map<string, number>;
  ndb: string | null;
  /** Food-specific energy factors (kcal/g) published by the source (R-22), else null. */
  atwaterFactors: AtwaterFactors | null;
};

type AtwaterFactors = { protein: number; fat: number; carbohydrate: number; source: string };

type Inputs = {
  files: Record<string, string>;
  records: Map<string, SourceRecord>;
};

function key(dataset: Dataset, id: string): string {
  return `${dataset}:${id}`;
}

/** FDC CSV download layout (food.csv, food_nutrient.csv, optional food_portion.csv, sr_legacy_food.csv). */
function readFdcCsv(dir: string, dataset: Dataset, inputs: Inputs): void {
  const food = readCsvObjects(join(dir, "food.csv"));
  const nutrients = new Map<string, Map<string, number>>();
  for (const r of readCsvObjects(join(dir, "food_nutrient.csv"))) {
    const id = r["fdc_id"] ?? "";
    let m = nutrients.get(id);
    if (m === undefined) nutrients.set(id, (m = new Map<string, number>()));
    m.set(r["nutrient_id"] ?? "", Number(r["amount"]));
  }
  const portions = new Map<string, Map<string, number>>();
  const ndb = new Map<string, string>();
  const factors = new Map<string, AtwaterFactors>();
  inputs.files[`${dataset}/food.csv`] = join(dir, "food.csv");
  inputs.files[`${dataset}/food_nutrient.csv`] = join(dir, "food_nutrient.csv");
  if (dataset === "sr_legacy") {
    inputs.files[`${dataset}/food_portion.csv`] = join(dir, "food_portion.csv");
    inputs.files[`${dataset}/sr_legacy_food.csv`] = join(dir, "sr_legacy_food.csv");
    for (const r of readCsvObjects(join(dir, "food_portion.csv"))) {
      const id = r["fdc_id"] ?? "";
      let m = portions.get(id);
      if (m === undefined) portions.set(id, (m = new Map<string, number>()));
      const amount = Number(r["amount"]);
      const grams = Number(r["gram_weight"]);
      if (amount > 0 && grams > 0) m.set((r["modifier"] ?? "").trim(), grams / amount);
    }
    for (const r of readCsvObjects(join(dir, "sr_legacy_food.csv")))
      ndb.set(r["fdc_id"] ?? "", r["NDB_number"] ?? "");
    // R-22: food_nutrient_conversion_factor (id → fdc_id) joined to its calorie factors.
    inputs.files[`${dataset}/food_nutrient_conversion_factor.csv`] = join(
      dir,
      "food_nutrient_conversion_factor.csv",
    );
    inputs.files[`${dataset}/food_calorie_conversion_factor.csv`] = join(
      dir,
      "food_calorie_conversion_factor.csv",
    );
    const factorFood = new Map<string, string>();
    for (const r of readCsvObjects(join(dir, "food_nutrient_conversion_factor.csv")))
      factorFood.set(r["id"] ?? "", r["fdc_id"] ?? "");
    for (const r of readCsvObjects(join(dir, "food_calorie_conversion_factor.csv"))) {
      const fid = factorFood.get(r["food_nutrient_conversion_factor_id"] ?? "");
      const protein = reported(r["protein_value"]);
      const fat = reported(r["fat_value"]);
      const carbohydrate = reported(r["carbohydrate_value"]);
      if (fid === undefined || protein === null || fat === null || carbohydrate === null) continue;
      factors.set(fid, {
        protein,
        fat,
        carbohydrate,
        source: `SR Legacy food_calorie_conversion_factor (conversion factor id ${r["food_nutrient_conversion_factor_id"] ?? ""}, fdc_id ${fid})`,
      });
    }
  }
  for (const f of food) {
    const id = f["fdc_id"] ?? "";
    const n = nutrients.get(id) ?? new Map<string, number>();
    const g = (nid: string): number | null => n.get(nid) ?? null;
    inputs.records.set(key(dataset, id), {
      description: f["description"] ?? "",
      kcal: g(FDC.kcal),
      protein: g(FDC.protein),
      carbs: g(FDC.carbs),
      carbsBasis: "by_difference",
      fat: g(FDC.fat),
      satFat: g(FDC.satFat),
      fibre: g(FDC.fibre),
      sugar: g(FDC.sugar),
      sodiumMg: g(FDC.sodium),
      derivations: {},
      portions: portions.get(id) ?? new Map<string, number>(),
      ndb: ndb.get(id) ?? null,
      atwaterFactors: factors.get(id) ?? null,
    });
  }
}

/** FDC API (`POST /v1/foods`), for the FDC-sourced records of the manifest. */
async function readFdcApi(
  base: string,
  ids: { dataset: Dataset; id: string }[],
  inputs: Inputs,
): Promise<void> {
  const apiKey = process.env["FDC_API_KEY"] ?? fail("--fdc-api needs FDC_API_KEY");
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const res = await fetch(`${base}/foods?api_key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fdcIds: batch.map((b) => Number(b.id)), format: "full" }),
    });
    if (!res.ok) fail(`FDC API: HTTP ${String(res.status)}`);
    const foods = (await res.json()) as FdcApiFood[];
    for (const food of foods) {
      const entry = batch.find((b) => b.id === String(food.fdcId));
      if (entry === undefined) continue;
      const n = new Map<string, number>();
      for (const fn of food.foodNutrients ?? []) {
        if (fn.nutrient?.id !== undefined && typeof fn.amount === "number")
          n.set(String(fn.nutrient.id), fn.amount);
      }
      const portions = new Map<string, number>();
      for (const p of food.foodPortions ?? []) {
        if ((p.amount ?? 0) > 0 && (p.gramWeight ?? 0) > 0)
          portions.set((p.modifier ?? "").trim(), (p.gramWeight ?? 0) / (p.amount ?? 1));
      }
      const g = (nid: string): number | null => n.get(nid) ?? null;
      const cal = (food.nutrientConversionFactors ?? []).find(
        (f) => f.type === ".CalorieConversionFactor",
      );
      const atwaterFactors: AtwaterFactors | null =
        cal?.proteinValue !== undefined &&
        cal.fatValue !== undefined &&
        cal.carbohydrateValue !== undefined
          ? {
              protein: cal.proteinValue,
              fat: cal.fatValue,
              carbohydrate: cal.carbohydrateValue,
              source: `FDC API nutrientConversionFactors (.CalorieConversionFactor), fdc_id ${entry.id}`,
            }
          : null;
      inputs.records.set(key(entry.dataset, entry.id), {
        description: food.description ?? "",
        kcal: g(FDC.kcal),
        protein: g(FDC.protein),
        carbs: g(FDC.carbs),
        carbsBasis: "by_difference",
        fat: g(FDC.fat),
        satFat: g(FDC.satFat),
        fibre: g(FDC.fibre),
        sugar: g(FDC.sugar),
        sodiumMg: g(FDC.sodium),
        derivations: {},
        portions,
        ndb: food.ndbNumber === undefined ? null : String(food.ndbNumber),
        atwaterFactors,
      });
    }
  }
}

type FdcApiFood = {
  fdcId: number;
  description?: string;
  ndbNumber?: number | string;
  foodNutrients?: { amount?: number; nutrient?: { id?: number } }[];
  foodPortions?: { amount?: number; gramWeight?: number; modifier?: string }[];
  nutrientConversionFactors?: {
    type?: string;
    proteinValue?: number;
    fatValue?: number;
    carbohydrateValue?: number;
  }[];
};

/** CoFID 2019 sheets "1.3 Proximates" and "1.4 Inorganics", saved as CSV (three header rows). */
function readCofid(proximatesPath: string, inorganicsPath: string, inputs: Inputs): void {
  inputs.files["cofid_2019/proximates.csv"] = proximatesPath;
  inputs.files["cofid_2019/inorganics.csv"] = inorganicsPath;
  const sheet = (path: string): { codes: string[]; rows: string[][] } => {
    const rows = parseCsv(readFileSync(path, "utf8"));
    const codes = rows[1] ?? fail(`${path}: missing component-code header row`);
    return { codes, rows: rows.slice(3) };
  };
  const inorganic = sheet(inorganicsPath);
  const naCol = inorganic.codes.indexOf("NA");
  if (naCol < 0) fail("CoFID inorganics: no NA column");
  const sodium = new Map<string, string>();
  for (const r of inorganic.rows) sodium.set(r[0] ?? "", r[naCol] ?? "");
  const prox = sheet(proximatesPath);
  const col = (code: string): number =>
    prox.codes.indexOf(code) >= 0 ? prox.codes.indexOf(code) : fail(`CoFID: no ${code} column`);
  const c = {
    kcal: col("KCALS"),
    protein: col("PROT"),
    carbs: col("CHO"),
    fat: col("FAT"),
    satFat: col("SATFOD"),
    fibre: col("AOACFIB"),
    nsp: col("ENGFIB"),
    sugar: col("TOTSUG"),
  };
  for (const r of prox.rows) {
    const code = r[0] ?? "";
    if (code === "") continue;
    const derivations: Record<string, string> = {};
    let fibre = reported(r[c.fibre]);
    const carbs = reported(r[c.carbs]);
    if (fibre === null && carbs === 0 && reported(r[c.nsp]) === 0) {
      // AOAC fibre = non-starch polysaccharide + resistant starch + lignin. With no
      // carbohydrate and no NSP reported by the same record, AOAC fibre is 0 as well.
      fibre = 0;
      derivations["fibre_g"] =
        "0: CoFID reports no AOAC fibre value, but carbohydrate 0 and non-starch polysaccharide 0";
    }
    inputs.records.set(key("cofid_2019", code), {
      description: r[1] ?? "",
      kcal: reported(r[c.kcal]),
      protein: reported(r[c.protein]),
      carbs,
      carbsBasis: "available",
      fat: reported(r[c.fat]),
      satFat: reported(r[c.satFat]),
      fibre,
      sugar: reported(r[c.sugar]),
      sodiumMg: reported(sodium.get(code)),
      derivations,
      portions: new Map(),
      ndb: null,
      atwaterFactors: null,
    });
  }
}

/** AFCD Release 1 "All solids & liquids per 100g", as CSV. */
function readAfcd(path: string, inputs: Inputs): void {
  inputs.files["afcd_r1/nutrients.csv"] = path;
  for (const r of readCsvObjects(path, "latin1")) {
    // The row after the header gives units; food rows have keys like F002206.
    if (!/^F\d+$/.test(r["Public Food Key"] ?? "")) continue;
    const energyKj = reported(r["Energy, with dietary fibre"]);
    const fat = reported(r["Total Fat"]);
    const satPct = reported(r["Total saturated fatty acids"]);
    const derivations: Record<string, string> = {
      kcal: "AFCD 'Energy, with dietary fibre' (kJ) / 4.184",
    };
    let satFat: number | null = null;
    if (fat !== null && satPct !== null) {
      satFat = (satPct / 100) * fat;
      derivations["sat_fat_g"] =
        "AFCD reports saturated fatty acids as % of total fatty acids: " +
        `${String(satPct)} % x total fat ${String(fat)} g. Fatty acids are a fraction of total ` +
        "lipid, so this is an upper bound.";
    }
    inputs.records.set(key("afcd_r1", r["Public Food Key"] ?? ""), {
      description: r["Food Name"] ?? "",
      kcal: energyKj === null ? null : energyKj / 4.184,
      protein: reported(r["Protein"]),
      carbs: reported(r["Available carbohydrate, without sugar alcohols"]),
      carbsBasis: "available",
      fat,
      satFat,
      fibre: reported(r["Total dietary fibre"]),
      sugar: reported(r["Total sugars"]),
      sodiumMg: reported(r["Sodium (Na)"]),
      derivations,
      portions: new Map(),
      ndb: null,
      atwaterFactors: null,
    });
  }
}

/** Open Food Facts product rows (per 100 g, label values). US labels: carbohydrate includes fibre. */
function readOff(path: string, inputs: Inputs): void {
  inputs.files["off/products.csv"] = path;
  for (const r of readCsvObjects(path)) {
    inputs.records.set(key("off", r["code"] ?? ""), {
      description: [r["product_name"], r["brands"]].filter((s) => (s ?? "") !== "").join(" / "),
      kcal: reported(r["energy_kcal_100g"]),
      protein: reported(r["proteins_100g"]),
      carbs: reported(r["carbohydrates_100g"]),
      carbsBasis: "by_difference",
      fat: reported(r["fat_100g"]),
      satFat: reported(r["saturated_fat_100g"]),
      fibre: reported(r["fiber_100g"]),
      sugar: reported(r["sugars_100g"]),
      sodiumMg: reported(r["sodium_mg_100g"]),
      derivations: {},
      portions: new Map(),
      ndb: null,
      atwaterFactors: null,
    });
  }
}

/** SR28 FOOD_DES.txt (caret-delimited, tilde-quoted): NDB number → refuse % and description. */
function readRefuse(path: string, inputs: Inputs): Map<string, { refuse: number; desc: string }> {
  inputs.files["sr28/FOOD_DES.txt"] = path;
  const out = new Map<string, { refuse: number; desc: string }>();
  for (const line of readFileSync(path, "latin1").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = line.split("^").map((s) => s.replace(/^~|~$/g, ""));
    const ndb = String(Number(f[0]));
    const refuse = f[8] === undefined || f[8] === "" ? 0 : Number(f[8]);
    out.set(ndb, { refuse, desc: f[7] ?? "" });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Manifest

type ManifestIngredient = {
  slug: string;
  name: string;
  aliases: string[];
  category: string;
  dietary_flags: string[];
  locale_availability: { AE: string };
  source: {
    dataset: Dataset;
    record_id: string;
    record_description?: string;
    retrieved_via?: string;
    retrieved_on?: string;
  };
  proxy_note?: string;
  uae_specific_reason?: string;
  atwater_reason?: string;
  unit?: { label: string; portion: string };
  density_portion?: string;
  edible_portion?: { value: number; basis: string };
};

type Manifest = {
  manifest_version: number;
  carbs_basis: "available" | "by_difference";
  ingredients: ManifestIngredient[];
  omitted: { name: string; nut7_example: boolean; reason: string }[];
};

type SolubleRow = { value: number; source: string; method: string; citation: string };

function readSoluble(path: string): Map<string, SolubleRow> {
  const out = new Map<string, SolubleRow>();
  for (const r of readCsvObjects(path)) {
    const slug = r["ingredient_slug"] ?? "";
    if (out.has(slug)) fail(`soluble-fibre.csv: duplicate row for ${slug}`);
    const value = Number(r["soluble_fibre_g_per_100g"]);
    if (!Number.isFinite(value) || value < 0) fail(`soluble-fibre.csv: bad value for ${slug}`);
    out.set(slug, {
      value,
      source: r["source"] ?? "",
      method: r["method"] ?? "",
      citation: r["citation"] ?? "",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ingredient snapshot

function atwaterDeltaPct(n: {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}): number {
  const predicted = 4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g + 2 * n.fibre_g;
  if (n.kcal === 0) return predicted === 0 ? 0 : Infinity;
  return (Math.abs(n.kcal - predicted) / n.kcal) * 100;
}

/** NUT-4 with food-specific factors (R-22): carbohydrate by difference, no fibre term. */
function specificDeltaPct(
  n: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number },
  f: AtwaterFactors,
): number {
  const predicted =
    f.protein * n.protein_g + f.fat * n.fat_g + f.carbohydrate * (n.carbs_g + n.fibre_g);
  if (n.kcal === 0) return predicted === 0 ? 0 : Infinity;
  return (Math.abs(n.kcal - predicted) / n.kcal) * 100;
}

function buildIngredient(
  m: ManifestIngredient,
  rec: SourceRecord,
  carbsBasis: Manifest["carbs_basis"],
  refuse: Map<string, { refuse: number; desc: string }>,
  soluble: Map<string, SolubleRow>,
): Record<string, unknown> {
  const where = `${m.slug} (${m.source.dataset}:${m.source.record_id})`;
  if (!(CATEGORIES as readonly string[]).includes(m.category))
    fail(`${where}: unknown category ${m.category}`);
  for (const f of m.dietary_flags)
    if (!(DIETARY_FLAGS as readonly string[]).includes(f)) fail(`${where}: unknown flag ${f}`);
  if (!(AVAILABILITY as readonly string[]).includes(m.locale_availability.AE))
    fail(`${where}: unknown AE availability ${m.locale_availability.AE}`);
  if (m.source.record_description !== undefined && m.source.record_description !== rec.description)
    fail(`${where}: record description "${rec.description}" does not match the manifest`);

  const need = (v: number | null, what: string): number =>
    v ?? fail(`${where}: the source record does not report ${what}`);
  const derivations: Record<string, string> = { ...rec.derivations };
  const kcal = need(rec.kcal, "energy");
  const protein = need(rec.protein, "protein");
  const fat = need(rec.fat, "fat");
  const satFat = need(rec.satFat, "saturated fat");
  const fibre = need(rec.fibre, "total dietary fibre");
  let carbs = need(rec.carbs, "carbohydrate");
  // R-20: fibre above carbohydrate-by-difference is clamped; such an entry is low confidence.
  let clamped = false;
  if (carbsBasis === "available" && rec.carbsBasis === "by_difference") {
    clamped = carbs - fibre < 0;
    const available = Math.max(0, carbs - fibre);
    derivations["carbs_g"] =
      `available carbohydrate = carbohydrate by difference ${String(round3(carbs))} - total ` +
      `dietary fibre ${String(round3(fibre))}` +
      (carbs - fibre < 0 ? " (negative difference clamped to 0)" : "");
    carbs = available;
  } else if (carbsBasis === "by_difference" && rec.carbsBasis === "available") {
    derivations["carbs_g"] =
      `carbohydrate by difference = available carbohydrate ${String(round3(carbs))} + total ` +
      `dietary fibre ${String(round3(fibre))}`;
    carbs = carbs + fibre;
  }

  // R-13: known zeros are filled, each with the citation of the record that makes them zero.
  let sugar = rec.sugar;
  if (sugar === null && round3(carbs) === 0) {
    sugar = 0;
    derivations["sugar_g"] =
      `0 because carbohydrate is 0 in ${m.source.dataset}:${m.source.record_id} (R-13)`;
  }
  let solubleFibre: number | null = null;
  const sol = soluble.get(m.slug);
  if (sol !== undefined) {
    if (sol.value > round3(fibre) + 1e-9)
      fail(`${where}: soluble fibre ${String(sol.value)} exceeds total fibre ${String(fibre)}`);
    solubleFibre = sol.value;
    derivations["soluble_fibre_g"] = `data/soluble-fibre.csv: ${sol.source} (${sol.method})`;
  } else if (round3(fibre) === 0) {
    solubleFibre = 0;
    derivations["soluble_fibre_g"] =
      `0 because total dietary fibre is 0 in ${m.source.dataset}:${m.source.record_id} (R-13)`;
  }

  // Edible portion: an explicit manifest basis, else SR refuse, else the record is the edible form.
  let ediblePortion = 1;
  if (m.edible_portion !== undefined) {
    ediblePortion = m.edible_portion.value;
    derivations["edible_portion"] = m.edible_portion.basis;
  } else if (rec.ndb !== null && refuse.has(String(Number(rec.ndb)))) {
    const r = refuse.get(String(Number(rec.ndb))) ?? fail("unreachable");
    ediblePortion = 1 - r.refuse / 100;
    derivations["edible_portion"] =
      `1 - SR refuse ${String(r.refuse)} % (SR28 FOOD_DES, NDB ${rec.ndb}` +
      (r.desc === "" ? ")" : `: ${r.desc})`);
  } else {
    derivations["edible_portion"] =
      "1: the source reports no refuse and the record describes the food as sold, edible as is";
  }

  let unitWeight: number | null = null;
  let unitLabel: string | null = null;
  if (m.unit !== undefined) {
    unitWeight =
      rec.portions.get(m.unit.portion) ?? fail(`${where}: no portion "${m.unit.portion}"`);
    unitLabel = m.unit.label;
    derivations["unit_weight_g"] = `SR food_portion "${m.unit.portion}"`;
  }
  let density: number | null = null;
  if (m.density_portion !== undefined) {
    const grams =
      rec.portions.get(m.density_portion) ?? fail(`${where}: no portion "${m.density_portion}"`);
    const ml =
      ML_PER_MEASURE[m.density_portion] ?? fail(`${where}: "${m.density_portion}" is not a volume`);
    density = grams / ml;
    derivations["density_g_per_ml"] =
      `SR food_portion "${m.density_portion}" ${String(grams)} g / ${String(ml)} ml`;
  }

  const info = DATASET_INFO[m.source.dataset];
  let confidence: Confidence = info.confidence;
  let confidenceReason: string | null =
    confidence === "low"
      ? "label-declared values (rounded to the label's serving before conversion to 100 g)"
      : null;
  if (m.proxy_note !== undefined && confidence === "high") {
    confidence = "medium";
    confidenceReason = "proxy record; see meta.provenance.proxy_note";
  }
  if (clamped) {
    confidence = "low";
    confidenceReason = [
      confidenceReason,
      "total dietary fibre exceeds carbohydrate by difference in the source, so available " +
        "carbohydrate was clamped to 0 (R-20)",
    ]
      .filter((x) => x !== null)
      .join("; ");
  }

  const values = {
    kcal: round3(kcal),
    protein_g: round3(protein),
    carbs_g: round3(carbs),
    fat_g: round3(fat),
    fibre_g: round3(fibre),
  };
  const delta = atwaterDeltaPct(values);
  // R-22: an entry also passes with the source's own factors. USDA applies its carbohydrate
  // factor to carbohydrate by difference (available + fibre), with no separate fibre term.
  const f = rec.atwaterFactors;
  const specificDelta = f === null ? null : specificDeltaPct(values, f);
  if (
    delta > ATWATER_TOLERANCE_PCT &&
    (specificDelta === null || specificDelta > ATWATER_TOLERANCE_PCT)
  ) {
    const reason =
      m.atwater_reason ??
      fail(`${where}: fails NUT-4 (${delta.toFixed(1)} %) and the manifest gives no reason`);
    confidence = "low";
    const specific =
      specificDelta === null ? "" : ` (${specificDelta.toFixed(1)} % with its own factors)`;
    confidenceReason = [confidenceReason, `NUT-4: ${delta.toFixed(1)} % off${specific}; ${reason}`]
      .filter((s) => s !== null)
      .join("; ");
  } else if (m.atwater_reason !== undefined) {
    fail(`${where}: passes NUT-4 but the manifest gives a reason`);
  }

  return {
    slug: m.slug,
    name: m.name,
    aliases: m.aliases,
    category: m.category,
    kcal: values.kcal,
    protein_g: values.protein_g,
    carbs_g: values.carbs_g,
    fat_g: values.fat_g,
    sat_fat_g: round3(satFat),
    fibre_g: values.fibre_g,
    soluble_fibre_g: solubleFibre === null ? null : round3(solubleFibre),
    sugar_g: sugar === null ? null : round3(sugar),
    sodium_mg: rec.sodiumMg === null ? null : round3(rec.sodiumMg),
    density_g_per_ml: density === null ? null : round3(density),
    unit_weight_g: unitWeight === null ? null : round3(unitWeight),
    unit_label: unitLabel,
    edible_portion: round3(ediblePortion),
    dietary_flags: [...m.dietary_flags].sort(),
    nutrition_source: `${info.prefix}:${m.source.record_id}`,
    nutrition_confidence: confidence,
    locale_availability: { AE: m.locale_availability.AE },
    created_by_household_id: null,
    meta: {
      provenance: {
        dataset: m.source.dataset,
        record_id: m.source.record_id,
        record_description: rec.description,
        retrieved_via: m.source.retrieved_via ?? null,
        retrieved_on: m.source.retrieved_on ?? null,
        proxy_note: m.proxy_note ?? null,
      },
      confidence_reason: confidenceReason,
      atwater_delta_pct: Number.isFinite(delta) ? Number(delta.toFixed(2)) : null,
      atwater_factors: f,
      atwater_specific_delta_pct:
        specificDelta === null || !Number.isFinite(specificDelta)
          ? null
          : Number(specificDelta.toFixed(2)),
      uae_specific: m.uae_specific_reason !== undefined,
      uae_specific_reason: m.uae_specific_reason ?? null,
      availability_basis: "builder assessment of UAE retail availability (not measured)",
      derivations: Object.fromEntries(
        Object.entries(derivations).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Method yields (ADR-3)

type YieldSource =
  | { kind: "definition"; note: string }
  | { kind: "analogy"; from: [string, string]; note: string }
  | {
      kind: "pairs";
      basis: Basis;
      pairs: { raw: string; cooked: string; ref_cooked?: string }[];
      oil_absorption?: boolean;
      substrate_note?: string;
      confidence: Confidence;
      note: string;
    };

type YieldManifest = {
  manifest_version: number;
  methods: { key: string; label: string; description: string; appeal_tags: string[] }[];
  rows: { method: string; category: string; source: YieldSource }[];
  excluded: { method: string; category: string; reason: string }[];
};

type PairValue = { yield: number; fatRetention: number; oil: number; detail: string };

/**
 * protein: Y = protein raw / protein cooked (protein is retained on cooking).
 * dry_matter: Y = (100 - water raw) / (100 - water cooked), for foods that take up water.
 * fat_free_dry_matter: as dry_matter but excluding fat, for foods cooked in fat, whose dry
 * matter would otherwise include the absorbed oil.
 */
type Basis = "protein" | "dry_matter" | "fat_free_dry_matter";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Records are cited as "<dataset>:<id>"; water is needed for the dry-matter basis. */
function pairValue(
  inputs: Inputs,
  water: Map<string, number>,
  basis: Basis,
  p: { raw: string; cooked: string; ref_cooked?: string },
  oilAbsorption: boolean,
): PairValue {
  const get = (k: string): SourceRecord => inputs.records.get(k) ?? fail(`yields: no record ${k}`);
  const raw = get(p.raw);
  const cooked = get(p.cooked);
  const num = (v: number | null, what: string, k: string): number =>
    v ?? fail(`yields: ${k} does not report ${what}`);
  let y: number;
  let detail: string;
  if (basis === "protein") {
    const pr = num(raw.protein, "protein", p.raw);
    const pc = num(cooked.protein, "protein", p.cooked);
    y = pr / pc;
    detail = `Y = protein ${String(pr)} / ${String(pc)}`;
  } else {
    const wr = water.get(p.raw) ?? fail(`yields: no water for ${p.raw}`);
    const wc = water.get(p.cooked) ?? fail(`yields: no water for ${p.cooked}`);
    if (basis === "dry_matter") {
      y = (100 - wr) / (100 - wc);
      detail = `Y = dry matter (100 - ${String(wr)}) / (100 - ${String(wc)})`;
    } else {
      const fr0 = num(raw.fat, "fat", p.raw);
      const fc0 = num(cooked.fat, "fat", p.cooked);
      y = (100 - wr - fr0) / (100 - wc - fc0);
      detail = `Y = fat-free dry matter (100 - ${String(wr)} - ${String(fr0)}) / (100 - ${String(wc)} - ${String(fc0)})`;
    }
  }
  const fr = num(raw.fat, "fat", p.raw);
  const fc = num(cooked.fat, "fat", p.cooked);
  let retention = fr > 0 ? (fc * y) / fr : 1;
  let oil = 0;
  if (oilAbsorption) {
    // Fat gained beyond the substrate's own fat, retained at the reference dry-heat retention.
    // R_ref: the substrate's own fat retention under dry heat (a named reference pair), else 1.
    const refRetention =
      p.ref_cooked === undefined
        ? 1
        : pairValue(inputs, water, "protein", { raw: p.raw, cooked: p.ref_cooked }, false)
            .fatRetention;
    oil = Math.max(0, fc * y - fr * refRetention);
    detail += `; A = fat ${String(fc)} x Y - ${String(fr)} x R_ref ${refRetention.toFixed(3)}`;
    retention = refRetention;
  } else {
    detail += `; R = fat ${String(fc)} x Y / ${String(fr)}`;
  }
  return { yield: y, fatRetention: Math.min(1, retention), oil, detail };
}

function buildYields(
  ym: YieldManifest,
  inputs: Inputs,
  water: Map<string, number>,
): Record<string, unknown> {
  const methodKeys = ym.methods.map((m) => m.key);
  for (const k of METHODS) if (!methodKeys.includes(k)) fail(`yields: method ${k} missing`);
  const rows = new Map<string, Record<string, unknown>>();
  const measured = new Map<string, { y: number; r: number; a: number }>();
  const rowKey = (m: string, c: string): string => `${m}|${c}`;
  // Measured rows first, so analogies can refer to them.
  const ordered = [...ym.rows].sort((a, b) => {
    const rank = (s: YieldSource): number => (s.kind === "analogy" ? 1 : 0);
    return rank(a.source) - rank(b.source);
  });
  for (const row of ordered) {
    if (!(METHODS as readonly string[]).includes(row.method))
      fail(`yields: bad method ${row.method}`);
    if (!(CATEGORIES as readonly string[]).includes(row.category))
      fail(`yields: bad category ${row.category}`);
    const k = rowKey(row.method, row.category);
    if (rows.has(k)) fail(`yields: duplicate row ${k}`);
    const s = row.source;
    let y: number;
    let r: number;
    let a: number;
    let meta: Record<string, unknown>;
    if (s.kind === "definition") {
      y = 1;
      r = 1;
      a = 0;
      meta = { source: "definition", confidence: "high", note: s.note };
    } else if (s.kind === "analogy") {
      const from =
        measured.get(rowKey(s.from[0], s.from[1])) ??
        fail(`yields: ${k} copies missing ${s.from.join("×")}`);
      y = from.y;
      r = from.r;
      a = from.a;
      meta = { source: `analogy:${s.from[0]}×${s.from[1]}`, confidence: "low", note: s.note };
    } else {
      const values = s.pairs.map((p) =>
        pairValue(inputs, water, s.basis, p, s.oil_absorption === true),
      );
      y = median(values.map((v) => v.yield));
      r = median(values.map((v) => v.fatRetention));
      a = median(values.map((v) => v.oil));
      meta = {
        source: `paired_records:${s.pairs.map((p) => `${p.raw}→${p.cooked}`).join(",")}`,
        confidence: s.confidence,
        method: `${s.basis.replace(/_/g, " ")} mass balance`,
        note: s.note,
        substrate_note: s.substrate_note ?? null,
        pair_yield_range: [
          round3(Math.min(...values.map((v) => v.yield))),
          round3(Math.max(...values.map((v) => v.yield))),
        ],
        pairs: s.pairs.map((p, i) => ({
          raw: p.raw,
          raw_description: inputs.records.get(p.raw)?.description ?? null,
          cooked: p.cooked,
          cooked_description: inputs.records.get(p.cooked)?.description ?? null,
          yield_factor: round3(values[i]?.yield ?? 0),
          fat_retention: round3(values[i]?.fatRetention ?? 0),
          oil_absorption_g_per_100g_raw: round3(values[i]?.oil ?? 0),
          working: values[i]?.detail ?? "",
        })),
      };
    }
    y = round3(y);
    r = round3(r);
    a = round3(a);
    measured.set(k, { y, r, a });
    rows.set(k, {
      method: row.method,
      ingredient_category: row.category,
      yield_factor: y,
      fat_retention: r,
      oil_absorption_g_per_100g_raw: a,
      meta,
    });
  }
  const excluded = new Set(ym.excluded.map((e) => rowKey(e.method, e.category)));
  for (const m of METHODS)
    for (const c of CATEGORIES) {
      const k = rowKey(m, c);
      if (!rows.has(k) && !excluded.has(k)) fail(`yields: no row and no exclusion for ${k}`);
      if (rows.has(k) && excluded.has(k)) fail(`yields: ${k} is both seeded and excluded`);
    }
  const sorted = [...rows.values()].sort((p, q) => {
    const a = `${String(METHODS.indexOf(p["method"] as (typeof METHODS)[number])).padStart(2, "0")}|${String(CATEGORIES.indexOf(p["ingredient_category"] as (typeof CATEGORIES)[number])).padStart(2, "0")}`;
    const b = `${String(METHODS.indexOf(q["method"] as (typeof METHODS)[number])).padStart(2, "0")}|${String(CATEGORIES.indexOf(q["ingredient_category"] as (typeof CATEGORIES)[number])).padStart(2, "0")}`;
    return a < b ? -1 : 1;
  });
  return {
    methods: ym.methods,
    yields: sorted,
    coverage: {
      required_pairs: "all",
      excluded: ym.excluded.map((e) => ({
        method: e.method,
        ingredient_category: e.category,
        reason: e.reason,
      })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// CLI

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: "string" },
      "sr-legacy": { type: "string" },
      "fdc-extra": { type: "string", multiple: true },
      "fdc-api": { type: "boolean" },
      "fdc-api-base": { type: "string", default: "https://api.nal.usda.gov/fdc/v1" },
      "cofid-proximates": { type: "string" },
      "cofid-inorganics": { type: "string" },
      afcd: { type: "string" },
      off: { type: "string" },
      "sr28-food-des": { type: "string" },
      "soluble-fibre": { type: "string" },
      date: { type: "string" },
      out: { type: "string" },
    },
  });
  const command = positionals[0] ?? fail("usage: import-fdc.ts ingredients|yields [options]");
  const out = values.out ?? fail("--out is required");
  const date =
    values.date ?? fail("--date YYYY-MM-DD is required (keeps the output deterministic)");
  const inputs: Inputs = { files: {}, records: new Map() };
  const manifestPath = values.manifest ?? fail("--manifest is required");
  inputs.files["manifest"] = manifestPath;
  const manifestText = readFileSync(manifestPath, "utf8");

  const fdcIds: { dataset: Dataset; id: string }[] = [];
  if (command === "ingredients") {
    const manifest = JSON.parse(manifestText) as Manifest;
    for (const m of manifest.ingredients)
      if (["sr_legacy", "fdc_foundation", "fdc_branded"].includes(m.source.dataset))
        fdcIds.push({ dataset: m.source.dataset, id: m.source.record_id });
  }
  if (values["fdc-api"] === true) await readFdcApi(values["fdc-api-base"], fdcIds, inputs);
  if (values["sr-legacy"] !== undefined) readFdcCsv(values["sr-legacy"], "sr_legacy", inputs);
  for (const dir of values["fdc-extra"] ?? []) {
    const food = readCsvObjects(join(dir, "food.csv"));
    const branded = food.every((f) => f["data_type"] === "branded_food");
    readFdcCsv(dir, branded ? "fdc_branded" : "fdc_foundation", inputs);
  }
  if (values["cofid-proximates"] !== undefined)
    readCofid(
      values["cofid-proximates"],
      values["cofid-inorganics"] ?? fail("--cofid-inorganics is required with --cofid-proximates"),
      inputs,
    );
  if (values.afcd !== undefined) readAfcd(values.afcd, inputs);
  if (values.off !== undefined) readOff(values.off, inputs);

  let result: Record<string, unknown>;
  if (command === "ingredients") {
    const manifest = JSON.parse(manifestText) as Manifest;
    const refuse = readRefuse(
      values["sr28-food-des"] ?? fail("--sr28-food-des is required"),
      inputs,
    );
    const solublePath = values["soluble-fibre"] ?? fail("--soluble-fibre is required");
    inputs.files["soluble-fibre"] = solublePath;
    const soluble = readSoluble(solublePath);
    const slugs = new Set<string>();
    for (const m of manifest.ingredients) {
      if (slugs.has(m.slug)) fail(`duplicate slug ${m.slug}`);
      slugs.add(m.slug);
    }
    for (const s of soluble.keys()) if (!slugs.has(s)) fail(`soluble-fibre.csv: unknown slug ${s}`);
    // Every entry is checked before failing, so one run reports all data errors.
    const errors: string[] = [];
    const ingredients: Record<string, unknown>[] = [];
    for (const m of [...manifest.ingredients].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
      try {
        const rec =
          inputs.records.get(key(m.source.dataset, m.source.record_id)) ??
          fail(`${m.slug}: no record ${m.source.dataset}:${m.source.record_id} in the inputs`);
        ingredients.push(buildIngredient(m, rec, manifest.carbs_basis, refuse, soluble));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (errors.length > 0) fail(`${String(errors.length)} error(s):\n${errors.join("\n")}`);
    result = {
      snapshot_version: 1,
      generated_by: "scripts/import-fdc.ts",
      generated_at: date,
      carbs_basis: manifest.carbs_basis,
      sources: sourcesBlock(inputs),
      omitted: manifest.omitted,
      ingredients,
    };
  } else if (command === "yields") {
    const ym = JSON.parse(manifestText) as YieldManifest;
    // Water (FDC 1051 / CoFID WATER) is needed for the dry-matter basis.
    const water = new Map<string, number>();
    if (values["sr-legacy"] !== undefined)
      for (const r of readCsvObjects(join(values["sr-legacy"], "food_nutrient.csv")))
        if (r["nutrient_id"] === "1051")
          water.set(key("sr_legacy", r["fdc_id"] ?? ""), Number(r["amount"]));
    if (values.afcd !== undefined)
      for (const r of readCsvObjects(values.afcd, "latin1")) {
        const w = /^F\d+$/.test(r["Public Food Key"] ?? "")
          ? reported(r["Moisture (water)"])
          : null;
        if (w !== null) water.set(key("afcd_r1", r["Public Food Key"] ?? ""), w);
      }
    if (values["cofid-proximates"] !== undefined) {
      const rows = parseCsv(readFileSync(values["cofid-proximates"], "utf8"));
      const col = (rows[1] ?? []).indexOf("WATER");
      for (const r of rows.slice(3)) {
        const w = reported(r[col]);
        if (w !== null) water.set(key("cofid_2019", r[0] ?? ""), w);
      }
    }
    result = {
      snapshot_version: 1,
      generated_by: "scripts/import-fdc.ts",
      generated_at: date,
      sources: sourcesBlock(inputs),
      ...buildYields(ym, inputs, water),
    };
  } else fail(`unknown command ${command}`);
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

function sourcesBlock(inputs: Inputs): Record<string, unknown> {
  const datasets = Object.fromEntries(
    (Object.keys(DATASET_INFO) as Dataset[]).map((d) => [
      d,
      {
        nutrition_source_prefix: DATASET_INFO[d].prefix,
        name: DATASET_INFO[d].name,
        release: DATASET_INFO[d].release,
        licence: DATASET_INFO[d].licence,
        default_confidence: DATASET_INFO[d].confidence,
      },
    ]),
  );
  const files = Object.fromEntries(
    Object.entries(inputs.files)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, path]) => [name, { sha256: sha256(path) }]),
  );
  return { datasets, input_files: files };
}

await main();
