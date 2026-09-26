// Verify script for leaf 1.2.2 (Target resolver and portion solver).
// Usage: node scripts/verify/leaf-1.2.2.mjs --gate G1|G2|G3|G4|G5
// Prints "VERIFY leaf-1.2.2 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise.
//
// Each gate builds @mealplanner/core with tsc, runs the gate's Vitest tests, and then checks the
// outcome again here: it imports the compiled resolver, solver and test fixtures from
// packages/core/dist and re-derives every figure with its own arithmetic (plate nutrients,
// feasibility certificates, adjuster eligibility, ratio deviation, percentiles), independently of
// the Vitest helpers. Measured figures (medians, p95) are computed on each run and printed.
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE = join(ROOT, "packages/core");
const DIST = join(CORE, "dist");

const MACROS = ["kcal", "protein", "carbs", "fat"];
const EPS = 1e-6;
const P95_LIMIT_MS = 150;
const RATIO_LIMIT = 0.25;

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

async function buildAndLoad(report) {
  rmSync(join(DIST, "src/planner"), { recursive: true, force: true });
  rmSync(join(DIST, "test/planner"), { recursive: true, force: true });
  const build = run("pnpm", ["--filter", "@mealplanner/core", "build"], { cwd: ROOT });
  report.check(build.code === 0, "@mealplanner/core builds with tsc", tail(build));
  if (build.code !== 0) return undefined;
  const load = (path) => import(pathToFileURL(join(DIST, path)).href);
  return {
    targets: await load("src/planner/targets/index.js"),
    solver: await load("src/planner/solver/index.js"),
    types: await load("src/types/index.js"),
    config: await load("test/planner/targets/config.js"),
    fixtures: await load("test/fixtures/index.js"),
    build: await load("test/planner/solver/fixtures/build.js"),
    cases: await load("test/planner/solver/fixtures/cases.js"),
    catalog: await load("test/planner/solver/fixtures/catalog.js"),
  };
}

/** Runs Vitest on the given test files (optionally filtered by test name) and checks it passed. */
function vitest(report, files, name, label) {
  const args = [
    "--filter",
    "@mealplanner/core",
    "exec",
    "vitest",
    "run",
    "--dir",
    "test",
    ...files,
  ];
  if (name !== undefined) args.push("-t", name);
  const result = run("pnpm", args, { cwd: ROOT });
  const out = `${result.stdout}\n${result.stderr}`;
  const passed = /Tests\s+(\d+) passed/.exec(out);
  report.check(
    result.code === 0 && passed !== null && Number(passed[1]) > 0 && !/\bfailed\b/.test(out),
    `Vitest: ${label} (${passed === null ? "no" : passed[1]} passed)`,
    tail(result, 40),
  );
}

/** Σ per100g · g / 100 over the items, own arithmetic (unknown soluble fibre ignored). */
function sumNutrients(items) {
  const n = { kcal: 0, protein: 0, carbs: 0, fat: 0, satFat: 0, fibre: 0 };
  for (const { per100g, cookedG } of items)
    for (const k of Object.keys(n)) n[k] += (per100g[k] * cookedG) / 100;
  return n;
}

function macro(n, m, basis) {
  if (m === "carbs") return basis === "total" ? n.carbs + n.fibre : n.carbs;
  return n[m];
}

function withinTolerance(n, target) {
  return (
    MACROS.every(
      (m) => Math.abs(macro(n, m, target.carbBasis) - target[m]) <= target.tol[m] + EPS,
    ) &&
    (target.satFatMax === undefined || n.satFat <= target.satFatMax + EPS)
  );
}

function unitOf(c) {
  if (c.portioning === "fixed") return c.defaultServingG;
  return c.portioning === "unit" ? c.unitWeightG : c.stepG;
}

/**
 * Checks a solution against its input: grams on the component grid and within [min, max],
 * variants belonging to their components, adjusters from the offered list. Returns the problems
 * and the plate nutrients recomputed from the grams.
 */
