// Verify script for leaf 1.2.7 (id-independent plan search; W-17, R-73).
// Usage: node scripts/verify/leaf-1.2.7.mjs --gate G1|G2|G3
// Prints "VERIFY leaf-1.2.7 <gate> PASSED" only when every assertion, the negative controls
// included, holds; exits non-zero otherwise.
//
// G1  Core: the F1 week at seeds 1–10, planned from the seed library and planned again with every
//     surrogate id of the input remapped to fresh UUIDv7-shaped ids, in reversed and in preserved
//     sort order (support.ts `remapInput`); mapped back, the whole PlanResult is equal (dishes,
//     plate grams, flags, reasons). Seed s and s + 1 differ. Negative control: the same comparison
//     on the pre-fix planner (PRE_FIX, compiled from git) fails under both remaps. Vitest
//     id-independence.test.ts runs too.
// G2  Job path: packages/db id-independence.int.test.ts (generatePlan on two databases), then the
//     worker's own `plan.generate` handler (`runJob` with HANDLERS["plan.generate"], one worker
//     runtime per database) on two more databases, each created empty, migrated, seeded and loaded
//     with F1 on its own. The persisted plates as (date, slot key, member name, dish slug, plate
//     grams, flags) are equal. Negative control: the comparison reports a one-dish change as
//     exactly one difference.
// G3  Measured on this build and on PRE_FIX, seeds 1–10, AI off: SC-1 in-tolerance rate
//     (targeted plates), frequency-relaxed meals and SC-2 (distinct core ingredients, economy 0.4
//     against 0, as 1.2.3 G2 counts them). SC-2 on this build: median >= 8 %, every seed >= 0 %.
//     Then, alone (see below), 1.2.3 G1 G3 G4 G5, 1.2.5 G1–G4, 1.2.6 G1–G2 and 1.4.10 G1.
//
// Concurrency: each gate compiles into directories of its own (pid in the name) and uses databases
// of its own. Gates hold a shared lock while they run; G3's regressions take it exclusively, so
// they start after the other gates of this ledger finish and run one at a time (other leaves'
// gates carry wall-clock budgets). Workspace packages are built in place under the
// `packages-build` lock the other leaves' scripts use.
//
// Database server (G2): DATABASE_URL when set, else localhost:5432, else a throwaway PostgreSQL 16
// cluster of this process.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE = join(ROOT, "packages/core");
const DB = join(ROOT, "packages/db");
const WORKER = join(ROOT, "apps/worker");
const DATA = join(ROOT, "data");
const SELF = fileURLToPath(import.meta.url);

/** The integration branch when 1.2.7 was dispatched: the plan search with id-keyed jitter. */
const PRE_FIX = "9fb710902c8564c3a8cfeaa2e8060c34de348002";
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
/** SC-2 (01 SC-2, OQ-8, R-63): median reduction over seeds 1–10, and every seed's floor. */
const SC2_MEDIAN = 0.08;
const SC2_MIN = 0;
const WIDTH = Math.max(1, Math.min(4, availableParallelism()));
const F1_WEEK = [
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
];

/** Regressions (G3), in the order they run. */
const REGRESSIONS = [
  ["leaf-1.2.3", "G1"],
  ["leaf-1.2.3", "G3"],
  ["leaf-1.2.3", "G4"],
  ["leaf-1.2.3", "G5"],
  ["leaf-1.2.5", "G1"],
  ["leaf-1.2.5", "G2"],
  ["leaf-1.2.5", "G3"],
  ["leaf-1.2.5", "G4"],
  ["leaf-1.2.6", "G1"],
  ["leaf-1.2.6", "G2"],
  ["leaf-1.4.10", "G1"],
];

const pct = (x) => `${(x * 100).toFixed(1)} %`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Processes and locks
// ---------------------------------------------------------------------------------------------

function runAsync(command, args, { cwd, env = {}, timeoutMs = 1_800_000 }) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? -1, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ code: -1, stdout, stderr: `${stderr}\n${String(error)}` });
    });
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

const ROOT_HASH = createHash("sha256").update(ROOT).digest("hex").slice(0, 12);
const SHARED_DIR = join(tmpdir(), `mealplanner-leaf127-shared-${ROOT_HASH}`);
const EXCLUSIVE = join(tmpdir(), `mealplanner-leaf127-exclusive-${ROOT_HASH}.lock`);

function exclusiveHolder() {
  const file = join(EXCLUSIVE, "pid");
  if (!existsSync(file)) return existsSync(EXCLUSIVE) ? -1 : null;
  const pid = Number(readFileSync(file, "utf8"));
  if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) return pid;
  rmSync(EXCLUSIVE, { recursive: true, force: true });
  return null;
}

let sharedFile = null;
/** Every gate holds the shared lock while it runs (waits while a gate holds it exclusively). */
async function acquireShared() {
  mkdirSync(SHARED_DIR, { recursive: true });
  for (;;) {
    while (exclusiveHolder() !== null) await pause(1000);
    sharedFile = join(SHARED_DIR, String(process.pid));
    writeFileSync(sharedFile, String(process.pid));
    if (exclusiveHolder() === null) return;
    rmSync(sharedFile, { force: true });
    sharedFile = null;
  }
}

