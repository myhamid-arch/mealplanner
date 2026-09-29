// Verify script for leaf 1.3.7 (contract gaps in learning and recipes; R-82, R-83, W-23).
// Usage: node scripts/verify/leaf-1.3.7.mjs --gate G1|G2|G3|G4
// Prints "VERIFY leaf-1.3.7 <gate> PASSED" only when every assertion, including the gate's
// negative controls, holds; exits non-zero otherwise.
//
// - G1 FBK-3 practical tags (W-23, R-83): the leaf's Vitest files for the rule and the `dish`
//   exclusion kind, with their named tests and negative controls; then this script re-checks the
//   outcome itself on the built modules: fixtures defined here go through `runRules` and the FBK-8
//   guardrails, and F1's planned weeks (seeds 1–3) run with the proposed exclusion. Each judgement
//   is also run on a known-bad input (one review; a week without the exclusion) and must fail.
// - G2 DM-4: packages/db nutrition-recompute.int.test.ts (the worker's queueing and job by path;
//   the stale row is the negative control).
// - G3 REC-6: apps/web recipe-draft.int.test.ts (the real worker against a recorded Messages API
//   server; the schema-failing response is the negative control).
// - G4 no regression: leaf-1.3.3 G1 and G2, and at the architect's CP1 request (R-83) leaf-1.1.2 G1
//   and leaf-1.2.6 G3, as child processes that must print their PASSED markers; then apps/web
//   `test:integration`, every test passed and none skipped. The suite judgement is also run on the
//   measured result with one test turned failed, and on it with one test turned skipped; both
//   must fail.
//
// Isolation (gates run concurrently): each gate uses its own databases (unique names, created by
// the tests), its own ports (the tests listen on port 0) and its own temp files. The shared outputs
// are the workspace packages' and the worker's dist/, built only when stale under the same
// `packages-build` lock every verify script uses (lib/node.mjs); the heavy web suite of G4 runs in
// the machine-wide `suite` slot. No model credential reaches any child process: G3's worker gets
// only the recorded server's URL and a placeholder token.
//
// Database: DATABASE_URL when set; otherwise postgres://postgres:postgres@localhost:5432/postgres
// when it answers; otherwise a throwaway PostgreSQL 16 cluster (lib/node.mjs acquireServer).
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Report,
  ROOT,
  SUITE_SLOTS,
  WEB,
  acquireServer,
  buildPackages,
  judgeTests,
  requireTitles,
  runAsync,
  vitestRun,
  withSlot,
} from "./lib/node.mjs";

const LABEL = "leaf-1.3.7";
const CORE = join(ROOT, "packages/core");
const DB = join(ROOT, "packages/db");

// ---------------------------------------------------------------------------------------------
// The spec's terms, written out here (FBK-3 06 §2, R-82, R-83, leaf-1.3.7 SPEC-Q-4, SPEC-Q-5).
// ---------------------------------------------------------------------------------------------

const SPEC = {
  packingTags: ["hard_to_pack", "went_soggy_in_box", "cold_is_bad"],
  slowTag: "took_too_long",
  minReviews: 2,
  /** DM-5, AGT-5, 1.3.3 SPEC-Q-7: the reasons whose exclusions are protected. */
  protectedReasons: ["allergy"],
  protectedWhenHard: ["medical", "religious"],
  seeds: [1, 2, 3],
};

// ---------------------------------------------------------------------------------------------
// Test titles each gate requires (exact, each run once and passed)
// ---------------------------------------------------------------------------------------------

