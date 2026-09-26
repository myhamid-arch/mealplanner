// Verify script for leaf 1.2.4 (Seed dish library).
// Usage: node scripts/verify/leaf-1.2.4.mjs --gate G1|G2|G3|G4|G6
//        node scripts/verify/leaf-1.2.4.mjs --g5-sample [--seed <n>]   (G5 material; not a gate)
// Prints "VERIFY leaf-1.2.4 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise.
//
// G1 and G2 read the data files only. G3, G4 and G6 compile @mealplanner/core with tsc into a
// directory of their own (packages/core/node_modules/.cache/leaf-1.2.4-<gate>-<pid>, removed at the
// end), so gates can run concurrently without sharing dist/. They import the 1.2.1 nutrition engine,
// the 1.2.2 target resolver and portion solver, and the F1 fixture from that build, and re-check
// every solver result with this script's own arithmetic. Measured figures are computed on each run.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE = join(ROOT, "packages/core");
const DATA = join(ROOT, "data");

const SLOT_KEYS = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "packed_school_lunch",
  "packed_work_lunch",
  "pre_workout",
  "post_workout",
];
const ROLES = ["protein", "carb", "vegetable", "sauce", "fat", "garnish", "side", "drink"];
const MACROS = ["kcal", "protein", "carbs", "fat"];
const EPS = 1e-6;

const MIN_DISHES = 60;
const MIN_CUISINES = 10;
const MIN_PER_SLOT = 8;
const MIN_COLD_PACKABLE = 8;
const DM3_SHARE = 0.7;
const DM3_RATE = 0.7;
const ATWATER_PCT = 12;
const MIN_ADJUSTERS = 15;
const FEASIBLE_RATE = 0.8;
const RATIO_LIMIT = 0.25;

// ---------------------------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------------------------

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function loadCatalog() {
  const snapshot = readJson(join(DATA, "ingredients.v1.json"));
  const yields = readJson(join(DATA, "method-yields.v1.json"));
  const cuisines = readJson(join(DATA, "cuisines.json"));
  return {
    ingredients: new Map(snapshot.ingredients.map((i) => [i.slug, i])),
    yields: yields.yields,
    methods: yields.methods.map((m) => m.key),
    cuisines: new Set(cuisines.map((c) => c.key)),
  };
}

function loadLibrary() {
  const dir = join(DATA, "seed-dishes");
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  const dishes = files.map((f) => ({ file: f, dish: readJson(join(dir, f)) }));
  const adjPath = join(DATA, "adjusters.json");
  const adjusters = existsSync(adjPath) ? readJson(adjPath).adjusters : [];
  return { dishes, adjusters };
}

const clone = (x) => structuredClone(x);

// ---------------------------------------------------------------------------------------------
// Structural validation (02 §4 columns, REC-4 limits, references, R-23, SPEC-Q-6)
// ---------------------------------------------------------------------------------------------

const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}/u;
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isStr = (s) => typeof s === "string" && s.trim().length > 0;
const isBool = (b) => typeof b === "boolean";
const isPosNum = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Every string anywhere in the value, with its path. */
function strings(value, path = "") {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}

/**
 * Problems with one dish record. `kind` is "dish" (seed library) or "adjuster" (PLN-6).
 * Returns a list of messages; empty means valid.
 */
