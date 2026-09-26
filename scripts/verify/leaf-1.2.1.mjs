// Verify script for leaf 1.2.1 (Nutrition engine).
// Usage: node scripts/verify/leaf-1.2.1.mjs --gate G1|G2|G3|G4
// Prints "VERIFY leaf-1.2.1 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise.
//
// G1–G3 build @mealplanner/core with tsc and import the compiled engine and the test fixtures
// from packages/core/dist. The comparisons are written here, independently of the Vitest suite
// and its helpers. G4 measures V8 line coverage of src/nutrition with Vitest.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";
import { copyWorkspace, installCopy } from "./lib/workspace.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE = join(ROOT, "packages/core");
const DIST = join(CORE, "dist");

const NUTRIENT_KEYS = [
  "kcal",
  "protein",
  "carbs",
  "fat",
  "satFat",
  "fibre",
  "solubleFibre",
  "sugar",
  "sodiumMg",
];
const GOLDEN_TOLERANCE = 0.005; // G1: 0.5 %
const ROUND_TRIP_TOLERANCE = 0.001; // G2: 0.1 %
const ZERO_EPSILON = 1e-9;

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** Builds core from scratch and imports the compiled engine and fixtures. */
async function buildAndLoad(report) {
  rmSync(join(DIST, "src/nutrition"), { recursive: true, force: true });
  rmSync(join(DIST, "test/nutrition"), { recursive: true, force: true });
  const build = run("pnpm", ["--filter", "@mealplanner/core", "build"], { cwd: ROOT });
  report.check(build.code === 0, "@mealplanner/core builds with tsc", tail(build));
  if (build.code !== 0) return undefined;
  const load = (path) => import(pathToFileURL(join(DIST, path)).href);
  return {
    engine: await load("src/nutrition/index.js"),
    catalog: await load("test/nutrition/fixtures/catalog.js"),
    golden: await load("test/nutrition/fixtures/golden.js"),
    mutants: await load("test/nutrition/fixtures/mutants.js"),
    pairs: await load("test/nutrition/fixtures/pairs.js"),
  };
}

/** Relative difference within tolerance; null must equal null; an expected 0 must be ~0. */
function mismatch(actual, expected, tolerance) {
  if (expected === null || actual === null) {
    return expected === actual ? null : `expected ${String(expected)}, got ${String(actual)}`;
  }
  if (typeof actual !== "number" || !Number.isFinite(actual)) {
    return `expected ${String(expected)}, got ${String(actual)}`;
  }
  if (expected === 0) {
    return Math.abs(actual) <= ZERO_EPSILON ? null : `expected 0, got ${String(actual)}`;
  }
  const rel = Math.abs(actual - expected) / Math.abs(expected);
  return rel <= tolerance
    ? null
    : `expected ${String(expected)}, got ${String(actual)} (${(rel * 100).toFixed(3)} %)`;
}

function nutrientMismatches(actual, expected, tolerance, label) {
  const problems = [];
  for (const key of NUTRIENT_KEYS) {
    const problem = mismatch(actual[key], expected[key], tolerance);
    if (problem !== null) problems.push(`${label}.${key}: ${problem}`);
  }
  return problems;
}

function goldenProblems(cases, compute, ctx) {
  const problems = [];
  for (const golden of cases) {
    try {
      const result = compute(golden.variant, ctx);
      problems.push(
        ...nutrientMismatches(result.per100g, golden.expected.per100g, GOLDEN_TOLERANCE, golden.id),
      );
      const cooked = mismatch(result.batchCookedG, golden.expected.batchCookedG, GOLDEN_TOLERANCE);
      if (cooked !== null) problems.push(`${golden.id}.batchCookedG: ${cooked}`);
    } catch (error) {
      problems.push(`${golden.id}: threw ${String(error)}`);
    }
  }
  return problems;
}

function yieldRow(ctx, method, category) {
  return ctx.methodYields.find((y) => y.method === method && y.category === category);
}