const G1_TITLES = [
  "G1 two reviews from packed meals give one proposal scoped to every packed slot",
  "G1 plate and plan_meal targets carry the meal too, and the two packed slots count together",
  "G1 counts a component review of the dish at a packed meal",
  "does not count the same review twice",
  "ignores packing tags on meals in slots that are not packed",
  "ignores reviews without a meal (they cannot show the dish came out of a box)",
  "ignores reviews outside the 30-day window",
  "counts per dish: one review each on two dishes gives nothing",
  "ignores a review whose target dish is not the dish its meal served",
  "proposes nothing when the household has no active packed slot, and scopes to active ones",
  "G1 two reviews give one note and no proposal, whatever the slot",
  "gives nothing for a single review, and packing tags never make a time note",
  "G1 passes validation as one pending proposal (the op is not protected)",
  "G1 is deduplicated by fingerprint: pending, or rejected in the last 30 days",
  "is satisfied by an exclusion whose scope covers both packed slots, not by a narrower one",
  "keep the dish out of every packed slot and still offer it in the others",
  "a household row covers every attendee in its slots only",
  "a member row covers that member only",
  "an unscoped row applies in every slot, and only to that dish",
  "other kinds with the same key do not exclude the dish",
  "parses a dish id key and stores the scope sorted",
  "refuses a key that is not a dish id",
  "writes the row for a household dish and for a seed dish",
  "refuses a dish the household cannot see",
];
const G1_NEGATIVE = [
  "G1 negative control: one such review gives no proposal",
  "negative control: without the exclusion the same assertion fails",
];
const G2_TITLES = [
  "G2 the change set queues nutrition.recompute (with kg.sync and plates.resolve)",
  "G2 the changed variant's row equals the engine's new per-100 g values, with a later computed_at",
  "G2 every other variant's row is unchanged, computed_at included",
  "G2 the change set is a recipe change: it touched the variant's ingredient lines",
];
const G2_NEGATIVE = ["G2 negative control: the stale row fails the same comparison"];
const G3_TITLES = [
  "G3 the job succeeds on the recorded response, which answered the one generation request",
  "G3 the draft is not saved: no dish or ingredient row is written by the job",
  "G3 the recipe card carries the draft with example plates for the requested day and slot",
  "G3 Save applies the card's ops through POST /change-sets and the dish is active",
];
const G3_NEGATIVE = ["G3 fails the job with no recipe card and saves nothing"];

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Every title in the run is one the gate requires (nothing extra or renamed goes unnoticed). */
function onlyKnown(report, tests, titles) {
  const known = new Set(titles);
  const extra = tests.filter((t) => !known.has(t.title)).map((t) => t.title);
  report.check(extra.length === 0, "no test outside the required list", extra.join("\n"));
}

async function gateTests(report, label, cwd, files, titles, negative, env = {}) {
  const r = await vitestRun(cwd, files, env);
  judgeTests(report, label, r);
  requireTitles(report, r.tests, [...titles, ...negative]);
  onlyKnown(report, r.tests, [...titles, ...negative]);
  return r;
}

const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

/** A module of packages/core's build (src or test support). */
const core = (path) => import(pathToFileURL(join(CORE, "dist", path)).href);

// ---------------------------------------------------------------------------------------------
// G1
// ---------------------------------------------------------------------------------------------

/**
 * The FBK-3 packing judgement: exactly one kept practical_packing proposal for `dishId`, with one
 * registry-valid, unprotected `exclusion.add` of kind `dish` for the household, scoped to exactly
 * the household's active packed slot keys. Returns the reasons it fails (empty = holds).
 */
function packingProblems(result, dishId, packedKeys, registry) {
  const out = [];
  const kept = result.kept.filter((d) => d.rule === "practical_packing");
  if (kept.length !== 1) return [`${String(kept.length)} practical_packing proposals kept, not 1`];
  const [draft] = kept;
  if (draft.ops.length !== 1) out.push(`${String(draft.ops.length)} ops, not 1`);
  const op = draft.ops[0];
  const p = op?.payload ?? {};
  if (op?.kind !== "exclusion.add") out.push(`op ${String(op?.kind)}, not exclusion.add`);
  if (p.kind !== "dish") out.push(`exclusion kind ${String(p.kind)}, not dish`);
  if (p.key !== dishId) out.push(`key ${String(p.key)}, not the dish`);
  if (p.memberId !== null) out.push(`member ${String(p.memberId)}, not the household`);
  if (JSON.stringify(p.slotKeys) !== JSON.stringify(packedKeys))
    out.push(`scope ${JSON.stringify(p.slotKeys)}, not ${JSON.stringify(packedKeys)}`);
  const protectedRow =
    SPEC.protectedReasons.includes(p.reason) ||
    (p.hard === true && SPEC.protectedWhenHard.includes(p.reason));
  if (protectedRow) out.push(`reason ${String(p.reason)} / hard ${String(p.hard)} is protected`);
  if (!registry.ChangeOpSchema.safeParse(op).success) out.push("the op fails ChangeOpSchema");
  if (registry.getOp("exclusion.add")?.protected === true) out.push("exclusion.add is protected");
  if (draft.evidence.count < SPEC.minReviews)
    out.push(`evidence ${String(draft.evidence.count)} < ${String(SPEC.minReviews)}`);
  return out;
}