function dishProblems(d, cat, kind, file) {
  const p = [];
  const at = `${kind} ${d?.slug ?? file}`;
  const bad = (msg) => p.push(`${at}: ${msg}`);
  if (d === null || typeof d !== "object") return [`${at}: not an object`];
  if (!(isStr(d.slug) && KEY.test(d.slug))) bad("slug must be kebab-case");
  if (file !== undefined && `${d.slug}.json` !== file) bad(`file name ${file} does not match slug`);
  if (!isStr(d.name)) bad("name missing");
  if (!isStr(d.description)) bad("description missing");
  if (!cat.cuisines.has(d.cuisine)) bad(`unknown cuisine ${d.cuisine}`);
  if (
    d.secondary_cuisine !== null &&
    !(cat.cuisines.has(d.secondary_cuisine) && d.secondary_cuisine !== d.cuisine)
  )
    bad(`bad secondary_cuisine ${d.secondary_cuisine}`);
  if (!(
    Array.isArray(d.slot_keys) &&
    d.slot_keys.length > 0 &&
    d.slot_keys.every((k) => SLOT_KEYS.includes(k))
  ))
    bad(`slot_keys must be a non-empty list of PLN-2 keys`);
  else if (new Set(d.slot_keys).size !== d.slot_keys.length) bad("duplicate slot key");
  if (!(Array.isArray(d.flavour_tags) && d.flavour_tags.every(isStr)))
    bad("flavour_tags must be strings");
  if (!isBool(d.is_packable) || !isBool(d.served_cold_ok))
    bad("is_packable / served_cold_ok must be booleans");
  if (d.source !== "seed") bad("source must be seed");
  if (d.status !== "active") bad("status must be active");
  if (!(Number.isInteger(d.version) && d.version >= 1)) bad("version must be an integer >= 1");
  if (!(Array.isArray(d.assembly_steps) && d.assembly_steps.every(isStr)))
    bad("assembly_steps must be strings");
  if (kind === "dish" && !(d.assembly_steps?.length > 0)) bad("assembly_steps empty");
  const comps = Array.isArray(d.components) ? d.components : [];
  if (comps.length < 1 || comps.length > 6) bad("1 to 6 components (REC-4)");
  if (kind === "adjuster" && !(comps.length === 1 && comps[0]?.role === "adjuster"))
    bad("an adjuster is exactly one component with role adjuster (PLN-6)");
  const ckeys = new Set();
  comps.forEach((c, ci) => {
    const cat2 = `${at} component ${c?.key}`;
    const cbad = (msg) => p.push(`${cat2}: ${msg}`);
    if (!(isStr(c.key) && KEY.test(c.key)) || ckeys.has(c.key))
      cbad("key missing, not kebab-case or duplicate");
    ckeys.add(c.key);
    if (!isStr(c.name)) cbad("name missing");
    const roleOk = kind === "adjuster" ? c.role === "adjuster" : ROLES.includes(c.role);
    if (!roleOk) cbad(`role ${c.role} not allowed`);
    if (!["continuous", "unit", "fixed"].includes(c.portioning)) cbad("bad portioning");
    if (c.portioning === "unit" && !isStr(c.unit_label)) cbad("unit portioning needs unit_label");
    if (!(
      typeof c.min_serving_g === "number" &&
      c.min_serving_g >= 0 &&
      c.min_serving_g <= c.default_serving_g &&
      c.default_serving_g <= c.max_serving_g &&
      c.max_serving_g > 0
    ))
      cbad("serving bounds must satisfy 0 <= min <= default <= max, max > 0");
    if (!(Number.isInteger(c.step_g) && c.step_g > 0)) cbad("step_g must be a positive integer");
    if (c.sort_order !== ci + 1) cbad("sort_order must follow the list order");
    if (!isBool(c.required)) cbad("required must be boolean");
    const vars = Array.isArray(c.variants) ? c.variants : [];
    if (vars.length < 1 || vars.length > 3) cbad("1 to 3 variants (REC-4)");
    if (vars.filter((v) => v.is_default === true).length !== 1) cbad("exactly one default variant");
    const vkeys = new Set();
    for (const v of vars) {
      const vat = `${cat2} variant ${v?.key}`;
      const vbad = (msg) => p.push(`${vat}: ${msg}`);
      if (!(isStr(v.key) && KEY.test(v.key)) || vkeys.has(v.key))
        vbad("key missing, not kebab-case or duplicate");
      vkeys.add(v.key);
      if (!cat.methods.includes(v.method)) vbad(`unknown method ${v.method}`);
      if (!isStr(v.label)) vbad("label missing");
      if (!isBool(v.is_default)) vbad("is_default must be boolean");
      if (!isPosNum(v.reference_batch_cooked_g)) vbad("reference_batch_cooked_g must be > 0");
      if (!(Number.isInteger(v.cook_time_min) && v.cook_time_min > 0))
        vbad("cook_time_min must be a positive integer");
      if (!(v.notes === null || isStr(v.notes))) vbad("notes must be null or text");
      if (!(Array.isArray(v.steps) && v.steps.length > 0 && v.steps.every(isStr)))
        vbad("steps must be non-empty text");
      const rows = Array.isArray(v.ingredients) ? v.ingredients : [];
      if (rows.length === 0) vbad("no ingredients");
      for (const r of rows) {
        const ing = cat.ingredients.get(r.ingredient_slug);
        const rbad = (msg) => p.push(`${vat} ingredient ${r.ingredient_slug}: ${msg}`);
        if (ing === undefined) {
          rbad("unknown catalogue slug");
          continue;
        }
        if (!isPosNum(r.raw_g_per_batch)) rbad("raw_g_per_batch must be grams > 0 (NUT-6)");
        if (!(r.role_note === null || isStr(r.role_note))) rbad("role_note must be null or text");
        if (!isBool(r.is_absorbed_oil)) rbad("is_absorbed_oil must be boolean");
        if (![null, "absorbed", "retained"].includes(r.cooking_liquid)) rbad("bad cooking_liquid");
        if (!(r.yield_override === null || isPosNum(r.yield_override))) rbad("bad yield_override");
        if (r.is_absorbed_oil && r.cooking_liquid !== null)
          rbad("absorbed oil cannot be a cooking liquid");
        if (r.is_absorbed_oil && ing.category !== "oil_fat")
          rbad("only an oil or fat can be absorbed cooking fat");
        if (r.yield_override !== null && (r.is_absorbed_oil || r.cooking_liquid === "absorbed"))
          rbad("yield_override only on an ingredient that keeps its own mass");
        const ae = ing.locale_availability?.AE;
        if (!["common", "available"].includes(ae)) rbad(`AE availability is ${ae} (NUT-7)`);
        if (
          ing.dietary_flags.includes("contains_pork") ||
          ing.dietary_flags.includes("contains_alcohol")
        )
          rbad("pork or alcohol (SPEC-Q-6)");
      }
    }
  });
  for (const [path, s] of strings(d)) if (EMOJI.test(s)) bad(`emoji in ${path} (R-23)`);
  return p;
}

// ---------------------------------------------------------------------------------------------
// G1: counts
// ---------------------------------------------------------------------------------------------

/** SPEC-Q-3: explicit slot key, plus the packed rules of PLN-9 §6.3. */
function suits(d, slot) {
  if (!d.slot_keys.includes(slot)) return false;
  if (slot === "packed_work_lunch") return d.is_packable;
  if (slot === "packed_school_lunch") return d.is_packable && d.served_cold_ok;
  return true;
}

function g1Measure(lib, cat) {
  const problems = [];
  const slugs = new Set();
  for (const { file, dish } of lib.dishes) {
    problems.push(...dishProblems(dish, cat, "dish", file));
    if (slugs.has(dish.slug)) problems.push(`duplicate slug ${dish.slug}`);
    slugs.add(dish.slug);
  }
  for (const a of lib.adjusters) {
    problems.push(...dishProblems(a, cat, "adjuster"));
    if (slugs.has(a.slug)) problems.push(`duplicate slug ${a.slug}`);
    slugs.add(a.slug);
  }
  const active = lib.dishes.map((x) => x.dish).filter((d) => d.status === "active");
  const cuisines = new Set(active.map((d) => d.cuisine));
  const perSlot = Object.fromEntries(
    SLOT_KEYS.map((s) => [s, active.filter((d) => suits(d, s)).length]),
  );
  const coldPackable = active.filter(
    (d) => d.is_packable && d.served_cold_ok && suits(d, "packed_school_lunch"),
  ).length;
  const failures = [];
  if (problems.length > 0) failures.push(`${problems.length} data problem(s)`);
  if (active.length < MIN_DISHES) failures.push(`${active.length} active dishes < ${MIN_DISHES}`);
  if (cuisines.size < MIN_CUISINES) failures.push(`${cuisines.size} cuisines < ${MIN_CUISINES}`);
  for (const s of SLOT_KEYS)
    if (perSlot[s] < MIN_PER_SLOT) failures.push(`${s}: ${perSlot[s]} < ${MIN_PER_SLOT}`);
  if (coldPackable < MIN_COLD_PACKABLE)
    failures.push(`${coldPackable} served_cold_ok packable < ${MIN_COLD_PACKABLE}`);
  return { problems, active, cuisines, perSlot, coldPackable, failures };
}