function releaseShared() {
  if (sharedFile !== null) rmSync(sharedFile, { force: true });
  sharedFile = null;
}

/** Waits until no other gate of this ledger runs, and keeps new ones from starting. */
async function acquireExclusive() {
  for (;;) {
    try {
      mkdirSync(EXCLUSIVE);
      writeFileSync(join(EXCLUSIVE, "pid"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      exclusiveHolder();
      await pause(1000);
    }
  }
  const others = () =>
    (existsSync(SHARED_DIR) ? readdirSync(SHARED_DIR) : []).filter((f) => {
      const pid = Number(f);
      if (pid === process.pid) return false;
      if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) return true;
      rmSync(join(SHARED_DIR, f), { force: true });
      return false;
    });
  while (others().length > 0) await pause(2000);
  return () => rmSync(EXCLUSIVE, { recursive: true, force: true });
}

/** A cross-process lock (atomic mkdir), named as the other leaves' scripts name theirs. */
async function withLock(name, fn) {
  const lock = join(tmpdir(), `mealplanner-${name}-${ROOT_HASH}.lock`);
  const deadline = Date.now() + 25 * 60_000;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pidFile = join(lock, "pid");
      const holder = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : NaN;
      if (Number.isInteger(holder) && holder > 0 && !processAlive(holder)) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${lock}`, { cause: error });
      await pause(500);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Core builds: this checkout, and the pre-fix planner from git
// ---------------------------------------------------------------------------------------------

/** What the planner runs need: src, the seed library, F1 and the G1 harness (support.ts). */
// Every file is listed: the pre-fix tree sits under node_modules/.cache, and tsc does not emit a
// file there that is only imported.
const ENTRY_POINTS = [
  "src",
  "test/fixtures",
  "test/planner/targets/config.ts",
  "test/planner/select/library.ts",
  "test/planner/select/f1.ts",
  "test/planner/select/seed-files.ts",
  "test/planner/select/support.ts",
];

/** Writes PRE_FIX's packages/core (src, test, manifests) under `dir`; returns its core directory. */
function extractPreFix(report, dir) {
  const list = run(
    "git",
    ["ls-tree", "-r", "--name-only", PRE_FIX, "--", "packages/core", "tsconfig.base.json"],
    { cwd: ROOT },
  );
  const files = list.stdout.split("\n").filter((f) => f !== "" && !f.includes("/node_modules/"));
  let ok = list.code === 0 && files.length > 0;
  for (const file of files) {
    const show = run("git", ["show", `${PRE_FIX}:${file}`], { cwd: ROOT });
    if (show.code !== 0) ok = false;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), show.stdout);
  }
  report.check(
    ok,
    `pre-fix planner: ${String(files.length)} files of packages/core at ${PRE_FIX.slice(0, 7)} read from git`,
    tail(list),
  );
  const day = ok ? readFileSync(join(dir, "packages/core/src/planner/select/day.ts"), "utf8") : "";
  report.check(
    day.includes("${dish.id}`)") && !day.includes("dish.slug"),
    "pre-fix planner hashes the dish id into its pre-score jitter (day.ts), and has no slug",
  );
  return join(dir, "packages/core");
}

/** Compiles a core tree (`coreDir`: this checkout's or the pre-fix one) into `out`. */
function compileCore(report, label, coreDir, out) {
  const config = join(dirname(out), `tsconfig.${label.replaceAll(" ", "-")}.json`);
  const entries = ENTRY_POINTS.filter((p) => existsSync(join(coreDir, p)));
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(coreDir, "tsconfig.json"),
      compilerOptions: {
        rootDir: coreDir,
        outDir: out,
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      },
      include: entries.map((p) => join(coreDir, p)),
    }),
  );
  const build = run("pnpm", ["--filter", "@mealplanner/core", "exec", "tsc", "-p", config], {
    cwd: ROOT,
  });
  report.check(
    build.code === 0,
    `${label}: @mealplanner/core compiles into its own directory`,
    tail(build),
  );
  return build.code === 0;
}

/** Compiles this checkout's core and the pre-fix core; returns their output directories. */
function buildTrees(report, gate) {
  const base = join(CORE, "node_modules/.cache", `leaf-1.2.7-${gate}-${String(process.pid)}`);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const fixed = join(base, "fixed");
  const pre = join(base, "pre-fix");
  const preCore = extractPreFix(report, join(base, "pre-fix-src"));
  const ok =
    compileCore(report, "this build", CORE, fixed) && compileCore(report, "pre-fix", preCore, pre);
  return { base, fixed: ok ? fixed : null, pre: ok ? pre : null };
}