/** took_too_long: one note on the dish, and no proposal touches the dish. */
function slowProblems(output, dishId) {
  const out = [];
  const notes = output.notes.filter((n) => n.subject?.dishId === dishId);
  if (notes.length !== 1) out.push(`${String(notes.length)} notes on the dish, not 1`);
  const ops = output.candidates.filter((d) => JSON.stringify(d.ops).includes(dishId));
  if (ops.length !== 0) out.push(`${String(ops.length)} proposals touch the dish`);
  return out;
}

async function ruleCheck(report) {
  const rules = await core("src/learning/rules/index.js");
  const registry = await core("src/changes/index.js");
  const H = await core("test/learning/rules/helpers.js");
  const cfg = H.config();
  const packedKeys = cfg.slotTypes
    .filter((s) => s.active && s.isPacked)
    .map((s) => s.key)
    .sort();
  report.check(
    packedKeys.length >= 2,
    `F1 has packed slots to scope to (${packedKeys.join(", ")})`,
  );
  const packedSlot = cfg.slotTypes.find((s) => s.isPacked && s.active);
  const dish = H.dish("Tuna pasta salad", [
    { name: "Pasta", role: "carb", variants: [{ label: "Cold" }] },
  ]);
  const slow = H.dish("Slow lamb", [{ name: "Lamb", variants: [{ label: "Braised" }] }]);
  const meal = H.meal(H.daysBefore(2), dish.id, {
    slotTypeId: packedSlot.id,
    plates: [H.plate(H.M.c1), H.plate(H.M.c2)],
  });
  const packing = (memberId, tag) =>
    H.review(memberId, "dish", dish.id, { tags: [tag], planMealId: meal.id });
  const slowReview = (memberId) => H.review(memberId, "dish", slow.id, { tags: [SPEC.slowTag] });
  const select = (output) =>
    rules.selectProposals({
      drafts: output.candidates,
      existing: [],
      state: { config: cfg, verifiedIngredientIds: new Set() },
      now: H.NOW,
    });
  const run = (reviews) =>
    rules.runRules(H.input({ config: cfg, reviews, dishes: [dish, slow], meals: [meal] }));

  const two = run([packing(H.M.c1, SPEC.packingTags[0]), packing(H.M.c2, SPEC.packingTags[1])]);
  const twoProblems = packingProblems(await select(two), dish.id, packedKeys, registry);
  report.check(
    twoProblems.length === 0,
    `2 packing reviews (${SPEC.packingTags.slice(0, 2).join(", ")}) on a packed meal: one pending, unprotected dish exclusion scoped to ${packedKeys.join(", ")}`,
    twoProblems.join("\n"),
  );
  const one = run([packing(H.M.c1, SPEC.packingTags[2])]);
  const oneProblems = packingProblems(await select(one), dish.id, packedKeys, registry);
  report.check(
    oneProblems.length > 0,
    "negative control: the same judgement fails on one packing review",
    "the judgement passed on a single review",
  );

  const slowTwo = run([slowReview(H.M.a), slowReview(H.M.b)]);
  const slowTwoProblems = slowProblems(slowTwo, slow.id);
  report.check(
    slowTwoProblems.length === 0,
    `2 ${SPEC.slowTag} reviews: one digest note on the dish and no op`,
    slowTwoProblems.join("\n"),
  );
  report.check(
    slowProblems(run([slowReview(H.M.a)]), slow.id).length > 0,
    `negative control: the same judgement fails on one ${SPEC.slowTag} review`,
  );
}

