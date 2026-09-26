// Verify script for leaf 1.3.2 (Reviews and preference learning).
// Usage: node scripts/verify/leaf-1.3.2.mjs --gate G1|G2|G3
// Prints "VERIFY leaf-1.3.2 <gate> PASSED" only when every assertion holds, including the gate's
// negative controls; exits non-zero otherwise.
//
// Each gate runs its unit tests (packages/core) and PostgreSQL tests (packages/db), requires the
// named tests (and their negative controls) to be present and passing, and then re-checks the
// outcome itself against the built packages: G1 reads the SC-3 figures the database test measured,
// G2 compares the built propagation with the FBK-4 table written out below, G3 drives the built
// portion-bias function 20 times. Every such check is also run on a known-bad input that must fail.
//
// Database: DATABASE_URL when set; otherwise postgres://postgres@localhost:5432/postgres when it
// answers; otherwise a throwaway PostgreSQL 16 cluster started from the local binaries and stopped
// on exit. Whichever is used must report server_version 16.x.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DB_DIR = join(ROOT, "packages/db");
const CORE_DIR = join(ROOT, "packages/core");
const DEFAULT_URL = "postgres://postgres@localhost:5432/postgres";

const GATES = {
  G1: {
    title:
      "SC-3: two 1★ reviews lower the member's dish score by ≥ 0.3 and plate appeal by > 0; other members unchanged (R-26)",
    runs: [
      { dir: CORE_DIR, files: ["test/learning/prefs/sc3.test.ts"] },
      { dir: DB_DIR, files: ["test/reviews/sc3.int.test.ts"] },
    ],
    required: [
      "G1 two 1★ reviews lower the member's dish score by ≥ 0.3 and plate appeal by > 0; others unchanged",
      "G1 the appeal drop matches the hand-computed FBK-4 value (SPEC-Q-1)",
      "G1 on F1 (liked cuisines): two 1★ reviews lower adult A's dish score by ≥ 0.3 and appeal by > 0; others unchanged",
      "G1 on a household with no preferences: the same holds",
    ],
    negative: [
      "G1 negative control: a learner that writes to the wrong member, or writes nothing, fails SC-3",
      "G1 negative control: reviews learned for another member, or by a login with no member, fail SC-3",
    ],
  },
  G2: {
    title: "propagation weights follow FBK-4; locked preferences never change",
    runs: [
      {
        dir: CORE_DIR,
        files: [
          "test/learning/prefs/signal.test.ts",
          "test/learning/prefs/propagate.test.ts",
          "test/learning/prefs/accumulate.test.ts",
          "test/learning/prefs/appeal.test.ts",
        ],
      },
      {
        dir: DB_DIR,
        files: ["test/reviews/learning.int.test.ts", "test/reviews/reviews.int.test.ts"],
      },
    ],
    required: [
      "G2 every row of the FBK-4 propagation table matches the hand-computed weights",
      "G2 incremental updates equal the closed form Σ(w·s) / (Σw + 2) over many reviews",
      "G2 locked preferences are never changed by learning",
      "G2 dish reviews store the FBK-4 weights: dish 1.0, cuisine 0.3, each method 0.3, each core ingredient 0.15/√n",
      "G2 variant, component, ingredient, cuisine and method reviews store their FBK-4 weights",
      "G2 learning is applied as learning change sets by the system actor, and undo restores the prior state",
      "a = 0.35·dish + 0.20·mean(variants) + 0.15·cuisine + 0.10·mean(methods) + 0.15·ingredientTerm + 0.05·kg",
      "an edit moves the learned state from the old signal to the new one (SPEC-Q-11)",
    ],
    negative: [
      "G2 negative control: a propagation with a mutated weight table is detected",
      "G2 negative control: a learner that ignores locks changes the locked row or fails",
      "G2 negative control: without the lock the same reviews change the row, and a direct learned write to a locked row is refused",
    ],
  },
  G3: {
    title: "untargeted portion bias follows FBK-5 within bounds; targeted grams unaffected",
    runs: [
      { dir: CORE_DIR, files: ["test/learning/prefs/portions.test.ts"] },
      { dir: DB_DIR, files: ["test/reviews/portions.int.test.ts"] },
    ],
    required: [
      "G3 too_much multiplies by 0.9; too_little and still_hungry by 1.1; starting at 1.0",
      "G3 the bias stays within [0.6, 1.6] after 20 repeated signals",
      "G3 targeted members' quantity feedback writes no portion bias (their grams are fixed by targets)",
      "G3 too_much on a component multiplies that role's bias by 0.9; too_little by 1.1",
      "G3 a whole-meal or whole-day quantity tag adjusts every role on the member's plate, once each",
      "G3 20 repeated signals stay within [0.6, 1.6]",
      "G3 targeted members' quantity feedback changes no bias, target or solver input",
      "G3 learning's portion change set undoes back to the prior bias",
    ],
    negative: [
      "G3 negative control: an unclamped learner leaves the bounds and is detected",
      "G3 negative control: a bias for a targeted member, or outside the bounds, is refused",
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16
// ---------------------------------------------------------------------------------------------

async function query(url, text) {
  const pg = (await import(pathToFileURL(join(DB_DIR, "node_modules/pg/lib/index.js")).href))
    .default;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    return (await client.query(text)).rows;
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
  const candidates = [
    fromConfig.code === 0 ? fromConfig.stdout.trim() : "",
    "/usr/lib/postgresql/16/bin",
  ];
  return candidates.find(
    (dir) => dir !== "" && existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl")),
  );
}

/** Starts a throwaway cluster; returns { url, stop }. Runs as the `postgres` user when root. */
async function startCluster() {
  const bin = pgBinDir();
  if (bin === undefined)
    throw new Error(
      "no DATABASE_URL, nothing on localhost:5432, and no PostgreSQL 16 binaries (initdb) found",
    );
  const asRoot = process.getuid?.() === 0;
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.3.2-pg-"));
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
      `-p ${String(port)} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`,
      "start",
    ]),
    { cwd: tmpdir() },
  );
  if (start.code !== 0) throw new Error(`pg_ctl start failed:\n${tail(start)}`);
  return {
    url: `postgres://postgres@127.0.0.1:${String(port)}/postgres`,
    stop: () => {
      run(...as([join(bin, "pg_ctl"), "-D", join(dir, "data"), "-m", "immediate", "stop"]), {
        cwd: tmpdir(),
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function acquireDatabase() {
  if (process.env.DATABASE_URL)
    return { url: process.env.DATABASE_URL, source: "DATABASE_URL", stop: () => undefined };
  if (await reachable(DEFAULT_URL))
    return { url: DEFAULT_URL, source: "localhost:5432", stop: () => undefined };
  const cluster = await startCluster();
  return { ...cluster, source: "throwaway cluster" };
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

function vitest(dir, files, env) {
  const outputFile = join(mkdtempSync(join(tmpdir(), "leaf-1.3.2-vitest-")), "report.json");
  return new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        join(ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        "--dir",
        "test",
        "--reporter=json",
        "--reporter=default",
        `--outputFile.json=${outputFile}`,
        ...files,
      ],
      { cwd: dir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const report = existsSync(outputFile) ? JSON.parse(readFileSync(outputFile, "utf8")) : null;
      rmSync(dirname(outputFile), { recursive: true, force: true });
      resolveRun({ code: code ?? -1, output, report });
    });
  });
}

function assertions(report) {
  return (report?.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
}

const importBuilt = (pkgDir, sub) =>
  import(pathToFileURL(join(pkgDir, "dist/src", sub, "index.js")).href);

// ---------------------------------------------------------------------------------------------
// Gate-specific re-checks on the built packages
// ---------------------------------------------------------------------------------------------

/** R-26 SC-3 acceptance for one measured household. */
function sc3Failures(m) {
  const failures = [];
  if (!(typeof m.dishScoreDrop === "number" && m.dishScoreDrop >= 0.3))
    failures.push(`dish score drop ${String(m.dishScoreDrop)} < 0.3`);
  if (!(typeof m.appealDrop === "number" && m.appealDrop > 0))
    failures.push(`appeal drop ${String(m.appealDrop)} is not > 0`);
  if (m.othersUnchanged !== true) failures.push("another member's appeal or preferences changed");
  if (m.changeSets !== 2) failures.push(`${String(m.changeSets)} learning change sets, expected 2`);
  return failures;
}

function checkG1(report, measureFile) {
  const lines = existsSync(measureFile)
    ? readFileSync(measureFile, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const measured = lines.map((line) => JSON.parse(line));
  report.check(
    measured.length === 2,
    `the database test recorded SC-3 measurements for 2 households (got ${String(measured.length)})`,
  );
  for (const m of measured) {
    console.log(
      `       measured (${m.name}): dish score drop ${m.dishScoreDrop.toFixed(3)}, plate appeal drop ${m.appealDrop.toFixed(4)}, other members unchanged: ${String(m.othersUnchanged)}, learning change sets: ${String(m.changeSets)}`,
    );
    const failures = sc3Failures(m);
    report.check(failures.length === 0, `SC-3 holds for ${m.name}`, failures.join("\n"));
  }
  const bad = { ...measured[0], appealDrop: 0, othersUnchanged: false };
  report.check(
    sc3Failures(bad).length > 0,
    "negative control: the same SC-3 acceptance rejects a measurement with no appeal drop and a changed member",
  );
}

/** FBK-4 06 §3, written out independently of packages/core. */
const FBK4 = {
  dish: { dish: 1, cuisine: 0.3, method: 0.3, ingredientBase: 0.15 },
  variant: { variant: 1, method: 0.5, dish: 0.3 },
  component: { variant: 0.8, ingredientBase: 0.2 },
};

function expectedWeights(table) {
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return [
    {
      target: {
        type: "dish",
        dishId: "d",
        cuisineKey: "c",
        eaten: [
          { variantId: "v1", methodKey: "m1", coreIngredientIds: ["i1", "i2"] },
          { variantId: "v2", methodKey: "m2", coreIngredientIds: ["i2", "i3"] },
        ],
      },
      expected: {
        "dish:d": table.dish.dish,
        "cuisine:c": table.dish.cuisine,
        "method:m1": table.dish.method,
        "method:m2": table.dish.method,
        "ingredient:i1": r3(table.dish.ingredientBase / Math.sqrt(3)),
        "ingredient:i2": r3(table.dish.ingredientBase / Math.sqrt(3)),
        "ingredient:i3": r3(table.dish.ingredientBase / Math.sqrt(3)),
      },
    },
    {
      target: { type: "variant", dishId: "d", variantId: "v", methodKey: "m" },
      expected: {
        "dish:d#v": table.variant.variant,
        "method:m": table.variant.method,
        "dish:d": table.variant.dish,
      },
    },
    {
      target: {
        type: "component",
        dishId: "d",
        variantId: "v",
        coreIngredientIds: ["i1", "i2", "i3", "i4"],
      },
      expected: {
        "dish:d#v": table.component.variant,
        ...Object.fromEntries(
          ["i1", "i2", "i3", "i4"].map((i) => [
            `ingredient:${i}`,
            r3(table.component.ingredientBase / 2),
          ]),
        ),
      },
    },
    { target: { type: "ingredient", ingredientId: "i" }, expected: { "ingredient:i": 1 } },
    { target: { type: "cuisine", cuisineKey: "c" }, expected: { "cuisine:c": 1 } },
    { target: { type: "method", methodKey: "m" }, expected: { "method:m": 1 } },
  ];
}

function propagationMismatches(propagateReview, table) {
  const out = [];
  for (const { target, expected } of expectedWeights(table)) {
    const got = Object.fromEntries(
      propagateReview(target, -1).map((c) => [`${c.entityType}:${c.entityKey}`, c.weight]),
    );
    const keys = new Set([...Object.keys(expected), ...Object.keys(got)]);
    for (const key of keys)
      if (got[key] !== expected[key])
        out.push(
          `${target.type} ${key}: built ${String(got[key])}, FBK-4 ${String(expected[key])}`,
        );
  }
  return out;
}

async function checkG2(report) {
  const prefs = await importBuilt(CORE_DIR, "learning/preferences");
  const mismatches = propagationMismatches(prefs.propagateReview, FBK4);
  report.check(
    mismatches.length === 0,
    "the built propagateReview matches the FBK-4 table for every target type",
    mismatches.join("\n"),
  );
  const wrong = { ...FBK4, dish: { ...FBK4.dish, cuisine: 0.5 } };
  report.check(
    propagationMismatches(prefs.propagateReview, wrong).length > 0,
    "negative control: the same comparison against a mutated table (cuisine 0.5) reports a mismatch",
  );
  const locked = {
    id: "p",
    householdId: "h",
    memberId: "m",
    entityType: "dish",
    entityKey: "d",
    score: 0.8,
    evidenceWeight: 3,
    source: "learned",
    locked: true,
    hard: "none",
    updatedAt: new Date(),
  };
  const contribution = [{ entityType: "dish", entityKey: "d", weight: 1, signal: -1 }];
  report.check(
    prefs.learningPreferenceOps("m", contribution, [locked]).length === 0,
    "the built learner emits no op for a locked learned row",
  );
  report.check(
    prefs.learningPreferenceOps("m", contribution, [{ ...locked, locked: false }]).length === 1,
    "negative control: the same row unlocked receives an op",
  );
}

async function checkG3(report) {
  const portions = await importBuilt(CORE_DIR, "learning/portions");
  const child = { id: "c", isTargeted: false };
  const walk = (tags, member = child) => {
    let rows = [];
    const seen = [];
    for (let i = 0; i < 20; i += 1) {
      for (const { payload } of portions.portionBiasOps(member, ["carb"], tags, rows)) {
        rows = [
          {
            householdId: "h",
            memberId: payload.memberId,
            componentRole: "carb",
            bias: payload.bias,
          },
        ];
      }
      seen.push(rows[0]?.bias ?? 1);
    }
    return seen;
  };
  const down = walk(["too_much"]);
  const up = walk(["still_hungry"]);
  console.log(
    `       measured: too_much ×20 → ${down.slice(0, 3).join(", ")} … ${String(down.at(-1))}; still_hungry ×20 → ${up.slice(0, 3).join(", ")} … ${String(up.at(-1))}`,
  );
  const inBounds = (xs) => xs.every((b) => b >= 0.6 && b <= 1.6);
  report.check(
    down[0] === 0.9 && down[1] === 0.81,
    "the built learner multiplies by 0.9 on too_much",
  );
  report.check(
    up[0] === 1.1 && up[1] === 1.21,
    "the built learner multiplies by 1.1 on still_hungry",
  );
  report.check(
    inBounds(down) && inBounds(up) && down.at(-1) === 0.6 && up.at(-1) === 1.6,
    "20 signals stay within [0.6, 1.6] and reach the bounds",
  );
  const naive = [];
  let b = 1;
  for (let i = 0; i < 20; i += 1) naive.push((b = Math.round(b * 0.9 * 1000) / 1000));
  report.check(
    !inBounds(naive),
    "negative control: the same bounds check rejects an unclamped learner",
  );
  report.check(
    walk(["too_much"], { id: "a", isTargeted: true }).every((x) => x === 1),
    "the built learner writes nothing for a targeted member",
  );
}

// ---------------------------------------------------------------------------------------------

async function gate(id) {
  const spec = GATES[id];
  const report = new Report(`leaf-1.3.2 ${id}`);
  console.log(`# ${id}: ${spec.title}`);

  const build = run(
    "pnpm",
    ["--filter", "@mealplanner/core", "--filter", "@mealplanner/db", "build"],
    { cwd: ROOT },
  );
  if (!report.check(build.code === 0, "packages core and db build", tail(build)))
    return report.finish();

  const database = await acquireDatabase();
  const scratch = mkdtempSync(join(tmpdir(), "leaf-1.3.2-measure-"));
  const measureFile = join(scratch, "sc3.jsonl");
  try {
    const rows = await query(database.url, "SHOW server_version");
    const version = String(rows[0]?.server_version ?? "");
    report.check(
      /^16\./.test(version),
      `database (${database.source}) is PostgreSQL 16 (server_version ${version})`,
    );

    const results = [];
    for (const { dir, files } of spec.runs) {
      const result = await vitest(dir, files, {
        DATABASE_URL: database.url,
        LEAF_132_MEASURE_OUT: measureFile,
      });
      const where = `${dir.slice(ROOT.length + 1)}: ${files.join(", ")}`;
      report.check(
        result.code === 0,
        `vitest exits 0 (${where})`,
        tail({ stdout: result.output, stderr: "" }, 60),
      );
      report.check(result.report !== null, `vitest wrote a JSON report (${where})`);
      results.push(...assertions(result.report));
    }

    const byStatus = (status) => results.filter((r) => r.status === status);
    console.log(
      `       tests: ${String(results.length)} (passed ${String(byStatus("passed").length)}, failed ${String(byStatus("failed").length)})`,
    );
    report.check(results.length > 0, "the gate ran tests");
    report.check(
      results.every((r) => r.status === "passed"),
      "every test passed; none failed, skipped, pending or todo",
      results
        .filter((r) => r.status !== "passed")
        .map((r) => `${r.status}: ${r.fullName}`)
        .join("\n"),
    );
    for (const name of [...spec.required, ...spec.negative]) {
      const matches = results.filter((r) => r.fullName.includes(name));
      report.check(
        matches.length > 0 && matches.every((r) => r.status === "passed"),
        `ran and passed: ${name}`,
      );
    }
    report.check(
      spec.negative.length > 0,
      `the gate has ${String(spec.negative.length)} negative control test(s)`,
    );

    if (id === "G1") checkG1(report, measureFile);
    if (id === "G2") await checkG2(report);
    if (id === "G3") await checkG3(report);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    database.stop();
  }
  return report.finish();
}

const flag = process.argv.indexOf("--gate");
const id = flag === -1 ? undefined : process.argv[flag + 1];
if (id === undefined || !(id in GATES)) {
  console.error(`usage: node scripts/verify/leaf-1.3.2.mjs --gate ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
process.exit(await gate(id));
