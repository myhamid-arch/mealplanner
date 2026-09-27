// Verify script for leaf 1.2.6 (Owner rulings: repeat gaps, slot-scoped exclusions; OQ-8, OQ-9,
// R-62, R-63).
// Usage: node scripts/verify/leaf-1.2.6.mjs --gate G1|G2|G3|G4
// Prints "VERIFY leaf-1.2.6 <gate> PASSED" only when every assertion holds, including the gate's
// negative controls; exits non-zero otherwise.
//
// Each gate compiles @mealplanner/core into its own directory and works in its own temp directory,
// so gates can run concurrently. Other leaves' gates are run through their own verify scripts,
// one after another (1.2.5 G1 needs an idle machine). Database: DATABASE_URL when set, otherwise
// postgres://postgres:postgres@localhost:5432/postgres; the integration tests create their own
// randomly named databases on that server and drop them.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE = join(ROOT, "packages/core");
const DB = join(ROOT, "packages/db");
const DATA = join(ROOT, "data");
const SELF = fileURLToPath(import.meta.url);
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres";

/** OQ-8, independent of the planner's constants: the day difference a repeat needs, by slot. */
const SHORT_SLOTS = new Set(["snack", "pre_workout", "post_workout"]);
const gapOf = (slotKey) => (SHORT_SLOTS.has(slotKey) ? 4 : 7);
const OLD_GAP = 6;
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const SCHOOL = "packed_school_lunch";
const NUT_COPY = "Is the school nut-free? I'll keep nuts out of the lunch boxes.";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// ---------------------------------------------------------------------------------------------
// Helpers: temp dirs, compiled core, Vitest, other leaves' gates
// ---------------------------------------------------------------------------------------------

function gateTemp(gate) {
  return mkdtempSync(join(tmpdir(), `leaf-1.2.6-${gate}-`));
}

/** Compiles core (src and test) into its own directory under core's node_modules/.cache. */
function compileCore(report, label) {
  const out = join(CORE, "node_modules/.cache", `leaf-1.2.6-${label}-${String(process.pid)}`);
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
    filters: await load("src/planner/select/filters.js"),
    members: await load("src/planner/select/members.js"),
    pool: await load("src/planner/select/pool.js"),
    changes: await load("src/changes/index.js"),
    followups: await load("src/onboarding/followups/index.js"),
    library: await load("test/planner/select/library.js"),
    f1: await load("test/planner/select/f1.js"),
  };
}

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

/**
 * Runs Vitest in a package with the JSON reporter. Passes when every listed file ran, at least one
 * test passed in each, and nothing failed or was skipped.
 */
