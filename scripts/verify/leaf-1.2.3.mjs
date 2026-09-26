// Verify script for leaf 1.2.3 (dish scoring, plan search, cook sheet).
// Usage: node scripts/verify/leaf-1.2.3.mjs --gate G1|G2|G3|G4|G5|G6
// Prints "VERIFY leaf-1.2.3 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise.
//
// Each gate compiles @mealplanner/core with tsc into a directory of its own
// (packages/core/node_modules/.cache/leaf-1.2.3-<gate>-<pid>, removed at the end), so gates can run
// concurrently. Plans come from the compiled planner and the seed library (data/). Every assertion
// re-derives what it checks with this script's own arithmetic from the seed JSON files and the
// catalogue: plate nutrients from per-100 g values × grams, targets from the resolver, core
// ingredients from the catalogue categories, sesame from the catalogue flags. Measured figures are
// computed on each run. G3 and G4 run plans in child processes (`--worker`) of this script.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE = join(ROOT, "packages/core");
const DATA = join(ROOT, "data");
const SELF = fileURLToPath(import.meta.url);
const EPS = 1e-6;

const SC2_REDUCTION = 0.25;
const G3_SEEDS = 50;
const DAY_BUDGET_S = 5;
const WEEK_BUDGET_S = 30;

// ---------------------------------------------------------------------------------------------
// Independent data: seed JSON and the catalogue
// ---------------------------------------------------------------------------------------------

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function seedIndex() {
  const catalogue = new Map(
    readJson(join(DATA, "ingredients.v1.json")).ingredients.map((i) => [i.slug, i]),
  );
  const dir = join(DATA, "seed-dishes");
  const dishes = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(join(dir, f)));
  const adjusters = readJson(join(DATA, "adjusters.json")).adjusters;
  /** variant id (`<dish>.<component>.<variant>`) → ingredient slugs of the seed record. */
  const variants = new Map();
  for (const d of [...dishes, ...adjusters])
    for (const c of d.components)
      for (const v of c.variants)
        variants.set(`${d.slug}.${c.key}.${v.key}`, {
          dish: d,
          component: c,
          variant: v,
          slugs: [...new Set(v.ingredients.map((r) => r.ingredient_slug))],
        });
  const isCore = (slug) => catalogue.get(slug)?.category !== "herb_spice" && slug !== "water";
  const hasFlag = (slug, flag) => catalogue.get(slug)?.dietary_flags.includes(flag) ?? false;
  return { catalogue, dishes, adjusters, variants, isCore, hasFlag };
}

/** The seed and catalogue files as the core test library builds them (library.ts SeedFiles). */
function seedFiles() {
  const dir = join(DATA, "seed-dishes");
  return {
    ingredients: readJson(join(DATA, "ingredients.v1.json")),
    methodYields: readJson(join(DATA, "method-yields.v1.json")),
    dishes: readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(join(dir, f))),
    adjusters: readJson(join(DATA, "adjusters.json")),
  };
}

const seedLibrary = (m) => m.library.buildSeedLibrary(seedFiles());

/** Variant ids served on a plate: items and adjusters. */
const servedVariantIds = (plate) => [
  ...plate.solution.items.map((i) => i.variantId),
  ...plate.solution.adjusters.map((a) => a.variantId),
];

// ---------------------------------------------------------------------------------------------
// Compiled core
// ---------------------------------------------------------------------------------------------

function compileCore(report, label) {
  const out = join(CORE, "node_modules/.cache", `leaf-1.2.3-${label}-${process.pid}`);
  rmSync(out, { recursive: true, force: true });
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
  return build.code === 0 ? out : null;
}

async function loadCore(out) {
  const load = (p) => import(pathToFileURL(join(out, p)).href);
  return {
    planner: await load("src/planner/index.js"),
    library: await load("test/planner/select/library.js"),
    f1: await load("test/planner/select/f1.js"),
  };
}