// ---------------------------------------------------------------------------------------------
// G1: ≥ 15 hand-computed golden variants match within 0.5 % (NUT-3)
// ---------------------------------------------------------------------------------------------
async function gateG1() {
  const report = new Report("leaf-1.2.1 G1");
  const m = await buildAndLoad(report);
  if (m === undefined) return report.finish();
  const { engine } = m;

  // 03 §7 public interface.
  for (const name of [
    "variantNutritionPer100gCooked",
    "rawForCooked",
    "plateNutrients",
    "atwaterCheck",
  ]) {
    report.check(
      typeof engine[name] === "function",
      `@mealplanner/core/nutrition exports ${name}()`,
    );
  }
  report.check(
    typeof engine.ENGINE_VERSION === "string" && engine.ENGINE_VERSION.length > 0,
    `ENGINE_VERSION is a non-empty string ("${String(engine.ENGINE_VERSION)}")`,
  );
  const dts = readFileSync(join(DIST, "src/nutrition/index.d.ts"), "utf8");
  const declared = [
    /export declare const ENGINE_VERSION: string;/,
    /export type \{[^}]*\bNutrients\b[^}]*\} from/,
  ];
  report.check(
    declared.every((re) => re.test(dts)),
    "index.d.ts declares ENGINE_VERSION: string and re-exports the Nutrients type",
  );
  const signatures = {
    "variant.d.ts":
      /variantNutritionPer100gCooked\(v: VariantInput, ctx: CatalogContext\): \{\s*per100g: Nutrients;\s*batchCookedG: number;\s*warnings: NutritionWarning\[\];\s*\}/,
    "raw.d.ts":
      /rawForCooked\(v: VariantInput, cookedG: number, ctx: CatalogContext\): Array<\{\s*ingredientId: string;\s*rawG: number;\s*discardedFat\?: boolean;\s*\}>/,
    "plate.d.ts":
      /plateNutrients\(items: Array<\{\s*per100g: Nutrients;\s*cookedG: number;\s*\}>\): Nutrients/,
    "atwater.d.ts": /atwaterCheck\(n: Nutrients\): \{\s*ok: boolean;\s*deltaPct: number;\s*\}/,
  };
  for (const [file, re] of Object.entries(signatures)) {
    const text = readFileSync(join(DIST, "src/nutrition", file), "utf8");
    report.check(re.test(text), `${file} declares the 03 §7 signature`, text);
  }
  const manifest = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8"));
  report.check(
    manifest.exports?.["./*"]?.default === "./dist/src/*/index.js",
    'package exports "./*" → ./dist/src/*/index.js, so @mealplanner/core/nutrition is the nutrition entry (R-1)',
  );

  // The golden set: size and coverage of the situations the gate names, derived from the inputs.
  const ctx = m.catalog.fixtureCatalog();
  const cases = m.golden.GOLDEN_CASES;
  report.check(cases.length >= 15, `at least 15 golden cases (found ${String(cases.length)})`);
  const categoryOf = (id) => ctx.ingredients.get(id)?.category;
  const ids = (c) => JSON.stringify(c.variant.ingredients.map((r) => [r.ingredientId, r.rawG]));
  const nonOilIds = (c) =>
    JSON.stringify(
      c.variant.ingredients.filter((r) => !r.isAbsorbedOil).map((r) => r.ingredientId),
    );
  const grilledFriedPairs = cases.filter(
    (g) =>
      g.variant.method === "grilled" &&
      cases.some(
        (f) => f.variant.method === "deep_fried" && nonOilIds(f) === nonOilIds(g) && f !== g,
      ),
  );
  const situations = {
    "grilled vs deep-fried pair on the same solids": grilledFriedPairs.length,
    "breaded variant": cases.filter((c) => c.variant.method.startsWith("breaded_")).length,
    "boiled grain": cases.filter(
      (c) =>
        c.variant.method === "boiled" &&
        c.variant.ingredients.some((r) => categoryOf(r.ingredientId) === "grain"),
    ).length,
    "retained-water stew": cases.filter(
      (c) =>
        c.variant.method === "stewed" &&
        c.variant.ingredients.some((r) => r.cookingLiquid === "retained"),
    ).length,
    "absorbed-oil cap (listed fat < absorption capacity)": cases.filter((c) => {
      let capacity = 0;
      let listed = 0;
      for (const r of c.variant.ingredients) {
        if (r.isAbsorbedOil) listed += r.rawG;
        else if (r.cookingLiquid === undefined) {
          const y = yieldRow(ctx, c.variant.method, categoryOf(r.ingredientId));
          capacity += (r.rawG * (y?.oilAbsorptionGPer100gRaw ?? 0)) / 100;
        }
      }
      return listed > 0 && listed < capacity;
    }).length,
    "unknown nutrient stays null": cases.filter((c) =>
      NUTRIENT_KEYS.some((k) => c.expected.per100g[k] === null),
    ).length,
    "null catalogue value made known by a zero bound (R-13)": cases.filter(
      (c) =>
        c.variant.ingredients.some((r) => {
          const n = ctx.ingredients.get(r.ingredientId)?.per100gRaw;
          return (
            n !== undefined &&
            ((n.solubleFibre === null && n.fibre === 0) || (n.sugar === null && n.carbs === 0))
          );
        }) &&
        c.expected.per100g.solubleFibre !== null &&
        c.expected.per100g.sugar !== null,
    ).length,
  };
  for (const [situation, count] of Object.entries(situations)) {
    report.check(count > 0, `golden set includes: ${situation} (${String(count)} case(s))`);
  }
  report.check(
    new Set(cases.map(ids)).size === cases.length,
    "no two golden cases have identical ingredient lists and quantities",
  );

  // Hand arithmetic is documented beside every case.
  const source = readFileSync(join(CORE, "test/nutrition/fixtures/golden.ts"), "utf8");
  const shown = source.split("per 100 g cooked = N / W * 100").length - 1;
  const totals = (source.match(/\/\/ {3}W = [\d.]+ g; N = kcal/g) ?? []).length;
  report.check(
    shown === cases.length && totals === cases.length,
    `golden.ts shows W, N and the per-100 g step for each case (${String(totals)}/${String(cases.length)})`,
  );

  // The comparison itself.
  const problems = goldenProblems(cases, engine.variantNutritionPer100gCooked, ctx);
  report.check(
    problems.length === 0,
    `all ${String(cases.length * (NUTRIENT_KEYS.length + 1))} golden values (9 nutrients + batch cooked grams per case) are within 0.5 %`,
    problems.join("\n"),
  );

  // Negative control 1: a +0.6 % error in one hand value is reported.
  const [first, ...rest] = cases;
  const shifted = {
    ...first,
    expected: {
      ...first.expected,
      per100g: { ...first.expected.per100g, kcal: first.expected.per100g.kcal * 1.006 },
    },
  };
  const shiftedProblems = goldenProblems(
    [shifted, ...rest],
    engine.variantNutritionPer100gCooked,
    ctx,
  );
  report.check(
    shiftedProblems.length === 1,
    `negative control: a golden kcal shifted by +0.6 % fails (${String(shiftedProblems.length)} mismatch)`,
  );

  // Negative control 2: each known-bad catalogue or input breaks at least one golden.
  report.check(
    m.mutants.MUTANTS.length >= 5,
    `five or more mutants (found ${String(m.mutants.MUTANTS.length)})`,
  );
  for (const mutant of m.mutants.MUTANTS) {
    const broken = goldenProblems(
      mutant.cases(cases),
      engine.variantNutritionPer100gCooked,
      mutant.catalog(ctx),
    );
    report.check(
      broken.length > 0,
      `negative control: mutant "${mutant.name}" breaks ${String(broken.length)} golden value(s)`,
    );
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G2: rawForCooked round-trips to batch totals within 0.1 %
// ---------------------------------------------------------------------------------------------
function roundTripProblems(label, v, api, ctx) {
  const problems = [];
  try {
    const base = api.variantNutritionPer100gCooked(v, ctx);
    const W = base.batchCookedG;
    const batchTotals = api.plateNutrients([{ per100g: base.per100g, cookedG: W }]);

    // (a) plates that partition the batch need exactly the batch's raw grams.
    const shares = [0.2, 0.3, 0.5];
    const sums = v.ingredients.map(() => 0);
    const plateTotals = [];
    for (const share of shares) {
      api.rawForCooked(v, W * share, ctx).forEach((line, i) => {
        sums[i] += line.rawG;
      });
      plateTotals.push(api.plateNutrients([{ per100g: base.per100g, cookedG: W * share }]));
    }
    v.ingredients.forEach((row, i) => {
      const p = mismatch(sums[i], row.rawG, ROUND_TRIP_TOLERANCE);
      if (p !== null) problems.push(`${label}: raw ${row.ingredientId} summed over plates: ${p}`);
    });
    const summed = {};
    for (const key of NUTRIENT_KEYS) {
      summed[key] = plateTotals.some((t) => t[key] === null)
        ? null
        : plateTotals.reduce((s, t) => s + t[key], 0);
    }
    problems.push(
      ...nutrientMismatches(summed, batchTotals, ROUND_TRIP_TOLERANCE, `${label} plates sum`),
    );

    // (b) cooking the raw grams for x cooked grams gives x grams with the same composition.
    const x = W * 0.35;
    const lines = api.rawForCooked(v, x, ctx);
    if (lines.length !== v.ingredients.length) {
      problems.push(
        `${label}: ${String(lines.length)} lines for ${String(v.ingredients.length)} rows`,
      );
    }
    lines.forEach((line, i) => {
      const row = v.ingredients[i];
      if (row === undefined || line.ingredientId !== row.ingredientId) {
        problems.push(`${label}: line ${String(i)} is ${line.ingredientId}, not the listed row`);
      } else if ((line.discardedFat === true) !== row.isAbsorbedOil) {
        problems.push(
          `${label}: discardedFat on ${row.ingredientId} is ${String(line.discardedFat)}`,
        );
      }
    });
    const rebuilt = {
      method: v.method,
      ingredients: v.ingredients.map((row, i) => ({ ...row, rawG: lines[i]?.rawG ?? NaN })),
    };
    const again = api.variantNutritionPer100gCooked(rebuilt, ctx);
    const cooked = mismatch(again.batchCookedG, x, ROUND_TRIP_TOLERANCE);
    if (cooked !== null) problems.push(`${label}: rebuilt batch cooked grams: ${cooked}`);
    problems.push(
      ...nutrientMismatches(again.per100g, base.per100g, ROUND_TRIP_TOLERANCE, `${label} rebuilt`),
    );

    // (c) the plate's nutrients are the batch totals scaled by x / W.
    const plate = api.plateNutrients([{ per100g: base.per100g, cookedG: x }]);
    const expected = {};
    for (const key of NUTRIENT_KEYS) {
      expected[key] = batchTotals[key] === null ? null : (batchTotals[key] * x) / W;
    }
    problems.push(...nutrientMismatches(plate, expected, ROUND_TRIP_TOLERANCE, `${label} plate`));
  } catch (error) {
    problems.push(`${label}: threw ${String(error)}`);
  }
  return problems;
}

async function gateG2() {
  const report = new Report("leaf-1.2.1 G2");
  const m = await buildAndLoad(report);
  if (m === undefined) return report.finish();
  const ctx = m.catalog.fixtureCatalog();
  const cases = m.golden.GOLDEN_CASES;
  const api = m.engine;

  for (const c of cases) {
    const problems = roundTripProblems(c.id, c.variant, api, ctx);
    report.check(
      problems.length === 0,
      `${c.id}: raw ↔ cooked round trip within 0.1 %`,
      problems.join("\n"),
    );
  }

  // Hand-checked instance: 1000 g fish + 500 g frying oil → W = 800 + min(60, 500) = 860 g.
  const fish = {
    method: "deep_fried",
    ingredients: [
      { ingredientId: "white_fish", rawG: 1000, isAbsorbedOil: false },
      { ingredientId: "sunflower_oil", rawG: 500, isAbsorbedOil: true },
    ],
  };
  const quarter = api.rawForCooked(fish, 215, ctx);
  report.check(
    mismatch(quarter[0]?.rawG ?? NaN, 250, 1e-12) === null &&
      mismatch(quarter[1]?.rawG ?? NaN, 125, 1e-12) === null &&
      quarter[1]?.discardedFat === true,
    "215 g of deep-fried fish (a quarter of the 860 g batch) needs 250 g fish and 125 g frying oil, flagged discardedFat",
    JSON.stringify(quarter),
  );

  // Negative control: a conversion that ignores yield and absorption fails the same comparison.
  const yieldIgnoring = {
    ...api,
    rawForCooked: (v, cookedG) => {
      const totalRaw = v.ingredients.reduce((s, r) => s + r.rawG, 0);
      return v.ingredients.map((r) => ({
        ingredientId: r.ingredientId,
        rawG: (r.rawG * cookedG) / totalRaw,
      }));
    },
  };
  const failing = cases.filter(
    (c) => roundTripProblems(c.id, c.variant, yieldIgnoring, ctx).length > 0,
  );
  report.check(
    failing.length > 0,
    `negative control: a yield-ignoring raw-from-cooked fails the round trip (${String(failing.length)}/${String(cases.length)} cases)`,
  );
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G3: grilled vs deep_fried fat direction; identical methods give identical output
// ---------------------------------------------------------------------------------------------
async function gateG3() {
  const report = new Report("leaf-1.2.1 G3");
  const m = await buildAndLoad(report);
  if (m === undefined) return report.finish();
  const ctx = m.catalog.fixtureCatalog();
  const compute = m.engine.variantNutritionPer100gCooked;
  const friedHasMoreFat = (grilled, fried) => fried.per100g.fat > grilled.per100g.fat;

  const sets = m.pairs.METHOD_PAIR_SETS;
  report.check(sets.length >= 3, `at least 3 raw-ingredient sets (found ${String(sets.length)})`);
  for (const set of sets) {
    const grilledInput = m.pairs.pairVariant(set.name, "grilled");
    const friedInput = m.pairs.pairVariant(set.name, "deep_fried");
    report.check(
      isDeepStrictEqual(grilledInput.ingredients, friedInput.ingredients),
      `${set.name}: grilled and deep_fried variants list identical raw ingredients`,
    );
    const grilled = compute(grilledInput, ctx);
    const fried = compute(friedInput, ctx);
    report.check(
      friedHasMoreFat(grilled, fried),
      `${set.name}: deep_fried fat ${fried.per100g.fat.toFixed(3)} g > grilled ${grilled.per100g.fat.toFixed(3)} g per 100 g cooked`,
    );

    // Negative control: the same method on independently built inputs.
    const again = compute(m.pairs.pairVariant(set.name, "grilled"), ctx);
    report.check(
      isDeepStrictEqual(grilled, again),
      `${set.name}: grilled vs grilled (separate input objects) gives identical output`,
    );
    report.check(
      !friedHasMoreFat(grilled, again),
      `${set.name}: negative control: the direction assertion rejects the identical-method pair`,
    );
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G4: 100 % line coverage of nutrition/ (NUT-1)
// ---------------------------------------------------------------------------------------------
function listTs(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => relative(dir, join(e.parentPath, e.name)).split("\\").join("/"))
    .sort();
}

/** Runs the nutrition suite with V8 coverage in `coreDir`; returns the parsed reports. */
function measureCoverage(coreDir) {
  const out = mkdtempSync(join(tmpdir(), "leaf-1.2.1-coverage-"));
  try {
    const result = run(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--dir",
        "test/nutrition",
        "--coverage.enabled=true",
        "--coverage.provider=v8",
        "--coverage.include=src/nutrition/**",
        "--coverage.reporter=json-summary",
        `--coverage.reportsDirectory=${out}`,
        "--reporter=json",
        `--outputFile=${join(out, "results.json")}`,
      ],
      { cwd: coreDir },
    );
    const summaryPath = join(out, "coverage-summary.json");
    const resultsPath = join(out, "results.json");
    return {
      result,
      summary: existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : undefined,
      results: existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : undefined,
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** File (relative to src/nutrition) → { covered, total, pct } lines. */
function lineCoverage(summary, coreDir) {
  const base = join(coreDir, "src/nutrition");
  const files = {};
  for (const [path, entry] of Object.entries(summary)) {
    if (path === "total") continue;
    files[relative(base, path).split("\\").join("/")] = entry.lines;
  }
  return { total: summary.total.lines, files };
}

async function gateG4() {
  const report = new Report("leaf-1.2.1 G4");
  const measured = measureCoverage(CORE);
  report.check(
    measured.result.code === 0,
    "vitest run with V8 coverage exits 0",
    tail(measured.result),
  );
  const { results, summary } = measured;
  report.check(
    results !== undefined && summary !== undefined,
    "coverage summary and test results were written",
  );
  if (results === undefined || summary === undefined) return report.finish();

  report.check(
    results.success === true &&
      results.numTotalTests > 0 &&
      results.numFailedTests === 0 &&
      results.numPendingTests === 0 &&
      results.numTodoTests === 0,
    `nutrition tests: ${String(results.numPassedTests)} passed, ${String(results.numFailedTests)} failed, ${String(results.numPendingTests)} skipped, ${String(results.numTodoTests)} todo`,
  );

  const { total, files } = lineCoverage(summary, CORE);
  const sourceFiles = listTs(join(CORE, "src/nutrition"));
  report.check(
    isDeepStrictEqual(Object.keys(files).sort(), sourceFiles),
    `coverage covers exactly the ${String(sourceFiles.length)} files of src/nutrition`,
    `measured: ${Object.keys(files).sort().join(", ")}\nsource:   ${sourceFiles.join(", ")}`,
  );
  for (const [file, lines] of Object.entries(files)) {
    report.check(
      lines.covered === lines.total,
      `src/nutrition/${file}: ${String(lines.covered)}/${String(lines.total)} lines covered`,
    );
  }
  report.check(
    total.total > 0 && total.covered === total.total && total.pct === 100,
    `total line coverage of src/nutrition: ${String(total.covered)}/${String(total.total)} (${String(total.pct)} %)`,
  );

  // Negative control: an uncovered function in a disposable copy drops coverage below 100 %.
  const copy = copyWorkspace(ROOT);
  try {
    const install = installCopy(copy.dir);
    report.check(install.code === 0, "negative control: workspace copy installs", tail(install));
    const copyCore = join(copy.dir, "packages/core");
    const target = join(copyCore, "src/nutrition/atwater.ts");
    writeFileSync(
      target,
      `${readFileSync(target, "utf8")}\nexport function neverCalled(x: number): number {\n  const doubled = x * 2;\n  return doubled + 1;\n}\n`,
    );
    const broken = measureCoverage(copyCore);
    const brokenLines =
      broken.summary === undefined ? undefined : lineCoverage(broken.summary, copyCore);
    report.check(
      brokenLines !== undefined &&
        brokenLines.total.covered < brokenLines.total.total &&
        (brokenLines.files["atwater.ts"]?.covered ?? 0) <
          (brokenLines.files["atwater.ts"]?.total ?? 0),
      `negative control: an uncovered function is measured (${brokenLines === undefined ? "no summary" : `${String(brokenLines.total.covered)}/${String(brokenLines.total.total)} lines`})`,
      tail(broken.result),
    );
  } finally {
    copy.dispose();
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4 };
const gateIndex = process.argv.indexOf("--gate");
const gate = gateIndex === -1 ? undefined : process.argv[gateIndex + 1];
const runGate = gate === undefined ? undefined : GATES[gate];
if (runGate === undefined) {
  console.log(`usage: node scripts/verify/leaf-1.2.1.mjs --gate ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
process.exitCode = await runGate();