function vitest(report, label, pkgDir, files, tmp, env = {}) {
  const outputFile = join(tmp, `vitest-${label.replace(/\W+/g, "-")}.json`);
  const r = run(
    process.execPath,
    [
      join(ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      "--dir",
      "test",
      "--reporter=json",
      `--outputFile.json=${outputFile}`,
      ...files,
    ],
    { cwd: pkgDir, env, timeoutMs: 900_000 },
  );
  const json = (() => {
    try {
      return readJson(outputFile);
    } catch {
      return null;
    }
  })();
  const results = json?.testResults ?? [];
  const perFile = files.map((f) => {
    const hit = results.find((t) => t.name.endsWith(f));
    const tests = hit?.assertionResults ?? [];
    return {
      file: f,
      ran: hit !== undefined,
      passed: tests.filter((t) => t.status === "passed").length,
      other: tests.filter((t) => t.status !== "passed").length,
    };
  });
  const ok =
    r.code === 0 &&
    json !== null &&
    json.numFailedTests === 0 &&
    json.numPendingTests === 0 &&
    json.numTodoTests === 0 &&
    perFile.every((p) => p.ran && p.passed > 0 && p.other === 0);
  report.check(
    ok,
    `Vitest ${label}: ${perFile.map((p) => `${p.file.split("/").at(-1)} ${String(p.passed)} passed`).join(", ")}`,
    `${tail(r, 40)}\n${JSON.stringify(perFile)}`,
  );
  return ok;
}

/** Runs another leaf's gate through its verify script; returns its output lines. */
function otherGate(report, leaf, gate, env = {}) {
  const t0 = Date.now();
  const r = run(
    process.execPath,
    [join(ROOT, "scripts/verify", `leaf-${leaf}.mjs`), "--gate", gate],
    {
      cwd: ROOT,
      env,
      timeoutMs: 1_500_000,
    },
  );
  const out = `${r.stdout}\n${r.stderr}`;
  report.check(
    r.code === 0 && out.includes(`VERIFY leaf-${leaf} ${gate} PASSED`),
    `leaf-${leaf} ${gate} passes (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
    tail(r, 40),
  );
  return out.split("\n");
}

/** Harness control: a gate that does not exist never counts as passed. */
function otherGateControl(report, leaf) {
  const r = run(
    process.execPath,
    [join(ROOT, "scripts/verify", `leaf-${leaf}.mjs`), "--gate", "G99"],
    {
      cwd: ROOT,
    },
  );
  report.check(
    r.code !== 0 && !`${r.stdout}${r.stderr}`.includes("PASSED"),
    `negative control: leaf-${leaf} --gate G99 exits non-zero without a PASSED marker`,
  );
}

// ---------------------------------------------------------------------------------------------
// Workers: F1 week plans in child processes (seeds split over the available cores)
// ---------------------------------------------------------------------------------------------

/** What G1 checks of a plan: meals with slot, dish, attendees, and the relaxed flags. */
function summarise(plan) {
  return {
    meals: plan.days.flatMap((d) =>
      d.meals.map((m) => ({
        date: d.date,
        slotKey: m.slotKey,
        memberScope: m.memberScope,
        kind: m.kind,
        dishId: m.dishId,
        members: m.plates.map((p) => p.memberId),
      })),
    ),
    relaxed: plan.flags
      .filter((f) => f.kind === "frequency_relaxed")
      .map((f) => ({ date: f.date, slotKey: f.slotKey, memberId: f.memberId })),
  };
}

async function worker(args) {
  const [kind, out, seeds] = args;
  const m = await loadCore(out);
  const lib = m.library.buildSeedLibrary(seedFiles());
  await m.planner.loadPortionSolver();
  if (kind === "g1")
    for (const seed of seeds.split(",").map(Number)) {
      const config = m.f1.f1PlanConfig();
      config.planningWeights = { ...config.planningWeights, aiGeneration: "off" };
      const plan = await m.planner.planDays(
        { config, dates: [...m.f1.F1_WEEK], dishes: lib.dishes, adjusters: lib.adjusters },
        { seed },
      );
      console.log(JSON.stringify({ seed, summary: summarise(plan) }));
    }
  return 0;
}

function spawnWorker(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [SELF, "--worker", ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("close", (code) =>
      resolveRun({
        code,
        stderr,
        lines: stdout
          .split("\n")
          .filter((l) => l.startsWith("{"))
          .map((l) => JSON.parse(l)),
      }),
    );
  });
}

async function planSeeds(kind, out) {
  const width = Math.max(1, Math.min(4, availableParallelism()));
  const chunks = Array.from({ length: width }, (_, w) =>
    SEEDS.filter((_, i) => i % width === w),
  ).filter((c) => c.length > 0);
  const runs = await Promise.all(chunks.map((c) => spawnWorker([kind, out, c.join(",")])));
  return { runs, lines: runs.flatMap((r) => r.lines) };
}

// ---------------------------------------------------------------------------------------------
// G1: repeat gaps
// ---------------------------------------------------------------------------------------------

const dayNumber = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/**
 * Pairs of servings of one dish that share an attendee and are closer than `gap(a, b)` days, where
 * neither meal is flagged `frequency_relaxed`. The script's own reading of OQ-8 / R-63.
 */
function violations(summary, gap) {
  const relaxed = (m) =>
    summary.relaxed.some(
      (f) =>
        f.date === m.date &&
        f.slotKey === m.slotKey &&
        (f.memberId ?? "shared") === (m.kind === "individual" ? m.memberScope : "shared"),
    );
  const found = [];
  let pairs = 0;
  const meals = summary.meals;
  for (let i = 0; i < meals.length; i++)
    for (let j = i + 1; j < meals.length; j++) {
      const a = meals[i];
      const b = meals[j];
      if (a.dishId !== b.dishId || !a.members.some((x) => b.members.includes(x))) continue;
      pairs++;
      const diff = Math.abs(dayNumber(a.date) - dayNumber(b.date));
      if (diff < gap(a.slotKey, b.slotKey) && !relaxed(a) && !relaxed(b))
        found.push(
          `${a.dishId}: ${a.date} ${a.slotKey} / ${b.date} ${b.slotKey} (${String(diff)} days)`,
        );
    }
  return { found, pairs };
}

const pairGap = (a, b) => Math.max(gapOf(a), gapOf(b));

/** Boundary cases (04 §6.3 examples), checked through the compiled `frequencyReason`. */
function boundaries(m, lib) {
  const dish = lib.dishes.find((d) => d.id === "chicken-shawarma-wrap");
  const pool = new m.pool.Pool(lib.dishes, lib.adjusters);
  const MON = "2026-09-28";
  const plus = (n) =>
    new Date(Date.parse(`${MON}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const served = (date, slotKey) => ({
    date,
    day: dayNumber(date),
    mealKey: `${date}|${slotKey}|shared`,
    slotKey,
    dishId: dish.id,
    memberIds: ["c1"],
    cuisineKey: dish.cuisineKey,
    methodKeys: [],
    core: [],
    mainProtein: null,
    timeKey: "12",
  });
  const blocked = (slot, n, prev = slot, rules = []) =>
    m.filters.frequencyReason(dish, plus(n), slot, ["c1"], [served(MON, prev)], rules, pool) !==
    null;
  const rule = (minGapDays) => ({
    id: "r",
    householdId: "h",
    memberId: null,
    entityType: "dish",
    entityKey: dish.id,
    minGapDays,
    maxPerWeek: null,
    source: "explicit",
    locked: false,
  });
  return [
    ["dinner Mon → Sun blocked", blocked("dinner", 6) === true],
    ["dinner Mon → next Mon allowed", blocked("dinner", 7) === false],
    ["snack Mon → Thu blocked", blocked("snack", 3) === true],
    ["snack Mon → Fri allowed", blocked("snack", 4) === false],
    [
      "pre_workout Mon → Thu blocked, Fri allowed",
      blocked("pre_workout", 3) && !blocked("pre_workout", 4),
    ],
    [
      "post_workout Mon → Thu blocked, Fri allowed",
      blocked("post_workout", 3) && !blocked("post_workout", 4),
    ],
    [
      "breakfast then snack: larger gap (7)",
      blocked("snack", 6, "breakfast") && !blocked("snack", 7, "breakfast"),
    ],
    [
      "frequency_rule min_gap_days 3 (days apart) replaces the default",
      blocked("dinner", 2, "dinner", [rule(3)]) && !blocked("dinner", 3, "dinner", [rule(3)]),
    ],
  ];
}

async function gateG1() {
  const report = new Report("leaf-1.2.6 G1");
  const tmp = gateTemp("G1");
  const outs = [];
  try {
    vitest(
      report,
      "core frequency and filters",
      CORE,
      ["test/planner/select/frequency.test.ts", "test/planner/select/filters.test.ts"],
      tmp,
    );
    const out = compileCore(report, "G1");
    if (out === null) return report.finish();
    outs.push(out);
    const m = await loadCore(out);
    const lib = m.library.buildSeedLibrary(seedFiles());
    for (const [what, ok] of boundaries(m, lib))
      report.check(ok, `boundary (compiled planner): ${what}`);

    // F1 seeds 1-10: no pair of servings closer than the OQ-8 gap outside relaxed meals.
    const { runs, lines } = await planSeeds("g1", out);
    report.check(
      runs.every((r) => r.code === 0) && lines.length === SEEDS.length,
      `${String(lines.length)} F1 week plans (seeds 1–10, AI off) in ${String(runs.length)} worker processes`,
      runs
        .map((r) => r.stderr)
        .join("\n")
        .slice(-3000),
    );
    let pairs = 0;
    const all = [];
    const relaxedCount = lines.reduce((s, l) => s + l.summary.relaxed.length, 0);
    for (const l of lines) {
      const v = violations(l.summary, pairGap);
      pairs += v.pairs;
      all.push(...v.found.map((x) => `seed ${String(l.seed)}: ${x}`));
    }
    report.check(
      pairs > 0 && all.length === 0,
      `F1 seeds 1–10: ${String(pairs)} repeat pairs sharing an attendee, none closer than the OQ-8 gap outside ${String(relaxedCount)} frequency_relaxed meal(s)`,
      all.slice(0, 20).join("\n"),
    );
    const near = lines.flatMap((l) => {
      const out2 = [];
      const ms = l.summary.meals;
      for (let i = 0; i < ms.length; i++)
        for (let j = i + 1; j < ms.length; j++)
          if (ms[i].dishId === ms[j].dishId && ms[i].members.some((x) => ms[j].members.includes(x)))
            out2.push(Math.abs(dayNumber(ms[i].date) - dayNumber(ms[j].date)));
      return out2;
    });
    console.log(
      `info - day differences of repeat pairs: ${[...new Set(near)].sort((a, b) => a - b).join(", ")}; relaxed meals: ${
        lines
          .flatMap((l) =>
            l.summary.relaxed.map((f) => `seed ${String(l.seed)} ${f.date} ${f.slotKey}`),
          )
          .join("; ") || "none"
      }`,
    );

    // Negative control: the same checks on a copy of the compiled planner with the old rule (6 days
    // for every slot) fail: the dinner boundary, and the checker on its plans.
    const bad = compileCore(report, "G1-old");
    if (bad !== null) {
      outs.push(bad);
      const file = join(bad, "src/planner/select/filters.js");
      const src = readFileSync(file, "utf8");
      const patched = src.replace(
        /export function pairGap\(a, b\) \{[\s\S]*?\n\}/,
        `export function pairGap(a, b) {\n    return ${String(OLD_GAP)};\n}`,
      );
      report.check(
        patched !== src,
        "negative control: the copy's pairGap is replaced by the old 6-day rule",
      );
      writeFileSync(file, patched);
      const old = await loadCore(bad);
      const failing = boundaries(old, old.library.buildSeedLibrary(seedFiles())).filter(
        ([, ok]) => !ok,
      );
      report.check(
        failing.some(([what]) => what === "dinner Mon → Sun blocked"),
        `negative control: the old 6-day rule fails the dinner boundary (${failing.map(([w]) => w).join("; ")})`,
      );
      const oldPlans = await planSeeds("g1", bad);
      const oldViolations = oldPlans.lines.flatMap((l) => violations(l.summary, pairGap).found);
      report.check(
        oldPlans.lines.length === SEEDS.length && oldViolations.length > 0,
        `negative control: plans made under the old rule show ${String(oldViolations.length)} violation(s) of the OQ-8 gap`,
      );
    }
  } finally {
    for (const o of outs) rmSync(o, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G2: SC-2 as re-set, the planner leaves' gates, SC-1 reported
// ---------------------------------------------------------------------------------------------

async function gateG2() {
  const report = new Report("leaf-1.2.6 G2");
  // 1.2.3 G2's threshold and aggregation are this leaf's (R-62, R-63): read them from the script.
  const src = readFileSync(join(ROOT, "scripts/verify/leaf-1.2.3.mjs"), "utf8");
  const median = /const SC2_MEDIAN = ([\d.]+);/.exec(src)?.[1];
  const min = /const SC2_MIN = ([\d.]+);/.exec(src)?.[1];
  report.check(
    median === "0.08" && min === "0",
    `1.2.3 G2 asserts SC-2 as re-set: median >= ${String(median)} and every seed >= ${String(min)} (R-63)`,
  );
  const g2 = otherGate(report, "1.2.3", "G2");
  const sc2 = g2.find((l) => l.startsWith("ok   - SC-2:"));
  report.check(
    sc2 !== undefined,
    `SC-2 measured by 1.2.3 G2: ${sc2?.slice(7) ?? "(no SC-2 line)"}`,
  );
  const g1 = otherGate(report, "1.2.3", "G1");
  for (const l of g1.filter((x) => /SC-1|in tolerance/.test(x)).slice(0, 6))
    console.log(`info - 1.2.3 G1: ${l.trim()}`);
  for (const g of ["G3", "G4", "G5"]) otherGate(report, "1.2.3", g);
  for (const g of ["G1", "G2", "G3", "G4", "G5"]) otherGate(report, "1.2.2", g);
  for (const g of ["G1", "G2", "G3", "G4"]) otherGate(report, "1.2.5", g);
  otherGateControl(report, "1.2.3");
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G3: slot-scoped exclusions
// ---------------------------------------------------------------------------------------------

async function gateG3() {
  const report = new Report("leaf-1.2.6 G3");
  const tmp = gateTemp("G3");
  const outs = [];
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  try {
    // Migration 0007 is in the Drizzle journal and carries the column and both checks.
    const journal = readJson(join(DB, "src/migrations/meta/_journal.json"));
    const entry = journal.entries.find((e) => e.tag.startsWith("0007_"));
    const sqlFile =
      entry === undefined
        ? ""
        : readFileSync(join(DB, "src/migrations", `${entry.tag}.sql`), "utf8");
    report.check(
      entry !== undefined &&
        /ADD COLUMN "slot_keys" text\[\]/.test(sqlFile) &&
        /exclusion_allergy_unscoped" CHECK \("exclusion"\."reason" <> 'allergy' OR "exclusion"\."slot_keys" IS NULL\)/.test(
          sqlFile,
        ) &&
        /UNIQUE NULLS NOT DISTINCT\("household_id","member_id","kind","key","slot_keys"\)/.test(
          sqlFile,
        ),
      `migration ${entry?.tag ?? "0007 (missing)"} is journalled: slot_keys text[], allergy unscoped check, unique key with the scope`,
    );
    vitest(
      report,
      "core exclusion scope",
      CORE,
      ["test/planner/select/exclusion-scope.test.ts"],
      tmp,
    );
    vitest(
      report,
      "db exclusion scope (integration)",
      DB,
      ["test/exclusion-scope.int.test.ts"],
      tmp,
      {
        DATABASE_URL: databaseUrl,
      },
    );

    const out = compileCore(report, "G3");
    if (out === null) return report.finish();
    outs.push(out);
    const m = await loadCore(out);
    const lib = m.library.buildSeedLibrary(seedFiles());
    const pool = new m.pool.Pool(lib.dishes, lib.adjusters);
    const nutIds = new Set(
      seedFiles()
        .ingredients.ingredients.filter((i) => i.dietary_flags.includes("contains_nuts"))
        .map((i) => `ing:${i.slug}`),
    );
    // A nut dish (almonds required) fit for the lunch box and dinner, as in the core test.
    const seed = lib.dishes.find((d) => d.id === "dates-laban-almonds");
    const nutDish = {
      ...seed,
      slotKeys: [...seed.slotKeys, "dinner"],
      components: seed.components.map((c) =>
        c.variants.some((v) => (pool.variant(v.id)?.core ?? []).some((i) => nutIds.has(i)))
          ? { ...c, required: true }
          : c,
      ),
    };
    const scoped = {
      id: "nuts-c3",
      householdId: "h",
      memberId: "c3",
      kind: "dietary_flag",
      key: "contains_nuts",
      reason: "other",
      hard: true,
      slotKeys: [SCHOOL],
    };
    const decide = (mod, rows) => {
      const cfg = mod.f1.f1PlanConfig();
      cfg.exclusions = [...cfg.exclusions, ...rows];
      const hh = new mod.members.Household(cfg, new mod.pool.Pool(lib.dishes, lib.adjusters));
      const slot = (k) => cfg.slotTypes.find((s) => s.key === k);
      const ok = (k) => mod.filters.passesExclusions(nutDish, [hh.ctx("c3", slot(k), nutDish, [])]);
      return { school: ok(SCHOOL), dinner: ok("dinner") };
    };
    const scopedResult = decide(m, [scoped]);
    report.check(
      scopedResult.school === false && scopedResult.dinner === true,
      `planner: a nut dish is refused in C3's packed school lunch (${String(!scopedResult.school)}) and allowed at C3's dinner (${String(scopedResult.dinner)})`,
    );
    const everywhere = decide(m, [{ ...scoped, slotKeys: null }]);
    report.check(
      everywhere.school === false && everywhere.dinner === false,
      "planner: the same exclusion without a scope refuses it in both slots",
    );

    // Op validation: a scoped allergy is rejected; the same payload with another reason passes.
    const parse = (reason) =>
      m.changes.ChangeOpSchema.safeParse({
        kind: "exclusion.add",
        payload: {
          memberId: null,
          kind: "dietary_flag",
          key: "contains_nuts",
          reason,
          slotKeys: [SCHOOL],
        },
      });
    report.check(
      parse("allergy").success === false,
      "op validation: exclusion.add with reason allergy and slotKeys is rejected",
    );
    const other = parse("other");
    report.check(
      other.success && JSON.stringify(other.data.payload.slotKeys) === JSON.stringify([SCHOOL]),
      "control: the same scoped payload with reason other is accepted and keeps its scope",
    );

    // Negative control: a copy of the planner whose member context ignores the scope refuses the
    // dish at dinner too, so the dinner assertion fails.
    const bad = compileCore(report, "G3-unscoped");
    if (bad !== null) {
      outs.push(bad);
      const file = join(bad, "src/planner/select/members.js");
      const src = readFileSync(file, "utf8");
      const patched = src.replace(
        /\(e\.slotKeys == null \|\| e\.slotKeys\.includes\(slotKey\)\)/,
        "true",
      );
      report.check(
        patched !== src,
        "negative control: the copy's member context ignores slot_keys",
      );
      writeFileSync(file, patched);
      const ignoring = decide(await loadCore(bad), [scoped]);
      report.check(
        ignoring.dinner === false,
        "negative control: without the scope the nut dish is refused at dinner too (the dinner assertion fails)",
      );
    }

    // 1.1.2's gates (schema, migrations, change sets) on the migrated schema.
    for (const g of ["G1", "G2", "G3", "G4", "G5", "G6"]) otherGate(report, "1.1.2", g);
  } finally {
    for (const o of outs) rmSync(o, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------
// G4: nut-free school follow-up
// ---------------------------------------------------------------------------------------------

async function gateG4() {
  const report = new Report("leaf-1.2.6 G4");
  const tmp = gateTemp("G4");
  const outs = [];
  try {
    vitest(report, "core follow-ups", CORE, ["test/onboarding/followups/engine.test.ts"], tmp);
    const out = compileCore(report, "G4");
    if (out === null) return report.finish();
    outs.push(out);
    const m = await loadCore(out);
    const cfg = m.f1.f1PlanConfig();
    const kids = m.followups.schoolChildren(cfg).map((k) => k.id);
    const open = (c) => m.followups.proposeFollowups(c).find((f) => f.key === "school_nut_free");
    const card = open(cfg);
    report.check(
      kids.length === 3 && card?.question === NUT_COPY,
      `F1: the card reads "${card?.question ?? "(none)"}" for ${String(kids.length)} school children`,
    );
    const { ops } = m.followups.followupOps(card, "yes", cfg);
    report.check(
      ops.length === 3 &&
        ops.every(
          (o, i) =>
            o.kind === "exclusion.add" &&
            o.payload.memberId === kids[i] &&
            o.payload.kind === "dietary_flag" &&
            o.payload.key === "contains_nuts" &&
            JSON.stringify(o.payload.slotKeys) === JSON.stringify([SCHOOL]) &&
            // F1's test member ids are not uuids; the payload is checked with one in their place.
            m.changes.ChangeOpSchema.safeParse({
              ...o,
              payload: { ...o.payload, memberId: "00000000-0000-4000-8000-000000000001" },
            }).success,
        ),
      "yes: one contains_nuts exclusion per school child, scoped to packed_school_lunch, each a valid op",
    );
    const rowsOf = (list) =>
      list.map((o, i) => ({
        id: `x${String(i)}`,
        householdId: "h",
        reason: "other",
        hard: true,
        ...o.payload,
      }));
    report.check(
      open({ ...cfg, exclusions: [...cfg.exclusions, ...rowsOf(ops)] }) === undefined,
      "settled once every school child has the scoped exclusion",
    );
    // Negative controls: two of three children covered, or a scope that is not the lunch box.
    report.check(
      open({ ...cfg, exclusions: [...cfg.exclusions, ...rowsOf(ops.slice(0, 2))] }) !== undefined,
      "negative control: with one child still open the question stays",
    );
    const snackOnly = ops.map((o) => ({ ...o, payload: { ...o.payload, slotKeys: ["snack"] } }));
    report.check(
      open({ ...cfg, exclusions: [...cfg.exclusions, ...rowsOf(snackOnly)] }) !== undefined,
      "negative control: nut exclusions scoped to the snack do not settle the lunch-box question",
    );
    for (const g of ["G1", "G2", "G3", "G4"]) otherGate(report, "1.4.7", g);
  } finally {
    for (const o of outs) rmSync(o, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4 };

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--worker") return worker(args.slice(1));
  const gate = args[args.indexOf("--gate") + 1];
  const fn = args.includes("--gate") ? GATES[gate] : undefined;
  if (fn === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.2.6.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    return 2;
  }
  return await fn();
}

process.exitCode = await main();