function plateProblems(input, solution) {
  const problems = [];
  const items = [];
  for (const item of solution.items) {
    const c = input.dish.components.find((x) => x.id === item.componentId);
    const v = c?.variants.find((x) => x.id === item.variantId);
    if (c === undefined || v === undefined) {
      problems.push(`${item.componentId}: unknown component or variant`);
      continue;
    }
    const unit = unitOf(c);
    if (!Number.isInteger(item.cookedG)) problems.push(`${c.id}: ${item.cookedG} g is not whole`);
    if (Math.abs(item.cookedG / unit - Math.round(item.cookedG / unit)) > 1e-9)
      problems.push(`${c.id}: ${item.cookedG} g is off the ${unit} g grid`);
    if (item.cookedG < c.minServingG - EPS || item.cookedG > c.maxServingG + EPS)
      problems.push(`${c.id}: ${item.cookedG} g outside [${c.minServingG}, ${c.maxServingG}]`);
    items.push({ per100g: v.per100g, cookedG: item.cookedG });
  }
  for (const a of solution.adjusters ?? []) {
    const dish = (input.adjusters ?? []).find((d) => d.id === a.dishId);
    const c = dish?.components[0];
    const v = c?.variants.find((x) => x.id === a.variantId);
    if (c === undefined || v === undefined) {
      problems.push(`${a.dishId}: adjuster not offered`);
      continue;
    }
    const unit = unitOf(c);
    if (Math.abs(a.cookedG / unit - Math.round(a.cookedG / unit)) > 1e-9)
      problems.push(`${a.dishId}: ${a.cookedG} g is off the ${unit} g grid`);
    if (a.cookedG < c.minServingG - EPS || a.cookedG > c.maxServingG + EPS)
      problems.push(`${a.dishId}: ${a.cookedG} g outside [${c.minServingG}, ${c.maxServingG}]`);
    items.push({ per100g: v.per100g, cookedG: a.cookedG });
  }
  const nutrients = sumNutrients(items);
  if (input.target !== null && solution.status !== "untargeted")
    for (const m of MACROS) {
      const expected = macro(nutrients, m, input.target.carbBasis) - input.target[m];
      if (Math.abs(solution.deviation[m] - expected) > 1e-6)
        problems.push(`deviation.${m} ${solution.deviation[m]} ≠ recomputed ${expected}`);
    }
  return { problems, nutrients };
}

/** A macro's reachable interval for a dish (own computation): required minimums to all maximums. */
function reachOf(dish, m, basis, allowed = () => true) {
  let min = 0;
  let max = 0;
  for (const c of dish.components) {
    const vs = c.variants.filter(allowed);
    if (vs.length === 0) continue;
    const unit = unitOf(c);
    const kMin = c.portioning === "fixed" ? 1 : Math.max(0, Math.ceil(c.minServingG / unit - 1e-9));
    const kMax = c.portioning === "fixed" ? 1 : Math.floor(c.maxServingG / unit + 1e-9);
    const per = vs.map((v) => macro(v.per100g, m, basis) / 100);
    max += kMax * unit * Math.max(...per);
    if (c.required) min += kMin * unit * Math.min(...per);
  }
  return { min, max };
}

function minSatFatOf(dish) {
  let min = 0;
  for (const c of dish.components) {
    if (!c.required) continue;
    const unit = unitOf(c);
    const kMin = c.portioning === "fixed" ? 1 : Math.max(0, Math.ceil(c.minServingG / unit - 1e-9));
    min += (kMin * unit * Math.min(...c.variants.map((v) => v.per100g.satFat))) / 100;
  }
  return min;
}

/** Analytic infeasibility certificate: some macro outside reach ± tolerance, or cap below minimum. */
function certifiedInfeasible(input, allowed) {
  const t = input.target;
  if (t.satFatMax !== undefined && minSatFatOf(input.dish) > t.satFatMax + EPS) return true;
  return MACROS.some((m) => {
    const r = reachOf(input.dish, m, t.carbBasis, allowed);
    return t[m] > r.max + t.tol[m] + EPS || t[m] < r.min - t.tol[m] - EPS;
  });
}

function variantAllowed(v, member) {
  const x = member.exclusions;
  return v.ingredients.every(
    (i) =>
      !x.ingredientIds.includes(i.id) &&
      !x.categories.includes(i.category) &&
      !i.dietaryFlags.some((f) => x.dietaryFlags.includes(f)),
  );
}