/** Runs `tasks` as `--worker` child processes, `WIDTH` at a time; returns their RESULT lines. */
async function workers(report, what, tasks) {
  const queue = tasks.map((t, i) => ({ t, i }));
  const results = new Array(tasks.length);
  const failures = [];
  await Promise.all(
    Array.from({ length: Math.min(WIDTH, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const r = await runAsync(process.execPath, [SELF, "--worker", JSON.stringify(next.t)], {
          cwd: ROOT,
          timeoutMs: 1_200_000,
        });
        const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
        if (r.code !== 0 || line === undefined)
          failures.push(
            `${JSON.stringify(next.t)}: exit ${String(r.code)}\n${r.stderr.slice(-2000)}`,
          );
        else results[next.i] = JSON.parse(line.slice(7));
      }
    }),
  );
  report.check(
    failures.length === 0,
    `${what}: ${String(tasks.length)} worker runs (${String(WIDTH)} processes)`,
    failures.join("\n"),
  );
  return failures.length === 0 ? results : null;
}

// ---------------------------------------------------------------------------------------------
// Worker processes: plans from a compiled tree
// ---------------------------------------------------------------------------------------------

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

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

async function loadTree(dir) {
  const load = (p) => import(pathToFileURL(join(dir, p)).href);
  return {
    planner: await load("src/planner/index.js"),
    library: await load("test/planner/select/library.js"),
    f1: await load("test/planner/select/f1.js"),
  };
}

function f1Input(m, lib, weights = {}) {
  const config = m.f1.f1PlanConfig();
  config.planningWeights = { ...config.planningWeights, aiGeneration: "off", ...weights };
  return { config, dates: F1_WEEK, dishes: lib.dishes, adjusters: lib.adjusters };
}

/** A plan without its run counters, which depend on what earlier runs in the process memoised. */
const stable = (plan) => ({ ...plan, stats: { ...plan.stats, ms: 0, solves: 0, cacheHits: 0 } });

/** Meals whose dish differs, meal by meal in plan order (as support.ts `mealsDiffering`). */
function mealsDiffering(a, b) {
  const dishes = (p) => p.days.flatMap((d) => d.meals.map((mm) => mm.dishId));
  const x = dishes(a);
  const y = dishes(b);
  let n = Math.abs(x.length - y.length);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++;
  return n;
}

/** G1: one seed on one tree; the remap harness always comes from this build's support.ts. */
async function g1Worker({ tree, harness, seed, next }) {
  const m = await loadTree(tree);
  const support = await import(pathToFileURL(join(harness, "test/planner/select/support.js")).href);
  const lib = m.library.buildSeedLibrary(seedFiles());
  const input = f1Input(m, lib);
  const original = await m.planner.planDays(input, { seed });
  const out = { seed, meals: original.days.flatMap((d) => d.meals).length };
  for (const order of ["reverse", "preserve"]) {
    const r = support.remapInput(input, seed, order);
    const back = support.mapBack(await m.planner.planDays(r.input, { seed }), r.back);
    const flags = (p) => JSON.stringify(p.flags);
    const reasons = (p) =>
      JSON.stringify(p.days.flatMap((d) => d.meals.map((mm) => mm.scoreBreakdown.reasons)));
    const grams = (p) =>
      JSON.stringify(
        p.days.flatMap((d) =>
          d.meals.flatMap((mm) => mm.plates.map((pl) => [pl.memberId, pl.solution.items])),
        ),
      );
    out[order] = {
      ids: r.forward.size,
      equal: isDeepStrictEqual(stable(back), stable(original)),
      mealsDiffering: mealsDiffering(original, back),
      sameFlags: flags(back) === flags(original),
      sameReasons: reasons(back) === reasons(original),
      sameGrams: grams(back) === grams(original),
    };
  }
  if (next)
    out.nextSeedDiffering = mealsDiffering(
      original,
      await m.planner.planDays(input, { seed: seed + 1 }),
    );
  // Comparator control: the same equality on a copy with one meal's dish changed.
  const changed = structuredClone(stable(original));
  const meal = changed.days[0].meals[0];
  meal.dishId = changed.days.flatMap((d) => d.meals).find((mm) => mm.dishId !== meal.dishId).dishId;
  out.comparatorCatchesOneDish =
    !isDeepStrictEqual(changed, stable(original)) && mealsDiffering(original, changed) === 1;
  return out;
}

/** G3: one seed on one tree, at economy 0.4 (F1's default) and 0. */
async function g3Worker({ tree, seed }) {
  const m = await loadTree(tree);
  const lib = m.library.buildSeedLibrary(seedFiles());
  const summary = (plan) => {
    const meals = plan.days.flatMap((d) => d.meals);
    const plates = meals.flatMap((mm) => mm.plates.filter((p) => p.targeted));
    return {
      economy: plan.weights[plan.dates[0]].ingredientEconomy,
      targeted: plates.length,
      inTolerance: plates.filter((p) => p.fitStatus === "in_tolerance").length,
      relaxed: meals.filter((mm) => mm.frequencyRelaxed !== null).length,
      relaxedFlags: plan.flags.filter((f) => f.kind === "frequency_relaxed").length,
      variants: meals.flatMap((mm) =>
        mm.plates.flatMap((p) => [
          ...p.solution.items.map((i) => i.variantId),
          ...p.solution.adjusters.map((a) => a.variantId),
        ]),
      ),
    };
  };
  const at = (economy) =>
    m.planner.planDays(f1Input(m, lib, economy === null ? {} : { ingredientEconomy: economy }), {
      seed,
    });
  return { seed, defaultEconomy: summary(await at(null)), zero: summary(await at(0)) };
}

