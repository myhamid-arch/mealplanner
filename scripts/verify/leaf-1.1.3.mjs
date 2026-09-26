// Verify script for leaf 1.1.3 (catalogue data). Usage: node scripts/verify/leaf-1.1.3.mjs --gate G1..G5
//
// Every gate runs its assertions on the committed data files, then runs the same assertion
// function on known-bad copies (negative controls), each of which must fail. The PASSED marker
// is printed only when every real-data assertion held and every negative control failed.
// Counts are measured from the files; the only constants are the spec's thresholds.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Report } from "./lib/report.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DATA = join(ROOT, "data");

// --- Spec encodings (02-domain-model §3, 03-nutrition-engine, 13-revision-r2), written from the spec text.

/** NUT-7: at least 250 ingredients. */
const MIN_INGREDIENTS = 250;
/** 11-build-plan §5, 1.1.3 G1: at least 40 UAE-specific items. */
const MIN_UAE_SPECIFIC = 40;
/** NUT-4: |kcal - (4P + 4C + 9F + 2 fibre)| / kcal <= 12 %. */
const ATWATER_TOLERANCE_PCT = 12;

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
];
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
];
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
];
const CUISINES = [
  "american",
  "british",
  "italian",
  "levantine",
  "emirati_gulf",
  "persian",
  "turkish",
  "indian",
  "pakistani",
  "mexican",
  "tex_mex",
  "mediterranean",
  "greek",
  "spanish",
  "french",
  "japanese",
  "chinese",
  "thai",
  "korean",
  "vietnamese",
  "north_african",
  "east_african",
  "fusion",
];
const AVAILABILITY = ["common", "available", "rare"];
const CONFIDENCE = ["high", "medium", "low"];
/** NUT-7 by name. Each must be present (by its slug) or listed in `omitted` with a reason. */
const NUT7_EXAMPLES = {
  "basmati rice": "basmati-rice",
  "Arabic bread (khubz)": "khubz",
  labneh: "labneh",
  halloumi: "halloumi",
  akkawi: "akkawi",
  laban: "laban",
  freekeh: "freekeh",
  bulgur: "bulgur",
  dates: "dates-dried",
  hammour: "hammour",
  "sherry (sheri) fish": "sheri",
  "kingfish (kanaad)": "kingfish",
  shrimp: "shrimp",
  lamb: "lamb-shoulder",
  "camel meat": "camel-meat",
  chickpeas: "chickpeas-dried",
  "fava beans (foul)": "fava-beans-dried",
  "za'atar": "zaatar",
  sumac: "sumac",
  tahini: "tahini",
  ghee: "ghee",
};
/** Registered nutrition_source prefixes (DM §3 plus R-19) and their datasets. */
const SOURCE_PREFIXES = {
  usda_fdc: ["sr_legacy", "fdc_foundation", "fdc_branded"],
  cofid: ["cofid_2019"],
  afcd: ["afcd_r1"],
  off: ["off"],
};
/** Label-value datasets (tiers 4-5): always low, with record id and retrieval date (CP1 amendment 6). */
const LABEL_DATASETS = ["fdc_branded", "off"];
/** DM §3 ingredient columns carried in the snapshot (id and timestamps are generated at load). */
const INGREDIENT_COLUMNS = [
  "slug",
  "name",
  "aliases",
  "category",
  "kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "sat_fat_g",
  "fibre_g",
  "soluble_fibre_g",
  "sugar_g",
  "sodium_mg",
  "density_g_per_ml",
  "unit_weight_g",
  "unit_label",
  "edible_portion",
  "dietary_flags",
  "nutrition_source",
  "nutrition_confidence",
  "locale_availability",
  "created_by_household_id",
];
const REQUIRED_NUMBERS = ["kcal", "protein_g", "carbs_g", "fat_g", "sat_fat_g", "fibre_g"];
const NULLABLE_NUMBERS = [
  "soluble_fibre_g",
  "sugar_g",
  "sodium_mg",
  "density_g_per_ml",
  "unit_weight_g",
];
/** DM §3 method_yield columns (R-12 removed the coating columns). */
const YIELD_COLUMNS = [
  "method",
  "ingredient_category",
  "yield_factor",
  "fat_retention",
  "oil_absorption_g_per_100g_raw",
];
/**
 * NUT-3 indicative ranges, with the "~" read as +/- 0.05 on factors and +/- 1 g on absorption.
 * breaded_fried x poultry is not checked: its range includes the coating, which R-12 excludes.
 */
const NUT3_RANGES = [
  { method: "grilled", category: "poultry", y: [0.7, 0.78], r: [0.8, 0.9], a: [0, 0] },
  { method: "deep_fried", category: "fish", y: [0.75, 0.85], r: [0.95, 1], a: [4, 9] },
  { method: "boiled", category: "grain", y: [2.4, 3.0], r: [0.95, 1], a: [0, 0] },
  { method: "roasted", category: "starch", y: [0.7, 0.8], r: [0.95, 1], a: [0, 1e9] },
];

