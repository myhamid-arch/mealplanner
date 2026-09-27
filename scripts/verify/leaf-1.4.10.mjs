// Verify script for leaf 1.4.10 (Plain reasons, graph start-up, change-log subjects: W-12, W-13,
// W-14; BLD-8 R-68, R-70).
// Usage: node scripts/verify/leaf-1.4.10.mjs --gate G1|G2|G3|G4
// Prints "VERIFY leaf-1.4.10 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise.
//
// G1  Plain reasons (W-12, UX-7): packages/core reasons.test.ts plans the F1 week for seeds 1–10
//     with the loader's labels (catalogue display names, data/cuisines.json labels) and checks
//     every reason: no slug, snake_case key or raw id; ingredient lists made of display names;
//     cuisine sentences made of labels; after a substitution (olive oil → canola oil, tahini →
//     peanut butter) no reason names the replaced ingredient. Negative controls (in the test):
//     today's labels (slug, key) fail the check, and the pre-fix wording that named the previous
//     meal by its dish name names the replaced ingredient. Then apps/web
//     test/followups/plain-reasons.int.test.ts: a plan from the database loader and a real
//     `plates.substitute` job. Regressions: 1.2.3 G1–G6, 1.2.6 G1–G2, 1.4.8 G1–G4.
// G2  Graph start-up order (W-13, KG-3; ADR-1): packages/graph startup.int.test.ts (the dish sync
//     creates missing catalogue nodes, hides no real error, covers the household scope, and two
//     catalogue syncs with a dish sync never deadlock), and apps/web
//     test/api/kg-startup.int.test.ts: `startWorker` at concurrency 2 on an empty graph with the
//     seed library, natural, held and open-transaction, plus two catalogue syncs and the dish
//     sync together: no failed attempt, and the graph equals the rebuild's (SPEC-Q-5).
//     Negative control: the held and open-transaction runs fail with the pre-fix syncDishes
//     (f7b041a, verbatim), and so does the household change set (SPEC-Q-6). The reproduction is
//     recorded in docs/decisions/leaf-1.4.10-w13.md. Regressions: 1.3.4 G1–G3.
// G3  Change-log subjects (W-14, R2-ADM-7): apps/web test/api/change-log-detail.int.test.ts
//     through `GET /change-sets`. Negative controls (in the test): two blocks of different logins
//     read differently, and the title-only rendering fails the same checks. Regressions: 1.4.1
//     G1–G3, 1.4.6 G1–G2.
// G4  Playwright at 390 and 1280 px with axe-core (apps/web/test/followups/followups.e2e.ts, own
//     config): the Plate's "Why this dinner" after a real substitution, and /changelog with a
//     block, a target change and a settings change. Negative controls in the spec. Regressions:
//     1.4.2 G1–G2.
//
// Isolation (gate-check runs gates in parallel): each gate has its own databases (random names,
// on DATABASE_URL's server, else localhost:5432, else a throwaway PostgreSQL 16 cluster), Next.js
// build directory (.next/verify-1.4.10-<gate>), port, worker and temp directories. Package builds
// run under a lock shared with the other leaves' scripts; `next build` runs with DATABASE_URL
// cleared (R-50). Regression gates run as child processes, LEAF1410_REGRESSION_JOBS at a time
// (default 2); a failure prints their output. 1.4.2's regression gates always run with
// DATABASE_URL cleared (R-50). G4 captures for the architect (G5) go to $SCREENSHOT_DIR when set.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = join(ROOT, "apps/web");
const WORKER = join(ROOT, "apps/worker");
const CORE = join(ROOT, "packages/core");
const GRAPH = join(ROOT, "packages/graph");
const PACKAGE_NAMES = ["core", "db", "ai", "graph", "api-contract", "ui-tokens"];
const PACKAGES = PACKAGE_NAMES.map((p) => join(ROOT, "packages", p));
const LABEL = "leaf-1.4.10";

// ---------------------------------------------------------------------------------------------
// The tests each gate requires, by title
// ---------------------------------------------------------------------------------------------