/** PLN-6 eligibility, own implementation. */
function adjusterEligible(dish, member) {
  if (dish.components.length !== 1) return false;
  if ((member.dishAppeal[dish.id] ?? 0) < -0.2) return false;
  if (member.slot.isPacked && !dish.isPackable) return false;
  if (member.slot.isPacked && !member.slot.reheatAvailable && !dish.servedColdOk) return false;
  return dish.components[0].variants.some((v) => variantAllowed(v, member));
}

function adjusterProblems(input, solution) {
  const problems = [];
  if (solution.adjusters.length > 2) problems.push(`${solution.adjusters.length} adjusters (> 2)`);
  const ids = solution.adjusters.map((a) => a.dishId);
  if (new Set(ids).size !== ids.length) problems.push("an adjuster dish is used twice");
  for (const a of solution.adjusters) {
    const dish = input.adjusters.find((d) => d.id === a.dishId);
    if (dish === undefined || !adjusterEligible(dish, input.member))
      problems.push(`${a.dishId} is not eligible for this member and slot`);
    const v = dish?.components[0]?.variants.find((x) => x.id === a.variantId);
    if (v !== undefined && !variantAllowed(v, input.member))
      problems.push(`${a.variantId} breaks the member's exclusions`);
  }
  return problems;
}

/** Ratio deviation Σ|g − ρ·G| / G over the main components (SPEC-Q-15). */
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

/** Nearest-rank percentile. */
const percentile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
};

/** The test catalogue subset equals data/ingredients.v1.json and data/method-yields.v1.json. */
function checkCatalogSubset(report, m) {
  const data = JSON.parse(readFileSync(join(ROOT, "data/ingredients.v1.json"), "utf8")).ingredients;
  const yields = JSON.parse(readFileSync(join(ROOT, "data/method-yields.v1.json"), "utf8")).yields;
  const fields = {
    kcal: "kcal",
    proteinG: "protein_g",
    carbsG: "carbs_g",
    fatG: "fat_g",
    satFatG: "sat_fat_g",
    fibreG: "fibre_g",
    solubleFibreG: "soluble_fibre_g",
    sugarG: "sugar_g",
    sodiumMg: "sodium_mg",
  };
  const bad = [];
  for (const i of m.catalog.TEST_INGREDIENTS) {
    const d = data.find((x) => x.slug === i.slug);
    if (d === undefined) {
      bad.push(`${i.slug}: not in the data file`);
      continue;
    }
    if (d.category !== i.category) bad.push(`${i.slug}.category`);
    if (JSON.stringify(d.dietary_flags) !== JSON.stringify(i.dietaryFlags))
      bad.push(`${i.slug}.flags`);
    for (const [k, col] of Object.entries(fields)) if (d[col] !== i[k]) bad.push(`${i.slug}.${k}`);
  }
  for (const y of m.catalog.TEST_YIELDS) {
    const d = yields.find((x) => x.method === y.method && x.ingredient_category === y.category);
    if (
      d === undefined ||
      d.yield_factor !== y.yieldFactor ||
      d.fat_retention !== y.fatRetention ||
      d.oil_absorption_g_per_100g_raw !== y.oilAbsorptionGPer100gRaw
    )
      bad.push(`yield ${y.method}×${y.category}`);
  }
  report.check(
    bad.length === 0 && m.catalog.TEST_INGREDIENTS.length > 0,
    `the test catalogue (${m.catalog.TEST_INGREDIENTS.length} ingredients, ${m.catalog.TEST_YIELDS.length} yield rows) matches data/*.v1.json`,
    bad.slice(0, 20).join("\n"),
  );
}

// ---------------------------------------------------------------------------------------------
// G1: F1 week — per-slot targets sum to daily targets (±1 g); training slots only for the
// training member (PLN-4)
// ---------------------------------------------------------------------------------------------