async function withCore(report, gate, fn) {
  const out = compileCore(report, gate);
  if (out === null) return;
  try {
    await fn(await loadCore(out), out);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function vitest(report, files) {
  const r = run(
    "pnpm",
    ["--filter", "@mealplanner/core", "exec", "vitest", "run", "--dir", "test", ...files],
    { cwd: ROOT },
  );
  const out = `${r.stdout}\n${r.stderr}`;
  const passed = /Tests\s+(\d+) passed/.exec(out);
  report.check(
    r.code === 0 &&
      passed !== null &&
      Number(passed[1]) > 0 &&
      !/\bfailed\b/.test(out) &&
      !/\bskipped\b/.test(out),
    `Vitest ${files.map((f) => f.split("/").at(-1)).join(", ")}: ${passed?.[1] ?? "no"} tests passed`,
    tail(r, 40),
  );
}

/** F1 planner input: seed library, AI off (G1: "AI off"). */
function f1Input(m, lib, dates, over = {}) {
  const config = over.config ?? m.f1.f1PlanConfig(over.configOpts ?? {});
  config.planningWeights = {
    ...config.planningWeights,
    aiGeneration: "off",
    ...(over.weights ?? {}),
  };
  return { config, dates, dishes: lib.dishes, adjusters: lib.adjusters };
}

// ---------------------------------------------------------------------------------------------
// Own arithmetic on plates
// ---------------------------------------------------------------------------------------------

function variantOf(plan, dishId, variantId) {
  for (const c of plan.dishes[dishId]?.components ?? []) {
    const v = c.variants.find((x) => x.id === variantId);
    if (v !== undefined) return { component: c, variant: v };
  }
  return null;
}

/** Plate nutrients from per-100 g × grams, and grid / [min, max] problems. */
function recompute(plan, meal, plate) {
  const n = { kcal: 0, protein: 0, carbs: 0, fat: 0, satFat: 0, fibre: 0 };
  const problems = [];
  const add = (dishId, variantId, g) => {
    const found = variantOf(plan, dishId, variantId);
    if (found === null) {
      problems.push(`${variantId} not in dish ${dishId}`);
      return;
    }
    const { component: c, variant: v } = found;
    const unit =
      c.portioning === "fixed"
        ? c.defaultServingG
        : c.portioning === "unit"
          ? c.unitWeightG
          : c.stepG;
    if (!Number.isInteger(g) || Math.abs(g / unit - Math.round(g / unit)) > 1e-9)
      problems.push(`${variantId}: ${g} g off its ${unit} g grid`);
    if (g < c.minServingG - EPS || g > c.maxServingG + EPS)
      problems.push(`${variantId}: ${g} g outside [${c.minServingG}, ${c.maxServingG}]`);
    for (const k of Object.keys(n)) n[k] += (v.per100g[k] * g) / 100;
  };
  for (const i of plate.solution.items) add(meal.dishId, i.variantId, i.cookedG);
  for (const a of plate.solution.adjusters) add(a.dishId, a.variantId, a.cookedG);
  if (plate.solution.adjusters.length > 2)
    problems.push(`${plate.solution.adjusters.length} adjusters (> 2, PLN-6)`);
  return { n, problems };
}

const macroOf = (n, m, basis) =>
  m === "carbs" ? (basis === "total" ? n.carbs + n.fibre : n.carbs) : n[m];

// ---------------------------------------------------------------------------------------------
// G1: SC-1 and R-28 member-day totals
// ---------------------------------------------------------------------------------------------

/**
 * Every targeted member-meal of the plan: in tolerance by this script's arithmetic (P/C/F per meal
 * against the resolver's targets, sat-fat cap, kcal inside the R-28 re-targeted window), or flagged
 * with a reason. Member-day kcal totals against ±tolerance.kcal. Returns failures and figures.
 */
function g1Evaluate(m, plan, cfg) {
  const failures = [];
  const rows = [];
  const memberDays = [];
  const flaggedKey = (f) => `${f.date}|${f.slotKey}|${f.memberId}`;
  const flagged = new Set(
    plan.flags.filter((f) => f.memberId !== null && f.slotKey !== null).map(flaggedKey),
  );
  const sharedFlagged = new Set(
    plan.flags
      .filter((f) => f.memberId === null && f.slotKey !== null)
      .map((f) => `${f.date}|${f.slotKey}`),
  );
  for (const date of plan.dates) {
    const targets = m.planner.resolveSlotTargets(cfg, date);
    const slotTime = (id) => {
      const s = cfg.slotTypes.find((x) => x.id === id);
      return `${s.defaultTime}|${String(s.sortOrder).padStart(6, "0")}|${s.key}`;
    };
    const meals = plan.days.find((d) => d.date === date)?.meals ?? [];
    for (const member of [...new Set(targets.map((t) => t.memberId))]) {
      const own = targets
        .filter((t) => t.memberId === member)
        .sort((a, b) => (slotTime(a.slotTypeId) < slotTime(b.slotTypeId) ? -1 : 1));
      const tolKcal = cfg.tolerances.find((t) => t.memberId === member)?.kcal ?? 50;
      let d = 0;
      let band = 0;
      let total = 0;
      let dayFlagged = false;
      for (const t of own) {
        band += t.tol.kcal;
        const hits = meals.flatMap((meal) =>
          meal.slotTypeId === t.slotTypeId
            ? meal.plates.filter((p) => p.memberId === member).map((plate) => ({ meal, plate }))
            : [],
        );
        const key = `${date}|${t.slotKey}|${member}`;
        if (hits.length !== 1) {
          const ok = hits.length === 0 && flagged.has(key);
          if (!ok) failures.push(`${key}: ${hits.length} plates and no flag`);
          rows.push({ key, status: "no plate", flagged: flagged.has(key) });
          dayFlagged = true;
          continue;
        }
        const { meal, plate } = hits[0];
        const { n, problems } = recompute(plan, meal, plate);
        for (const p of problems) failures.push(`${key}: ${p}`);
        const devs = {};
        for (const mm of ["protein", "carbs", "fat"])
          devs[mm] = macroOf(n, mm, t.carbBasis) - t[mm];
        const windowKcal = t.kcal - d;
        devs.kcal = n.kcal - windowKcal;
        const inTol =
          ["protein", "carbs", "fat"].every((mm) => Math.abs(devs[mm]) <= t.tol[mm] + EPS) &&
          Math.abs(devs.kcal) <= band + EPS &&
          (t.satFatMax === undefined || n.satFat <= t.satFatMax + EPS);
        const isFlagged = plate.flag !== null && plate.flag !== "" && flagged.has(key);
        if (plate.fitStatus === "in_tolerance" && !inTol)
          failures.push(`${key}: reported in_tolerance but recomputes outside tolerance`);
        if (!inTol && !isFlagged) failures.push(`${key}: out of tolerance and not flagged`);
        if (plate.fitStatus !== "in_tolerance") dayFlagged = true;
        if (plate.fitStatus !== "in_tolerance" && !isFlagged)
          failures.push(`${key}: status ${plate.fitStatus} without a flag`);
        if (
          plate.target !== null &&
          (Math.abs(plate.target.kcal - windowKcal) > 1e-6 ||
            Math.abs(plate.target.tol.kcal - band) > 1e-6) &&
          !meal.locked
        )
          failures.push(
            `${key}: target ${plate.target.kcal}±${plate.target.tol.kcal} is not the R-28 window ${windowKcal.toFixed(1)}±${band}`,
          );
        rows.push({
          key,
          status: inTol ? "in_tolerance" : plate.fitStatus,
          flagged: isFlagged,
          reason: plate.flag,
          devs,
          relaxed:
            meal.explain.some((e) => e.startsWith("Frequency relaxed")) ||
            sharedFlagged.has(`${date}|${t.slotKey}`),
        });
        d += n.kcal - t.kcal;
        total += n.kcal;
      }
      const target = own.reduce((s, t) => s + t.kcal, 0);
      const within = Math.abs(total - target) <= tolKcal + EPS;
      if (Math.abs(band - tolKcal) > EPS)
        failures.push(
          `${date} ${member}: slot bands sum to ${band}, not tolerance.kcal ${tolKcal}`,
        );
      if (!dayFlagged && !within)
        failures.push(
          `${date} ${member}: day total ${total.toFixed(1)} outside ${target} ± ${tolKcal}`,
        );
      const reported = plan.memberDays.find((x) => x.memberId === member && x.date === date);
      if (
        dayFlagged &&
        !plan.flags.some(
          (f) => f.kind === "member_day_kcal" && f.date === date && f.memberId === member,
        )
      )
        failures.push(`${date} ${member}: member-day with a flagged slot is not flagged`);
      if (reported === undefined || Math.abs(reported.kcalActual - total) > 1e-6)
        failures.push(`${date} ${member}: memberDays total disagrees`);
      memberDays.push({ date, member, target, total, tolKcal, within, dayFlagged });
    }
  }
  return { failures, rows, memberDays };
}

function clonePlan(plan) {
  return structuredClone(plan);
}

async function gateG1() {
  const report = new Report("leaf-1.2.3 G1");
  vitest(report, [
    "test/planner/select/score.test.ts",
    "test/planner/select/retarget.test.ts",
    "test/planner/select/improve.test.ts",
    "test/planner/select/plan.test.ts",
  ]);
  await withCore(report, "G1", async (m) => {
    const lib = seedLibrary(m);
    const input = f1Input(m, lib, [...m.f1.F1_WEEK]);
    const plan = await m.planner.planDays(input, { seed: 1 });
    const r = g1Evaluate(m, plan, input.config);
    const total = r.rows.length;
    const inTol = r.rows.filter((x) => x.status === "in_tolerance").length;
    const flaggedRows = r.rows.filter((x) => x.status !== "in_tolerance");
    report.check(
      total > 0 && r.failures.length === 0,
      `SC-1: ${total} targeted member-meals over the F1 week (seed library, AI off): ${inTol} in tolerance (${((inTol / total) * 100).toFixed(1)} %), ${flaggedRows.length} flagged with a reason, 0 unflagged misses`,
      r.failures.slice(0, 30).join("\n"),
    );
    for (const x of flaggedRows)
      console.log(
        `info - flagged ${x.key}: ${x.status}; ${x.reason ?? "no plate"}${x.devs ? `; smallest deviation found: P ${x.devs.protein.toFixed(1)} g, C ${x.devs.carbs.toFixed(1)} g, F ${x.devs.fat.toFixed(1)} g, kcal ${x.devs.kcal.toFixed(1)}` : ""}`,
      );
    const relaxed = plan.flags.filter((f) => f.kind === "frequency_relaxed");
    console.log(
      `info - frequency relaxed (SPEC-Q-15): ${relaxed.map((f) => `${f.date} ${f.slotKey} ${f.memberId ?? "shared"}`).join("; ") || "none"}`,
    );
    const unflaggedDays = r.memberDays.filter((x) => !x.dayFlagged);
    report.check(
      unflaggedDays.every((x) => x.within) && unflaggedDays.length > 0,
      `R-28: all ${unflaggedDays.length} member-days without a flagged slot are within ±tolerance.kcal; ${r.memberDays.length - unflaggedDays.length} member-day(s) flagged (SPEC-Q-2)`,
    );
    for (const x of r.memberDays)
      console.log(
        `info - member-day ${x.date} ${x.member}: ${x.total.toFixed(1)} kcal against ${x.target} ± ${x.tolKcal} (${(x.total - x.target).toFixed(1)})${x.dayFlagged ? " FLAGGED" : ""}${x.within ? "" : " OUTSIDE"}`,
      );
    const pcf = r.rows
      .filter((x) => x.devs)
      .map((x) =>
        Math.max(
          Math.abs(x.devs.protein) / 5,
          Math.abs(x.devs.carbs) / 5,
          Math.abs(x.devs.fat) / 2,
        ),
      );
    console.log(
      `info - per-meal P/C/F: worst |dev|/tol ${Math.max(...pcf).toFixed(2)} over ${pcf.length} plates`,
    );

    // Negative controls: the same evaluation on known-bad plans must fail.
    const inTolPlate = () => {
      for (const d of plan.days)
        for (const meal of d.meals)
          for (const p of meal.plates)
            if (p.targeted && p.fitStatus === "in_tolerance") return { d: d.date, meal, p };
      return null;
    };
    const target = inTolPlate();
    const locate = (pl) =>
      pl.days
        .find((d) => d.date === target.d)
        .meals.find(
          (mm) =>
            mm.slotTypeId === target.meal.slotTypeId && mm.memberScope === target.meal.memberScope,
        )
        .plates.find((p) => p.memberId === target.p.memberId);
    const bumped = clonePlan(plan);
    const bp = locate(bumped);
    bp.solution.items[0].cookedG += 60;
    report.check(
      g1Evaluate(m, bumped, input.config).failures.length > 0,
      `negative control: 60 g more on ${target.meal.slotKey} ${target.d} ${target.p.memberId}'s plate, unflagged, fails SC-1`,
    );
    const dropped = clonePlan(plan);
    const dm = dropped.days
      .find((d) => d.date === target.d)
      .meals.find(
        (mm) =>
          mm.slotTypeId === target.meal.slotTypeId && mm.memberScope === target.meal.memberScope,
      );
    dm.plates = dm.plates.filter((p) => p.memberId !== target.p.memberId);
    report.check(
      g1Evaluate(m, dropped, input.config).failures.length > 0,
      "negative control: a targeted member-meal with no plate and no flag fails SC-1",
    );
    const miss = clonePlan(plan);
    const mp = locate(miss);
    mp.fitStatus = "infeasible";
    mp.flag = null;
    report.check(
      g1Evaluate(m, miss, input.config).failures.length > 0,
      "negative control: an infeasible plate without a flag fails SC-1",
    );
    const drift = clonePlan(plan);
    const dp = locate(drift);
    dp.target = { ...dp.target, kcal: dp.target.kcal + 40 };
    report.check(
      g1Evaluate(m, drift, input.config).failures.length > 0,
      "negative control: a plate target that is not the R-28 re-targeted window fails",
    );
  });
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G2: SC-2 distinct ingredients, economy 0.4 against 0
// ---------------------------------------------------------------------------------------------

function distinctIngredients(plan, idx) {
  const core = new Set();
  const all = new Set();
  for (const d of plan.days)
    for (const meal of d.meals)
      for (const p of meal.plates)
        for (const v of servedVariantIds(p)) {
          const rec = idx.variants.get(v);
          if (rec === undefined) throw new Error(`variant ${v} not in the seed files`);
          for (const s of rec.slugs) {
            all.add(s);
            if (idx.isCore(s)) core.add(s);
          }
        }
  const dishes = new Set(plan.days.flatMap((d) => d.meals.map((mm) => mm.dishId)));
  const meals = plan.days.reduce((s, d) => s + d.meals.length, 0);
  return { core: core.size, all: all.size, dishes: dishes.size, meals };
}

async function gateG2() {
  const report = new Report("leaf-1.2.3 G2");
  vitest(report, ["test/planner/select/score.test.ts"]);
  await withCore(report, "G2", async (m) => {
    const idx = seedIndex();
    const lib = seedLibrary(m);
    const plan = (economy) =>
      m.planner.planDays(
        f1Input(m, lib, [...m.f1.F1_WEEK], { weights: { ingredientEconomy: economy } }),
        { seed: 1 },
      );
    const withEconomy = await plan(0.4);
    const baseline = await plan(0);
    report.check(
      withEconomy.weights[m.f1.F1_WEEK[0]].ingredientEconomy === 0.4 &&
        baseline.weights[m.f1.F1_WEEK[0]].ingredientEconomy === 0,
      "the two plans differ only in ingredient_economy (0.4 against 0), same seed and configuration otherwise",
    );
    const a = distinctIngredients(withEconomy, idx);
    const b = distinctIngredients(baseline, idx);
    const reduction = 1 - a.core / b.core;
    const reductionAll = 1 - a.all / b.all;
    console.log(
      `info - economy 0.4: ${a.core} core / ${a.all} all ingredients, ${a.dishes} dishes over ${a.meals} meals`,
    );
    console.log(
      `info - economy 0:   ${b.core} core / ${b.all} all ingredients, ${b.dishes} dishes over ${b.meals} meals`,
    );
    console.log(
      `info - all ingredients (spices and water included): ${(reductionAll * 100).toFixed(1)} % fewer`,
    );
    report.check(
      reduction >= SC2_REDUCTION,
      `SC-2: distinct core ingredients over the F1 week, economy 0.4 against 0: ${a.core} against ${b.core} = ${(reduction * 100).toFixed(1)} % fewer (>= ${SC2_REDUCTION * 100} %)`,
    );
    // Negative controls.
    const self = distinctIngredients(withEconomy, idx);
    report.check(
      1 - self.core / a.core < SC2_REDUCTION,
      "negative control: a plan measured against itself shows 0 % and fails the threshold",
    );
    const extra = clonePlan(withEconomy);
    const meal = extra.days[0].meals[0];
    const seen = servedSlugs(withEconomy, idx);
    const other = [...idx.variants.keys()].find((v) =>
      idx.variants.get(v).slugs.some((s) => idx.isCore(s) && !seen.has(s)),
    );
    meal.plates[0].solution.adjusters.push({ dishId: "control", variantId: other, cookedG: 10 });
    report.check(
      distinctIngredients(extra, idx).core > a.core,
      "negative control: serving one more variant with an unseen core ingredient raises the measured count",
    );
  });
  return report.finish();
}

function servedSlugs(plan, idx) {
  const out = new Set();
  for (const d of plan.days)
    for (const meal of d.meals)
      for (const p of meal.plates)
        for (const v of servedVariantIds(p))
          for (const s of idx.variants.get(v)?.slugs ?? []) out.add(s);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Workers (G3, G4): plans in child processes
// ---------------------------------------------------------------------------------------------

function stablePlanHash(plan) {
  // Run counters are not part of the plan: wall-clock time, and solves and cache hits.
  const stats = { ...plan.stats, ms: 0, solves: 0, cacheHits: 0 };
  return createHash("sha256")
    .update(JSON.stringify({ ...plan, stats }))
    .digest("hex");
}

/** Child process: plans and prints one JSON line per plan. */
async function worker(args) {
  const [kind, out, ...rest] = args;
  const m = await loadCore(out);
  const lib = seedLibrary(m);
  await m.planner.loadPortionSolver();
  if (kind === "g3") {
    const [allergy, seeds] = rest;
    for (const seed of seeds.split(",").map(Number)) {
      const input = f1Input(m, lib, [...m.f1.F1_WEEK], {
        configOpts: { sesameAllergy: allergy === "1" },
      });
      const plan = await m.planner.planDays(input, { seed });
      const c3 = [];
      for (const d of plan.days)
        for (const meal of d.meals)
          for (const p of meal.plates)
            if (p.memberId === "c3")
              c3.push({
                date: d.date,
                slot: meal.slotKey,
                dish: meal.dishId,
                variants: servedVariantIds(p),
              });
      console.log(JSON.stringify({ seed, c3 }));
    }
  } else if (kind === "g4") {
    const [seed, dates] = rest;
    const input = f1Input(m, lib, dates.split(","));
    // Main-thread CPU (SPEC-Q-16): the planner is single-threaded; V8's background compile and GC
    // threads are not planning work and would count in process.cpuUsage().
    const cpu0 = process.threadCpuUsage();
    const t0 = performance.now();
    const plan = await m.planner.planDays(input, { seed: Number(seed) });
    const wall = (performance.now() - t0) / 1000;
    const cpu = process.threadCpuUsage(cpu0);
    console.log(
      JSON.stringify({
        seed: Number(seed),
        dates,
        wall,
        cpu: (cpu.user + cpu.system) / 1e6,
        hash: stablePlanHash(plan),
        meals: plan.days.reduce((s, d) => s + d.meals.length, 0),
      }),
    );
  }
  return 0;
}

function spawnWorker(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [SELF, "--worker", ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("close", (code) =>
      resolvePromise({
        code,
        stdout,
        stderr,
        lines: stdout
          .split("\n")
          .filter((l) => l.startsWith("{"))
          .map((l) => JSON.parse(l)),
      }),
    );
  });
}

/** Runs the jobs `width` at a time; results in job order. */
async function pool(jobs, width) {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(width, jobs.length)) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await spawnWorker(jobs[i]);
      }
    }),
  );
  return results;
}