const REASONS_UNIT = [
  "no reason names a slug, a snake_case key or a raw id; ingredient lists are display names",
  "the plans exercise the labelled reasons: ingredient lists and cuisine repeats occur",
  'cuisine repeats read "<Label> food is already on N other days this week"',
  "negative control: today's labels (slug for ingredients, key for cuisines) fail the check",
  "olive-oil → canola-oil: the week's reasons never name it",
  "tahini → peanut-butter: the week's reasons never name it",
  "negative control: naming the previous meal by its dish name (pre-fix) names the replaced ingredient",
];
const REASONS_INT = [
  "the generated plan's reasons use display names: no slug, snake_case key or id",
  "negative control: a reason with today's slug labels fails the same check",
  "after the kitchen flags it unavailable and plates.substitute runs, no reason names it",
];
const STARTUP_GRAPH = [
  "creates the global catalogue first; with the nightly recompute the graph equals the rebuild's",
  "with the catalogue present, the dish sync does not sync it again",
  "a dish naming an ingredient the catalogue does not have still fails the edge write",
  "synced before the household catalogue (syncRequests' order), it succeeds",
  "two catalogue syncs and a dish sync started together: no deadlock, graph equals the rebuild's",
];
const STARTUP_WORKER = [
  "natural, at concurrency 2: no attempt fails; the graph equals the rebuild's",
  "held (the dish job runs before the catalogue job): no attempt fails; the graph equals the rebuild's",
  "open-tx (catalogue nodes written, not committed): the dish sync waits, no attempt fails; the graph equals the rebuild's",
  "three (two catalogue syncs and the dish sync together, concurrency 3): no deadlock, no retry; the graph equals the rebuild's",
  "held: the dish job's attempt fails with edges to missing catalogue nodes",
  "open-tx: the dish job's attempt fails with edges to missing catalogue nodes",
  "natural (reported, not asserted): the race as reproduced at CP1",
  "the real kg.sync handler (syncRequests: dish request first) succeeds, no retry",
  "negative control: with the pre-fix syncDishes it fails on every attempt",
];
const CHANGE_LOG = [
  "each entry names its subject and, for scalar fields, before → after",
  "the target change carries the mockup's chips: protein and calories, before and after",
  "the settings change and the undo carry before → after (the undo reversed)",
  "a change set stored as raw rows resolves from its JSON alone (no migration)",
  "an undo blocked by a later change names that change by its resolved title",
  "a vanished subject renders with the stored title and no detail",
  "multi-subject change sets keep their stored summary",
  "negative control: two blocks of different logins have the same stored summary",
  "negative control: the title-only rendering fails the same checks",
  "the resolved op kinds (coverage listed for the architect)",
  "another household's admin sees none of these entries",
];
const E2E = [
  "@G4 set-up: the mockup's family; Ravi blocked, Sara's protein target and the time zone changed; a dinner substituted",
  ...["390", "1280"].flatMap((v) => [
    `@G4 the Plate's "Why this dinner" after a substitution at ${v} px`,
    `@G4 /changelog names each subject, with before → after chips, at ${v} px`,
  ]),
];
const E2E_NEGATIVE = [
  "@G4 negative control: the title-only rendering (stored summaries) fails the change-log check",
  "@G4 negative control: axe reports a known-bad page",
];
const SHOTS = ["390", "1280"].flatMap((v) => [`plate-after-substitution-${v}`, `changelog-${v}`]);
const REGRESSIONS = {
  G1: [
    ...["G1", "G2", "G3", "G4", "G5", "G6"].map((g) => ["leaf-1.2.3", g]),
    ["leaf-1.2.6", "G1"],
    ["leaf-1.2.6", "G2"],
    ...["G1", "G2", "G3", "G4"].map((g) => ["leaf-1.4.8", g]),
  ],
  G2: ["G1", "G2", "G3"].map((g) => ["leaf-1.3.4", g]),
  G3: [
    ...["G1", "G2", "G3"].map((g) => ["leaf-1.4.1", g]),
    ["leaf-1.4.6", "G1"],
    ["leaf-1.4.6", "G2"],
  ],
  G4: [
    ["leaf-1.4.2", "G1"],
    ["leaf-1.4.2", "G2"],
  ],
};

