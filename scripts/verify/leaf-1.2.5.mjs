// Verify script for leaf 1.2.5 (deterministic solver limit, W-4, R-51).
// Usage: node scripts/verify/leaf-1.2.5.mjs --gate G1|G2|G3|G4
// Prints "VERIFY leaf-1.2.5 <gate> PASSED" only when every assertion, including the negative
// control, holds; exits non-zero otherwise.
//
// Each gate compiles @mealplanner/core with tsc into directories of its own
// (packages/core/node_modules/.cache/leaf-1.2.5-<gate>-<variant>-<pid>, removed at the end), so
// gates can run side by side without sharing files. Plans run in child processes of this script
// (`--worker`), on the seed library (data/) and fixture F1, AI off. G1 spawns busy processes
// (`--busy`) to load every CPU; they end when G1 ends, and exit on their own if G1 dies.
//
// "Idle" figures (G2, G3's baseline) are measured one process at a time and guarded: a timed plan
// whose wall time exceeds its main-thread CPU time by more than 15 % means the machine was busy,
// and the gate fails with "machine not idle" rather than report a figure measured under load.
// R-54: this ledger is reverified with `--jobs 1 --timeout 1200`, so G1 never overlaps G2/G3.
import { fork, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { setImmediate } from "node:timers";
import { performance } from "node:perf_hooks";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";
import { copyWorkspace, installCopy } from "./lib/workspace.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE = join(ROOT, "packages/core");
const DATA = join(ROOT, "data");
const SELF = fileURLToPath(import.meta.url);
const CACHE = join(CORE, "node_modules/.cache");

/** The integration branch at dispatch: the last solver with PLN-5's 0.25 s wall-clock limit. */
const BASELINE_COMMIT = "44ab0919bdf7ba59470d38aa58cde70abef234b7";
const SOLVER_DIRS = ["src/planner/solver", "test/planner/solver"];
/** config.ts line the negative controls substitute (asserted to match exactly once). */
const NODE_LIMIT_LINE = /^export const MIP_NODE_LIMIT_PER_COMBINATION = [\d_]+;$/m;

const G1_SEEDS = [1, 2, 3];
const G1_RUNS = 3;
const G3_SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const DAY_BUDGET_CPU_S = 4.0;
const WEEK_BUDGET_WALL_S = 30;
const G2_DAY_PASSES = 3;
const QUALITY_TOLERANCE = 0.005;
const IDLE_RATIO_MAX = 1.15;
const BUSY_LIFETIME_MS = 20 * 60_000;
/**
 * G4's negative control: no branch-and-bound node at all, so HiGHS stops before finding a plate.
 * A limit of 1 is not enough there: 1.2.2's fixture plates reach tolerance within one node (found
 * at build: 1.2.2 G2 still passed with it), while G3's F1 plans do degrade at 1.
 */
const G4_BROKEN_NODE_LIMIT = 0;

// ---------------------------------------------------------------------------------------------
// Builds: the working tree, the 0.25 s baseline, and substituted variants
// ---------------------------------------------------------------------------------------------

/** A disposable directory under packages/core/node_modules/.cache, unique to this process. */
function scratch(label) {
  const dir = join(CACHE, `leaf-1.2.5-${label}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function tsc(project, outDir) {
  return run(
    "pnpm",
    ["--filter", "@mealplanner/core", "exec", "tsc", "-p", project, "--outDir", outDir],
    { cwd: ROOT },
  );
}

/**
 * Compiles core. `variant`:
 * - `{ kind: "tree" }`: the working tree as is;
 * - `{ kind: "baseline" }`: the working tree with `src/planner/solver/**` and its tests taken from
 *   BASELINE_COMMIT (the 0.25 s wall-clock solver);
 * - `{ kind: "nodes", value }`: the working tree with MIP_NODE_LIMIT_PER_COMBINATION = value;
 * - `{ kind: "instrumented" }`: the working tree with every HiGHS run timed (calibration, info only).
 * Returns the output directory (with `src/…`, `test/…`) or null after a failed check.
 */
function build(report, label, variant) {
  const dir = scratch(label);
  const out = join(dir, "out");
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  if (variant.kind === "tree") {
    const r = tsc("tsconfig.json", out);
    const ok = report.check(
      r.code === 0,
      `core compiles from the working tree into ${relative(ROOT, out)}`,
      tail(r),
    );
    return ok ? { out, dispose } : (dispose(), null);
  }
  const src = join(dir, "tree");
  for (const part of ["src", "test"])
    cpSync(join(CORE, part), join(src, part), { recursive: true });
  writeFileSync(
    join(src, "tsconfig.json"),
    JSON.stringify({
      extends: join(ROOT, "tsconfig.base.json"),
      compilerOptions: { rootDir: ".", outDir: "dist" },
      include: ["src", "test"],
    }),
  );
  let what;
  if (variant.kind === "baseline") {
    const listed = run(
      "git",
      [
        "ls-tree",
        "-r",
        "--name-only",
        BASELINE_COMMIT,
        ...SOLVER_DIRS.map((d) => `packages/core/${d}`),
      ],
      { cwd: ROOT },
    );
    if (
      !report.check(
        listed.code === 0 && listed.stdout.trim() !== "",
        `baseline commit ${BASELINE_COMMIT.slice(0, 7)} is in this clone (its solver files are listed)`,
        tail(listed),
      )
    )
      return (dispose(), null);
    for (const d of SOLVER_DIRS) rmSync(join(src, d), { recursive: true, force: true });
    let files = 0;
    for (const path of listed.stdout.trim().split("\n")) {
      const shown = run("git", ["show", `${BASELINE_COMMIT}:${path}`], { cwd: ROOT });
      if (shown.code !== 0) {
        report.check(false, `git show ${path} at the baseline commit`, tail(shown));
        return (dispose(), null);
      }
      const target = join(src, relative("packages/core", path));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, shown.stdout);
      files++;
    }
    const config = readFileSync(join(src, "src/planner/solver/config.ts"), "utf8");
    if (
      !report.check(
        /export const TIME_LIMIT_PER_COMBINATION_S = 0\.25;/.test(config) &&
          !/MIP_NODE_LIMIT/.test(config),
        `baseline solver (${files} files from ${BASELINE_COMMIT.slice(0, 7)}) has the 0.25 s wall-clock limit and no work limit`,
      )
    )
      return (dispose(), null);
    what = `the 0.25 s wall-clock baseline (solver from ${BASELINE_COMMIT.slice(0, 7)})`;
  } else if (variant.kind === "nodes") {
    const path = join(src, "src/planner/solver/config.ts");
    const text = readFileSync(path, "utf8");
    const matches = text.match(new RegExp(NODE_LIMIT_LINE.source, "gm")) ?? [];
    if (
      !report.check(
        matches.length === 1,
        `node-limit line found once in config.ts for the ${label} build`,
      )
    )
      return (dispose(), null);
    writeFileSync(
      path,
      text.replace(
        NODE_LIMIT_LINE,
        `export const MIP_NODE_LIMIT_PER_COMBINATION = ${variant.value};`,
      ),
    );
    what = `a build with MIP_NODE_LIMIT_PER_COMBINATION = ${variant.value}`;
  } else {
    const path = join(src, "src/planner/solver/highs.ts");
    const text = readFileSync(path, "utf8");
    const anchor = "      model.run();\n      const code = model.getModelStatus();\n";
    if (
      !report.check(
        text.split(anchor).length === 2,
        "instrumentation anchor found once in highs.ts",
      )
    )
      return (dispose(), null);
    writeFileSync(
      path,
      text.replace(
        anchor,
        `      const t0 = performance.now();
      model.run();
      const code = model.getModelStatus();
      const g = globalThis as unknown as { __highsRuns?: number[][] };
      (g.__highsRuns ??= []).push([
        isMip ? 1 : 0,
        performance.now() - t0,
        isMip ? Number(model.info.get("mip_node_count")) : Number(model.info.get("simplex_iteration_count")),
      ]);
`,
      ),
    );
    what = "an instrumented build (HiGHS runs timed)";
  }
  const r = tsc(join(src, "tsconfig.json"), out);
  const ok = report.check(r.code === 0, `core compiles as ${what}`, tail(r));
  return ok ? { out, dispose } : (dispose(), null);
}

async function loadCore(out) {
  const load = (p) => import(pathToFileURL(join(out, p)).href);
  return {
    planner: await load("src/planner/index.js"),
    config: await load("src/planner/solver/config.js"),
    library: await load("test/planner/select/library.js"),
    f1: await load("test/planner/select/f1.js"),
  };
}

function vitest(report, files) {
  const r = run(
    "pnpm",
    ["--filter", "@mealplanner/core", "exec", "vitest", "run", "--dir", "test", ...files],
    { cwd: ROOT },
  );
  const text = `${r.stdout}\n${r.stderr}`;
  const passed = /Tests\s+(\d+) passed/.exec(text);
  report.check(
    r.code === 0 &&
      passed !== null &&
      Number(passed[1]) > 0 &&
      !/\bfailed\b/.test(text) &&
      !/\bskipped\b/.test(text),
    `Vitest ${files.map((f) => f.split("/").at(-1)).join(", ")}: ${passed?.[1] ?? "no"} tests passed`,
    tail(r, 40),
  );
}

// ---------------------------------------------------------------------------------------------
// Workers: plans in child processes
// ---------------------------------------------------------------------------------------------

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function seedLibrary(m) {
  const dir = join(DATA, "seed-dishes");
  return m.library.buildSeedLibrary({
    ingredients: readJson(join(DATA, "ingredients.v1.json")),
    methodYields: readJson(join(DATA, "method-yields.v1.json")),
    dishes: readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(join(dir, f))),
    adjusters: readJson(join(DATA, "adjusters.json")),
  });
}

/** 1.2.3 G4's hash: the whole PlanResult JSON except the run counters. */
function stablePlanHash(plan) {
  const stats = { ...plan.stats, ms: 0, solves: 0, cacheHits: 0 };
  return createHash("sha256")
    .update(JSON.stringify({ ...plan, stats }))
    .digest("hex");
}

/** SPEC-Q-1: the plan objective, Σ PLN-9 meal scores (what the search maximises). */
const planObjective = (plan) =>
  plan.days.reduce((s, d) => s + d.meals.reduce((t, m) => t + m.scoreBreakdown.total, 0), 0);

/** SPEC-Q-3: targeted member-meals and how many are in tolerance (SC-1, as 1.2.3 G1 counts). */
function sc1(plan) {
  const targeted = new Set(plan.members.filter((m) => m.targeted).map((m) => m.id));
  let total = 0;
  let inTolerance = 0;
  for (const d of plan.days)
    for (const meal of d.meals)
      for (const p of meal.plates)
        if (targeted.has(p.memberId)) {
          total++;
          if (p.solution.status === "in_tolerance") inTolerance++;
        }
  return { total, inTolerance };
}

/** The plan with one meal's dish replaced by another dish: the G1 negative-control fixture. */
function oneDishChanged(plan, dishIds) {
  const copy = JSON.parse(JSON.stringify(plan));
  const meal = copy.days[0].meals[0];
  const other = dishIds.find((id) => id !== meal.dishId);
  meal.dishId = other;
  return { plan: copy, from: plan.days[0].meals[0].dishId, to: other };
}

/**
 * Child process: `--worker <out> <seed> <dates|week>`. Plans once and prints one JSON line. Every
 * plan gets a fresh process: the planner memoises plate solves per dish object for the life of the
 * process (1.2.3 `run.ts` SOLVE_MEMO), so a second plan in the same process would reuse the first
 * one's HiGHS results instead of solving. CPU is main-thread CPU (1.2.3 SPEC-Q-16).
 */
async function worker([out, seeds, dates]) {
  const m = await loadCore(out);
  const lib = seedLibrary(m);
  await m.planner.loadPortionSolver();
  const planDates = dates === "week" ? [...m.f1.F1_WEEK] : dates.split(",");
  for (const seed of seeds.split(",").map(Number)) {
    const config = m.f1.f1PlanConfig({});
    config.planningWeights = { ...config.planningWeights, aiGeneration: "off" };
    globalThis.__highsRuns = [];
    const cpu0 = process.threadCpuUsage();
    const t0 = performance.now();
    const plan = await m.planner.planDays(
      { config, dates: planDates, dishes: lib.dishes, adjusters: lib.adjusters },
      { seed },
    );
    const wall = (performance.now() - t0) / 1000;
    const cpu = process.threadCpuUsage(cpu0);
    const changed = oneDishChanged(
      plan,
      lib.dishes.map((d) => d.id),
    );
    console.log(
      JSON.stringify({
        seed,
        dates: dates === "week" ? "week" : dates,
        wall,
        cpu: (cpu.user + cpu.system) / 1e6,
        hash: stablePlanHash(plan),
        changedHash: stablePlanHash(changed.plan),
        changed: `${changed.from} → ${changed.to}`,
        objective: planObjective(plan),
        sc1: sc1(plan),
        meals: plan.days.reduce((s, d) => s + d.meals.length, 0),
        highsRuns: globalThis.__highsRuns,
        nodeLimit: m.config.MIP_NODE_LIMIT_PER_COMBINATION ?? null,
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
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      const lines = [];
      for (const line of stdout.split("\n"))
        if (line.startsWith("{")) {
          try {
            lines.push(JSON.parse(line));
          } catch {
            // not a result line
          }
        }
      resolvePromise({ code: code ?? -1, lines, stderr });
    });
  });
}

/** Runs jobs with at most `width` workers at a time; results in job order. */
async function pool(jobs, width) {
  const results = new Array(jobs.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(width, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await spawnWorker(jobs[i]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Every run exited 0 with the expected number of plans. */
function allRan(report, runs, perRun, what) {
  return report.check(
    runs.every((r) => r.code === 0 && r.lines.length === perRun),
    `${what}: ${runs.length * perRun} plans`,
    runs
      .map((r) => r.stderr)
      .join("\n")
      .slice(-3000),
  );
}

/** Idleness guard: wall ÷ main-thread CPU of every timed plan. */
function idle(report, lines, what) {
  const worst = Math.max(...lines.map((l) => l.wall / l.cpu));
  return report.check(
    worst <= IDLE_RATIO_MAX,
    `${what} measured idle: worst wall/CPU ratio ${worst.toFixed(3)} (<= ${IDLE_RATIO_MAX}; above it the machine was not idle)`,
    "machine not idle: another process competed for the CPU while this was timed; rerun with nothing else running (R-54: --jobs 1)",
  );
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ---------------------------------------------------------------------------------------------
// Busy processes (G1)
// ---------------------------------------------------------------------------------------------

/** Child process: spins until told to stop, then reports its own CPU time. */
function busy() {
  const started = Date.now();
  let stop = false;
  process.on("message", (msg) => {
    if (msg === "stop") stop = true;
  });
  process.on("disconnect", () => process.exit(0));
  const spin = () => {
    if (stop) {
      const c = process.cpuUsage();
      process.send?.({ cpu: (c.user + c.system) / 1e6 }, () => process.exit(0));
      return;
    }
    if (Date.now() - started > BUSY_LIFETIME_MS) process.exit(0);
    const until = performance.now() + 25;
    let x = 0;
    while (performance.now() < until) x += Math.sqrt(x + 1);
    setImmediate(spin);
  };
  spin();
  return new Promise(() => {});
}

/** Starts one busy process per CPU. `stop()` returns their CPU seconds; `kill()` always cleans up. */
function startLoad(count) {
  const children = Array.from({ length: count }, () =>
    fork(SELF, ["--busy"], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore", "ipc"] }),
  );
  const kill = () => {
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  };
  process.on("exit", kill);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.once(signal, () => {
      kill();
      process.exit(1);
    });
  const stop = () =>
    Promise.all(
      children.map(
        (c) =>
          new Promise((res) => {
            const timer = setTimeout(() => res(null), 5000);
            c.once("message", (m) => {
              clearTimeout(timer);
              res(m.cpu);
            });
            c.once("exit", () => {
              clearTimeout(timer);
              res(null);
            });
            c.send("stop");
          }),
      ),
    );
  return { stop, kill, children };
}

// ---------------------------------------------------------------------------------------------
// G1: determinism under load (PLN-11, W-4)
// ---------------------------------------------------------------------------------------------

/** Seed → the distinct hashes over every run; a seed with more than one differs somewhere. */
function compareRuns(runs) {
  const bySeed = new Map();
  for (const r of runs)
    for (const l of r.lines) {
      const set = bySeed.get(l.seed) ?? new Set();
      set.add(l.hash);
      bySeed.set(l.seed, set);
    }
  return [...bySeed].map(([seed, hashes]) => ({ seed, hashes: [...hashes] }));
}

async function gateG1() {
  const report = new Report("leaf-1.2.5 G1");
  vitest(report, ["test/planner/solver/work-limit.test.ts"]);
  const built = build(report, "G1-tree", { kind: "tree" });
  if (built === null) return report.finish();
  const cpus = availableParallelism();
  let load;
  try {
    // A run plans seeds 1–3 in turn, each in a fresh process.
    const runOnce = async () => {
      const lines = [];
      let stderr = "";
      let code = 0;
      for (const seed of G1_SEEDS) {
        const [r] = await pool([[built.out, String(seed), "week"]], 1);
        lines.push(...r.lines);
        stderr += r.stderr;
        if (r.code !== 0) code = r.code;
      }
      return { code, lines, stderr };
    };
    // Idle: one run at a time, nothing else started by this script.
    const idleRuns = [];
    for (let i = 0; i < G1_RUNS; i++) idleRuns.push(await runOnce());
    // Loaded: one busy process per CPU, then the three runs at once.
    load = startLoad(cpus);
    await new Promise((r) => setTimeout(r, 1000));
    const t0 = performance.now();
    const loadedRuns = await Promise.all(Array.from({ length: G1_RUNS }, runOnce));
    const loadedWall = (performance.now() - t0) / 1000;
    const busyCpu = await load.stop();
    load.kill();

    const ranIdle = allRan(
      report,
      idleRuns,
      G1_SEEDS.length,
      "idle runs (one at a time, one process per plan)",
    );
    const ranLoaded = allRan(
      report,
      loadedRuns,
      G1_SEEDS.length,
      `runs under load (${G1_RUNS} at once, with ${cpus} busy processes, one process per plan)`,
    );
    if (!ranIdle || !ranLoaded) return report.finish();

    // The load was real: the busy processes held the CPUs, and the plans ran slower for it.
    const busyTotal = busyCpu.reduce((s, c) => s + (c ?? 0), 0);
    report.check(
      busyCpu.every((c) => c !== null) && busyTotal >= 0.5 * cpus * loadedWall,
      `load: ${cpus} busy processes used ${busyTotal.toFixed(1)} CPU s over the ${loadedWall.toFixed(1)} s loaded period (>= half of every CPU: ${(0.5 * cpus * loadedWall).toFixed(1)} s)`,
    );
    const ratio = (runs) => {
      const ls = runs.flatMap((r) => r.lines);
      return ls.reduce((s, l) => s + l.wall / l.cpu, 0) / ls.length;
    };
    const idleRatio = ratio(idleRuns);
    const loadedRatio = ratio(loadedRuns);
    report.check(
      loadedRatio >= 1.2 * idleRatio,
      `plans under load waited for the CPU: mean wall/CPU ${loadedRatio.toFixed(2)} loaded vs ${idleRatio.toFixed(2)} idle (>= 1.2×)`,
    );
    for (const r of [...idleRuns, ...loadedRuns])
      for (const l of r.lines)
        console.log(
          `info - seed ${l.seed}: ${l.hash.slice(0, 16)}… ${l.cpu.toFixed(2)} s CPU, ${l.wall.toFixed(2)} s wall, ${l.meals} meals`,
        );

    const all = [...idleRuns, ...loadedRuns];
    const compared = compareRuns(all);
    for (const { seed, hashes } of compared)
      report.check(
        hashes.length === 1,
        `seed ${seed}: all ${all.length} runs (${G1_RUNS} idle, ${G1_RUNS} loaded) give the same plan (sha256 ${hashes.join(" / ")})`,
      );
    report.check(
      compared.length === G1_SEEDS.length &&
        new Set(compared.map((c) => c.hashes[0])).size === G1_SEEDS.length,
      `the ${G1_SEEDS.length} seeds give ${G1_SEEDS.length} different plans`,
    );

    // Negative control: the same comparison, with one loaded plan's one dish changed.
    const victim = loadedRuns[0].lines[0];
    const tampered = all.map((r, i) =>
      i === idleRuns.length
        ? {
            ...r,
            lines: r.lines.map((l) => (l === victim ? { ...l, hash: l.changedHash } : l)),
          }
        : r,
    );
    const differing = compareRuns(tampered).filter((c) => c.hashes.length > 1);
    report.check(
      differing.length === 1 && differing[0].seed === victim.seed,
      `negative control: a seed-${victim.seed} plan with one dish changed (${victim.changed}) is reported as different (${differing.map((d) => `seed ${d.seed}: ${d.hashes.length} hashes`).join(", ")})`,
    );
  } finally {
    load?.kill();
    built.dispose();
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G2: budgets (R-38, PLN-11)
// ---------------------------------------------------------------------------------------------

const dayWithinBudget = (line) => line.cpu <= DAY_BUDGET_CPU_S;

async function gateG2() {
  const report = new Report("leaf-1.2.5 G2");
  const built = build(report, "G2-tree", { kind: "tree" });
  if (built === null) return report.finish();
  try {
    const m = await loadCore(built.out);
    const week = [...m.f1.F1_WEEK];
    const weekRun = await pool([[built.out, "1", "week"]], 1);
    const dayJobs = [];
    for (let pass = 0; pass < G2_DAY_PASSES; pass++)
      for (const d of week) dayJobs.push([built.out, "1", d]);
    const dayRuns = await pool(dayJobs, 1);
    if (
      !allRan(
        report,
        [...weekRun, ...dayRuns],
        1,
        "F1 week and days, seed 1, one process at a time",
      )
    )
      return report.finish();
    const w = weekRun[0].lines[0];
    const days = dayRuns.map((r) => r.lines[0]);
    idle(report, [w, ...days], "week and day plans");
    report.check(
      w.wall <= WEEK_BUDGET_WALL_S,
      `week: F1 week ${w.wall.toFixed(2)} s wall (${w.cpu.toFixed(2)} s CPU, ${w.meals} meals) (<= ${WEEK_BUDGET_WALL_S} s)`,
    );
    for (const d of week) {
      const xs = days.filter((x) => x.dates === d);
      console.log(
        `info - day ${d}: ${xs.map((x) => x.cpu.toFixed(2)).join(" / ")} s CPU (${xs[0].meals} meals)`,
      );
    }
    const worst = days.reduce((a, b) => (b.cpu > a.cpu ? b : a));
    report.check(
      days.length === G2_DAY_PASSES * week.length && days.every(dayWithinBudget),
      `day: worst F1 day ${worst.dates} ${worst.cpu.toFixed(2)} s CPU (wall ${worst.wall.toFixed(2)} s) over ${days.length} runs (<= ${DAY_BUDGET_CPU_S} s)`,
    );
    // Negative control: the day-budget assertion, applied through the same harness to a known
    // over-budget measurement (the whole week measured as one plan), must fail.
    report.check(
      !dayWithinBudget(w),
      `negative control: the day-budget check rejects the week run (${w.cpu.toFixed(2)} s CPU > ${DAY_BUDGET_CPU_S} s)`,
    );
  } finally {
    built.dispose();
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G3: quality against the 0.25 s wall-clock baseline (PLN-5, SC-1)
// ---------------------------------------------------------------------------------------------

function quality(lines) {
  const bySeed = new Map(lines.map((l) => [l.seed, l]));
  const objectives = G3_SEEDS.map((s) => bySeed.get(s).objective);
  const total = lines.reduce((s, l) => s + l.sc1.total, 0);
  const inTol = lines.reduce((s, l) => s + l.sc1.inTolerance, 0);
  return { bySeed, median: median(objectives), total, inTol, rate: inTol / total };
}

/** SPEC-Q-2/3: median objective within ±0.5 % of the baseline's, SC-1 rate not lower. */
function qualityHolds(q, base) {
  const rel = (q.median - base.median) / Math.abs(base.median);
  return {
    rel,
    objectiveOk: Math.abs(rel) <= QUALITY_TOLERANCE,
    rateOk: q.inTol * base.total >= base.inTol * q.total,
  };
}

async function gateG3() {
  const report = new Report("leaf-1.2.5 G3");
  const builds = {
    base: build(report, "G3-baseline", { kind: "baseline" }),
    tree: build(report, "G3-tree", { kind: "tree" }),
    bad: build(report, "G3-nodes1", { kind: "nodes", value: 1 }),
    calib: build(report, "G3-instrumented", { kind: "instrumented" }),
  };
  try {
    if (Object.values(builds).some((b) => b === null)) return report.finish();
    const jobs = (b) => G3_SEEDS.map((s) => [b.out, String(s), "week"]);
    // Baseline first, alone: one fresh process per seed, one at a time, nothing else running.
    const baseRuns = await pool(jobs(builds.base), 1);
    if (!allRan(report, baseRuns, 1, "0.25 s baseline, seeds 1–10, idle, one process at a time"))
      return report.finish();
    const baseLines = baseRuns.map((r) => r.lines[0]);
    idle(report, baseLines, "the 0.25 s baseline");
    // The work-limited plans do not depend on load (G1), so they may run side by side.
    const width = Math.max(1, Math.min(4, availableParallelism() - 1));
    const treeRuns = await pool(jobs(builds.tree), width);
    const badRuns = await pool(jobs(builds.bad), width);
    const treeLines = treeRuns.flatMap((r) => r.lines);
    const badLines = badRuns.flatMap((r) => r.lines);
    report.check(
      treeRuns.every((r) => r.code === 0) && treeLines.length === G3_SEEDS.length,
      `work-limited solver, seeds 1–10: ${treeLines.length} plans (one process per plan, ${width} at a time)`,
      treeRuns
        .map((r) => r.stderr)
        .join("\n")
        .slice(-3000),
    );
    report.check(
      badRuns.every((r) => r.code === 0) && badLines.length === G3_SEEDS.length,
      `negative-control build (node limit 1), seeds 1–10: ${badLines.length} plans (one process per plan, ${width} at a time)`,
      badRuns
        .map((r) => r.stderr)
        .join("\n")
        .slice(-3000),
    );
    if (treeLines.length !== G3_SEEDS.length || badLines.length !== G3_SEEDS.length)
      return report.finish();

    const base = quality(baseLines);
    const tree = quality(treeLines);
    const bad = quality(badLines);
    let identical = 0;
    for (const s of G3_SEEDS) {
      const b = base.bySeed.get(s);
      const t = tree.bySeed.get(s);
      const same = b.hash === t.hash;
      if (same) identical++;
      console.log(
        `info - seed ${s}: objective ${t.objective.toFixed(4)} vs baseline ${b.objective.toFixed(4)} (ratio ${(t.objective / b.objective).toFixed(5)}), SC-1 ${t.sc1.inTolerance}/${t.sc1.total} vs ${b.sc1.inTolerance}/${b.sc1.total}, plan ${same ? "identical" : "different"}; baseline ${b.wall.toFixed(2)} s wall / ${b.cpu.toFixed(2)} s CPU`,
      );
    }
    const q = qualityHolds(tree, base);
    report.check(
      q.objectiveOk,
      `median plan objective ${tree.median.toFixed(4)} vs 0.25 s baseline ${base.median.toFixed(4)}: ${(q.rel * 100).toFixed(3)} % (within ±${QUALITY_TOLERANCE * 100} %)`,
    );
    report.check(
      q.rateOk,
      `SC-1 in-tolerance rate ${tree.inTol}/${tree.total} (${(tree.rate * 100).toFixed(2)} %) vs baseline ${base.inTol}/${base.total} (${(base.rate * 100).toFixed(2)} %): not lower`,
    );
    // R-54: at idle no F1 solve reaches either limit, so the plans equal the baseline's.
    report.check(
      identical === G3_SEEDS.length,
      `plan identity at idle (R-54): ${identical} of ${G3_SEEDS.length} work-limited plans identical to the 0.25 s baseline (sha256)`,
    );

    // Negative control: the same assertions on the node-limit-1 build must fail.
    const n = qualityHolds(bad, base);
    const badIdentical = G3_SEEDS.filter(
      (s) => bad.bySeed.get(s).hash === base.bySeed.get(s).hash,
    ).length;
    report.check(
      !(n.objectiveOk && n.rateOk),
      `negative control: node limit 1 fails the quality check (median objective ${bad.median.toFixed(4)}, ${(n.rel * 100).toFixed(3)} %; SC-1 ${bad.inTol}/${bad.total} = ${(bad.rate * 100).toFixed(2)} %; ${badIdentical} of ${G3_SEEDS.length} plans identical to the baseline)`,
    );

    // Calibration on this machine (info): what 0.25 s is worth in nodes and LP iterations.
    const calibRuns = await pool(
      [1, 2, 3].map((s) => [builds.calib.out, String(s), "week"]),
      1,
    );
    const runs = calibRuns.flatMap((r) => r.lines.flatMap((l) => l.highsRuns));
    const perNode = runs.filter((r) => r[0] === 1 && r[2] >= 20).map((r) => r[1] / r[2]);
    const perIter = runs.filter((r) => r[0] === 0 && r[2] >= 20).map((r) => r[1] / r[2]);
    const cfg = (await loadCore(builds.tree.out)).config;
    if (perNode.length > 0 && perIter.length > 0)
      console.log(
        `info - calibration on this machine (seeds 1–3, idle): ${median(perNode).toFixed(3)} ms/node over ${perNode.length} MILPs → 0.25 s ≈ ${Math.floor(250 / median(perNode))} nodes (configured ${cfg.MIP_NODE_LIMIT_PER_COMBINATION}); ${median(perIter).toFixed(4)} ms/iteration over ${perIter.length} LPs → ≈ ${Math.floor(250 / median(perIter))} iterations (configured ${cfg.LP_ITERATION_LIMIT_PER_COMBINATION}); most nodes in one MILP ${Math.max(...runs.filter((r) => r[0] === 1).map((r) => r[2]))}, most LP iterations ${Math.max(...runs.filter((r) => r[0] === 0).map((r) => r[2]))}`,
      );
    else
      console.log(
        `info - calibration run produced no data: ${calibRuns
          .map((r) => r.stderr)
          .join("\n")
          .slice(-500)}`,
      );
  } finally {
    for (const b of Object.values(builds)) b?.dispose();
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G4: no regression (1.2.2 G1–G5, 1.2.3 G1/G3/G4/G5; 1.2.3 G2 reported)
// ---------------------------------------------------------------------------------------------

function subGate(cwd, leaf, gate) {
  const t0 = performance.now();
  const r = run(process.execPath, [join(cwd, `scripts/verify/leaf-${leaf}.mjs`), "--gate", gate], {
    cwd,
    timeoutMs: 900_000,
  });
  const text = `${r.stdout}\n${r.stderr}`;
  return {
    ...r,
    text,
    seconds: (performance.now() - t0) / 1000,
    passed: r.code === 0 && text.includes(`VERIFY leaf-${leaf} ${gate} PASSED`),
  };
}

async function gateG4() {
  const report = new Report("leaf-1.2.5 G4");
  const required = [
    ["1.2.2", "G1"],
    ["1.2.2", "G2"],
    ["1.2.2", "G3"],
    ["1.2.2", "G4"],
    ["1.2.2", "G5"],
    ["1.2.3", "G1"],
    ["1.2.3", "G3"],
    ["1.2.3", "G4"],
    ["1.2.3", "G5"],
  ];
  for (const [leaf, gate] of required) {
    const r = subGate(ROOT, leaf, gate);
    for (const line of r.text.split("\n"))
      if (/^(ok|FAIL|info) +- /.test(line) && /week:|day:|SC-1|p95|median|sha256/.test(line))
        console.log(`       ${leaf} ${gate}: ${line}`);
    report.check(
      r.passed,
      `leaf-${leaf} ${gate} passes (${r.seconds.toFixed(0)} s)`,
      r.text
        .split("\n")
        .filter((l) => /FAIL|Error/.test(l))
        .slice(0, 30)
        .join("\n") || tail(r, 30),
    );
  }
  // 1.2.3 G2 (SC-2) is reported, not required: W-3 / OQ-8 is open (R-37).
  const g2 = subGate(ROOT, "1.2.3", "G2");
  const figures = g2.text.split("\n").filter((l) => /reduction|^(ok|FAIL) +- /.test(l));
  for (const line of figures) console.log(`       1.2.3 G2: ${line}`);
  report.check(
    figures.some((l) => /reduction over seeds/.test(l)),
    `leaf-1.2.3 G2 ran and reported its SC-2 figures (${g2.passed ? "PASSED" : "not passed; W-3 open, reported only"})`,
    tail(g2, 30),
  );

  // Negative control: in a disposable workspace copy with a broken node limit, 1.2.2 G2 must fail.
  const copy = copyWorkspace(ROOT);
  try {
    const config = join(copy.dir, "packages/core/src/planner/solver/config.ts");
    const text = readFileSync(config, "utf8");
    const matched = (text.match(new RegExp(NODE_LIMIT_LINE.source, "gm")) ?? []).length === 1;
    writeFileSync(
      config,
      text.replace(
        NODE_LIMIT_LINE,
        `export const MIP_NODE_LIMIT_PER_COMBINATION = ${G4_BROKEN_NODE_LIMIT};`,
      ),
    );
    const install = installCopy(copy.dir);
    if (
      report.check(
        matched && install.code === 0,
        `negative control: workspace copy with MIP_NODE_LIMIT_PER_COMBINATION = ${G4_BROKEN_NODE_LIMIT} installed`,
        tail(install),
      )
    ) {
      const bad = subGate(copy.dir, "1.2.2", "G2");
      const failed = bad.text.split("\n").filter((l) => /^FAIL/.test(l));
      report.check(
        !bad.passed && failed.length > 0,
        `negative control: 1.2.2 G2 fails with the node limit at ${G4_BROKEN_NODE_LIMIT} (${failed.length} failed assertion(s): ${failed.slice(0, 2).join(" | ").slice(0, 300)})`,
        tail(bad, 30),
      );
    }
  } finally {
    copy.dispose();
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4 };

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--worker") return worker(args.slice(1));
  if (args[0] === "--busy") return busy();
  const gate = args[0] === "--gate" ? args[1] : undefined;
  const fn = gate === undefined ? undefined : GATES[gate];
  if (fn === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.2.5.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    return 2;
  }
  return fn();
}

main().then(
  (code) => {
    if (typeof code === "number") process.exit(code);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