/**
 * The planner judgement over F1's week: with `cfg`, no planned week (each seed) serves `dishId` in
 * a packed slot, and the dish stays eligible at every non-packed meal where it was eligible without
 * the exclusion (and at one at least). Returns the problems (empty = holds).
 */
async function plannerProblems(cfg, dishId, mod) {
  const packed = new Set(cfg.slotTypes.filter((s) => s.isPacked).map((s) => s.key));
  const out = [];
  for (const seed of SPEC.seeds) {
    const plan = await mod.plan(cfg, seed);
    for (const day of plan.days)
      for (const m of day.meals)
        if (m.dishId === dishId && packed.has(m.slotKey))
          out.push(`seed ${String(seed)}: served at ${m.date} ${m.slotKey}`);
  }
  const { lib } = mod;
  const base = new mod.Run(mod.f1.f1PlanConfig(), lib.dishes, lib.adjusters, 1);
  const run = new mod.Run(cfg, lib.dishes, lib.adjusters, 1);
  let offered = 0;
  for (const date of mod.f1.F1_WEEK)
    for (const spec of mod.mealsOfDate(cfg, date)) {
      if (packed.has(spec.slot.key)) continue;
      const before = base.eligiblePool(spec).some((d) => d.id === dishId);
      const after = run.eligiblePool(spec).some((d) => d.id === dishId);
      if (after) offered += 1;
      if (before && !after) out.push(`${date} ${spec.slot.key}: no longer offered`);
    }
  if (offered === 0) out.push("offered at no non-packed meal of the week");
  return { problems: out, offered };
}

async function plannerCheck(report) {
  // The seed library from the data files, read here (the Vitest suites import them through Vite's
  // import.meta.glob, which plain Node does not have), built by core's test library builder.
  const files = {
    ingredients: readJson("data/ingredients.v1.json"),
    methodYields: readJson("data/method-yields.v1.json"),
    dishes: readdirSync(join(ROOT, "data/seed-dishes"))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => readJson(`data/seed-dishes/${f}`)),
    adjusters: readJson("data/adjusters.json"),
  };
  const lib = (await core("test/planner/select/library.js")).buildSeedLibrary(files);
  const { planDays } = await core("src/planner/index.js");
  const f1 = await core("test/planner/select/f1.js");
  const mod = {
    lib,
    f1,
    plan: (config, seed) =>
      planDays(
        { config, dates: f1.F1_WEEK, dishes: lib.dishes, adjusters: lib.adjusters },
        { seed },
      ),
    Run: (await core("src/planner/select/run.js")).Run,
    mealsOfDate: (await core("src/planner/select/meals.js")).mealsOfDate,
  };
  const baseCfg = mod.f1.f1PlanConfig();
  const packedKeys = baseCfg.slotTypes
    .filter((s) => s.active && s.isPacked)
    .map((s) => s.key)
    .sort();
  // The dish F1's seed-1 week serves most in packed slots (measured, not named here).
  report.check(
    lib.dishes.length > 0,
    `seed library built from data/ (${String(lib.dishes.length)} dishes)`,
  );
  const plan = await mod.plan(baseCfg, 1);
  const counts = new Map();
  for (const day of plan.days)
    for (const m of day.meals)
      if (packedKeys.includes(m.slotKey)) counts.set(m.dishId, (counts.get(m.dishId) ?? 0) + 1);
  const [dishId, served] =
    [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
  if (
    !report.check(
      dishId !== undefined,
      `F1's week serves a dish in packed slots (${String(served)}× ${String(dishId)})`,
    )
  )
    return;
  const withExclusion = mod.f1.f1PlanConfig();
  withExclusion.exclusions = [
    ...withExclusion.exclusions,
    {
      id: "leaf-1.3.7-g1",
      householdId: "household-test",
      memberId: null,
      kind: "dish",
      key: dishId,
      reason: "other",
      hard: false,
      slotKeys: packedKeys,
    },
  ];
  const excluded = await plannerProblems(withExclusion, dishId, mod);
  report.check(
    excluded.problems.length === 0,
    `with the accepted exclusion, F1's weeks (seeds ${SPEC.seeds.join(", ")}) keep the dish out of ${packedKeys.join(", ")} and still offer it at ${String(excluded.offered)} other meals`,
    excluded.problems.join("\n"),
  );
  const baseline = await plannerProblems(mod.f1.f1PlanConfig(), dishId, mod);
  report.check(
    baseline.problems.some((p) => /served at/.test(p)),
    "negative control: without the exclusion the same judgement fails (the dish is served in a packed slot)",
    baseline.problems.join("\n") || "the judgement passed without the exclusion",
  );
}