// ---------------------------------------------------------------------------------------------
// Locks and builds
// ---------------------------------------------------------------------------------------------

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** A cross-process lock (atomic mkdir); a lock left by a dead process is taken over. */
function withLock(name, fn) {
  const lock = join(
    tmpdir(),
    `mealplanner-${name}-${createHash("sha256").update(ROOT).digest("hex").slice(0, 12)}.lock`,
  );
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
      sleepMs(500);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function newestMtime(dir) {
  let newest = 0;
  if (!existsSync(dir)) return 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

function stale(pkgDir) {
  const inputs = Math.max(
    newestMtime(join(pkgDir, "src")),
    statSync(join(pkgDir, "package.json")).mtimeMs,
  );
  const dist = join(pkgDir, "dist");
  if (!existsSync(dist)) return true;
  return inputs > newestMtime(dist);
}

/** Workspace packages and the worker, built once (under the shared lock) when a source is newer. */
function buildPackages(report) {
  const result = withLock("packages-build", () => {
    if (![...PACKAGES, WORKER].some(stale)) return { code: 0, stdout: "up to date", stderr: "" };
    return run(
      "pnpm",
      [
        "exec",
        "turbo",
        "run",
        "build",
        ...PACKAGE_NAMES.flatMap((p) => ["--filter", `@mealplanner/${p}`]),
        "--filter",
        "@mealplanner/worker",
      ],
      { cwd: ROOT, timeoutMs: 900_000 },
    );
  });
  return report.check(
    result.code === 0,
    "workspace packages and the worker are built",
    `${result.stdout}\n${result.stderr}`,
  );
}

const distDirFor = (gate) => `.next/verify-1.4.10-${gate.toLowerCase()}`;

/** `next build` into the gate's own directory, one at a time, without a database (R-50). */
function buildWeb(report, gate) {
  const build = withLock("web-next-build", () =>
    run("pnpm", ["exec", "next", "build"], {
      cwd: WEB,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        MISE_NEXT_DIST_DIR: distDirFor(gate),
        DATABASE_URL: "",
        NODE_OPTIONS: "",
      },
      timeoutMs: 1_200_000,
    }),
  );
  return report.check(
    build.code === 0,
    `apps/web builds into ${distDirFor(gate)} (next build, typecheck included)`,
    tail(build, 60),
  );
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16
// ---------------------------------------------------------------------------------------------

async function pgClient(url) {
  const pg = (await import(pathToFileURL(join(WEB, "node_modules/pg/lib/index.js")).href)).default;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await client.connect();
  return client;
}

async function query(url, text, values = []) {
  const client = await pgClient(url);
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

async function startCluster() {
  const bin = pgBinDir();
  if (bin === undefined)
    throw new Error(
      "no DATABASE_URL, nothing on localhost:5432, and no PostgreSQL 16 binaries (initdb)",
    );
  const asRoot = process.getuid?.() === 0;
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.10-pg-"));
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
      `-p ${String(port)} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=300`,
      "start",
    ]),
    { cwd: tmpdir() },
  );
  if (start.code !== 0) throw new Error(`pg_ctl start failed:\n${tail(start)}`);
  return {
    url: `postgres://postgres@127.0.0.1:${String(port)}/postgres`,
    source: "throwaway cluster",
    stop: () => {
      run(...as([join(bin, "pg_ctl"), "-D", join(dir, "data"), "-m", "immediate", "stop"]), {
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

/** A fresh database of the gate's own, migrated and seeded with the catalogue (R-17 loader). */
async function gateDatabase(report, server, gate) {
  const name = `leaf1410_${gate.toLowerCase()}_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
  await query(server.url, `CREATE DATABASE "${name}"`);
  const url = withDatabase(server.url, name);
  const { migrateAndSeed } = await import(
    pathToFileURL(join(ROOT, "packages/db/dist/src/seed/index.js")).href
  );
  await migrateAndSeed(url);
  const [counts] = await query(
    url,
    `SELECT (SELECT count(*) FROM ingredient)::int AS ingredients, (SELECT count(*) FROM dish)::int AS dishes`,
  );
  report.check(
    counts.ingredients > 0 && counts.dishes > 0,
    `database ${name} migrated and seeded (${String(counts.ingredients)} ingredients, ${String(counts.dishes)} dishes)`,
  );
  return {
    url,
    drop: async () => {
      await query(
        server.url,
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      );
      await query(server.url, `DROP DATABASE IF EXISTS "${name}"`);
    },
  };
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

/** Runs vitest; returns { code, tests, output } without judging. */
function vitestRun(cwd, args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.10-vitest-"));
  const out = join(dir, "report.json");
  try {
    const result = run(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        ...args,
        "--reporter=json",
        `--outputFile=${out}`,
        "--reporter=default",
      ],
      { cwd, env: { NODE_OPTIONS: "", ...env }, timeoutMs: 1_500_000 },
    );
    const tests = existsSync(out) ? collectVitest(JSON.parse(readFileSync(out, "utf8"))) : [];
    return { code: result.code, tests, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A title matches exactly, or by prefix when the expected title ends with ": " (it.each). */
function matches(title, expected) {
  return expected.endsWith(": ") ? title.startsWith(expected) : title === expected;
}

/** Runs vitest and checks every test ran and passed and every expected title is among them. */
function vitest(report, label, cwd, args, expected, env = {}) {
  const r = vitestRun(cwd, args, env);
  const failed = r.tests.filter((t) => t.status !== "passed");
  report.check(
    r.code === 0 && r.tests.length > 0 && failed.length === 0,
    `${label}: ${String(r.tests.length)} tests ran and passed`,
    failed.length > 0 ? failed.map((t) => `--- ${t.title}\n${t.failure}`).join("\n") : r.output,
  );
  for (const title of expected) {
    const hit = r.tests.filter((t) => matches(t.title, title));
    report.check(
      hit.length > 0 && hit.every((t) => t.status === "passed"),
      `passed: ${title}${title.endsWith(": ") ? "…" : ""}`,
      `status ${hit.map((t) => t.status).join(", ") || "missing"}`,
    );
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Child processes: Playwright, the worker, other leaves' gates
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

function background(command, args, { cwd, env }) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
  let output = "";
  child.stdout.on("data", (d) => (output = (output + d).slice(-20_000)));
  child.stderr.on("data", (d) => (output = (output + d).slice(-20_000)));
  return {
    output: () => output,
    alive: () => child.exitCode === null && child.signalCode === null,
    stop: () =>
      new Promise((resolveStop) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
        child.once("close", () => resolveStop());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000);
      }),
  };
}

function chromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
}

function playwrightResults(reportFile) {
  const out = new Map();
  if (!existsSync(reportFile)) return out;
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests ?? []) out.set(spec.title, t.results?.at(-1)?.status ?? "skipped");
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of JSON.parse(readFileSync(reportFile, "utf8")).suites ?? []) walk(s);
  return out;
}

function findFiles(dir, name) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? findFiles(join(dir, e.name), name)
      : e.name === name
        ? [join(dir, e.name)]
        : [],
  );
}

/** Other leaves' gates as child processes, `jobs` at a time; each must print its PASSED marker. */
async function regressions(report, list) {
  const jobs = Math.max(1, Number(process.env.LEAF1410_REGRESSION_JOBS ?? "2") || 2);
  const queue = [...list];
  const results = new Map();
  const workers = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const [leaf, gate] = next;
      const started = Date.now();
      const r = await runAsync(
        process.execPath,
        [join(ROOT, `scripts/verify/${leaf}.mjs`), "--gate", gate],
        {
          cwd: ROOT,
          // R-50: 1.4.2's gates build and serve without a database; with DATABASE_URL set, its
          // `next build` prerenders /offline through the runtime, which then needs AUTH_SECRET.
          // The other leaves' gates use DATABASE_URL's server when it is set.
          env: { NODE_OPTIONS: "", ...(leaf === "leaf-1.4.2" ? { DATABASE_URL: "" } : {}) },
          timeoutMs: 1_700_000,
        },
      );
      results.set(`${leaf} ${gate}`, { ...r, seconds: Math.round((Date.now() - started) / 1000) });
    }
  });
  await Promise.all(workers);
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

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

/** A vitest run against the gate's database server (a fresh database per test file). */
async function integration(report, label, cwd, file, titles) {
  const server = await acquireServer(report);
  try {
    return vitest(report, label, cwd, ["--dir", "test", file], titles, {
      DATABASE_URL: server.url,
    });
  } finally {
    server.stop();
  }
}

async function gateG1(report) {
  if (!buildPackages(report)) return;
  const unit = vitest(
    report,
    "packages/core reasons.test.ts (F1 week, seeds 1–10)",
    CORE,
    ["--dir", "test", "test/planner/select/reasons.test.ts"],
    REASONS_UNIT,
  );
  // Measured, not assumed: how many reasons the check read over the ten seeds.
  const measured = /W-12 reasons checked: (\d+) over seeds 1–10/.exec(unit.output);
  const count = Number(measured?.[1] ?? "0");
  report.check(
    count > 0,
    `measured: ${String(count)} reasons checked over the F1 week plans for seeds 1–10`,
    unit.output,
  );
  const int = await integration(
    report,
    "apps/web test/followups/plain-reasons.int.test.ts (loader + plates.substitute)",
    WEB,
    "test/followups/plain-reasons.int.test.ts",
    REASONS_INT,
  );
  const picked = /W-12 substitution: (.+)/.exec(int.output)?.[1];
  report.check(picked !== undefined, `the substitution replaced: ${picked ?? "(not reported)"}`);
  await regressions(report, REGRESSIONS.G1);
}

async function gateG2(report) {
  if (!buildPackages(report)) return;
  await integration(
    report,
    "packages/graph startup.int.test.ts",
    GRAPH,
    "test/startup.int.test.ts",
    STARTUP_GRAPH,
  );
  const worker = await integration(
    report,
    "apps/web test/api/kg-startup.int.test.ts (real worker, concurrency 2 and 3)",
    WEB,
    "test/api/kg-startup.int.test.ts",
    STARTUP_WORKER,
  );
  const natural = /W-13 natural pre-fix run: (.+)/.exec(worker.output)?.[1];
  console.log(`info - W-13 natural pre-fix run (reported, not asserted): ${natural ?? "?"}`);
  const record = join(ROOT, "docs/decisions/leaf-1.4.10-w13.md");
  report.check(
    existsSync(record) &&
      readFileSync(record, "utf8").includes("edge(s) name a node that does not exist"),
    "the W-13 reproduction is recorded (docs/decisions/leaf-1.4.10-w13.md)",
  );
  await regressions(report, REGRESSIONS.G2);
}

async function gateG3(report) {
  if (!buildPackages(report)) return;
  const r = await integration(
    report,
    "apps/web test/api/change-log-detail.int.test.ts (GET /change-sets)",
    WEB,
    "test/api/change-log-detail.int.test.ts",
    CHANGE_LOG,
  );
  const kinds = /described op kinds: (.+)/.exec(r.output)?.[1];
  console.log(`info - op kinds with a resolved title: ${kinds ?? "?"}`);
  await regressions(report, REGRESSIONS.G3);
}

async function gateG4(report) {
  if (!buildPackages(report)) return;
  if (!buildWeb(report, "G4")) return;
  const server = await acquireServer(report);
  const outDir = mkdtempSync(join(tmpdir(), "leaf-1.4.10-g4-"));
  const processes = [];
  let db;
  try {
    db = await gateDatabase(report, server, "G4");
    // The worker syncs the catalogue graph at start (SUBSTITUTES_FOR for the substitution).
    const worker = background(process.execPath, ["dist/src/main.js"], {
      cwd: WORKER,
      env: { DATABASE_URL: db.url, ANTHROPIC_API_KEY: "", NODE_OPTIONS: "", LOG_LEVEL: "warn" },
    });
    processes.push(worker);
    const port = await freePort();
    const reportFile = join(outDir, "report.json");
    const shots = process.env.SCREENSHOT_DIR ?? join(outDir, "screenshots");
    const e2e = await runAsync(
      process.execPath,
      [
        join(WEB, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        "test/followups/playwright.config.ts",
        "--reporter=list,json",
      ],
      {
        cwd: WEB,
        env: {
          MISE_NEXT_DIST_DIR: distDirFor("G4"),
          PLAYWRIGHT_PORT: String(port),
          APP_URL: `http://localhost:${String(port)}`,
          DATABASE_URL: db.url,
          AUTH_SECRET: randomBytes(32).toString("base64url"),
          ANTHROPIC_API_KEY: "",
          NODE_OPTIONS: "",
          WORLD_FILE: join(outDir, "world.json"),
          SCREENSHOT_DIR: shots,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
          PLAYWRIGHT_OUTPUT_DIR: join(outDir, "artefacts"),
          NEXT_TELEMETRY_DISABLED: "1",
          ...(chromium() === undefined ? {} : { PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromium() }),
        },
      },
    );
    const tests = playwrightResults(reportFile);
    const failed = [...tests].filter(([, s]) => s !== "passed");
    if (e2e.code !== 0 || failed.length > 0) {
      console.log(
        `----- followups.e2e.ts: full output (exit ${String(e2e.code)}) -----\n${e2e.stdout}\n${e2e.stderr}`,
      );
      for (const f of findFiles(outDir, "error-context.md"))
        console.log(`----- ${f} -----\n${readFileSync(f, "utf8")}`);
      console.log(`----- worker output (tail) -----\n${worker.output()}`);
    }
    report.check(e2e.code === 0, "apps/web/test/followups/followups.e2e.ts exits 0", tail(e2e, 40));
    for (const title of [...E2E, ...E2E_NEGATIVE])
      report.check(
        tests.get(title) === "passed",
        title,
        `status: ${String(tests.get(title) ?? "missing")}`,
      );
    const known = new Set([...E2E, ...E2E_NEGATIVE]);
    const unexpected = [...tests.keys()].filter((t) => !known.has(t));
    report.check(
      unexpected.length === 0,
      "no test outside the required list",
      unexpected.join("\n"),
    );
    const missing = SHOTS.filter((s) => !existsSync(join(shots, `${s}.png`)));
    report.check(
      missing.length === 0,
      `captures for G5 written (${String(SHOTS.length)})`,
      missing.join(", "),
    );
    report.check(worker.alive(), "the worker ran for the whole gate", worker.output());
  } finally {
    for (const p of processes.reverse()) await p.stop();
    if (db !== undefined) await db.drop().catch(() => undefined);
    server.stop();
    rmSync(outDir, { recursive: true, force: true });
  }
  await regressions(report, REGRESSIONS.G4);
}

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4 };

async function main() {
  const i = process.argv.indexOf("--gate");
  const gate = i === -1 ? undefined : process.argv[i + 1];
  if (gate === undefined || GATES[gate] === undefined) {
    console.error("usage: node scripts/verify/leaf-1.4.10.mjs --gate G1|G2|G3|G4");
    return 2;
  }
  // The full output also goes to a log file (gate-check keeps only a bounded transcript; W-1).
  const logFile = join(
    tmpdir(),
    `leaf-1.4.10-${gate.toLowerCase()}-${String(process.pid)}-last.log`,
  );
  writeFileSync(logFile, "");
  const print = console.log.bind(console);
  console.log = (...args) => {
    print(...args);
    try {
      appendFileSync(logFile, `${args.map(String).join(" ")}\n`);
    } catch {
      // The log is a convenience; the gate's verdict does not depend on it.
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