async function worker(task) {
  const result = task.kind === "g1" ? await g1Worker(task) : await g3Worker(task);
  console.log(`RESULT ${JSON.stringify(result)}`);
}

// ---------------------------------------------------------------------------------------------
// Vitest
// ---------------------------------------------------------------------------------------------

function collectVitest(json) {
  return (json?.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((a) => ({
      title: a.title,
      status: a.status,
      failure: (a.failureMessages ?? []).join("\n"),
    })),
  );
}

/** Runs one vitest file; every test must pass, none skip, and each expected title must be there. */
function vitest(report, label, cwd, file, expected, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.2.7-vitest-"));
  const out = join(dir, "report.json");
  try {
    const r = run(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--dir",
        "test",
        file,
        "--reporter=json",
        `--outputFile=${out}`,
        "--reporter=default",
      ],
      { cwd, env: { NODE_OPTIONS: "", ...env }, timeoutMs: 1_500_000 },
    );
    const tests = existsSync(out) ? collectVitest(JSON.parse(readFileSync(out, "utf8"))) : [];
    const failed = tests.filter((t) => t.status !== "passed");
    report.check(
      r.code === 0 && tests.length > 0 && failed.length === 0,
      `${label}: ${String(tests.length - failed.length)} of ${String(tests.length)} tests passed`,
      failed.length > 0
        ? failed.map((t) => `--- ${t.title}\n${t.failure}`).join("\n")
        : tail(r, 40),
    );
    for (const title of expected)
      report.check(
        tests.some((t) => t.title === title && t.status === "passed"),
        `${label}: "${title}" passed`,
      );
    return `${r.stdout}\n${r.stderr}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// G1
// ---------------------------------------------------------------------------------------------

async function gateG1(report) {
  const out = vitest(
    report,
    "packages/core id-independence.test.ts",
    CORE,
    "test/planner/select/id-independence.test.ts",
    [
      "collects every kind of surrogate id: dishes, components, variants, ingredients, adjusters, members, slot types and config rows",
      "reverse order: fresh UUIDv7-shaped ids, one per id, and no original id left outside natural keys",
      "preserve order: fresh UUIDv7-shaped ids, one per id, and no original id left outside natural keys",
      "a different seed changes the plan",
    ],
  );
  const harness = /G1 harness: (.+)/.exec(out)?.[1];
  if (harness !== undefined) console.log(`info - remap harness: ${harness}`);
  const trees = buildTrees(report, "G1");
  try {
    if (trees.fixed === null || trees.pre === null) return;
    const fixed = await workers(
      report,
      "this build, F1 week seeds 1–10, each planned plain, reverse-remapped, preserve-remapped and at seed + 1",
      SEEDS.map((seed) => ({
        kind: "g1",
        tree: trees.fixed,
        harness: trees.fixed,
        seed,
        next: true,
      })),
    );
    const pre = await workers(
      report,
      `pre-fix planner (${PRE_FIX.slice(0, 7)}), the same seeds, plain and under both remaps`,
      SEEDS.map((seed) => ({
        kind: "g1",
        tree: trees.pre,
        harness: trees.fixed,
        seed,
        next: false,
      })),
    );
    if (fixed === null || pre === null) return;
    console.log(
      "info - seed | this build: reverse / preserve meals differing, seed+1 differing | pre-fix: reverse / preserve meals differing (of N)",
    );
    for (let i = 0; i < SEEDS.length; i++) {
      const f = fixed[i];
      const p = pre[i];
      console.log(
        `info - ${String(f.seed).padStart(2)} | ${String(f.reverse.mealsDiffering)} / ${String(f.preserve.mealsDiffering)}, ${String(f.nextSeedDiffering)} | ${String(p.reverse.mealsDiffering)} / ${String(p.preserve.mealsDiffering)} (of ${String(p.meals)})`,
      );
    }
    for (const order of ["reverse", "preserve"]) {
      const bad = fixed.filter((f) => !f[order].equal);
      report.check(
        bad.length === 0 && fixed.every((f) => f[order].ids > 900),
        `this build, ${order}-order remap of ${String(fixed[0][order].ids)} surrogate ids: mapped back, the whole plan is equal for seeds 1–10 (dishes, plate grams, flags, reasons)`,
        bad.map((f) => `seed ${String(f.seed)}: ${JSON.stringify(f[order])}`).join("\n"),
      );
      report.check(
        fixed.every(
          (f) =>
            f[order].sameFlags &&
            f[order].sameReasons &&
            f[order].sameGrams &&
            f[order].mealsDiffering === 0,
        ),
        `this build, ${order}-order remap: dish per meal, plate grams, flags and reasons each equal on every seed`,
      );
    }
    report.check(
      fixed.every((f) => f.nextSeedDiffering > 0),
      `a different seed changes the plan: seed s against s + 1 differs in ${fixed.map((f) => String(f.nextSeedDiffering)).join(", ")} meals`,
    );
    report.check(
      fixed.every((f) => f.comparatorCatchesOneDish),
      "negative control: the comparison reports a plan with one meal's dish changed as different",
    );
    for (const order of ["reverse", "preserve"]) {
      const failing = pre.filter((p) => !p[order].equal);
      report.check(
        failing.length === SEEDS.length,
        `negative control: today's id-keyed jitter (${PRE_FIX.slice(0, 7)}) fails the ${order}-order comparison on ${String(failing.length)} of ${String(SEEDS.length)} seeds (${pre.map((p) => String(p[order].mealsDiffering)).join(", ")} of ${String(pre[0].meals)} meals change)`,
      );
    }
  } finally {
    rmSync(trees.base, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// G2
// ---------------------------------------------------------------------------------------------

async function pgModule() {
  return (await import(pathToFileURL(join(WORKER, "node_modules/pg/lib/index.js")).href)).default;
}

async function query(url, text, values = []) {
  const pg = await pgModule();
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function reachable(url) {
  try {
    await query(url, "SELECT 1");
    return true;
  } catch {
    return false;
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function pgBinDir() {
  const fromConfig = run("pg_config", ["--bindir"], { cwd: ROOT });
  return [fromConfig.code === 0 ? fromConfig.stdout.trim() : "", "/usr/lib/postgresql/16/bin"].find(
    (dir) => dir !== "" && existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl")),
  );
}

/** A PostgreSQL 16 cluster of this process in a temporary directory (removed on stop). */
async function startCluster() {
  const bin = pgBinDir();
  if (bin === undefined)
    throw new Error("no DATABASE_URL, nothing on localhost:5432, and no PostgreSQL 16 binaries");
  const asRoot = process.getuid?.() === 0;
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.2.7-pg-"));
  const port = await freePort();
  const as = (args) =>
    asRoot ? ["runuser", ["-u", "postgres", "--", ...args]] : [args[0], args.slice(1)];
  if (asRoot) run("chown", ["postgres", dir], { cwd: ROOT });
  const init = run(
    ...as([
      join(bin, "initdb"),
      "-D",
      join(dir, "data"),
      "-U",
      "postgres",
      "--auth=trust",
      "--no-sync",
    ]),
    { cwd: tmpdir() },
  );
  if (init.code !== 0) throw new Error(`initdb failed:\n${tail(init)}`);
  const start = run(
    ...as([
      join(bin, "pg_ctl"),
      "-D",
      join(dir, "data"),
      "-l",
      join(dir, "log"),
      "-w",
      "-o",
      `-p ${String(port)} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=200`,
      "start",
    ]),
    { cwd: tmpdir() },
  );
  if (start.code !== 0) throw new Error(`pg_ctl start failed:\n${tail(start)}`);
  return {
    url: `postgres://postgres@127.0.0.1:${String(port)}/postgres`,
    source: "throwaway cluster",
    stop: () => {
      run(...as([join(bin, "pg_ctl"), "-D", join(dir, "data"), "-m", "fast", "stop"]), {
        cwd: tmpdir(),
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function acquireServer(report) {
  let server;
  if (process.env.DATABASE_URL)
    server = { url: process.env.DATABASE_URL, source: "DATABASE_URL", stop: () => undefined };
  else {
    const local = "postgres://postgres:postgres@localhost:5432/postgres";
    server = (await reachable(local))
      ? { url: local, source: "localhost:5432", stop: () => undefined }
      : await startCluster();
  }
  const version = (await query(server.url, "SHOW server_version"))[0]?.server_version ?? "?";
  report.check(
    /^16\./.test(version),
    `database server (${server.source}) is PostgreSQL 16 (server_version ${version})`,
  );
  return server;
}

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Builds core, db, the worker and the worker's workspace dependencies in place (shared lock). */
async function buildPackages(report) {
  const r = await withLock("packages-build", () =>
    run("pnpm", ["exec", "turbo", "run", "build", "--filter", "@mealplanner/worker..."], {
      cwd: ROOT,
      timeoutMs: 1_200_000,
    }),
  );
  report.check(r.code === 0, "workspace packages and the worker are built", tail(r));
  return r.code === 0;
}

/**
 * One database of G2's own, created empty, migrated, seeded and loaded with F1, with the worker's
 * `plan.generate` handler run on it through `runJob` (as the worker's queue runs it).
 */
async function handlerWorld(report, server, label) {
  const name = `leaf127_g2_${label}_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
  await query(server.url, `CREATE DATABASE "${name}"`);
  const url = withDatabase(server.url, name);
  const dist = (p) => import(pathToFileURL(join(p)).href);
  const drop = async () => {
    await query(server.url, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  };
  try {
    const { migrateAndSeed } = await dist(join(DB, "dist/src/seed/index.js"));
    const { loadFixture } = await dist(join(DB, "dist/src/services/config/index.js"));
    const { createJob } = await dist(join(DB, "dist/src/services/plans/index.js"));
    const { F1 } = await dist(join(CORE, "dist/test/fixtures/index.js"));
    const { createWorkerRuntime } = await dist(join(WORKER, "dist/src/runtime.js"));
    const { runJob } = await dist(join(WORKER, "dist/src/runner.js"));
    const { HANDLERS } = await dist(join(WORKER, "dist/src/jobs/handlers.js"));
    await migrateAndSeed(url);
    const rt = await createWorkerRuntime(
      { databaseUrl: url, dataDir: DATA, aiRecipeDailyLimit: 60, concurrency: 1 },
      { model: null },
    );
    let householdId;
    try {
      const loaded = await loadFixture(rt.db, F1);
      householdId = loaded.householdId;
      const job = await createJob(rt.db, {
        kind: "plan.generate",
        householdId,
        payload: { dates: F1_WEEK, seed: 1 },
        createdByUserId: null,
      });
      await runJob(rt, job.id, HANDLERS["plan.generate"]);
      const [row] = await query(url, "SELECT status FROM job WHERE id = $1", [job.id]);
      report.check(
        row?.status === "succeeded",
        `database ${label}: migrated, seeded, F1 loaded; the worker's plan.generate job (F1 week, seed 1) ${String(row?.status)}`,
      );
    } finally {
      await rt.close();
    }
    return { name, url, householdId, drop };
  } catch (error) {
    await drop();
    throw error;
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** The persisted plates as (date, slot key, member name, dish slug, plate grams, flags). */
async function persistedPlates(w) {
  const natural = new Map([[w.householdId, "household"]]);
  for (const r of await query(w.url, "SELECT id, slug FROM ingredient"))
    natural.set(r.id, `ingredient:${r.slug}`);
  for (const r of await query(
    w.url,
    "SELECT id, slug, household_id IS NULL AS global FROM dish WHERE household_id IS NULL OR household_id = $1",
    [w.householdId],
  ))
    natural.set(r.id, `dish:${r.slug}${r.global ? "" : "@household"}`);
  for (const r of await query(w.url, "SELECT id, dish_id, sort_order, name FROM component"))
    if (natural.has(r.dish_id))
      natural.set(r.id, `${natural.get(r.dish_id)}/${String(r.sort_order)}:${r.name}`);
  for (const r of await query(
    w.url,
    "SELECT v.id, v.component_id, v.label, m.key AS method FROM variant v JOIN preparation_method m ON m.id = v.method_id",
  ))
    if (natural.has(r.component_id))
      natural.set(r.id, `${natural.get(r.component_id)}/${r.label}:${r.method}`);
  for (const r of await query(
    w.url,
    "SELECT id, display_name FROM member WHERE household_id = $1",
    [w.householdId],
  ))
    natural.set(r.id, `member:${r.display_name}`);
  for (const r of await query(w.url, "SELECT id, key FROM slot_type WHERE household_id = $1", [
    w.householdId,
  ]))
    natural.set(r.id, `slot:${r.key}`);
  const n = (id) => natural.get(id) ?? id;
  const text = (s) => (s === null ? null : s.replace(UUID, (u) => n(u)));
  const rows = await query(
    w.url,
    `SELECT d.date::text AS date, m.slot_type_id, m.member_scope, p.member_id, m.dish_id,
            p.fit_status, p.deviation, m.score_breakdown,
            COALESCE((SELECT json_agg(json_build_object('variantId', i.variant_id, 'cookedG', i.cooked_g)
                        ORDER BY i.id) FROM plate_item i WHERE i.plate_id = p.id), '[]') AS items
       FROM plan_day d JOIN plan_meal m ON m.plan_day_id = d.id JOIN plate p ON p.plan_meal_id = m.id
      WHERE d.household_id = $1`,
    [w.householdId],
  );
  return rows
    .map((r) => ({
      date: r.date,
      slot: n(r.slot_type_id),
      scope: r.member_scope === "shared" ? "shared" : n(r.member_scope),
      member: n(r.member_id),
      dish: n(r.dish_id),
      grams: r.items.map((i) => `${n(i.variantId)}=${String(i.cookedG)}`),
      flags: [
        r.fit_status,
        text(r.deviation?.flag ?? null),
        text(r.score_breakdown?.meal?.frequencyRelaxed ?? null),
      ],
    }))
    .sort((a, b) => {
      const ka = `${a.date}|${a.slot}|${a.scope}|${a.member}`;
      const kb = `${b.date}|${b.slot}|${b.scope}|${b.member}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

/** Differences between two persisted plate lists, one line each (empty when equal). */
function plateDifferences(a, b) {
  const key = (r) => `${r.date} ${r.slot} ${r.scope} ${r.member}`;
  const byKey = new Map(b.map((r) => [key(r), r]));
  const out = [];
  for (const r of a) {
    const other = byKey.get(key(r));
    if (other === undefined) out.push(`${key(r)}: only in the first database`);
    else if (JSON.stringify(r) !== JSON.stringify(other))
      out.push(
        `${key(r)}: ${r.dish} [${r.grams.join(", ")}] | ${other.dish} [${other.grams.join(", ")}]`,
      );
    byKey.delete(key(r));
  }
  for (const k of byKey.keys()) out.push(`${k}: only in the second database`);
  return out;
}

async function gateG2(report) {
  const server = await acquireServer(report);
  try {
    if (!(await buildPackages(report))) return;
    const out = vitest(
      report,
      "packages/db id-independence.int.test.ts (generatePlan on two seeded databases)",
      DB,
      "test/plans/id-independence.int.test.ts",
      [
        "each database was migrated, seeded and loaded from zero: different databases and ids",
        "the loader's planner input is the same under natural keys (every order included)",
        "persists identical (date, slot key, member, dish slug, plate grams, flags, reasons) rows",
        "persists identical cook batches in the same order (R-1)",
        "negative control: a one-dish change is reported as exactly one difference",
      ],
      { DATABASE_URL: server.url },
    );
    const persisted = /W-17 G2: (.+)/.exec(out)?.[1];
    if (persisted !== undefined) console.log(`info - service level: ${persisted}`);

    const a = await handlerWorld(report, server, "a");
    let b;
    try {
      b = await handlerWorld(report, server, "b");
      const [ha] = await query(a.url, "SELECT id FROM member ORDER BY id LIMIT 1");
      const [hb] = await query(b.url, "SELECT id FROM member ORDER BY id LIMIT 1");
      report.check(
        a.name !== b.name && a.householdId !== b.householdId && ha?.id !== hb?.id,
        `two databases loaded apart (${a.name}, ${b.name}): different household and member ids`,
      );
      const x = await persistedPlates(a);
      const y = await persistedPlates(b);
      const diff = plateDifferences(x, y);
      report.check(
        x.length > 0 && diff.length === 0 && isDeepStrictEqual(x, y),
        `worker plan.generate on each: ${String(x.length)} persisted plates, identical (date, slot key, member name, dish slug, plate grams, flags)`,
        diff.slice(0, 20).join("\n"),
      );
      const flagged = x.filter((r) => r.flags[1] !== null || r.flags[2] !== null).length;
      console.log(
        `info - worker path: ${String(x.length)} plates, ${String(flagged)} flagged or frequency-relaxed`,
      );
      const changed = structuredClone(x);
      const other = x.find((r) => r.dish !== x[0].dish)?.dish;
      changed[0].dish = other;
      const control = plateDifferences(x, changed);
      report.check(
        other !== undefined && control.length === 1 && control[0].includes(other),
        `negative control: a one-dish change is reported as exactly one difference (${control[0] ?? "none"})`,
      );
    } finally {
      await a.drop();
      if (b !== undefined) await b.drop();
    }
  } finally {
    server.stop();
  }
}

// ---------------------------------------------------------------------------------------------
// G3
// ---------------------------------------------------------------------------------------------

/** Core ingredients (not herb_spice, not water) per seed-file variant id, from the seed files. */
function coreIndex() {
  const files = seedFiles();
  const catalogue = new Map(files.ingredients.ingredients.map((i) => [i.slug, i]));
  const isCore = (slug) => catalogue.get(slug)?.category !== "herb_spice" && slug !== "water";
  const variants = new Map();
  for (const d of [...files.dishes, ...files.adjusters.adjusters])
    for (const c of d.components)
      for (const v of c.variants)
        variants.set(
          `${d.slug}.${c.key}.${v.key}`,
          [...new Set(v.ingredients.map((r) => r.ingredient_slug))].filter(isCore),
        );
  return variants;
}

function distinctCore(summary, index) {
  const core = new Set();
  for (const v of summary.variants) {
    const slugs = index.get(v);
    if (slugs === undefined) throw new Error(`variant ${v} not in the seed files`);
    for (const s of slugs) core.add(s);
  }
  return core.size;
}

function aggregate(reductions) {
  const sorted = [...reductions].sort((u, v) => u - v);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0
      ? Number.NaN
      : sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
  return { median, min: sorted[0] ?? Number.NaN, max: sorted.at(-1) ?? Number.NaN };
}

const passesSc2 = (agg) => agg.median >= SC2_MEDIAN && agg.min >= SC2_MIN;

/** Other leaves' gates as child processes, one at a time; each must print its PASSED marker. */
async function regressions(report) {
  for (const [leaf, gate] of REGRESSIONS) {
    const started = Date.now();
    const r = await runAsync(
      process.execPath,
      [join(ROOT, `scripts/verify/${leaf}.mjs`), "--gate", gate],
      {
        cwd: ROOT,
        env: { NODE_OPTIONS: "" },
        timeoutMs: 3_600_000,
      },
    );
    const key = `${leaf} ${gate}`;
    const ok = r.code === 0 && r.stdout.includes(`VERIFY ${key} PASSED`);
    if (!ok)
      console.log(
        `----- ${key}: full output (exit ${String(r.code)}) -----\n${r.stdout}\n${r.stderr}\n----- end of ${key} -----`,
      );
    report.check(
      ok,
      `regression: ${key} passes (${String(Math.round((Date.now() - started) / 1000))} s)`,
    );
  }
}

async function gateG3(report) {
  const index = coreIndex();
  const trees = buildTrees(report, "G3");
  try {
    if (trees.fixed === null || trees.pre === null) return;
    const measure = (tree, what) =>
      workers(
        report,
        what,
        SEEDS.map((seed) => ({ kind: "g3", tree, seed })),
      );
    const fixed = await measure(trees.fixed, "this build, F1 week seeds 1–10 at economy 0.4 and 0");
    const pre = await measure(
      trees.pre,
      `pre-fix planner (${PRE_FIX.slice(0, 7)}), the same plans`,
    );
    if (fixed === null || pre === null) return;
    const figures = (runs) => {
      const reductions = runs.map(
        (r) => 1 - distinctCore(r.defaultEconomy, index) / distinctCore(r.zero, index),
      );
      const targeted = runs.reduce((s, r) => s + r.defaultEconomy.targeted, 0);
      const inTolerance = runs.reduce((s, r) => s + r.defaultEconomy.inTolerance, 0);
      const relaxed = runs.reduce((s, r) => s + r.defaultEconomy.relaxed, 0);
      const relaxedFlags = runs.reduce((s, r) => s + r.defaultEconomy.relaxedFlags, 0);
      return {
        reductions,
        agg: aggregate(reductions),
        targeted,
        inTolerance,
        relaxed,
        relaxedFlags,
      };
    };
    const now = figures(fixed);
    const before = figures(pre);
    report.check(
      fixed.every((r) => r.defaultEconomy.economy === 0.4 && r.zero.economy === 0),
      "the default F1 plans ran at economy 0.4 and the comparison plans at 0",
    );
    console.log(
      "info - seed | SC-2 core reduction: pre-fix | this build   (distinct core ingredients 0.4 / 0)",
    );
    for (let i = 0; i < SEEDS.length; i++)
      console.log(
        `info - ${String(SEEDS[i]).padStart(2)} | ${pct(before.reductions[i])} (${String(distinctCore(pre[i].defaultEconomy, index))} / ${String(distinctCore(pre[i].zero, index))}) | ${pct(now.reductions[i])} (${String(distinctCore(fixed[i].defaultEconomy, index))} / ${String(distinctCore(fixed[i].zero, index))})`,
      );
    console.log(
      `info - SC-2 over seeds 1–10: pre-fix min ${pct(before.agg.min)}, median ${pct(before.agg.median)}, max ${pct(before.agg.max)} | this build min ${pct(now.agg.min)}, median ${pct(now.agg.median)}, max ${pct(now.agg.max)}`,
    );
    console.log(
      `info - SC-1 in tolerance (targeted plates, seeds 1–10, economy 0.4): pre-fix ${String(before.inTolerance)}/${String(before.targeted)} | this build ${String(now.inTolerance)}/${String(now.targeted)}`,
    );
    console.log(
      `info - frequency-relaxed meals (seeds 1–10, economy 0.4): pre-fix ${String(before.relaxed)} | this build ${String(now.relaxed)}`,
    );
    report.check(
      passesSc2(now.agg),
      `SC-2 on this build, seeds 1–10: median ${pct(now.agg.median)} (>= ${pct(SC2_MEDIAN)}), every seed >= ${pct(SC2_MIN)} (min ${pct(now.agg.min)})`,
    );
    report.check(
      now.targeted > 0 && before.targeted > 0 && now.relaxed === now.relaxedFlags,
      `SC-1 and frequency-relaxed figures measured on both builds (${String(now.targeted)} and ${String(before.targeted)} targeted plates; every relaxed meal flagged)`,
    );
    report.check(
      !passesSc2(aggregate(fixed.map(() => 0))),
      "negative control: ten seeds measured against themselves (0 % each) fail the SC-2 median",
    );
    const floor = [...now.reductions];
    floor[floor.indexOf(Math.min(...floor))] = -0.01;
    report.check(
      !passesSc2(aggregate(floor)),
      "negative control: the measured seeds with the lowest set to -1.0 % fail the every-seed floor",
    );
  } finally {
    rmSync(trees.base, { recursive: true, force: true });
  }
  releaseShared();
  const waited = Date.now();
  const release = await acquireExclusive();
  console.log(
    `info - waited ${String(Math.round((Date.now() - waited) / 1000))} s for this ledger's other gates`,
  );
  try {
    await regressions(report);
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--worker") {
    await worker(JSON.parse(args[1]));
    return 0;
  }
  const gate = args[args.indexOf("--gate") + 1];
  const gates = { G1: gateG1, G2: gateG2, G3: gateG3 };
  if (args.indexOf("--gate") < 0 || !(gate in gates)) {
    console.error("usage: node scripts/verify/leaf-1.2.7.mjs --gate G1|G2|G3");
    return 2;
  }
  const report = new Report(`leaf-1.2.7 ${gate}`);
  const started = Date.now();
  await acquireShared();
  try {
    await gates[gate](report);
  } catch (error) {
    report.check(false, `${gate} ran to the end`, String(error?.stack ?? error));
  } finally {
    releaseShared();
  }
  console.log(`info - ${gate} took ${String(Math.round((Date.now() - started) / 1000))} s`);
  return report.finish();
}

process.exitCode = await main();