const WIDTH = Math.max(1, Math.min(4, availableParallelism()));

// ---------------------------------------------------------------------------------------------
// G3: C3 sesame across 50 seeded plans
// ---------------------------------------------------------------------------------------------

function sesameOnC3(results, idx) {
  const hits = [];
  let plates = 0;
  for (const r of results)
    for (const x of r.c3) {
      plates++;
      for (const v of x.variants) {
        const rec = idx.variants.get(v);
        if (rec === undefined)
          hits.push(`seed ${r.seed} ${x.date} ${x.slot}: unknown variant ${v}`);
        else if (rec.slugs.some((s) => idx.hasFlag(s, "contains_sesame")))
          hits.push(
            `seed ${r.seed} ${x.date} ${x.slot}: ${v} (${rec.slugs.filter((s) => idx.hasFlag(s, "contains_sesame")).join(", ")})`,
          );
      }
    }
  return { hits, plates };
}

async function gateG3() {
  const report = new Report("leaf-1.2.3 G3");
  vitest(report, ["test/planner/select/filters.test.ts"]);
  const out = compileCore(report, "G3");
  if (out === null) return report.finish();
  try {
    const idx = seedIndex();
    const sesameDishes = idx.dishes.filter((d) =>
      d.components.some((c) =>
        c.variants.some((v) =>
          v.ingredients.some((r) => idx.hasFlag(r.ingredient_slug, "contains_sesame")),
        ),
      ),
    );
    report.check(
      sesameDishes.length > 0,
      `the seed library has ${sesameDishes.length} dishes with a contains_sesame ingredient (${sesameDishes.map((d) => d.slug).join(", ")})`,
    );
    const seeds = Array.from({ length: G3_SEEDS }, (_, i) => i + 1);
    const chunks = Array.from({ length: WIDTH }, (_, w) =>
      seeds.filter((_, i) => i % WIDTH === w),
    ).filter((c) => c.length > 0);
    const runs = await pool(
      chunks.map((c) => ["g3", out, "1", c.join(",")]),
      WIDTH,
    );
    const results = runs.flatMap((r) => r.lines);
    report.check(
      runs.every((r) => r.code === 0) && results.length === G3_SEEDS,
      `${results.length} F1 week plans with the C3 sesame allergy, seeds 1–${G3_SEEDS} (${chunks.length} worker processes)`,
      runs
        .map((r) => r.stderr)
        .join("\n")
        .slice(-3000),
    );
    const withAllergy = sesameOnC3(results, idx);
    report.check(
      withAllergy.plates > 0 && withAllergy.hits.length === 0,
      `no contains_sesame ingredient on any of ${withAllergy.plates} C3 plates (items and adjusters) across ${results.length} plans`,
      withAllergy.hits.slice(0, 20).join("\n"),
    );
    // Negative control: the same plans without the exclusion serve sesame to C3 at least once.
    let control = { hits: [], plates: 0 };
    let planned = 0;
    for (let start = 0; start < seeds.length && control.hits.length === 0; start += WIDTH) {
      const batch = seeds.slice(start, start + WIDTH);
      const r = await pool(
        batch.map((s) => ["g3", out, "0", String(s)]),
        WIDTH,
      );
      const lines = r.flatMap((x) => x.lines);
      planned += lines.length;
      const c = sesameOnC3(lines, idx);
      control = { hits: [...control.hits, ...c.hits], plates: control.plates + c.plates };
    }
    report.check(
      control.hits.length > 0,
      `negative control: without the exclusion, sesame reaches a C3 plate (${control.hits.length} time(s) in the first ${planned} seeds; first: ${control.hits[0] ?? "none"})`,
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G4: determinism and budgets (SPEC-Q-16)
// ---------------------------------------------------------------------------------------------

async function gateG4() {
  const report = new Report("leaf-1.2.3 G4");
  const out = compileCore(report, "G4");
  if (out === null) return report.finish();
  try {
    const m = await loadCore(out);
    const week = [...m.f1.F1_WEEK];
    const weekJobs = [
      ["g4", out, "1", week.join(",")],
      ["g4", out, "1", week.join(",")],
      ["g4", out, "2", week.join(",")],
    ];
    const dayJobs = week.map((d) => ["g4", out, "1", d]);
    // Weeks run side by side; days run one at a time, so a day is not timed against its neighbours.
    const runs = [...(await pool(weekJobs, WIDTH)), ...(await pool(dayJobs, 1))];
    const lines = runs.map((r) => r.lines[0]);
    report.check(
      runs.every((r) => r.code === 0 && r.lines.length === 1),
      `${runs.length} plans ran, each in a fresh process`,
      runs
        .map((r) => r.stderr)
        .join("\n")
        .slice(-3000),
    );
    if (lines.some((l) => l === undefined)) return;
    const [a, a2, b] = lines;
    report.check(
      a.hash === a2.hash,
      `same seed, same plan: two F1 week plans with seed 1 in separate processes are identical (sha256 ${a.hash.slice(0, 16)}…, ${a.meals} meals)`,
    );
    report.check(
      a.hash !== b.hash,
      `negative control: seed 2 gives a different plan (${b.hash.slice(0, 16)}…), so the comparison can fail`,
    );
    const weekCpu = Math.max(a.cpu, a2.cpu, b.cpu);
    report.check(
      weekCpu <= WEEK_BUDGET_S,
      `week: ${weekCpu.toFixed(2)} s CPU (wall ${[a, a2, b].map((x) => x.wall.toFixed(2)).join(" / ")} s) for the F1 week (<= ${WEEK_BUDGET_S} s)`,
    );
    const days = lines.slice(3);
    const worst = days.reduce((w, x) => (x.cpu > w.cpu ? x : w));
    for (const x of days)
      console.log(
        `info - day ${x.dates}: ${x.cpu.toFixed(2)} s CPU, ${x.wall.toFixed(2)} s wall, ${x.meals} meals`,
      );
    report.check(
      days.length === 7 && worst.cpu <= DAY_BUDGET_S,
      `day: worst F1 day ${worst.dates} ${worst.cpu.toFixed(2)} s CPU (wall ${worst.wall.toFixed(2)} s) (<= ${DAY_BUDGET_S} s)`,
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G5: cook sheet (PLN-14)
// ---------------------------------------------------------------------------------------------

/** Batch raw totals against plate raw equivalents, and each plate's raw against rᵢ·g/W. */
function g5Evaluate(plan, sheet, idx) {
  const failures = [];
  let batches = 0;
  let rows = 0;
  for (const day of plan.days)
    for (const meal of day.meals) {
      const cm = sheet.days
        .find((d) => d.date === day.date)
        ?.meals.find((x) => x.slotKey === meal.slotKey && x.memberScope === meal.memberScope);
      const at = `${day.date} ${meal.slotKey}/${meal.memberScope}`;
      if (cm === undefined) {
        failures.push(`${at}: no cook-sheet meal`);
        continue;
      }
      // Plating table covers every attendee, with the plate's grams.
      const rowIds = cm.plating.rows.map((r) => r.memberId).sort();
      if (JSON.stringify(rowIds) !== JSON.stringify([...meal.attendees].sort()))
        failures.push(`${at}: plating rows ${rowIds} for attendees ${meal.attendees}`);
      for (const p of meal.plates) {
        const row = cm.plating.rows.find((r) => r.memberId === p.memberId);
        if (row === undefined) continue;
        rows++;
        for (const i of p.solution.items) {
          const cell = row.cells.find((c) => c.componentId === i.componentId);
          if (cell?.cookedG !== i.cookedG || cell?.variantId !== i.variantId)
            failures.push(
              `${at} ${p.memberId}: plating cell for ${i.componentId} does not match the plate`,
            );
        }
        if (row.sides.length !== p.solution.adjusters.length)
          failures.push(`${at} ${p.memberId}: adjuster sides missing`);
      }
      // Each plate's raw equivalents against the seed recipe: rᵢ · g / W (W = reference batch).
      for (const pr of cm.plates)
        for (const x of [...pr.items, ...pr.adjusters]) {
          const rec = idx.variants.get(x.variantId);
          if (rec === undefined) {
            failures.push(`${at}: unknown variant ${x.variantId}`);
            continue;
          }
          for (const r of rec.variant.ingredients) {
            const expected = (r.raw_g_per_batch * x.cookedG) / rec.variant.reference_batch_cooked_g;
            const got = x.rawEquivalent[`ing:${r.ingredient_slug}`];
            const sameRows = rec.variant.ingredients.filter(
              (q) => q.ingredient_slug === r.ingredient_slug,
            );
            const expectedSum = sameRows.reduce(
              (s, q) => s + (q.raw_g_per_batch * x.cookedG) / rec.variant.reference_batch_cooked_g,
              0,
            );
            // reference_batch_cooked_g is the engine's batch mass rounded to 1 g (1.2.4 ADR-1): 0.2 %.
            if (got === undefined || Math.abs(got - expectedSum) > 0.002 * expectedSum + 1e-9)
              failures.push(
                `${at} ${pr.memberId} ${x.variantId} ${r.ingredient_slug}: raw ${got} against ${expected.toFixed(3)}`,
              );
          }
        }
      // Batch totals equal the sum over plates, per variant and ingredient.
      for (const b of cm.batches) {
        batches++;
        const fromPlates = new Map();
        let grams = 0;
        for (const pr of cm.plates)
          for (const x of b.kind === "component" ? pr.items : pr.adjusters)
            if (x.variantId === b.variantId) {
              grams += x.cookedG;
              for (const [id, g] of Object.entries(x.rawEquivalent))
                fromPlates.set(id, (fromPlates.get(id) ?? 0) + g);
            }
        if (b.totalCookedG !== grams)
          failures.push(
            `${at} ${b.variantId}: batch ${b.totalCookedG} g cooked against ${grams} g on plates`,
          );
        const batch = new Map();
        for (const r of [...b.raw, ...b.discardedFat])
          batch.set(r.ingredientId, (batch.get(r.ingredientId) ?? 0) + r.rawG);
        const ids = new Set([...batch.keys(), ...fromPlates.keys()]);
        for (const id of ids) {
          const x = batch.get(id) ?? 0;
          const y = fromPlates.get(id) ?? 0;
          if (Math.abs(x - y) > 1e-6 * Math.max(1, y))
            failures.push(`${at} ${b.variantId} ${id}: batch raw ${x} against plates ${y}`);
        }
      }
      // Every served variant has a batch.
      const served = new Set(meal.plates.flatMap((p) => servedVariantIds(p)));
      const batched = new Set(cm.batches.map((b) => b.variantId));
      for (const v of served)
        if (!batched.has(v)) failures.push(`${at}: served variant ${v} has no batch`);
    }
  return { failures, batches, rows };
}

async function gateG5() {
  const report = new Report("leaf-1.2.3 G5");
  vitest(report, ["test/planner/select/cooksheet.test.ts"]);
  await withCore(report, "G5", async (m) => {
    const idx = seedIndex();
    const lib = seedLibrary(m);
    const plan = await m.planner.planDays(f1Input(m, lib, [...m.f1.F1_WEEK]), { seed: 1 });
    const sheet = m.planner.buildCookSheet(plan, lib.catalog);
    const r = g5Evaluate(plan, sheet, idx);
    report.check(
      r.batches > 0 && r.failures.length === 0,
      `F1 week cook sheet: ${r.batches} batches' raw totals equal the sum of their plates' raw equivalents; each plate's raw equivalents match the seed recipe (rᵢ·g/W); ${r.rows} plating rows cover every attendee with the plate's grams`,
      r.failures.slice(0, 20).join("\n"),
    );
    report.check(
      sheet.banner.length === 2 &&
        sheet.days.every(
          (d) => d.meals.length === plan.days.find((x) => x.date === d.date).meals.length,
        ),
      "NUT-6 banner present; one cook-sheet meal per planned meal",
    );
    const c3Meals = sheet.days
      .flatMap((d) => d.meals)
      .filter((cm) => cm.plating.rows.some((row) => row.memberId === "c3"));
    report.check(
      c3Meals.length > 0 &&
        c3Meals.every((cm) =>
          cm.allergyBanners.some((b) => b.memberId === "c3" && b.allergen === "sesame"),
        ),
      `R2-UX-2: the C3 sesame banner is on all ${c3Meals.length} meals C3 attends`,
    );
    // Negative controls.
    const perturbed = structuredClone(sheet);
    const pb = perturbed.days[0].meals[0].batches[0];
    pb.raw[0].rawG *= 1.01;
    report.check(
      g5Evaluate(plan, perturbed, idx).failures.length > 0,
      "negative control: a batch raw quantity 1 % off fails",
    );
    const missing = structuredClone(sheet);
    missing.days[0].meals[0].plating.rows.pop();
    report.check(
      g5Evaluate(plan, missing, idx).failures.length > 0,
      "negative control: a plating table without one attendee fails",
    );
    const lostPlate = structuredClone(sheet);
    lostPlate.days[0].meals[0].plates.pop();
    report.check(
      g5Evaluate(plan, lostPlate, idx).failures.length > 0,
      "negative control: a plate left out of the raw totals fails",
    );
  });
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G6: meal overrides (R2-MEAL-2)
// ---------------------------------------------------------------------------------------------

function g6Evaluate(plan, date) {
  const failures = [];
  const meals = plan.days.find((d) => d.date === date)?.meals ?? [];
  const dinners = meals.filter((mm) => mm.slotKey === "dinner");
  const shared = dinners.filter((mm) => mm.kind === "shared");
  if (shared.length !== 1) failures.push(`${shared.length} shared dinners`);
  else {
    if (shared[0].attendees.includes("adult_b") || shared[0].attendees.includes("c3"))
      failures.push("split members still attend the shared dinner");
    if (JSON.stringify([...shared[0].splitMembers].sort()) !== JSON.stringify(["adult_b", "c3"]))
      failures.push("shared dinner does not list its split members");
    if (shared[0].plates.some((p) => p.memberId === "adult_b" || p.memberId === "c3"))
      failures.push("a split member has a plate at the shared dinner");
  }
  for (const member of ["adult_b", "c3"]) {
    const own = dinners.filter((mm) => mm.memberScope === member);
    if (
      own.length !== 1 ||
      own[0].kind !== "individual" ||
      !own[0].split ||
      own[0].plates.length !== 1 ||
      own[0].plates[0].memberId !== member
    )
      failures.push(`${member}: no split individual dinner with their own plate`);
  }
  const breakfasts = meals.filter((mm) => mm.slotKey === "breakfast");
  const attendees = ["adult_a", "adult_b", "c1", "c2", "c3"];
  if (
    breakfasts.some((mm) => mm.kind !== "individual") ||
    JSON.stringify(breakfasts.map((mm) => mm.memberScope).sort()) !== JSON.stringify(attendees)
  )
    failures.push(
      `breakfast is not individual per attendee: ${breakfasts.map((mm) => `${mm.kind}/${mm.memberScope}`)}`,
    );
  for (const mm of breakfasts)
    if (mm.plates.length !== 1 || mm.plates[0].memberId !== mm.memberScope)
      failures.push(`breakfast ${mm.memberScope}: plate mismatch`);
  // Nothing else on the date changes shape: lunch and the packed lunches stay shared.
  for (const key of ["packed_school_lunch", "packed_work_lunch", "lunch"])
    if (meals.filter((mm) => mm.slotKey === key).some((mm) => mm.kind !== "shared"))
      failures.push(`${key} changed`);
  return failures;
}

async function gateG6() {
  const report = new Report("leaf-1.2.3 G6");
  vitest(report, ["test/planner/select/meals.test.ts", "test/planner/select/overrides.test.ts"]);
  await withCore(report, "G6", async (m) => {
    const lib = seedLibrary(m);
    const date = m.f1.F1_WEEK[0];
    const cfg = m.f1.f1PlanConfig();
    const ov = (slotKey, kind, memberIds) => ({
      id: `ov-${slotKey}`,
      householdId: cfg.household.id,
      planDate: date,
      slotTypeId: m.f1.slotId(slotKey),
      kind,
      memberIds,
      createdBy: "admin",
      createdAt: new Date(0),
    });
    cfg.mealOverrides = [
      ov("dinner", "split_member", ["adult_b", "c3"]),
      ov("breakfast", "make_individual", []),
    ];
    const plan = await m.planner.planDays(f1Input(m, lib, [date], { config: cfg }), { seed: 1 });
    const failures = g6Evaluate(plan, date);
    report.check(
      failures.length === 0,
      `F1 ${date} with split_member (dinner: adult_b, c3) and make_individual (breakfast): split members dine on their own dish, the shared dinner keeps the rest and lists them, breakfast is one individual meal per attendee`,
      failures.join("\n"),
    );
    const own = plan.days[0].meals
      .filter((mm) => mm.slotKey === "dinner")
      .map(
        (mm) =>
          `${mm.kind}${mm.split ? "(split)" : ""} ${mm.memberScope}: ${mm.dishId} [${mm.plates.map((p) => `${p.memberId} ${p.fitStatus}`).join(", ")}]`,
      );
    console.log(`info - dinners: ${own.join("; ")}`);
    const bPlate = plan.days[0].meals.find(
      (mm) => mm.slotKey === "dinner" && mm.memberScope === "adult_b",
    )?.plates[0];
    report.check(
      bPlate !== undefined &&
        bPlate.targeted &&
        (bPlate.fitStatus === "in_tolerance" || bPlate.flag !== null),
      "Adult B's own dinner is solved against B's dinner target (in tolerance or flagged)",
    );
    // Negative control: the same checks on the plan without overrides fail.
    const plain = await m.planner.planDays(f1Input(m, lib, [date]), { seed: 1 });
    report.check(
      g6Evaluate(plain, date).length > 0,
      `negative control: without the overrides the checks fail (${g6Evaluate(plain, date).length} failures)`,
    );
  });
  return report.finish();
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4, G5: gateG5, G6: gateG6 };

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--worker") return worker(args.slice(1));
  const gate = args[args.indexOf("--gate") + 1];
  const fn = args.includes("--gate") ? GATES[gate] : undefined;
  if (fn === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.2.3.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    return 2;
  }
  return await fn();
}

process.exitCode = await main();