// --- Loading

function readJson(name) {
  return JSON.parse(readFileSync(join(DATA, name), "utf8"));
}

/** RFC 4180 CSV → array of objects keyed by the header row. */
function readCsv(name) {
  const text = readFileSync(join(DATA, name), "utf8");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
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
  const [header, ...body] = rows;
  return body
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function load() {
  return {
    snapshot: readJson("ingredients.v1.json"),
    yields: readJson("method-yields.v1.json"),
    cuisines: readJson("cuisines.json"),
    soluble: readCsv("soluble-fibre.csv"),
    substitutes: readCsv("substitutes.csv"),
  };
}

// --- Assertion helpers

/** Collects problems; `check` returns problems for one data set so controls can reuse it. */
class Problems {
  constructor() {
    this.list = [];
  }
  add(condition, message) {
    if (!condition) this.list.push(message);
    return condition;
  }
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.trim() !== "";

function atwater(i) {
  const predicted = 4 * i.protein_g + 4 * i.carbs_g + 9 * i.fat_g + 2 * i.fibre_g;
  if (i.kcal === 0) return predicted === 0 ? 0 : Infinity;
  return (Math.abs(i.kcal - predicted) / i.kcal) * 100;
}

function summarise(list, max = 8) {
  const shown = list.slice(0, max).join("\n");
  return list.length > max ? `${shown}\n… and ${String(list.length - max)} more` : shown;
}

/** Runs the real-data check, then every negative control, and reports both. */
function runGate(label, data, check, controls, stats) {
  const report = new Report(`leaf-1.1.3 ${label}`);
  const real = check(data);
  if (stats) for (const line of stats(data)) console.log(`info - ${line}`);
  report.check(real.length === 0, `real data: ${label} assertions hold`, summarise(real));
  // A control counts only if its own mutation adds a problem matching `expect`; a problem the
  // real data already had cannot make a control pass.
  const already = new Set(real);
  for (const [name, mutate, expect] of controls) {
    const bad = structuredClone(data);
    mutate(bad);
    const added = check(bad).filter((x) => !already.has(x) && x.includes(expect));
    report.check(
      added.length > 0,
      `negative control fails as it must: ${name}${added.length > 0 ? ` (${added[0]})` : ""}`,
    );
  }
  return report.finish();
}

const bySlug = (data, slug) => data.snapshot.ingredients.find((i) => i.slug === slug);

// --- G1: >= 250 ingredients, required fields, source, AE availability, >= 40 UAE-specific (NUT-7)

function checkG1(data) {
  const p = new Problems();
  const { snapshot, cuisines, substitutes } = data;
  const ings = snapshot.ingredients;
  p.add(Array.isArray(ings), "snapshot.ingredients is an array");
  if (!Array.isArray(ings)) return p.list;
  p.add(
    ings.length >= MIN_INGREDIENTS,
    `NUT-7: ${String(ings.length)} ingredients < ${String(MIN_INGREDIENTS)}`,
  );
  const datasets = snapshot.sources?.datasets ?? {};
  const slugs = new Set();
  for (const i of ings) {
    const at = `ingredient ${String(i.slug)}`;
    p.add(isStr(i.slug) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(i.slug), `${at}: slug is kebab-case`);
    p.add(!slugs.has(i.slug), `${at}: duplicate slug`);
    slugs.add(i.slug);
    for (const col of INGREDIENT_COLUMNS) p.add(col in i, `${at}: missing column ${col}`);
    p.add(isStr(i.name), `${at}: name`);
    p.add(Array.isArray(i.aliases) && i.aliases.every(isStr), `${at}: aliases is text[]`);
    p.add(CATEGORIES.includes(i.category), `${at}: category ${String(i.category)}`);
    for (const col of REQUIRED_NUMBERS)
      p.add(isNum(i[col]) && i[col] >= 0, `${at}: ${col} is a number >= 0`);
    for (const col of NULLABLE_NUMBERS)
      p.add(i[col] === null || (isNum(i[col]) && i[col] >= 0), `${at}: ${col} is null or >= 0`);
    p.add(
      isNum(i.edible_portion) && i.edible_portion > 0 && i.edible_portion <= 1,
      `${at}: edible_portion in (0, 1]`,
    );
    p.add(
      i.protein_g + i.carbs_g + i.fat_g + i.fibre_g <= 100.5,
      `${at}: protein + carbs + fat + fibre exceed 100 g`,
    );
    // 0.01 g: sources round each nutrient separately (SR brewed tea: fat 0, saturated fat 0.002).
    p.add(i.sat_fat_g <= i.fat_g + 0.01, `${at}: sat_fat_g > fat_g`);
    p.add(
      i.soluble_fibre_g === null || i.soluble_fibre_g <= i.fibre_g + 1e-9,
      `${at}: soluble_fibre_g > fibre_g`,
    );
    p.add(
      (i.unit_weight_g === null) === (i.unit_label === null),
      `${at}: unit_weight_g and unit_label go together`,
    );
    p.add(i.created_by_household_id === null, `${at}: catalogue entries are global`);
    p.add(Array.isArray(i.dietary_flags), `${at}: dietary_flags is text[]`);
    // Source
    const m = /^([a-z_]+):(\S+)$/.exec(String(i.nutrition_source));
    const prov = i.meta?.provenance ?? {};
    p.add(m !== null && m[1] in SOURCE_PREFIXES, `${at}: nutrition_source prefix not registered`);
    if (m !== null && m[1] in SOURCE_PREFIXES) {
      p.add(SOURCE_PREFIXES[m[1]].includes(prov.dataset), `${at}: prefix does not match dataset`);
      p.add(m[2] === prov.record_id, `${at}: nutrition_source id differs from provenance`);
      p.add(
        prov.dataset in datasets,
        `${at}: dataset ${String(prov.dataset)} not declared in sources`,
      );
    }
    p.add(isStr(prov.record_id) && isStr(prov.record_description), `${at}: provenance record`);
    p.add(CONFIDENCE.includes(i.nutrition_confidence), `${at}: nutrition_confidence`);
    if (LABEL_DATASETS.includes(prov.dataset)) {
      p.add(i.nutrition_confidence === "low", `${at}: label values must be low confidence`);
      p.add(
        isStr(prov.retrieved_on) && /^\d{4}-\d{2}-\d{2}$/.test(prov.retrieved_on),
        `${at}: label values need a retrieval date`,
      );
    }
    if (isStr(prov.proxy_note)) {
      p.add(i.nutrition_confidence !== "high", `${at}: a proxy is at most medium confidence`);
      p.add(prov.proxy_note.includes(prov.record_id), `${at}: proxy note must name the record`);
    }
    if (i.nutrition_confidence !== "high")
      p.add(isStr(i.meta?.confidence_reason), `${at}: ${i.nutrition_confidence} needs a reason`);
    p.add(AVAILABILITY.includes(i.locale_availability?.AE), `${at}: locale_availability.AE`);
    if (i.meta?.uae_specific === true)
      p.add(isStr(i.meta.uae_specific_reason), `${at}: UAE-specific item needs a reason`);
  }
  const uae = ings.filter((i) => i.meta?.uae_specific === true && i.locale_availability?.AE);
  p.add(
    uae.length >= MIN_UAE_SPECIFIC,
    `G1: ${String(uae.length)} UAE-specific items < ${String(MIN_UAE_SPECIFIC)}`,
  );
  const omitted = snapshot.omitted ?? [];
  for (const [example, slug] of Object.entries(NUT7_EXAMPLES)) {
    const present = slugs.has(slug);
    const omit = omitted.find((o) => o.name.toLowerCase() === example.toLowerCase());
    p.add(
      present || (omit !== undefined && isStr(omit.reason)),
      `NUT-7 example "${example}" is neither present nor omitted with a reason`,
    );
    if (present)
      p.add(
        bySlugIn(ings, slug).meta?.uae_specific === true,
        `NUT-7 example ${slug} not UAE-flagged`,
      );
  }
  for (const o of omitted) p.add(!slugs.has(slugify(o.name)), `omitted item ${o.name} is present`);
  // Cuisines (DM §3)
  const keys = cuisines.map((c) => c.key);
  p.add(
    keys.length === CUISINES.length && CUISINES.every((k) => keys.includes(k)),
    "cuisines.json holds exactly the 23 DM §3 keys",
  );
  for (const c of cuisines)
    p.add(isStr(c.label) && "flag_emoji" in c && "parent_key" in c, `cuisine ${String(c.key)}`);
  // Substitutes (KG SUBSTITUTES_FOR seed)
  for (const s of substitutes) {
    const w = Number(s.weight);
    p.add(
      slugs.has(s.from_slug) && slugs.has(s.to_slug),
      `substitute ${s.from_slug}→${s.to_slug}: unknown slug`,
    );
    p.add(s.from_slug !== s.to_slug, `substitute ${s.from_slug}: self-substitution`);
    p.add(Number.isFinite(w) && w > 0 && w <= 1, `substitute ${s.from_slug}→${s.to_slug}: weight`);
  }
  return p.list;
}

function bySlugIn(ings, slug) {
  return ings.find((i) => i.slug === slug) ?? {};
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function statsG1(data) {
  const ings = data.snapshot.ingredients;
  const count = (f) => ings.filter(f).length;
  const conf = CONFIDENCE.map((c) => `${c} ${String(count((i) => i.nutrition_confidence === c))}`);
  const sugarOver = count((i) => i.sugar_g !== null && i.sugar_g > i.carbs_g + 1e-9);
  return [
    `ingredients: ${String(ings.length)} (NUT-7 needs >= ${String(MIN_INGREDIENTS)})`,
    `UAE-specific: ${String(count((i) => i.meta?.uae_specific === true))} (needs >= ${String(MIN_UAE_SPECIFIC)})`,
    `confidence: ${conf.join(", ")}`,
    `omitted: ${(data.snapshot.omitted ?? []).map((o) => o.name).join(", ") || "none"}`,
    `sugar above available carbohydrate (source values, not asserted): ${String(sugarOver)}`,
    `cuisines: ${String(data.cuisines.length)}; substitutes: ${String(data.substitutes.length)}`,
  ];
}

// --- G2: every ingredient passes NUT-4 or is low confidence with a reason

/** R-20: the committed snapshot uses available carbohydrate (FDC 1005 - 1079). */
const CARBS_BASIS = "available";

/**
 * In-memory regeneration of the snapshot on the other basis (carbohydrate by difference =
 * available + fibre). A clamped entry takes its reported by-difference value from its derivation.
 */
function regenerateByDifference(d) {
  d.snapshot.carbs_basis = "by_difference";
  for (const i of d.snapshot.ingredients) {
    const clamped = String(i.meta?.derivations?.carbs_g).includes("clamped");
    const m = /by difference ([\d.]+)/.exec(i.meta?.derivations?.carbs_g ?? "");
    i.carbs_g = clamped && m !== null ? Number(m[1]) : i.carbs_g + i.fibre_g;
  }
}

function nut4Failures(ings) {
  return ings.filter((i) => atwater(i) > ATWATER_TOLERANCE_PCT).length;
}

function checkG2(data) {
  const p = new Problems();
  p.add(
    data.snapshot.carbs_basis === CARBS_BASIS,
    `R-20: snapshot carbs_basis is ${String(data.snapshot.carbs_basis)}, not ${CARBS_BASIS}`,
  );
  for (const i of data.snapshot.ingredients)
    if (String(i.meta?.derivations?.carbs_g).includes("clamped"))
      p.add(
        i.nutrition_confidence === "low" && String(i.meta.confidence_reason).includes("clamped"),
        `${i.slug}: clamped carbohydrate must be low confidence and say so (R-20)`,
      );
  for (const i of data.snapshot.ingredients) {
    const delta = atwater(i);
    if (delta <= ATWATER_TOLERANCE_PCT) continue;
    p.add(
      i.nutrition_confidence === "low" &&
        isStr(i.meta?.confidence_reason) &&
        i.meta.confidence_reason.includes("NUT-4"),
      `${i.slug}: NUT-4 off by ${delta.toFixed(1)} % and not low confidence with a NUT-4 reason`,
    );
  }
  return p.list;
}

function statsG2(data) {
  const fails = data.snapshot.ingredients.filter((i) => atwater(i) > ATWATER_TOLERANCE_PCT);
  const other = structuredClone(data);
  regenerateByDifference(other);
  return [
    `NUT-4 passing: ${String(data.snapshot.ingredients.length - fails.length)} of ${String(data.snapshot.ingredients.length)}`,
    `NUT-4 failing, low confidence with a reason: ${fails.map((i) => i.slug).join(", ") || "none"}`,
    `carbohydrate basis: ${String(data.snapshot.carbs_basis)}; NUT-4 failures if regenerated by difference: ${String(nut4Failures(other.snapshot.ingredients))}`,
  ];
}

// --- G3: method-yield rows, with a source, for every (method, category) the seed library uses

/** (method, category) pairs used by data/seed-dishes/** (leaf 1.2.4), derived from its files. */
function seedLibraryPairs(ingredients) {
  const dir = join(DATA, "seed-dishes");
  if (!existsSync(dir)) return null;
  const categoryOf = new Map(ingredients.map((i) => [i.slug, i.category]));
  const pairs = new Set();
  const files = [];
  const walkDir = (d) => {
    for (const f of readdirSync(d)) {
      const path = join(d, f);
      if (statSync(path).isDirectory()) walkDir(path);
      else if (f.endsWith(".json")) files.push(path);
    }
  };
  walkDir(dir);
  // A variant is any object with a method key and a list whose items name a catalogue slug.
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== "object") return;
    const method = node.method ?? node.method_key;
    if (METHODS.includes(method)) {
      for (const value of Object.values(node))
        if (Array.isArray(value))
          for (const item of value) {
            const slug = item?.ingredient ?? item?.ingredient_slug ?? item?.slug;
            if (categoryOf.has(slug)) pairs.add(`${method}|${categoryOf.get(slug)}`);
          }
    }
    Object.values(node).forEach(visit);
  };
  for (const f of files) visit(JSON.parse(readFileSync(f, "utf8")));
  return { files: files.length, pairs };
}

function checkG3(data) {
  const p = new Problems();
  const y = data.yields;
  const methodKeys = (y.methods ?? []).map((m) => m.key);
  p.add(
    methodKeys.length === METHODS.length && METHODS.every((k) => methodKeys.includes(k)),
    "preparation_method rows are exactly the 23 DM §3 keys",
  );
  for (const m of y.methods ?? [])
    p.add(
      isStr(m.label) && isStr(m.description) && Array.isArray(m.appeal_tags),
      `method ${String(m.key)}`,
    );
  const rows = new Map();
  for (const r of y.yields ?? []) {
    const k = `${String(r.method)}|${String(r.ingredient_category)}`;
    const at = `method_yield ${k}`;
    p.add(!rows.has(k), `${at}: duplicate`);
    rows.set(k, r);
    for (const col of YIELD_COLUMNS) p.add(col in r, `${at}: missing column ${col}`);
    p.add(
      !("coating_ingredient_id" in r) && !("coating_ingredient_slug" in r),
      `${at}: coating column (R-12)`,
    );
    p.add(
      METHODS.includes(r.method) && CATEGORIES.includes(r.ingredient_category),
      `${at}: unknown key`,
    );
    p.add(
      isNum(r.yield_factor) && r.yield_factor > 0 && r.yield_factor <= 4,
      `${at}: yield_factor`,
    );
    p.add(
      isNum(r.fat_retention) && r.fat_retention >= 0 && r.fat_retention <= 1,
      `${at}: fat_retention`,
    );
    p.add(
      isNum(r.oil_absorption_g_per_100g_raw) &&
        r.oil_absorption_g_per_100g_raw >= 0 &&
        r.oil_absorption_g_per_100g_raw <= 40,
      `${at}: oil_absorption_g_per_100g_raw`,
    );
    p.add(isStr(r.meta?.source), `${at}: meta.source`);
    p.add(CONFIDENCE.includes(r.meta?.confidence), `${at}: meta.confidence`);
    p.add(isStr(r.meta?.note), `${at}: meta.note`);
    if (String(r.meta?.source).startsWith("paired_records:"))
      p.add(Array.isArray(r.meta.pairs) && r.meta.pairs.length > 0, `${at}: pairs listed`);
    if (String(r.meta?.source).startsWith("analogy:")) {
      const [fm, fc] = String(r.meta.source).slice("analogy:".length).split("×");
      const from =
        rows.get(`${fm}|${fc}`) ??
        (y.yields ?? []).find((q) => q.method === fm && q.ingredient_category === fc);
      p.add(from !== undefined, `${at}: analogy source ${fm}×${fc} missing`);
      if (from !== undefined)
        p.add(
          from.yield_factor === r.yield_factor &&
            from.fat_retention === r.fat_retention &&
            from.oil_absorption_g_per_100g_raw === r.oil_absorption_g_per_100g_raw,
          `${at}: analogy values differ from ${fm}×${fc}`,
        );
      p.add(r.meta.confidence === "low", `${at}: an analogy is low confidence`);
    }
  }
  // Coverage: every DM pair is seeded or excluded with a reason (R-19), and every pair the seed
  // library uses is seeded.
  const excluded = new Map(
    (y.coverage?.excluded ?? []).map((e) => [`${e.method}|${e.ingredient_category}`, e]),
  );
  for (const m of METHODS)
    for (const c of CATEGORIES) {
      const k = `${m}|${c}`;
      const ex = excluded.get(k);
      p.add(
        rows.has(k) || (ex !== undefined && isStr(ex.reason)),
        `no row and no reasoned exclusion for ${k}`,
      );
      p.add(!(rows.has(k) && ex !== undefined), `${k} is both seeded and excluded`);
    }
  const seed = seedLibraryPairs(data.snapshot.ingredients);
  if (seed !== null) {
    p.add(
      seed.files === 0 || seed.pairs.size > 0,
      "data/seed-dishes exists but no (method, category) pair could be read",
    );
    for (const k of seed.pairs)
      p.add(rows.has(k), `seed library uses ${k}, which has no yield row`);
  }
  // NUT-3 indicative ranges, reproduced from source.
  for (const n of NUT3_RANGES) {
    const r = rows.get(`${n.method}|${n.category}`);
    const within = (v, [lo, hi]) => isNum(v) && v >= lo - 1e-9 && v <= hi + 1e-9;
    p.add(
      r !== undefined &&
        within(r.yield_factor, n.y) &&
        within(r.fat_retention, n.r) &&
        within(r.oil_absorption_g_per_100g_raw, n.a),
      `NUT-3 ${n.method}×${n.category}: ${r ? `Y ${String(r.yield_factor)}, R ${String(r.fat_retention)}, A ${String(r.oil_absorption_g_per_100g_raw)}` : "missing"} outside the indicative range`,
    );
  }
  return p.list;
}

function statsG3(data) {
  const rows = data.yields.yields;
  const kinds = {};
  for (const r of rows) {
    const kind = String(r.meta.source).split(":")[0];
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  const seed = seedLibraryPairs(data.snapshot.ingredients);
  const nut3 = NUT3_RANGES.map((n) => {
    const r = rows.find((q) => q.method === n.method && q.ingredient_category === n.category);
    return `${n.method}×${n.category} Y ${String(r?.yield_factor)} R ${String(r?.fat_retention)} A ${String(r?.oil_absorption_g_per_100g_raw)} (${String(r?.meta.source).slice(0, 40)})`;
  });
  return [
    `method_yield rows: ${String(rows.length)}; excluded pairs: ${String(data.yields.coverage.excluded.length)}; DM pairs: ${String(METHODS.length * CATEGORIES.length)}`,
    `row sources: ${Object.entries(kinds)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(", ")}`,
    seed === null
      ? "data/seed-dishes/ does not exist yet (leaf 1.2.4): coverage is all DM pairs"
      : `seed library: ${String(seed.files)} files, ${String(seed.pairs.size)} (method, category) pairs`,
    ...nut3.map((s) => `NUT-3: ${s}`),
  ];
}

// --- G4: soluble-fibre values carry citations; unknowns are null, not 0 (NUT-8, R-13)

function checkG4(data) {
  const p = new Problems();
  const ings = new Map(data.snapshot.ingredients.map((i) => [i.slug, i]));
  const rows = new Map();
  for (const r of data.soluble) {
    const at = `soluble-fibre.csv ${r.ingredient_slug}`;
    p.add(!rows.has(r.ingredient_slug), `${at}: duplicate`);
    rows.set(r.ingredient_slug, r);
    const ing = ings.get(r.ingredient_slug);
    const v = r.soluble_fibre_g_per_100g.trim() === "" ? NaN : Number(r.soluble_fibre_g_per_100g);
    p.add(ing !== undefined, `${at}: unknown slug`);
    p.add(Number.isFinite(v) && v >= 0, `${at}: value is a number >= 0`);
    if (ing !== undefined) p.add(v <= ing.fibre_g + 1e-9, `${at}: soluble exceeds total fibre`);
    p.add(/^(usda_fdc|fineli):\S+$/.test(r.source), `${at}: source ${r.source} not registered`);
    p.add(["measured", "total_minus_insoluble"].includes(r.method), `${at}: method ${r.method}`);
    p.add(
      isStr(r.citation) && r.citation.includes(r.source.split(":")[1]),
      `${at}: citation must name the record`,
    );
  }
  for (const i of data.snapshot.ingredients) {
    const at = `ingredient ${i.slug}`;
    const row = rows.get(i.slug);
    const d = i.meta?.derivations?.soluble_fibre_g;
    if (row !== undefined) {
      p.add(
        i.soluble_fibre_g === Number(row.soluble_fibre_g_per_100g),
        `${at}: soluble_fibre_g differs from the CSV`,
      );
    } else if (i.soluble_fibre_g !== null) {
      // R-13: a known zero is allowed only where total fibre is 0, citing the ingredient's own record.
      p.add(
        i.soluble_fibre_g === 0 &&
          i.fibre_g === 0 &&
          isStr(d) &&
          d.includes(i.meta.provenance.record_id),
        `${at}: soluble_fibre_g ${String(i.soluble_fibre_g)} has no citation (only a total-fibre-0 record justifies 0)`,
      );
    }
    if (i.sugar_g === 0 && i.meta?.derivations?.sugar_g !== undefined)
      p.add(
        i.carbs_g === 0 && i.meta.derivations.sugar_g.includes(i.meta.provenance.record_id),
        `${at}: sugar 0 is filled only when carbohydrate is 0 (R-13)`,
      );
  }
  return p.list;
}

function statsG4(data) {
  const ings = data.snapshot.ingredients;
  const listed = ings.filter((i) => data.soluble.some((r) => r.ingredient_slug === i.slug)).length;
  const zero = ings.filter((i) => i.soluble_fibre_g === 0 && i.fibre_g === 0).length;
  const unknown = ings.filter((i) => i.soluble_fibre_g === null).length;
  return [
    `soluble fibre: ${String(listed)} cited values from data/soluble-fibre.csv, ${String(zero)} R-13 zeros (total fibre 0), ${String(unknown)} null (unknown)`,
    `sugar filled as R-13 zero: ${String(ings.filter((i) => i.meta?.derivations?.sugar_g !== undefined).length)}; sugar null: ${String(ings.filter((i) => i.sugar_g === null).length)}`,
  ];
}

// --- G5: allergen dietary_flags let sesame expand to tahini, hummus and za'atar (R2-ONB-3)

/** R2-ONB-3's deterministic expansion: an allergen maps to every ingredient carrying its flag. */
function expandAllergen(ingredients, allergen) {
  const flag = `contains_${allergen}`;
  return ingredients.filter((i) => i.dietary_flags.includes(flag)).map((i) => i.slug);
}

const NAME_RULES = [
  { re: /\b(tahini|tahina|sesame|za'?atar|hummus|houmous|halva)\b/i, flag: "contains_sesame" },
  {
    re: /\b(wheat|bulgur|freekeh|semolina|couscous|barley|rye|khubz|bread|pasta|vermicelli|seitan|breadcrumbs|filo|croissant|bagel|naan|muffin)\b/i,
    flag: "contains_gluten",
  },
  {
    re: /\b(milk|cheese|yogurt|labneh|laban|butter|ghee|cream|halloumi|akkawi|nabulsi|feta|mozzarella|ricotta|parmesan|cheddar|gouda|whey)\b/i,
    flag: "contains_dairy",
  },
  { re: /\b(egg|mayonnaise)\b/i, flag: "contains_egg" },
  {
    re: /\b(almond|walnut|cashew|pistachio|hazelnut|pecan|macadamia|brazil|pine nut|peanut)s?\b/i,
    flag: "contains_nuts",
  },
  { re: /\b(soy|tofu|tempeh|edamame)\b/i, flag: "contains_soy" },
];
/** Names where a keyword does not mean the allergen (plant "milks", nut-free "butters"). */
const NAME_RULE_EXCEPTIONS = {
  contains_dairy: [
    "coconut-milk",
    "soy-milk",
    "almond-milk",
    "peanut-butter",
    "almond-butter",
    "vegetable-ghee",
    "cocoa-powder",
    "coconut-flesh",
    "desiccated-coconut",
    "coconut-oil",
    "coconut-water",
    "buckwheat",
  ],
  contains_nuts: [
    "nutmeg",
    "coconut-flesh",
    "desiccated-coconut",
    "coconut-milk",
    "coconut-oil",
    "coconut-water",
  ],
  contains_gluten: ["buckwheat", "rice-cakes"],
  contains_egg: ["eggplant"],
};
const ANIMAL = ["poultry", "red_meat", "fish", "seafood"];

function checkG5(data) {
  const p = new Problems();
  const ings = data.snapshot.ingredients;
  for (const i of ings) {
    const at = `ingredient ${i.slug}`;
    const f = new Set(i.dietary_flags);
    for (const flag of i.dietary_flags)
      p.add(DIETARY_FLAGS.includes(flag), `${at}: unknown flag ${flag}`);
    p.add(f.size === i.dietary_flags.length, `${at}: duplicate flag`);
    if (i.category === "fish") p.add(f.has("contains_fish"), `${at}: fish without contains_fish`);
    if (i.category === "seafood")
      p.add(f.has("contains_shellfish"), `${at}: seafood without contains_shellfish`);
    if (i.category === "egg") p.add(f.has("contains_egg"), `${at}: egg without contains_egg`);
    if (i.category === "dairy")
      p.add(f.has("contains_dairy"), `${at}: dairy without contains_dairy`);
    if (f.has("vegan")) p.add(f.has("vegetarian"), `${at}: vegan implies vegetarian`);
    if (f.has("vegan"))
      for (const x of [
        "contains_dairy",
        "contains_egg",
        "contains_fish",
        "contains_shellfish",
        "contains_pork",
      ])
        p.add(!f.has(x), `${at}: vegan with ${x}`);
    if (f.has("vegetarian"))
      for (const x of ["contains_fish", "contains_shellfish", "contains_pork"])
        p.add(!f.has(x), `${at}: vegetarian with ${x}`);
    if (ANIMAL.includes(i.category))
      p.add(!f.has("vegetarian"), `${at}: meat or fish flagged vegetarian`);
    const text = `${i.name} ${i.aliases.join(" ")}`;
    for (const rule of NAME_RULES)
      if (rule.re.test(text) && !(NAME_RULE_EXCEPTIONS[rule.flag] ?? []).includes(i.slug))
        p.add(f.has(rule.flag), `${at}: name suggests ${rule.flag} but the flag is missing`);
  }
  const sesame = expandAllergen(ings, "sesame");
  for (const slug of ["tahini", "hummus", "zaatar"])
    p.add(sesame.includes(slug), `R2-ONB-3: sesame does not expand to ${slug}`);
  return p.list;
}

function statsG5(data) {
  const ings = data.snapshot.ingredients;
  const counts = DIETARY_FLAGS.map(
    (f) => `${f} ${String(ings.filter((i) => i.dietary_flags.includes(f)).length)}`,
  );
  return [
    `sesame expands to: ${expandAllergen(ings, "sesame").join(", ")}`,
    `flag counts: ${counts.join(", ")}`,
  ];
}

// --- CLI

const GATES = {
  G1: {
    check: checkG1,
    stats: statsG1,
    controls: [
      [
        "one ingredient short of 250",
        (d) => {
          d.snapshot.ingredients.length = MIN_INGREDIENTS - 1;
        },
        "ingredients <",
      ],
      [
        "an entry without AE availability",
        (d) => {
          delete d.snapshot.ingredients[0].locale_availability.AE;
        },
        "locale_availability.AE",
      ],
      [
        "an unregistered source prefix",
        (d) => {
          d.snapshot.ingredients[1].nutrition_source = "blog:123";
        },
        "prefix not registered",
      ],
      [
        "only 39 UAE-specific items",
        (d) => {
          let keep = MIN_UAE_SPECIFIC - 1;
          for (const i of d.snapshot.ingredients)
            if (i.meta.uae_specific) {
              if (keep > 0) keep--;
              else i.meta.uae_specific = false;
            }
        },
        "UAE-specific items <",
      ],
      [
        "a NUT-7 example removed without an omission",
        (d) => {
          d.snapshot.ingredients = d.snapshot.ingredients.filter((i) => i.slug !== "halloumi");
        },
        'NUT-7 example "halloumi"',
      ],
      [
        "label values marked high confidence",
        (d) => {
          const i = d.snapshot.ingredients.find((x) => x.meta.provenance.dataset === "fdc_branded");
          i.nutrition_confidence = "high";
        },
        "label values must be low",
      ],
    ],
  },
  G2: {
    check: checkG2,
    stats: statsG2,
    controls: [
      [
        "a high-confidence entry with kcal scaled by 1.2",
        (d) => {
          const i = d.snapshot.ingredients.find(
            (x) => x.nutrition_confidence === "high" && x.kcal > 50,
          );
          i.kcal = i.kcal * 1.2;
        },
        "NUT-4 off",
      ],
      [
        "a failing entry whose low-confidence reason is removed",
        (d) => {
          const i = d.snapshot.ingredients.find((x) => atwater(x) > ATWATER_TOLERANCE_PCT);
          i.meta.confidence_reason = null;
        },
        "NUT-4 off",
      ],
      [
        "a clamped entry left at high confidence (R-20)",
        (d) => {
          const i = d.snapshot.ingredients.find((x) => x.nutrition_confidence === "high");
          i.meta.derivations.carbs_g += " (negative difference clamped to 0)";
        },
        "clamped carbohydrate",
      ],
      // R-20: regenerating on the by-difference basis must raise the NUT-4 failure count. Every
      // extra failure is a high-confidence entry that now fails, the problem this control adds.
      [
        "regenerated in memory with carbs_basis by_difference",
        (d) => {
          const before = nut4Failures(d.snapshot.ingredients);
          regenerateByDifference(d);
          if (nut4Failures(d.snapshot.ingredients) <= before) d.snapshot.ingredients.length = 0;
        },
        "NUT-4 off",
      ],
    ],
  },
  G3: {
    check: checkG3,
    stats: statsG3,
    controls: [
      [
        "a required row deleted",
        (d) => {
          d.yields.yields = d.yields.yields.filter(
            (r) => !(r.method === "grilled" && r.ingredient_category === "fish"),
          );
        },
        "grilled|fish",
      ],
      [
        "a row without a source",
        (d) => {
          delete d.yields.yields[5].meta.source;
        },
        "meta.source",
      ],
      [
        "grilled x poultry yield outside the NUT-3 range",
        (d) => {
          d.yields.yields.find(
            (r) => r.method === "grilled" && r.ingredient_category === "poultry",
          ).yield_factor = 0.9;
        },
        "NUT-3 grilled×poultry",
      ],
      [
        "a coating column (R-12)",
        (d) => {
          d.yields.yields[0].coating_ingredient_id = null;
        },
        "coating column",
      ],
    ],
  },
  G4: {
    check: checkG4,
    stats: statsG4,
    controls: [
      [
        "soluble fibre 0 on an entry with fibre > 0 and no citation",
        (d) => {
          const i = d.snapshot.ingredients.find((x) => x.fibre_g > 0 && x.soluble_fibre_g === null);
          i.soluble_fibre_g = 0;
        },
        "has no citation",
      ],
      [
        "a CSV row with an empty citation",
        (d) => {
          d.soluble[0].citation = "";
        },
        "citation must name",
      ],
      [
        "a snapshot value that differs from the CSV",
        (d) => {
          bySlug(d, d.soluble[0].ingredient_slug).soluble_fibre_g += 0.5;
        },
        "differs from the CSV",
      ],
    ],
  },
  G5: {
    check: checkG5,
    stats: statsG5,
    controls: [
      [
        "contains_sesame removed from hummus",
        (d) => {
          const i = bySlug(d, "hummus");
          i.dietary_flags = i.dietary_flags.filter((f) => f !== "contains_sesame");
        },
        "does not expand to hummus",
      ],
      [
        "an unknown flag",
        (d) => {
          d.snapshot.ingredients[0].dietary_flags.push("contains_lupin");
        },
        "unknown flag",
      ],
      [
        "vegan and dairy on one entry",
        (d) => {
          bySlug(d, "labneh").dietary_flags.push("vegan");
        },
        "vegan with contains_dairy",
      ],
    ],
  },
};

const argIndex = process.argv.indexOf("--gate");
const gate = argIndex >= 0 ? process.argv[argIndex + 1] : undefined;
if (gate === undefined || !(gate in GATES)) {
  console.log(`usage: node scripts/verify/leaf-1.1.3.mjs --gate ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
const { check, stats, controls } = GATES[gate];
process.exit(runGate(gate, load(), check, controls, stats));