function gateG1() {
  const report = new Report("leaf-1.2.4 G1");
  const cat = loadCatalog();
  const lib = loadLibrary();
  const m = g1Measure(lib, cat);
  report.check(
    m.problems.length === 0,
    `all ${lib.dishes.length} dishes and ${lib.adjusters.length} adjusters are valid records (columns, keys, references, AE availability, no pork/alcohol, no emoji)`,
    m.problems.slice(0, 30).join("\n"),
  );
  report.check(
    m.active.length >= MIN_DISHES,
    `${m.active.length} active dishes (>= ${MIN_DISHES})`,
  );
  const byCuisine = {};
  for (const d of m.active) byCuisine[d.cuisine] = (byCuisine[d.cuisine] ?? 0) + 1;
  report.check(
    m.cuisines.size >= MIN_CUISINES,
    `${m.cuisines.size} cuisines (>= ${MIN_CUISINES}): ${JSON.stringify(byCuisine)}`,
  );
  for (const s of SLOT_KEYS)
    report.check(
      m.perSlot[s] >= MIN_PER_SLOT,
      `slot ${s}: ${m.perSlot[s]} suitable dishes (>= ${MIN_PER_SLOT})`,
    );
  report.check(
    m.coldPackable >= MIN_COLD_PACKABLE,
    `packed without reheat: ${m.coldPackable} packable served_cold_ok dishes (>= ${MIN_COLD_PACKABLE})`,
  );
  const sesame = m.active.filter((d) =>
    d.components.some((c) =>
      c.variants.some((v) =>
        v.ingredients.some((r) =>
          cat.ingredients.get(r.ingredient_slug)?.dietary_flags.includes("contains_sesame"),
        ),
      ),
    ),
  );
  console.log(
    `info - ${sesame.length} dishes carry contains_sesame through their ingredients: ${sesame.map((d) => d.slug).join(", ")}`,
  );

  // Negative controls: the same measurement on known-bad libraries must fail.
  const mutate = (fn) => {
    const copy = clone(lib);
    fn(copy);
    return g1Measure(copy, cat).failures;
  };
  const controls = [
    ["59 dishes", (l) => (l.dishes = l.dishes.slice(0, MIN_DISHES - 1))],
    [
      "9 cuisines",
      (l) => {
        const keep = [...new Set(l.dishes.map((x) => x.dish.cuisine))].slice(0, MIN_CUISINES - 1);
        for (const x of l.dishes) if (!keep.includes(x.dish.cuisine)) x.dish.cuisine = keep[0];
      },
    ],
    ["nothing served cold", (l) => l.dishes.forEach((x) => (x.dish.served_cold_ok = false))],
    [
      "no pre_workout dish",
      (l) =>
        l.dishes.forEach(({ dish }) => {
          const kept = dish.slot_keys.filter((k) => k !== "pre_workout");
          dish.slot_keys = kept.length > 0 ? kept : ["snack"];
        }),
    ],
    ["an emoji in a name", (l) => (l.dishes[0].dish.name += " \u{1F957}")],
    [
      "an unknown ingredient slug",
      (l) =>
        (l.dishes[0].dish.components[0].variants[0].ingredients[0].ingredient_slug =
          "unicorn-meat"),
    ],
    [
      "a pork ingredient",
      (l) =>
        (l.dishes[0].dish.components[0].variants[0].ingredients[0].ingredient_slug = "pork-loin"),
    ],
    ["a dish that is not active", (l) => (l.dishes[0].dish.status = "retired")],
  ];
  for (const [name, fn] of controls) {
    const failures = mutate(fn);
    report.check(
      failures.length > 0,
      `negative control: ${name} fails G1 (${failures.slice(0, 2).join("; ")})`,
    );
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G2: DM-3 variant ingredient sets (SPEC-Q-1)
// ---------------------------------------------------------------------------------------------

/** Raw-mass shares of the variant's non-fat, non-coating, non-absorbed-liquid ingredients. */
function coreShares(v, cat) {
  const grams = new Map();
  for (const r of v.ingredients) {
    const ing = cat.ingredients.get(r.ingredient_slug);
    if (r.is_absorbed_oil || ing?.category === "oil_fat") continue;
    if (r.role_note === "coating" || r.cooking_liquid === "absorbed") continue;
    grams.set(r.ingredient_slug, (grams.get(r.ingredient_slug) ?? 0) + r.raw_g_per_batch);
  }
  const total = [...grams.values()].reduce((a, b) => a + b, 0);
  return new Map([...grams].map(([k, g]) => [k, total > 0 ? g / total : 0]));
}

function sharedFraction(a, b, cat) {
  const pa = coreShares(a, cat);
  const pb = coreShares(b, cat);
  let s = 0;
  for (const [k, x] of pa) s += Math.min(x, pb.get(k) ?? 0);
  return s;
}

/** The component's smallest pairwise share, or null with fewer than 2 variants. */
function componentShare(c, cat) {
  if (c.variants.length < 2) return null;
  let min = Infinity;
  for (let i = 0; i < c.variants.length; i++)
    for (let j = i + 1; j < c.variants.length; j++)
      min = Math.min(min, sharedFraction(c.variants[i], c.variants[j], cat));
  return min;
}

function dm3(dishes, cat) {
  const rows = dishes.map((d) => {
    const shares = d.components.map((c) => ({ key: c.key, share: componentShare(c, cat) }));
    const best = shares.filter((s) => s.share !== null).sort((a, b) => b.share - a.share)[0];
    return { slug: d.slug, best, qualifies: best !== undefined && best.share >= DM3_SHARE - EPS };
  });
  const rate = rows.filter((r) => r.qualifies).length / rows.length;
  return { rows, rate };
}

function gateG2() {
  const report = new Report("leaf-1.2.4 G2");
  const cat = loadCatalog();
  const dishes = loadLibrary()
    .dishes.map((x) => x.dish)
    .filter((d) => d.status === "active");
  const { rows, rate } = dm3(dishes, cat);
  const q = rows.filter((r) => r.qualifies).length;
  report.check(
    dishes.length > 0 && rate >= DM3_RATE,
    `${q}/${dishes.length} dishes (${(rate * 100).toFixed(1)} %) have a component whose variants all share >= ${DM3_SHARE * 100} % of their core ingredients (>= ${DM3_RATE * 100} %)`,
  );
  const multi = rows.filter((r) => r.best !== undefined);
  const below = multi.filter((r) => !r.qualifies);
  console.log(
    `info - dishes with a multi-variant component: ${multi.length}; below the share: ${below.map((r) => `${r.slug} (${r.best.key} ${(r.best.share * 100).toFixed(0)} %)`).join(", ") || "none"}`,
  );
  console.log(
    `info - dishes without any multi-variant component: ${
      rows
        .filter((r) => r.best === undefined)
        .map((r) => r.slug)
        .join(", ") || "none"
    }`,
  );

  // Metric checks and negative controls.
  const v = (rows2, method = "grilled") => ({
    method,
    ingredients: rows2.map(([s, g, o = {}]) => ({
      ingredient_slug: s,
      raw_g_per_batch: g,
      role_note: o.coat ? "coating" : null,
      is_absorbed_oil: Boolean(o.oil),
      cooking_liquid: o.abs ? "absorbed" : null,
      yield_override: null,
    })),
  });
  const chicken = v([
    ["chicken-breast", 1000],
    ["garlic", 15],
    ["lemon-juice", 30],
    ["olive-oil", 20],
  ]);
  const fried = v(
    [
      ["chicken-breast", 1000],
      ["garlic", 15],
      ["lemon-juice", 30],
      ["breadcrumbs", 120, { coat: true }],
      ["egg", 80, { coat: true }],
      ["sunflower-oil", 800, { oil: true }],
    ],
    "breaded_fried",
  );
  const fish = v([
    ["hammour", 1000],
    ["garlic", 15],
    ["lemon-juice", 30],
    ["olive-oil", 20],
  ]);
  report.check(
    Math.abs(sharedFraction(chicken, chicken, cat) - 1) < EPS,
    "metric: identical variants share 100 %",
  );
  report.check(
    Math.abs(sharedFraction(chicken, fried, cat) - 1) < EPS,
    "metric: coating and frying fat are excluded (grilled vs breaded-fried chicken share 100 %)",
  );
  const swapped = sharedFraction(chicken, fish, cat);
  report.check(
    swapped < DM3_SHARE,
    `negative control: swapping the main ingredient (chicken to hammour) shares ${(swapped * 100).toFixed(1)} % and fails`,
  );
  const bad = dishes.map((d) => ({
    ...clone(d),
    components: [{ key: "x", variants: [chicken, fish] }],
  }));
  const badRate = dm3(bad, cat).rate;
  report.check(
    badRate < DM3_RATE,
    `negative control: a library of such dishes measures ${(badRate * 100).toFixed(1)} % and fails the rate`,
  );
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// Compiled core (G3, G4, G6)
// ---------------------------------------------------------------------------------------------

async function withCore(report, gate, fn) {
  const out = join(CORE, "node_modules/.cache", `leaf-1.2.4-${gate}-${process.pid}`);
  rmSync(out, { recursive: true, force: true });
  try {
    const build = run(
      "pnpm",
      [
        "--filter",
        "@mealplanner/core",
        "exec",
        "tsc",
        "-p",
        "tsconfig.json",
        "--outDir",
        relative(CORE, out),
      ],
      { cwd: ROOT },
    );
    report.check(
      build.code === 0,
      `@mealplanner/core compiles with tsc into its own directory (${relative(ROOT, out)})`,
      tail(build),
    );
    if (build.code !== 0) return;
    const load = (p) => import(pathToFileURL(join(out, p)).href);
    const m = {
      nutrition: await load("src/nutrition/index.js"),
      solver: await load("src/planner/solver/index.js"),
      targets: await load("src/planner/targets/index.js"),
      config: await load("test/planner/targets/config.js"),
      fixtures: await load("test/fixtures/index.js"),
    };
    await fn(m);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function engineContext(cat) {
  return {
    ingredients: new Map(
      [...cat.ingredients.values()].map((i) => [
        i.slug,
        {
          id: i.slug,
          category: i.category,
          per100gRaw: {
            kcal: i.kcal,
            protein: i.protein_g,
            carbs: i.carbs_g,
            fat: i.fat_g,
            satFat: i.sat_fat_g,
            fibre: i.fibre_g,
            solubleFibre: i.soluble_fibre_g,
            sugar: i.sugar_g,
            sodiumMg: i.sodium_mg,
          },
        },
      ]),
    ),
    methodYields: cat.yields.map((r) => ({
      method: r.method,
      category: r.ingredient_category,
      yieldFactor: r.yield_factor,
      fatRetention: r.fat_retention,
      oilAbsorptionGPer100gRaw: r.oil_absorption_g_per_100g_raw,
    })),
  };
}

function factorMap(cat) {
  const m = new Map();
  for (const i of cat.ingredients.values()) {
    const f = i.meta?.atwater_factors;
    if (f) m.set(i.slug, { protein: f.protein, fat: f.fat, carbohydrate: f.carbohydrate });
  }
  return m;
}

function variantInput(v) {
  return {
    method: v.method,
    ingredients: v.ingredients.map((r) => ({
      ingredientId: r.ingredient_slug,
      rawG: r.raw_g_per_batch,
      isAbsorbedOil: r.is_absorbed_oil,
      ...(r.cooking_liquid === null ? {} : { cookingLiquid: r.cooking_liquid }),
      ...(r.yield_override === null ? {} : { yieldOverride: r.yield_override }),
    })),
  };
}

/** R-22 for one catalogue ingredient: generic 4/4/9/2 or its own factors within 12 %. */
function ingredientPassesNut4(i) {
  if (i.kcal === 0) return 4 * i.protein_g + 4 * i.carbs_g + 9 * i.fat_g + 2 * i.fibre_g === 0;
  const generic = 4 * i.protein_g + 4 * i.carbs_g + 9 * i.fat_g + 2 * i.fibre_g;
  if ((Math.abs(i.kcal - generic) / i.kcal) * 100 <= ATWATER_PCT) return true;
  const f = i.meta?.atwater_factors;
  if (!f) return false;
  const specific =
    f.protein * i.protein_g + f.carbohydrate * (i.carbs_g + i.fibre_g) + f.fat * i.fat_g;
  return (Math.abs(i.kcal - specific) / i.kcal) * 100 <= ATWATER_PCT;
}

/** NUT-6: a step that says "to taste" must name a gram value. */
const nut6StepProblem = (s) => /to taste/i.test(s) && !/\d+(\.\d+)?\s*g\b/.test(s);

/** SPEC-Q-4 nutrition validation of one variant; returns problems and computed nutrition. */
function variantNutritionProblems(v, where, cat, ctx, factors, nutrition) {
  const p = [];
  for (const r of v.ingredients) {
    const ing = cat.ingredients.get(r.ingredient_slug);
    if (ing === undefined) {
      p.push(`${where}: unknown ingredient ${r.ingredient_slug}`);
      continue;
    }
    if (!ingredientPassesNut4(ing))
      p.push(`${where}: ingredient ${ing.slug} fails NUT-4 under R-22`);
    // NUT-5: every (method, category) pair listed, as 1.1.3 G3 re-derives it from these files.
    if (!cat.yields.some((y) => y.method === v.method && y.ingredient_category === ing.category))
      p.push(`${where}: no method-yield row for (${v.method}, ${ing.category}) (NUT-5)`);
  }
  for (const s of v.steps ?? [])
    if (nut6StepProblem(s)) p.push(`${where}: "to taste" without grams (NUT-6): ${s}`);
  if (p.length > 0) return { problems: p };
  let result;
  try {
    result = nutrition.variantNutritionPer100gCooked(variantInput(v), ctx);
  } catch (e) {
    return { problems: [`${where}: engine error ${e.message}`] };
  }
  if (Math.abs(result.batchCookedG - v.reference_batch_cooked_g) > 1)
    p.push(
      `${where}: reference_batch_cooked_g ${v.reference_batch_cooked_g} but the engine computes ${result.batchCookedG.toFixed(1)} g`,
    );
  const check = nutrition.variantAtwaterCheck(variantInput(v), ctx, factors);
  if (!check.ok)
    p.push(`${where}: R-30 energy check ${check.deltaPct.toFixed(1)} % (> ${ATWATER_PCT} %)`);
  return { problems: p, per100g: result.per100g, deltaPct: check.deltaPct };
}

function allVariants(records, kind) {
  const out = [];
  for (const d of records)
    for (const c of d.components)
      for (const v of c.variants)
        out.push({ d, c, v, where: `${kind} ${d.slug}/${c.key}/${v.key}` });
  return out;
}

// ---------------------------------------------------------------------------------------------
// G3: every variant passes nutrition validation; >= 15 adjusters
// ---------------------------------------------------------------------------------------------

async function gateG3() {
  const report = new Report("leaf-1.2.4 G3");
  const vt = run(
    "pnpm",
    [
      "--filter",
      "@mealplanner/core",
      "exec",
      "vitest",
      "run",
      "--dir",
      "test",
      "test/nutrition/atwater.test.ts",
    ],
    { cwd: ROOT },
  );
  const vout = `${vt.stdout}\n${vt.stderr}`;
  const passed = /Tests\s+(\d+) passed/.exec(vout);
  report.check(
    vt.code === 0 && passed !== null && Number(passed[1]) > 0 && !/\bfailed\b/.test(vout),
    `Vitest: variantAtwaterCheck and atwaterCheck suite (${passed?.[1] ?? "no"} passed)`,
    tail(vt, 40),
  );
  const cat = loadCatalog();
  const lib = loadLibrary();
  await withCore(report, "G3", async (m) => {
    const ctx = engineContext(cat);
    const factors = factorMap(cat);
    const structural = [
      ...lib.dishes.flatMap(({ file, dish }) => dishProblems(dish, cat, "dish", file)),
      ...lib.adjusters.flatMap((a) => dishProblems(a, cat, "adjuster")),
    ];
    report.check(
      structural.length === 0,
      "every record is structurally valid (REC-5 step 2 references, serving bounds, grams)",
      structural.slice(0, 20).join("\n"),
    );
    const dishes = lib.dishes.map((x) => x.dish);
    const variants = [...allVariants(dishes, "dish"), ...allVariants(lib.adjusters, "adjuster")];
    const problems = [];
    let maxDelta = 0;
    for (const { v, where } of variants) {
      const r = variantNutritionProblems(v, where, cat, ctx, factors, m.nutrition);
      problems.push(...r.problems);
      if (r.deltaPct !== undefined) maxDelta = Math.max(maxDelta, r.deltaPct);
    }
    report.check(
      variants.length > 0 && problems.length === 0,
      `all ${variants.length} variants pass nutrition validation: engine, stored batch mass within 1 g, R-30 energy check (worst ${maxDelta.toFixed(2)} %), R-22 ingredients, yield rows, NUT-6`,
      problems.slice(0, 30).join("\n"),
    );
    const lowUsed = new Map();
    for (const { d, v } of variants)
      for (const r of v.ingredients)
        if (cat.ingredients.get(r.ingredient_slug)?.nutrition_confidence === "low")
          lowUsed.set(
            r.ingredient_slug,
            new Set([...(lowUsed.get(r.ingredient_slug) ?? []), d.slug]),
          );
    const source = (slug) => {
      const i = cat.ingredients.get(slug);
      const pv = i.meta?.provenance;
      return `${i.nutrition_source}${pv ? `, ${pv.dataset} record ${pv.record_id} "${pv.record_description}"` : ""}`;
    };
    console.log(
      `info - low-confidence ingredients used (SPEC-Q-7; all pass NUT-4 under R-22): ${[...lowUsed].map(([s, ds]) => `${s} [${source(s)}] in ${[...ds].join(", ")}`).join("; ") || "none"}`,
    );

    const adjusters = lib.adjusters.filter(
      (a) =>
        a.components.length === 1 && a.components[0].role === "adjuster" && a.status === "active",
    );
    report.check(
      adjusters.length >= MIN_ADJUSTERS && adjusters.length === lib.adjusters.length,
      `${adjusters.length} adjuster dishes, each a single component with role adjuster (>= ${MIN_ADJUSTERS})`,
    );

    // Negative controls.
    const target = variants.find(({ v }) =>
      v.ingredients.some((r) => r.ingredient_slug === "chicken-breast"),
    );
    const inflated = clone(cat);
    inflated.ingredients = new Map(cat.ingredients);
    inflated.ingredients.set("chicken-breast", {
      ...cat.ingredients.get("chicken-breast"),
      kcal: cat.ingredients.get("chicken-breast").kcal * 1.3,
    });
    const inflatedCtx = engineContext(inflated);
    const r1 = variantNutritionProblems(
      target.v,
      target.where,
      inflated,
      inflatedCtx,
      factorMap(inflated),
      m.nutrition,
    );
    const r1v = m.nutrition.variantAtwaterCheck(
      variantInput(target.v),
      inflatedCtx,
      factorMap(inflated),
    );
    report.check(
      r1.problems.length > 0 && !r1v.ok,
      `negative control: chicken breast kcal inflated by 30 % fails the ingredient check and the R-30 variant check of ${target.where} (${r1v.deltaPct.toFixed(1)} %)`,
    );
    const shifted = {
      ...clone(target.v),
      reference_batch_cooked_g: target.v.reference_batch_cooked_g + 50,
    };
    const r2 = variantNutritionProblems(shifted, "shifted", cat, ctx, factors, m.nutrition);
    report.check(
      r2.problems.some((s) => s.includes("reference_batch_cooked_g")),
      "negative control: a stored batch mass 50 g off is rejected",
    );
    const unknown = clone(target.v);
    unknown.ingredients[0].ingredient_slug = "unicorn-meat";
    report.check(
      variantNutritionProblems(unknown, "unknown", cat, ctx, factors, m.nutrition).problems.length >
        0,
      "negative control: an unknown ingredient slug is rejected",
    );
    const vinegar = clone(target.v);
    vinegar.ingredients.push({
      ingredient_slug: "vinegar",
      raw_g_per_batch: 20,
      role_note: null,
      is_absorbed_oil: false,
      cooking_liquid: null,
      yield_override: null,
    });
    report.check(
      variantNutritionProblems(vinegar, "vinegar", cat, ctx, factors, m.nutrition).problems.some(
        (s) => s.includes("NUT-4"),
      ),
      "negative control: an ingredient failing NUT-4 under R-22 (vinegar) is rejected",
    );
    const taste = { ...clone(target.v), steps: ["Season with salt to taste."] };
    report.check(
      variantNutritionProblems(taste, "taste", cat, ctx, factors, m.nutrition).problems.some((s) =>
        s.includes("NUT-6"),
      ),
      'negative control: a "to taste" step without grams is rejected',
    );
    report.check(
      lib.adjusters.slice(0, MIN_ADJUSTERS - 1).length < MIN_ADJUSTERS,
      "negative control: 14 adjusters would fail the count",
    );
  });
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// Solver helpers (G4, G6)
// ---------------------------------------------------------------------------------------------

function toSolve(d, cat, per100) {
  return {
    id: d.slug,
    isPackable: d.is_packable,
    servedColdOk: d.served_cold_ok,
    components: d.components.map((c) => ({
      id: `${d.slug}.${c.key}`,
      role: c.role,
      portioning: c.portioning,
      minServingG: c.min_serving_g,
      maxServingG: c.max_serving_g,
      defaultServingG: c.default_serving_g,
      stepG: c.step_g,
      unitWeightG: null,
      required: c.required,
      variants: c.variants.map((v) => ({
        id: `${d.slug}.${c.key}.${v.key}`,
        isDefault: v.is_default,
        per100g: per100.get(v),
        ingredients: [...new Set(v.ingredients.map((r) => r.ingredient_slug))].map((s) => ({
          id: s,
          category: cat.ingredients.get(s).category,
          dietaryFlags: cat.ingredients.get(s).dietary_flags,
        })),
      })),
    })),
  };
}

function prepareSolver(m, cat, lib) {
  const ctx = engineContext(cat);
  const per100 = new Map();
  const dishes = lib.dishes.map((x) => x.dish).filter((d) => d.status === "active");
  for (const d of [...dishes, ...lib.adjusters])
    for (const c of d.components)
      for (const v of c.variants)
        per100.set(v, m.nutrition.variantNutritionPer100gCooked(variantInput(v), ctx).per100g);
  const solveDishes = dishes.map((d) => ({ d, s: toSolve(d, cat, per100) }));
  const solveAdjusters = lib.adjusters.map((a) => ({ d: a, s: toSolve(a, cat, per100) }));
  const cfg = m.config.f1Config();
  const slotRow = (key) => cfg.slotTypes.find((s) => s.key === key);
  const exclusionsOf = (memberId) => {
    const own = (m.fixtures.F1.exclusions ?? []).filter(
      (e) => e.member === memberId || e.member === undefined || e.member === null,
    );
    return {
      ingredientIds: own.filter((e) => e.kind === "ingredient").map((e) => e.key),
      categories: own.filter((e) => e.kind === "category").map((e) => e.key),
      dietaryFlags: own.filter((e) => e.kind === "dietary_flag").map((e) => e.key),
    };
  };
  const memberCtx = (memberId, slotKey, appetite = "medium") => ({
    memberId,
    appetite,
    roleBias: {},
    variantAppeal: {},
    dishAppeal: {},
    exclusions: exclusionsOf(memberId),
    slot: {
      key: slotKey,
      isPacked: slotRow(slotKey).isPacked,
      reheatAvailable: slotRow(slotKey).reheatAvailable,
    },
  });
  /** Distinct targets per (member, slot, day kind) over the F1 week. */
  const targets = new Map();
  for (const date of m.config.F1_WEEK)
    for (const t of m.targets.resolveSlotTargets(cfg, date)) {
      const key = `${t.memberId}|${t.slotKey}|${t.dayKind}`;
      const prev = targets.get(key);
      if (prev === undefined) targets.set(key, t);
      else if (
        MACROS.some((k) => prev[k] !== t[k]) ||
        MACROS.some((k) => prev.tol[k] !== t.tol[k]) ||
        prev.satFatMax !== t.satFatMax
      )
        targets.set(`${key}|${date}`, t);
    }
  const adjustersFor = (slotKey) =>
    solveAdjusters.filter((a) => a.d.slot_keys.includes(slotKey)).map((a) => a.s);
  return {
    cfg,
    solveDishes,
    solveAdjusters,
    memberCtx,
    targets: [...targets.values()],
    adjustersFor,
  };
}

const macroOf = (n, m, basis) =>
  m === "carbs" ? (basis === "total" ? n.carbs + n.fibre : n.carbs) : n[m];
const unitOf = (c) =>
  c.portioning === "fixed" ? c.defaultServingG : c.portioning === "unit" ? c.unitWeightG : c.stepG;

/** Own re-check of a plate: grid, [min, max], offered variants, recomputed nutrients and tolerance. */
function plateCheck(dish, adjusters, target, solution) {
  const problems = [];
  const n = { kcal: 0, protein: 0, carbs: 0, fat: 0, satFat: 0, fibre: 0 };
  const add = (per100g, g) => {
    for (const k of Object.keys(n)) n[k] += (per100g[k] * g) / 100;
  };
  const checkGrams = (c, g, label) => {
    const unit = unitOf(c);
    if (!Number.isInteger(g) || Math.abs(g / unit - Math.round(g / unit)) > 1e-9)
      problems.push(`${label}: ${g} g off the ${unit} g grid`);
    if (g < c.minServingG - EPS || g > c.maxServingG + EPS)
      problems.push(`${label}: ${g} g outside [${c.minServingG}, ${c.maxServingG}]`);
  };
  for (const item of solution.items) {
    const c = dish.components.find((x) => x.id === item.componentId);
    const v = c?.variants.find((x) => x.id === item.variantId);
    if (v === undefined) {
      problems.push(`${item.componentId}: unknown component or variant`);
      continue;
    }
    checkGrams(c, item.cookedG, c.id);
    add(v.per100g, item.cookedG);
  }
  for (const a of solution.adjusters) {
    const adj = adjusters.find((x) => x.id === a.dishId);
    const c = adj?.components[0];
    const v = c?.variants.find((x) => x.id === a.variantId);
    if (v === undefined) {
      problems.push(`${a.dishId}: adjuster not offered`);
      continue;
    }
    checkGrams(c, a.cookedG, a.dishId);
    add(v.per100g, a.cookedG);
  }
  if (solution.adjusters.length > 2) problems.push(`${solution.adjusters.length} adjusters (> 2)`);
  let inTolerance = false;
  if (target !== null) {
    inTolerance =
      MACROS.every(
        (k) => Math.abs(macroOf(n, k, target.carbBasis) - target[k]) <= target.tol[k] + EPS,
      ) &&
      (target.satFatMax === undefined || n.satFat <= target.satFatMax + EPS);
    if (solution.status === "in_tolerance" && !inTolerance)
      problems.push("reported in_tolerance but the recomputed plate is not");
  }
  return { problems, inTolerance };
}

function ratioDeviation(dish, solution) {
  const gRef = dish.components.reduce((a, c) => a + c.defaultServingG, 0);
  const grams = dish.components.map(
    (c) => solution.items.find((i) => i.componentId === c.id)?.cookedG ?? 0,
  );
  const G = grams.reduce((a, b) => a + b, 0);
  return (
    dish.components.reduce(
      (a, c, i) => a + Math.abs(grams[i] - (c.defaultServingG / gRef) * G),
      0,
    ) / G
  );
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ---------------------------------------------------------------------------------------------
// G4: >= 80 % of dinner dishes feasible for both F1 targeted adults (SPEC-Q-2, R-31)
// ---------------------------------------------------------------------------------------------

function feasibility(env, m, entries, dinnerTargets, withAdjusters) {
  const adjusters = withAdjusters ? env.adjustersFor("dinner") : [];
  const failing = [];
  const problems = [];
  let feasible = 0;
  for (const { d, s } of entries) {
    let ok = true;
    const misses = [];
    for (const t of dinnerTargets) {
      const sol = m.solver.solvePlate({
        dish: s,
        target: t,
        member: env.memberCtx(t.memberId, "dinner"),
        adjusters,
      });
      const chk = plateCheck(s, adjusters, t, sol);
      problems.push(...chk.problems.map((x) => `${d.slug}/${t.memberId}/${t.dayKind}: ${x}`));
      if (!(sol.status === "in_tolerance" && chk.inTolerance)) {
        ok = false;
        misses.push(`${t.memberId} ${t.dayKind}`);
      }
    }
    if (ok) feasible++;
    else failing.push(`${d.slug} (${misses.join(", ")})`);
  }
  return { feasible, rate: entries.length > 0 ? feasible / entries.length : 0, failing, problems };
}

async function gateG4() {
  const report = new Report("leaf-1.2.4 G4");
  const cat = loadCatalog();
  const lib = loadLibrary();
  await withCore(report, "G4", async (m) => {
    await m.solver.loadPortionSolver();
    const env = prepareSolver(m, cat, lib);
    const targeted = env.cfg.members.filter((mb) => mb.isTargeted).map((mb) => mb.id);
    const dinnerTargets = env.targets.filter(
      (t) => t.slotKey === "dinner" && targeted.includes(t.memberId),
    );
    report.check(
      targeted.length === 2 &&
        targeted.every((id) => dinnerTargets.filter((t) => t.memberId === id).length >= 1),
      `F1 dinner targets from resolveSlotTargets: ${dinnerTargets.map((t) => `${t.memberId}/${t.dayKind} ${t.kcal} kcal P${t.protein} C${t.carbs} F${t.fat} ±${t.tol.kcal} kcal sat<=${t.satFatMax}`).join("; ")}`,
    );
    const dinner = env.solveDishes.filter(({ d }) => suits(d, "dinner"));
    report.check(dinner.length >= MIN_PER_SLOT, `${dinner.length} dinner dishes measured`);
    const withAdj = feasibility(env, m, dinner, dinnerTargets, true);
    const without = feasibility(env, m, dinner, dinnerTargets, false);
    report.check(
      withAdj.problems.length === 0 && without.problems.length === 0,
      "every solved plate re-checks: on the grid, within [min, max], status matches the recomputed nutrients",
      [...withAdj.problems, ...without.problems].slice(0, 20).join("\n"),
    );
    report.check(
      withAdj.rate >= FEASIBLE_RATE,
      `feasible for both adults at every dinner target, up to 2 adjusters (R-31): ${withAdj.feasible}/${dinner.length} = ${(withAdj.rate * 100).toFixed(1)} % (>= ${FEASIBLE_RATE * 100} %)`,
    );
    console.log(
      `info - without adjusters: ${without.feasible}/${dinner.length} = ${(without.rate * 100).toFixed(1)} %`,
    );
    console.log(`info - infeasible with adjusters: ${withAdj.failing.join("; ") || "none"}`);
    console.log(`info - infeasible without adjusters: ${without.failing.join("; ") || "none"}`);

    // Negative controls.
    const badDish = {
      slug: "control-fried-lamb",
      d: null,
      s: {
        id: "control-fried-lamb",
        isPackable: false,
        servedColdOk: false,
        components: [
          {
            ...env.solveDishes[0].s.components[0],
            id: "control.lamb",
            minServingG: 250,
            maxServingG: 400,
            defaultServingG: 300,
            required: true,
            variants: [
              {
                id: "control.lamb.fried",
                isDefault: true,
                per100g: {
                  kcal: 330,
                  protein: 20,
                  carbs: 8,
                  fat: 25,
                  satFat: 11,
                  fibre: 0,
                  solubleFibre: 0,
                  sugar: 0,
                  sodiumMg: 300,
                },
                ingredients: [{ id: "lamb-mince", category: "red_meat", dietaryFlags: [] }],
              },
            ],
          },
        ],
      },
    };
    badDish.d = { slug: badDish.slug };
    const control = feasibility(
      env,
      m,
      Array.from({ length: 10 }, () => badDish),
      dinnerTargets,
      true,
    );
    report.check(
      control.rate < FEASIBLE_RATE,
      `negative control: a library of a fatty single-component dish measures ${(control.rate * 100).toFixed(0)} % and fails the threshold`,
    );
    const t0 = dinnerTargets[0];
    const good = m.solver.solvePlate({
      dish: dinner[0].s,
      target: t0,
      member: env.memberCtx(t0.memberId, "dinner"),
      adjusters: [],
    });
    const tampered = {
      ...good,
      items: good.items.map((i, k) => (k === 0 ? { ...i, cookedG: i.cookedG + 60 } : i)),
    };
    report.check(
      !plateCheck(dinner[0].s, [], t0, tampered).inTolerance,
      "negative control: the re-check rejects an in-tolerance plate with 60 g more of its first component",
    );
  });
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G6: plate naturalness on the seed library (PLN-5, SPEC-Q-5)
// ---------------------------------------------------------------------------------------------

async function gateG6() {
  const report = new Report("leaf-1.2.4 G6");
  const cat = loadCatalog();
  const lib = loadLibrary();
  await withCore(report, "G6", async (m) => {
    await m.solver.loadPortionSolver();
    const env = prepareSolver(m, cat, lib);
    const problems = [];
    const ratios = [];
    const statuses = {};
    const perSlot = {};
    let plates = 0;
    for (const t of env.targets) {
      const adjusters = env.adjustersFor(t.slotKey);
      for (const { d, s } of env.solveDishes.filter(({ d: x }) => suits(x, t.slotKey))) {
        const sol = m.solver.solvePlate({
          dish: s,
          target: t,
          member: env.memberCtx(t.memberId, t.slotKey),
          adjusters,
        });
        plates++;
        statuses[sol.status] = (statuses[sol.status] ?? 0) + 1;
        const ps = (perSlot[t.slotKey] ??= { plates: 0, inTolerance: 0 });
        ps.plates++;
        const chk = plateCheck(s, adjusters, t, sol);
        problems.push(
          ...chk.problems.map((x) => `${d.slug}/${t.memberId}/${t.slotKey}/${t.dayKind}: ${x}`),
        );
        if (sol.status === "in_tolerance" && chk.inTolerance) {
          ps.inTolerance++;
          ratios.push(ratioDeviation(s, sol));
        }
      }
    }
    for (const child of env.cfg.members.filter((mb) => !mb.isTargeted))
      for (const { d, s } of env.solveDishes)
        for (const slotKey of d.slot_keys) {
          const sol = m.solver.solvePlate({
            dish: s,
            target: null,
            member: env.memberCtx(child.id, slotKey, child.appetite),
            adjusters: [],
          });
          plates++;
          statuses[sol.status] = (statuses[sol.status] ?? 0) + 1;
          problems.push(
            ...plateCheck(s, [], null, sol).problems.map(
              (x) => `${d.slug}/${child.id}/${slotKey}: ${x}`,
            ),
          );
          if (
            sol.items.some((i) =>
              s.components
                .find((c) => c.id === i.componentId)
                .variants.find((v) => v.id === i.variantId)
                .ingredients.some((ing) =>
                  env
                    .memberCtx(child.id, slotKey)
                    .exclusions.dietaryFlags.some((f) => ing.dietaryFlags.includes(f)),
                ),
            )
          )
            problems.push(`${d.slug}/${child.id}: an excluded ingredient was served`);
        }
    report.check(
      plates > 0 && problems.length === 0,
      `no component outside [min, max] or off its grid on ${plates} solved F1 plates ${JSON.stringify(statuses)}`,
      problems.slice(0, 20).join("\n"),
    );
    const med = median(ratios);
    report.check(
      ratios.length >= 100 && med <= RATIO_LIMIT,
      `median ratio deviation Σ|g − ρG|/G over ${ratios.length} in-tolerance targeted plates = ${(med * 100).toFixed(1)} % (limit ${RATIO_LIMIT * 100} %)`,
    );
    console.log(
      `info - in tolerance by slot: ${Object.entries(perSlot)
        .map(([k, v]) => `${k} ${v.inTolerance}/${v.plates}`)
        .join(", ")}`,
    );

    // Negative controls.
    const { s } = env.solveDishes.find(({ s: x }) => x.components.length >= 2);
    const [c0, c1] = s.components;
    const lopsided = {
      status: "in_tolerance",
      adjusters: [],
      items: [
        { componentId: c0.id, variantId: c0.variants[0].id, cookedG: c0.maxServingG },
        {
          componentId: c1.id,
          variantId: c1.variants[0].id,
          cookedG: Math.ceil(c1.minServingG / c1.stepG) * c1.stepG,
        },
      ],
    };
    const lr = ratioDeviation(s, lopsided);
    report.check(
      lr > RATIO_LIMIT && median(ratios.map(() => lr)) > RATIO_LIMIT,
      `negative control: a lopsided plate (${c0.maxServingG} g of ${c0.id}, minimum of ${c1.id}) measures ${(lr * 100).toFixed(0)} % and fails the median limit`,
    );
    const over = {
      ...lopsided,
      items: [{ ...lopsided.items[0], cookedG: c0.maxServingG + c0.stepG }],
    };
    report.check(
      plateCheck(s, [], null, over).problems.some((x) => x.includes("outside")),
      `negative control: ${c0.maxServingG + c0.stepG} g of ${c0.id} is caught as outside [min, max]`,
    );
  });
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G5 material: a seeded random draw of 10 recipes, printed for the architect's manual review
// ---------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function g5Sample(seed) {
  const cat = loadCatalog();
  const dishes = loadLibrary()
    .dishes.map((x) => x.dish)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const rand = mulberry32(seed);
  for (let i = dishes.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [dishes[i], dishes[j]] = [dishes[j], dishes[i]];
  }
  console.log(
    `G5 sample: seed ${seed}, 10 of ${dishes.length} dishes (Fisher-Yates over slugs sorted A-Z, mulberry32)\n`,
  );
  for (const d of dishes.slice(0, 10)) {
    console.log(`## ${d.name} (${d.slug})`);
    console.log(`${d.description}`);
    console.log(
      `Cuisine: ${d.cuisine}${d.secondary_cuisine ? ` / ${d.secondary_cuisine}` : ""}. Slots: ${d.slot_keys.join(", ")}. Packable: ${d.is_packable ? "yes" : "no"}. Served cold: ${d.served_cold_ok ? "yes" : "no"}.`,
    );
    for (const c of d.components) {
      console.log(
        `\n### ${c.name} (${c.role}; ${c.min_serving_g}–${c.max_serving_g} g cooked per plate, default ${c.default_serving_g} g${c.required ? "" : ", optional"})`,
      );
      for (const v of c.variants) {
        console.log(
          `\n**${v.label}** (${v.method}${v.is_default ? ", default" : ""}; batch ≈ ${v.reference_batch_cooked_g} g cooked; ${v.cook_time_min} min)`,
        );
        console.log("Ingredients:");
        for (const r of v.ingredients) {
          const ing = cat.ingredients.get(r.ingredient_slug);
          const notes = [
            r.role_note,
            r.is_absorbed_oil ? "frying fat, mostly discarded" : null,
            r.cooking_liquid ? `cooking liquid, ${r.cooking_liquid}` : null,
          ].filter(Boolean);
          console.log(
            `- ${r.raw_g_per_batch} g ${ing?.name ?? r.ingredient_slug}${notes.length ? ` (${notes.join("; ")})` : ""}`,
          );
        }
        console.log("Method:");
        v.steps.forEach((s, i) => console.log(`${i + 1}. ${s}`));
      }
    }
    console.log("\nAssembly:");
    d.assembly_steps.forEach((s, i) => console.log(`${i + 1}. ${s}`));
    console.log("\n---\n");
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4, G6: gateG6 };

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--g5-sample")) {
    const i = args.indexOf("--seed");
    return g5Sample(i >= 0 ? Number(args[i + 1]) : 20260926);
  }
  const gate = args[args.indexOf("--gate") + 1];
  const fn = args.includes("--gate") ? GATES[gate] : undefined;
  if (fn === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.2.4.mjs --gate ${Object.keys(GATES).join("|")} | --g5-sample [--seed <n>]`,
    );
    return 2;
  }
  return await fn();
}

process.exitCode = await main();