/** Groups targets by member-day and returns the problems with the sums and training slots. */
function weekProblems(targets, f1, profiles) {
  const problems = [];
  const training = new Map(
    f1.members.map((mb) => [mb.key, new Set((mb.training ?? []).map((d) => d.weekday))]),
  );
  const groups = new Map();
  for (const t of targets) {
    const key = `${t.memberId}|${t.date}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const [key, slots] of groups) {
    const [memberId, date] = key.split("|");
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
    const trains = training.get(memberId)?.has(weekday) ?? false;
    const member = f1.members.find((mb) => mb.key === memberId);
    const profile = (trains ? member?.targets?.training : undefined) ?? member?.targets?.default;
    if (profile === undefined) {
      problems.push(`${key}: targets for a member without targets`);
      continue;
    }
    const daily = {
      kcal: profile.kcal,
      protein: profile.proteinG,
      carbs: profile.carbsG,
      fat: profile.fatG,
    };
    for (const m of MACROS) {
      const sum = slots.reduce((a, t) => a + t[m], 0);
      if (Math.abs(sum - daily[m]) > 1) problems.push(`${key}: Σ ${m} ${sum} vs daily ${daily[m]}`);
    }
    const keys = slots.map((t) => t.slotKey);
    for (const k of ["pre_workout", "post_workout"])
      if (keys.includes(k) !== trains)
        problems.push(
          `${key}: ${k} ${trains ? "missing on a training day" : "on a non-training day"}`,
        );
  }
  // Every targeted member has every day; no untargeted member has targets.
  for (const mb of f1.members) {
    const days = new Set(targets.filter((t) => t.memberId === mb.key).map((t) => t.date));
    if (mb.targets === undefined && days.size > 0)
      problems.push(`${mb.key}: untargeted but has targets`);
    if (mb.targets !== undefined && days.size !== profiles.days)
      problems.push(`${mb.key}: ${days.size} days`);
  }
  return problems;
}

async function gateG1() {
  const report = new Report("leaf-1.2.2 G1");
  const m = await buildAndLoad(report);
  if (m === undefined) return report.finish();
  vitest(report, ["test/planner/targets"], undefined, "target resolver suite");

  for (const name of ["resolveSlotTargets", "attendedSlots"])
    report.check(
      typeof m.targets[name] === "function",
      `@mealplanner/core/planner/targets exports ${name}()`,
    );
  report.check(
    m.targets.CARB_TARGET_BASIS === "total",
    'CARB_TARGET_BASIS is "total" (OQ-7 default, R-20)',
  );

  const f1 = m.types.FixtureSchema.parse(m.fixtures.F1);
  const cfg = m.config.f1Config();
  const week = m.config.F1_WEEK;
  report.check(
    week.length === 7 && week.map((d) => m.types.weekdayOf(d)).join(",") === "0,1,2,3,4,5,6",
    `the F1 week is Monday to Sunday (${week[0]} … ${week[6]})`,
  );
  const targets = week.flatMap((d) => m.targets.resolveSlotTargets(cfg, d));
  const problems = weekProblems(targets, f1, { days: 7 });
  report.check(
    problems.length === 0,
    `F1 week: ${targets.length} slot targets; every member-day sums to its daily target within 1 g / 1 kcal; pre/post-workout exactly on each member's training days`,
    problems.slice(0, 20).join("\n"),
  );
  const perMember = (id) =>
    new Set(targets.filter((t) => t.memberId === id).map((t) => t.date)).size;
  report.check(
    perMember("adult_a") === 7 &&
      perMember("adult_b") === 7 &&
      ["c1", "c2", "c3"].every((c) => perMember(c) === 0),
    "both targeted adults have targets on all 7 days; the three children have none",
  );
  const training = (id) =>
    targets
      .filter((t) => t.memberId === id && t.slotKey === "pre_workout")
      .map((t) => m.types.weekdayOf(t.date))
      .join(",");
  report.check(
    training("adult_a") === "0,2,4" && training("adult_b") === "1,3,5",
    `training slots: Adult A on weekdays ${training("adult_a")} (Mon/Wed/Fri), Adult B on ${training("adult_b")} (Tue/Thu/Sat)`,
  );
  const both = m.targets.resolveSlotTargets(cfg, week[0], { carbBasis: "available" });
  report.check(
    both.every((t) => t.carbBasis === "available") &&
      targets.filter((t) => t.date === week[0]).every((t) => t.carbBasis === "total"),
    "the carbohydrate basis is carried on every target and can be switched",
  );

  // Negative controls: the same checks reject a shifted slot and a misplaced training slot.
  const shifted = targets.map((t, i) => (i === 3 ? { ...t, protein: t.protein + 2 } : t));
  report.check(
    weekProblems(shifted, f1, { days: 7 }).length > 0,
    "negative control: a slot shifted by 2 g breaks the daily sum and is rejected",
  );
  const pre = targets.find((t) => t.memberId === "adult_a" && t.slotKey === "pre_workout");
  const misplaced = [...targets, { ...pre, memberId: "adult_b", date: week[0] }];
  report.check(
    weekProblems(misplaced, f1, { days: 7 }).some((p) => p.includes("non-training")),
    "negative control: a pre-workout slot on Adult B's rest day is rejected",
  );
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G2: 200 known-feasible cases in tolerance on the step grid; 50 known-infeasible cases are
// infeasible in strict and flexible_miss in flexible (PLN-5, PLN-8)
// ---------------------------------------------------------------------------------------------

function feasibleCaseProblems(m, c) {
  const problems = [];
  const witness = sumNutrients(
    [...c.witness.items, ...c.witness.adjusters].filter((x) => x.cookedG > 0),
  );
  if (!withinTolerance(witness, c.target))
    problems.push(`${c.id}: witness is not within tolerance`);
  const s = m.solver.solvePlate(c);
  if (s.status !== "in_tolerance") problems.push(`${c.id}: status ${s.status}`);
  const { problems: plate, nutrients } = plateProblems(c, s);
  problems.push(...plate.map((p) => `${c.id}: ${p}`));
  if (!withinTolerance(nutrients, c.target))
    problems.push(`${c.id}: recomputed plate out of tolerance`);
  return problems;
}

async function gateG2() {
  const report = new Report("leaf-1.2.2 G2");
  const m = await buildAndLoad(report);
  if (m === undefined) return report.finish();
  vitest(
    report,
    ["test/planner/solver/solve.test.ts"],
    "known-",
    "known-feasible and known-infeasible suites",
  );
  checkCatalogSubset(report, m);
  await m.solver.loadPortionSolver();

  const total = m.cases.feasibleCases(200, "total", 1);
  const available = m.cases.feasibleCases(40, "available", 2);
  for (const [label, cases, basis] of [
    ["total", total, "total"],
    ["available", available, "available"],
  ]) {
    const problems = cases.flatMap((c) => feasibleCaseProblems(m, c));
    report.check(
      cases.length === (basis === "total" ? 200 : 40) &&
        cases.every((c) => c.target.carbBasis === basis) &&
        problems.length === 0,
      `${cases.length} known-feasible cases on ${label} carbohydrate: each witness is within tolerance, and each solution is in_tolerance with every gram on its step grid and within [min, max] (recomputed here)`,
      problems.slice(0, 20).join("\n"),
    );
  }

  const infeasible = m.cases.infeasibleCases(50, "total", 3);
  const uncertified = infeasible.filter((c) => !certifiedInfeasible(c));
  report.check(
    infeasible.length === 50 && uncertified.length === 0,
    `50 known-infeasible cases, each with an analytic certificate recomputed here (kinds: ${[...new Set(infeasible.map((c) => c.kind))].join(", ")})`,
    uncertified.map((c) => c.id).join(", "),
  );
  const strictBad = [];
  const flexBad = [];
  for (const c of infeasible) {
    const s = m.solver.solvePlate(c);
    if (s.status !== "infeasible" || s.fit !== 0 || plateProblems(c, s).problems.length > 0)
      strictBad.push(
        `${c.id}: ${s.status} fit ${s.fit} ${plateProblems(c, s).problems.join("; ")}`,
      );
    const flexInput = { ...c, target: { ...c.target, mode: "flexible" } };
    const f = m.solver.solvePlate(flexInput);
    if (f.status !== "flexible_miss" || plateProblems(flexInput, f).problems.length > 0)
      flexBad.push(`${c.id}: ${f.status}`);
  }
  report.check(
    strictBad.length === 0,
    "strict mode: all 50 are infeasible (fit 0, least-deviation plate on the grid)",
    strictBad.slice(0, 20).join("\n"),
  );
  report.check(
    flexBad.length === 0,
    "flexible mode: all 50 are flexible_miss",
    flexBad.slice(0, 20).join("\n"),
  );

  // Negative controls.
  const c0 = total[0];
  const s0 = m.solver.solvePlate(c0);
  const offGrid = {
    ...s0,
    items: s0.items.map((it, i) => (i === 0 ? { ...it, cookedG: it.cookedG + 1 } : it)),
  };
  report.check(
    plateProblems(c0, offGrid).problems.some((p) => p.includes("grid")),
    "negative control: a plate moved 1 g off the grid is rejected",
  );
  report.check(
    total.every((c) => !certifiedInfeasible(c)),
    "negative control: the certificate never fires on the 200 known-feasible cases",
  );
  const miss = m.solver.solvePlate(infeasible[0]);
  report.check(
    !withinTolerance(plateProblems(infeasible[0], miss).nutrients, infeasible[0].target),
    "negative control: the tolerance check rejects the least-deviation plate of an infeasible case",
  );
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G3: infeasible-without-adjusters cases become feasible with at most 2 adjusters; excluded
// adjusters never used (PLN-6)
// ---------------------------------------------------------------------------------------------

async function gateG3() {
  const report = new Report("leaf-1.2.2 G3");
  const m = await buildAndLoad(report);
  if (m === undefined) return report.finish();
  vitest(report, ["test/planner/solver/solve.test.ts"], "adjusters", "adjuster suite");
  await m.solver.loadPortionSolver();

  const cases = m.cases.adjusterCases(60, "total", 4);
  const offered = cases[0]?.adjusters ?? [];
  const ineligiblePairs = cases.reduce(
    (n, c) => n + c.adjusters.filter((a) => !adjusterEligible(a, c.member)).length,
    0,
  );
  report.check(
    cases.length === 60 && offered.length >= 10 && ineligiblePairs >= cases.length,
    `60 cases offering ${offered.length} adjusters; ${ineligiblePairs} (case, adjuster) pairs are ineligible (dairy allergy, low appeal, packed without reheat, ingredient and category exclusions)`,
  );
  const problems = [];
  let one = 0;
  let two = 0;
  for (const c of cases) {
    const allowed = (v) => variantAllowed(v, c.member);
    if (!certifiedInfeasible({ ...c, adjusters: [] }, allowed))
      problems.push(`${c.id}: no certificate`);
    const witness = sumNutrients([...c.witness.items, ...c.witness.adjusters]);
    if (!withinTolerance(witness, c.target)) problems.push(`${c.id}: witness out of tolerance`);
    if (
      c.witness.adjusters.some(
        (a) =>
          !adjusterEligible(
            offered.find((d) => d.id === a.dishId),
            c.member,
          ),
      )
    )
      problems.push(`${c.id}: witness uses an ineligible adjuster`);
    const alone = m.solver.solvePlate({ ...c, adjusters: [] });
    if (alone.status !== "infeasible") problems.push(`${c.id}: without adjusters ${alone.status}`);
    const s = m.solver.solvePlate(c);
    if (s.status !== "in_tolerance") problems.push(`${c.id}: with adjusters ${s.status}`);
    if (s.adjusters.length === 0) problems.push(`${c.id}: no adjuster used`);
    const { problems: plate, nutrients } = plateProblems(c, s);
    problems.push(
      ...plate.map((p) => `${c.id}: ${p}`),
      ...adjusterProblems(c, s).map((p) => `${c.id}: ${p}`),
    );
    if (!withinTolerance(nutrients, c.target))
      problems.push(`${c.id}: recomputed plate out of tolerance`);
    if (s.adjusters.length === 1) one++;
    if (s.adjusters.length === 2) two++;
  }
  report.check(
    problems.length === 0,
    `each case is certified infeasible for the dish alone (and the solver agrees), and in_tolerance with ≤ 2 eligible adjusters (${one} with one, ${two} with two)`,
    problems.slice(0, 20).join("\n"),
  );

  // Negative controls: the eligibility check rejects forged solutions.
  const dairy = cases.find((c) => c.member.exclusions.dietaryFlags.includes("contains_dairy"));
  const yogurt = offered.find((d) => d.id === "adjuster.greek_yogurt_0");
  const forged = {
    ...m.solver.solvePlate(dairy),
    adjusters: [
      { dishId: yogurt.id, variantId: yogurt.components[0].variants[0].id, cookedG: 100 },
    ],
  };
  report.check(
    adjusterProblems(dairy, forged).some((p) => p.includes("not eligible")),
    "negative control: Greek yogurt on a dairy-allergic member's plate is rejected",
  );
  const three = {
    ...forged,
    adjusters: offered.slice(0, 3).map((d) => ({
      dishId: d.id,
      variantId: d.components[0].variants[0].id,
      cookedG: d.components[0].minServingG,
    })),
  };
  report.check(
    adjusterProblems({ ...dairy, member: m.cases.memberCtx() }, three).some((p) =>
      p.includes("> 2"),
    ),
    "negative control: a plate with three adjusters is rejected",
  );
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G4: no component outside [min, max]; median ratio deviation ≤ 25 % on the leaf's own test dish
// set of ≥ 20 multi-component dishes
// ---------------------------------------------------------------------------------------------

/** The G4 plates: F1 targeted week × suitable dishes, and F1 children × dishes (untargeted). */
function g4Plates(m) {
  const { dishes } = m.build.testDishes();
  const cfg = m.config.f1Config();
  const targeted = [];
  for (const date of m.config.F1_WEEK)
    for (const t of m.targets.resolveSlotTargets(cfg, date))
      for (const dish of dishes.filter((d) => m.build.dishSlots(d.id).includes(t.slotKey)))
        targeted.push({
          dish,
          target: t,
          member: m.cases.memberCtx({ memberId: t.memberId }),
          adjusters: [],
        });
  const untargeted = [];
  for (const child of cfg.members.filter((mb) => !mb.isTargeted))
    for (const bias of [0.6, 1, 1.6])
      for (const dish of dishes)
        untargeted.push({
          dish,
          target: null,
          member: m.cases.memberCtx({
            memberId: child.id,
            appetite: child.appetite,
            roleBias: { protein: bias, carb: bias, vegetable: bias, side: bias },
          }),
          adjusters: [],
        });
  return { dishes, targeted, untargeted };
}

async function gateG4() {
  const report = new Report("leaf-1.2.2 G4");
  const m = await buildAndLoad(report);
  if (m === undefined) return report.finish();
  vitest(report, ["test/planner/solver/solve.test.ts"], "naturalness", "plate-naturalness suite");
  checkCatalogSubset(report, m);
  await m.solver.loadPortionSolver();

  const { dishes, targeted, untargeted } = g4Plates(m);
  const multi = dishes.filter((d) => d.components.length >= 2);
  report.check(
    multi.length >= 20 && multi.length === dishes.length,
    `the test dish set has ${multi.length} multi-component dishes (≥ 20)`,
  );
  const outside = [];
  const ratios = [];
  const statuses = {};
  for (const input of [...targeted, ...untargeted]) {
    const s = m.solver.solvePlate(input);
    statuses[s.status] = (statuses[s.status] ?? 0) + 1;
    const { problems } = plateProblems(input, s);
    outside.push(...problems.map((p) => `${input.dish.id}/${input.member.memberId}: ${p}`));
    if (s.status === "in_tolerance") ratios.push(ratioDeviation(input.dish, s));
  }
  report.check(
    outside.length === 0,
    `no component outside [min, max] or off its grid on ${targeted.length + untargeted.length} solved plates (${JSON.stringify(statuses)})`,
    outside.slice(0, 20).join("\n"),
  );
  const med = median(ratios);
  report.check(
    ratios.length >= 100 && med <= RATIO_LIMIT,
    `median ratio deviation Σ|g − ρG|/G over ${ratios.length} in-tolerance F1 plates = ${(med * 100).toFixed(1)} % (limit ${RATIO_LIMIT * 100} %)`,
  );

  // Negative controls.
  const chicken = dishes.find((d) => d.id === "chicken_rice_salad");
  const lopsided = {
    items: [
      {
        componentId: chicken.components[0].id,
        variantId: chicken.components[0].variants[0].id,
        cookedG: 320,
      },
      {
        componentId: chicken.components[1].id,
        variantId: chicken.components[1].variants[0].id,
        cookedG: 15,
      },
    ],
  };
  report.check(
    ratioDeviation(chicken, lopsided) > RATIO_LIMIT &&
      median([...ratios.map(() => ratioDeviation(chicken, lopsided))]) > RATIO_LIMIT,
    `negative control: 320 g chicken with 15 g rice measures ${(ratioDeviation(chicken, lopsided) * 100).toFixed(0)} % and fails the median limit`,
  );
  const below = {
    status: "untargeted",
    items: [{ ...lopsided.items[1] }],
    adjusters: [],
  };
  report.check(
    plateProblems({ dish: chicken, target: null, adjusters: [] }, below).problems.some((p) =>
      p.includes("outside"),
    ),
    "negative control: 15 g rice (min 50 g) is reported outside [min, max]",
  );
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G5: p95 solve time ≤ 150 ms per plate
// ---------------------------------------------------------------------------------------------

async function gateG5() {
  const report = new Report("leaf-1.2.2 G5");
  const m = await buildAndLoad(report);
  if (m === undefined) return report.finish();
  await m.solver.loadPortionSolver();

  // Every targeted plate of G2, G3 and G4 (untargeted plates need no MILP and are left out).
  const inputs = [
    ...m.cases.feasibleCases(200, "total", 1),
    ...m.cases.feasibleCases(40, "available", 2),
    ...m.cases.infeasibleCases(50, "total", 3),
    ...m.cases
      .infeasibleCases(50, "total", 3)
      .map((c) => ({ ...c, target: { ...c.target, mode: "flexible" } })),
    ...m.cases.adjusterCases(60, "total", 4),
    ...g4Plates(m).targeted,
  ];
  // Warm-up: JIT and the WebAssembly instance, not counted.
  for (const input of inputs.slice(0, 10)) m.solver.solvePlate(input);
  const times = [];
  for (const input of inputs) {
    const t0 = performance.now();
    m.solver.solvePlate(input);
    times.push(performance.now() - t0);
  }
  const p95 = percentile(times, 95);
  const max = Math.max(...times);
  const p50 = percentile(times, 50);
  console.log(
    `measured: n=${times.length} p50=${p50.toFixed(1)} ms p95=${p95.toFixed(1)} ms max=${max.toFixed(1)} ms (${process.platform}, node ${process.version})`,
  );
  report.check(times.length >= 500, `${times.length} targeted plates timed (G2, G3 and G4 inputs)`);
  report.check(
    p95 <= P95_LIMIT_MS,
    `p95 solve time ${p95.toFixed(1)} ms ≤ ${P95_LIMIT_MS} ms (max ${max.toFixed(1)} ms)`,
  );

  // Negative controls: the percentile is right on a known series and the limit rejects a slow one.
  const series = Array.from({ length: 100 }, (_, i) => i + 1);
  report.check(
    percentile(series, 95) === 95 && percentile(series, 50) === 50,
    "the nearest-rank percentile of 1…100 gives p95 = 95 and p50 = 50",
  );
  const slow = series.map((x) => x * 2);
  report.check(
    !(percentile(slow, 95) <= P95_LIMIT_MS),
    `negative control: a series with p95 = ${percentile(slow, 95)} ms fails the limit`,
  );
  return report.finish();
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4, G5: gateG5 };

async function main() {
  const index = process.argv.indexOf("--gate");
  const gate = index === -1 ? undefined : process.argv[index + 1];
  const fn = gate === undefined ? undefined : GATES[gate];
  if (fn === undefined) {
    console.log(`usage: node scripts/verify/leaf-1.2.2.mjs --gate ${Object.keys(GATES).join("|")}`);
    return 2;
  }
  return fn();
}

process.exitCode = await main();