async function gateG1(report) {
  if (!(await buildPackages(report))) return;
  await gateTests(
    report,
    "packages/core practical.test.ts + dish-exclusion.test.ts",
    CORE,
    ["test/learning/rules/practical.test.ts", "test/planner/select/dish-exclusion.test.ts"],
    G1_TITLES,
    G1_NEGATIVE,
  );
  await ruleCheck(report);
  await plannerCheck(report);
}

// ---------------------------------------------------------------------------------------------
// G2, G3
// ---------------------------------------------------------------------------------------------

async function withServer(report, label, fn) {
  const server = await acquireServer(report, label);
  try {
    return await fn(server);
  } finally {
    server.stop();
  }
}

async function gateG2(report) {
  if (!(await buildPackages(report))) return;
  await withServer(report, "leaf-1.3.7-g2", (server) =>
    gateTests(
      report,
      "packages/db nutrition-recompute.int.test.ts",
      DB,
      ["test/nutrition-recompute.int.test.ts"],
      G2_TITLES,
      G2_NEGATIVE,
      { DATABASE_URL: server.url },
    ),
  );
}

async function gateG3(report) {
  if (!(await buildPackages(report))) return;
  await withServer(report, "leaf-1.3.7-g3", (server) =>
    gateTests(
      report,
      "apps/web recipe-draft.int.test.ts (real worker, recorded responses)",
      WEB,
      ["test/api/recipe-draft.int.test.ts"],
      G3_TITLES,
      G3_NEGATIVE,
      { DATABASE_URL: server.url },
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// G4
// ---------------------------------------------------------------------------------------------

const REGRESSIONS = [
  ["leaf-1.3.3", "G1"],
  ["leaf-1.3.3", "G2"],
  ["leaf-1.1.2", "G1"],
  ["leaf-1.2.6", "G3"],
];

/** Other leaves' gates as child processes, two at a time; each must print its PASSED marker. */
async function regressions(report, list, jobs = 2) {
  const queue = [...list];
  const results = new Map();
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const [leaf, gate] = next;
        const started = Date.now();
        const r = await runAsync(
          process.execPath,
          [join(ROOT, `scripts/verify/${leaf}.mjs`), "--gate", gate],
          { cwd: ROOT, env: { NODE_OPTIONS: "" }, timeoutMs: 3_000_000 },
        );
        results.set(`${leaf} ${gate}`, {
          ...r,
          seconds: Math.round((Date.now() - started) / 1000),
        });
      }
    }),
  );
  for (const [leaf, gate] of list) {
    const key = `${leaf} ${gate}`;
    const r = results.get(key);
    const ok = r !== undefined && r.code === 0 && r.stdout.includes(`VERIFY ${key} PASSED`);
    if (!ok && r !== undefined)
      console.log(
        `----- ${key}: full output (exit ${String(r.code)}) -----\n${r.stdout}\n${r.stderr}\n----- end of ${key} -----`,
      );
    report.check(ok, `regression: ${key} passes (${String(r?.seconds ?? "?")} s)`);
  }
}

/** The suite judgement: a report exists, the script exited 0, tests ran, all passed, none skipped. */
function suiteProblems(r) {
  const out = [];
  if (!r.reported) out.push("no JSON report");
  if (r.code !== 0) out.push(`exit ${String(r.code)}`);
  if (r.tests.length === 0) out.push("no tests ran");
  for (const t of r.tests)
    if (t.status !== "passed") out.push(`[${t.status}] ${t.file} › ${t.fullName}`);
  for (const f of r.files)
    if (f.status === "failed") out.push(`[file failed] ${f.file}: ${f.message.slice(0, 500)}`);
  return out;
}

async function webIntegration(server) {
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.3.7-g4-"));
  const file = join(dir, "report.json");
  try {
    const r = await runAsync(
      "pnpm",
      [
        "run",
        "test:integration",
        "--reporter=json",
        `--outputFile.json=${file}`,
        "--reporter=default",
      ],
      { cwd: WEB, env: { DATABASE_URL: server.url }, timeoutMs: 3_000_000 },
    );
    const json = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    return {
      code: r.code,
      reported: json !== null,
      output: `${r.stdout}\n${r.stderr}`,
      tests: (json?.testResults ?? []).flatMap((f) =>
        (f.assertionResults ?? []).map((a) => ({
          file: relative(ROOT, f.name ?? ""),
          title: a.title,
          fullName: a.fullName ?? a.title,
          status: a.status,
        })),
      ),
      files: (json?.testResults ?? []).map((f) => ({
        file: relative(ROOT, f.name ?? ""),
        status: f.status,
        message: f.message ?? "",
      })),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function gateG4(report) {
  if (!(await buildPackages(report))) return;
  await regressions(report, REGRESSIONS);
  const r = await withServer(report, "leaf-1.3.7-g4", (server) =>
    withSlot("suite", SUITE_SLOTS, () => webIntegration(server)),
  );
  const problems = suiteProblems(r);
  const files = new Set(r.tests.map((t) => t.file)).size;
  report.check(
    problems.length === 0,
    `apps/web test:integration: ${String(r.tests.length)} tests in ${String(files)} files, all passed, none skipped`,
    [...problems, r.output.split("\n").slice(-60).join("\n")].join("\n").slice(0, 20_000),
  );
  for (const file of [
    "test/api/g1-contract-matrix.int.test.ts",
    "test/api/g3-openapi.int.test.ts",
    "test/api/recipe-draft.int.test.ts",
  ])
    report.check(
      r.tests.some((t) => t.file === `apps/web/${file}`),
      `the suite ran apps/web/${file}`,
    );
  // Negative controls: the same judgement on the measured result with one test failed, and with
  // one test skipped.
  const first = r.tests[0];
  if (first !== undefined) {
    const failed = { ...r, tests: [{ ...first, status: "failed" }, ...r.tests.slice(1)] };
    const skipped = { ...r, tests: [{ ...first, status: "skipped" }, ...r.tests.slice(1)] };
    report.check(
      suiteProblems(failed).length > 0,
      "negative control: the judgement fails with one test failed",
    );
    report.check(
      suiteProblems(skipped).length > 0,
      "negative control: the judgement fails with one test skipped",
    );
  }
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4 };

async function main() {
  const i = process.argv.indexOf("--gate");
  const gate = i === -1 ? undefined : process.argv[i + 1];
  if (gate === undefined || GATES[gate] === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.3.7.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    return 2;
  }
  // The full output also goes to a log file (gate-check keeps a bounded transcript).
  const logFile = join(tmpdir(), `${LABEL}-${gate.toLowerCase()}-${String(process.pid)}-last.log`);
  writeFileSync(logFile, "");
  const print = console.log.bind(console);
  console.log = (...args) => {
    print(...args);
    try {
      appendFileSync(logFile, `${args.map(String).join(" ")}\n`);
    } catch {
      // The log is a convenience; the verdict does not depend on it.
    }
  };
  console.log(`full output: ${logFile}`);
  const report = new Report(`${LABEL} ${gate}`);
  const started = Date.now();
  await GATES[gate](report);
  console.log(
    `time - ${String(Math.round((Date.now() - started) / 1000))} s  gate ${gate} in total`,
  );
  if (report.failures.length > 0) console.log(`failing: ${report.failures.join(" | ")}`);
  return report.finish();
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    console.log(`VERIFY ${LABEL} FAILED (error)`);
    process.exit(1);
  },
);
