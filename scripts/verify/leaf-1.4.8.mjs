// Verify script for leaf 1.4.8 (Plan follow-ups: move, substitutes, day sums; BLD-8 R-58, R-60).
// Usage: node scripts/verify/leaf-1.4.8.mjs --gate G1|G2|G3|G4|G5
// Prints "VERIFY leaf-1.4.8 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise. The harness (builds, database, worker, runners) is
// 1.4.4's (docs/decisions/leaf-1.4.8-adr-1.md), with this leaf's names.
//
// G1  Move: `plan_meal.move` apply/inverse (1.1.2's property test, this op), the move rules
//     (unit), `POST /plan-meals/{id}/move` (integration: exchange, empty slot, both days solved
//     against the resolver, undo, 409s, 422 with nothing written, admin only; negative control:
//     the bare op leaves the days unsolved), and Playwright @1.4.8-G1: drag and the keyboard
//     "Move to…" at 390 and 1280 px; negative control: a refused drag is not reported as moved.
// G2  W-6: olive oil → canola oil on the seed library (steps, labels, component names, leading
//     note; negative control: the pre-fix replaced()), and the substituted cook sheet through the
//     real `plates.substitute` worker handler.
// G3  W-7: F1 slot targets sum to the day target (every member, both day kinds); the 2146 vs 2150
//     reproduction; the screens' day-target helper with the pre-fix sum as negative control; and
//     Playwright @1.4.8-G3: Plan and Plate show the day kind's target at 390 and 1280 px.
// G4  "Use for <day> <slot>": swap refusal in strict mode and least-bad save in flexible mode
//     (integration), and Playwright @1.4.8-G4 at 390 and 1280 px: accepted, excluded (sesame)
//     and infeasible (strict) with the reason shown.
// G5  Playwright @1.4.8-G5: the substituted cook sheet (negative control: the original sheet
//     fails the same check) and axe-core on every new state, light and dark; then 1.4.4 G1–G3.
//
// Isolation (gates may run at the same time, and next to other leaves' gates): each e2e gate
// uses its own database (on DATABASE_URL's server, else localhost:5432, else a throwaway
// PostgreSQL 16 cluster on a free port), its own Next.js build directory, a free port, its own
// worker process and its own temp directory. Package builds and `next build` run under locks
// shared with the other screen leaves' scripts. On any failed test the full error and output are
// printed (W-1).
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
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
const PACKAGES = ["core", "db", "ai", "graph", "api-contract", "ui-tokens"].map((p) =>
  join(ROOT, "packages", p),
);

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

/** Workspace packages and the worker, built once (under a lock) when a source is newer. */
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
        ...["core", "db", "ai", "graph", "api-contract", "ui-tokens"].flatMap((p) => [
          "--filter",
          `@mealplanner/${p}`,
        ]),
        "--filter",
        "@mealplanner/worker",
      ],
      { cwd: ROOT, timeoutMs: 900_000 },
    );
  });
  report.check(
    result.code === 0,
    "workspace packages and the worker are built",
    `${result.stdout}\n${result.stderr}`,
  );
  return result.code === 0;
}

const distDirFor = (gate) => `.next/verify-1.4.8-${gate.toLowerCase()}`;

/** `next build` into the gate's own directory; builds of the web app run one at a time. */
function buildWeb(report, gate) {
  const build = withLock("web-next-build", () =>
    run("pnpm", ["exec", "next", "build"], {
      cwd: WEB,
      // Built without a database: the static /offline page must not need a runtime (as in 1.4.2).
      env: { NEXT_TELEMETRY_DISABLED: "1", MISE_NEXT_DIST_DIR: distDirFor(gate), DATABASE_URL: "" },
      timeoutMs: 900_000,
    }),
  );
  report.check(
    build.code === 0,
    `apps/web builds into ${distDirFor(gate)} (next build, typecheck included)`,
    `${build.stdout}\n${build.stderr}`,
  );
  return build.code === 0;
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16: a database of the gate's own
// ---------------------------------------------------------------------------------------------

async function pgClient(url) {
  const pg = (await import(pathToFileURL(join(WEB, "node_modules/pg/lib/index.js")).href)).default;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await client.connect();
  return client;
}

async function query(url, text) {
  const client = await pgClient(url);
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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.8-pg-"));
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

async function acquireServer() {
  if (process.env.DATABASE_URL)
    return { url: process.env.DATABASE_URL, source: "DATABASE_URL", stop: () => undefined };
  const local = "postgres://postgres:postgres@localhost:5432/postgres";
  if (await reachable(local))
    return { url: local, source: "localhost:5432", stop: () => undefined };
  return startCluster();
}

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** A fresh database on the server, migrated and seeded with the catalogue (R-17 loader). */
async function gateDatabase(report, gate) {
  const server = await acquireServer();
  const version = (await query(server.url, "SHOW server_version"))[0]?.server_version ?? "?";
  report.check(
    /^16\./.test(version),
    `database server (${server.source}) is PostgreSQL 16 (server_version ${version})`,
  );
  const name = `leaf148_${gate.toLowerCase()}_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
  await query(server.url, `CREATE DATABASE "${name}"`);
  const url = withDatabase(server.url, name);
  const { migrateAndSeed } = await import(
    pathToFileURL(join(ROOT, "packages/db/dist/src/seed/index.js")).href
  );
  await migrateAndSeed(url);
  report.check(true, `database ${name} created, migrated and seeded`);
  return {
    url,
    serverUrl: server.url,
    drop: async () => {
      try {
        await query(
          server.url,
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
        );
        await query(server.url, `DROP DATABASE IF EXISTS "${name}"`);
      } finally {
        server.stop();
      }
    },
  };
}

/** The pg-boss worker on the gate's database (plan jobs, ARC-7). */
function startWorker(databaseUrl, logFile) {
  // Output goes straight to a file: the Playwright run below is synchronous, so a pipe would not
  // be drained and could fill up and stall the worker.
  const fd = openSync(logFile, "w");
  const child = spawn(process.execPath, ["dist/src/main.js"], {
    cwd: WORKER,
    env: { ...process.env, DATABASE_URL: databaseUrl, LOG_LEVEL: "warn" },
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  return {
    stop: async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise((r) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            r();
          }, 10_000);
          child.once("exit", () => {
            clearTimeout(timer);
            r();
          });
        });
      }
    },
    output: () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : ""),
  };
}

// ---------------------------------------------------------------------------------------------
// Test runners
// ---------------------------------------------------------------------------------------------

function collectPlaywright(suite) {
  const out = [];
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = (t.results ?? []).at(-1);
      out.push({
        title: spec.title,
        status: last?.status ?? t.status ?? "unknown",
        durationMs: last?.duration ?? 0,
        timeoutMs: t.timeout ?? 0,
        errors: (last?.errors ?? []).map((e) => e.stack ?? e.message ?? JSON.stringify(e)),
        stdout: (last?.stdout ?? []).map((s) => s.text ?? "").join(""),
      });
    }
  }
  for (const child of suite.suites ?? []) out.push(...collectPlaywright(child));
  return out;
}

/**
 * Runs `plan.spec.ts --grep @<tag>` against the gate's database and build (`gate`) and checks
 * every title.
 */
async function playwright(report, tag, gate, db, expected, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), `leaf-1.4.8-${gate.toLowerCase()}-`));
  const jsonFile = join(dir, "results.json");
  const port = await freePort();
  const env = {
    DATABASE_URL: db.url,
    AUTH_SECRET: randomBytes(32).toString("base64"),
    APP_URL: `http://localhost:${String(port)}`,
    PLAYWRIGHT_SKIP_BUILD: "1",
    PLAYWRIGHT_PORT: String(port),
    MISE_NEXT_DIST_DIR: distDirFor(gate),
    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
    PLAYWRIGHT_OUTPUT_DIR: join(dir, "out"),
    NEXT_TELEMETRY_DISABLED: "1",
    ...extraEnv,
  };
  if (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE === undefined &&
    existsSync("/opt/pw-browsers/chromium")
  )
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium";
  try {
    const result = run(
      "pnpm",
      ["exec", "playwright", "test", "e2e/plan.spec.ts", "--grep", `@${tag}`, "--reporter=json"],
      {
        cwd: WEB,
        env,
        timeoutMs: 1_800_000,
      },
    );
    const results = existsSync(jsonFile)
      ? collectPlaywright(JSON.parse(readFileSync(jsonFile, "utf8")))
      : [];
    // Measured figures: how much of its timeout each test used (a run under load shows the margin).
    for (const r of results)
      console.log(
        `       ${r.status.padEnd(8)} ${r.title} (${(r.durationMs / 1000).toFixed(1)} s of ${String(r.timeoutMs / 1000)} s)`,
      );
    const failed = results.filter((r) => r.status !== "passed");
    // W-1: the whole failure, never a tail.
    const detail = [
      ...failed.map((r) => `--- ${r.status}: ${r.title}\n${r.errors.join("\n")}\n${r.stdout}`),
      results.length === 0 ? `${result.stdout}\n${result.stderr}` : "",
    ].join("\n");
    report.check(
      result.code === 0 && existsSync(jsonFile),
      `Playwright @${tag} run exits 0 with a JSON report`,
      detail,
    );
    report.check(
      results.length >= expected.length && failed.length === 0,
      `${String(results.length)} @${tag} tests ran and every one passed (none skipped)`,
      detail,
    );
    const byTitle = new Map(results.map((r) => [r.title, r.status]));
    for (const title of expected)
      report.check(
        byTitle.get(title) === "passed",
        `passed: ${title}`,
        `status ${String(byTitle.get(title))}`,
      );
    return results;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function collectVitest(report) {
  return (report?.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((a) => ({
      title: a.title,
      status: a.status,
      failure: (a.failureMessages ?? []).join("\n"),
    })),
  );
}

/** Runs vitest in `cwd` with the given arguments; checks every expected title passed. */
function vitest(report, label, cwd, args, expected, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.8-vitest-"));
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
      {
        cwd,
        env,
        timeoutMs: 900_000,
      },
    );
    const tests = existsSync(out) ? collectVitest(JSON.parse(readFileSync(out, "utf8"))) : [];
    // With `-t`, tests outside the filter are skipped by design; otherwise nothing may skip.
    const filtered = args.includes("-t");
    const failed = tests.filter(
      (t) =>
        t.status !== "passed" && !(filtered && ["skipped", "pending", "todo"].includes(t.status)),
    );
    const detail =
      failed.length > 0
        ? failed.map((t) => `--- ${t.title}\n${t.failure}`).join("\n")
        : `${result.stdout}\n${result.stderr}`;
    report.check(
      result.code === 0 && tests.length > 0 && failed.length === 0,
      `${label}: ${String(tests.filter((t) => t.status === "passed").length)} tests passed, none failed`,
      detail,
    );
    const byTitle = new Map(tests.map((t) => [t.title, t.status]));
    for (const title of expected)
      report.check(
        byTitle.get(title) === "passed",
        `passed: ${title}`,
        `status ${String(byTitle.get(title))}`,
      );
    return tests;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

const V = ["390", "1280"];

/** A database server for integration tests (DATABASE_URL, localhost:5432, or a throwaway one). */
async function withServer(report, fn) {
  const server = await acquireServer();
  report.check(true, `database server for integration tests: ${server.source}`);
  try {
    return await fn(server.url);
  } finally {
    server.stop();
  }
}

async function gateG1() {
  const report = new Report("leaf-1.4.8 G1");
  console.log(
    "# G1: move a meal to another day (UX-4, W-5 addendum, R-58): op, route, both days re-solved, exchange, 409s, undo, admin only; drag and Move menu",
  );
  vitest(
    report,
    "the move rules (apps/web/components/plan/logic.test.ts)",
    WEB,
    ["components/plan/logic.test.ts"],
    [
      "offers swap, move, and blocked days with the reason, from today on",
      "a locked, cooked or past meal, or one on a sent day, cannot be moved",
    ],
  );
  if (!buildPackages(report)) return report.finish();
  await withServer(report, async (url) => {
    vitest(
      report,
      "plan_meal.move apply → inverse restores the exact prior state (1.1.2 G3 property test)",
      join(ROOT, "packages/db"),
      ["--dir", "test", "test/changes.int.test.ts", "-t", "plan_meal.move|registry"],
      [
        "F1: plan_meal.move — apply then inverse restores the exact prior state",
        "F3: plan_meal.move — apply then inverse restores the exact prior state",
      ],
      { DATABASE_URL: url },
    );
    vitest(
      report,
      "POST /plan-meals/{id}/move (integration)",
      WEB,
      ["--dir", "test", "test/api/plan-move.int.test.ts", "-t", "POST /plan-meals"],
      [
        "the generated days start solved (the check's baseline)",
        "onto an occupied slot the two meals exchange; both days are re-solved",
        "undo through the change log puts both days back exactly",
        "onto an empty slot the meal moves and the source slot is left empty",
        "a locked meal or a locked occupant is refused with 409",
        "a day sent to the kitchen, or a cooked meal, is refused with 409",
        "the same date, a date without a plan, or an occupant the planner refuses: 422, nothing written",
        "admins only: a member or kitchen login gets 403; another household's meal is 404",
        "negative control: the bare op without the re-solve leaves the days unsolved",
      ],
      { DATABASE_URL: url },
    );
  });
  if (!buildWeb(report, "G1")) return report.finish();
  const db = await gateDatabase(report, "G1");
  const logDir = mkdtempSync(join(tmpdir(), "leaf-1.4.8-g1-worker-"));
  const w = startWorker(db.url, join(logDir, "worker.log"));
  try {
    await playwright(report, "1.4.8-G1", "G1", db, [
      ...V.flatMap((v) => [
        `@1.4.8-G1 drag a meal onto another day's slot at ${v} px`,
        `@1.4.8-G1 Move to… from the keyboard at ${v} px`,
      ]),
      "@1.4.8-G1 a move the planner refuses says why and changes nothing",
      "@1.4.8-G1 negative control: a drag the server refused is not reported as moved",
    ]);
  } finally {
    await w.stop();
    if (report.failures.length > 0) console.log(`       worker output:\n${w.output()}`);
    rmSync(logDir, { recursive: true, force: true });
    await db.drop();
  }
  return report.finish();
}

async function gateG2() {
  const report = new Report("leaf-1.4.8 G2");
  console.log(
    "# G2: substituted copies name the substitute in steps, labels and component names (W-6, R-58, R-60)",
  );
  if (!buildPackages(report)) return report.finish();
  await withServer(report, async (url) => {
    vitest(
      report,
      "olive oil → canola oil on the seed library, with the pre-fix replaced() as negative control",
      join(ROOT, "packages/db"),
      ["--dir", "test", "test/plans/substitute-text.int.test.ts"],
      [
        "replaces the display name and aliases, case-insensitive, keeping capitalisation",
        "matches whole words only and leaves other text alone",
        "leaves longer names of other ingredients, and the substitute's own name, as written",
        "adds the leading note when no step names the ingredient",
        "every seed dish with olive oil: steps, labels and component names name canola oil",
        "a variant with olive oil that never names it gets the leading note",
        "negative control: the pre-fix replaced() leaves olive oil in the copy's text",
      ],
      { DATABASE_URL: url },
    );
    vitest(
      report,
      "the substituted cook sheet through the real plates.substitute worker handler",
      WEB,
      ["--dir", "test", "test/api/cook-sheet-flags.int.test.ts"],
      [
        "after the job runs, the result names the substitute and every re-solved meal",
        "the substituted cook sheet names the substitute in steps, labels and component names",
      ],
      { DATABASE_URL: url },
    );
  });
  return report.finish();
}

async function gateG3() {
  const report = new Report("leaf-1.4.8 G3");
  console.log(
    "# G3: slot targets sum to the day target; Plan and Plate show the resolver's day target; 2146 vs 2150 (W-7)",
  );
  vitest(
    report,
    "F1 day sums and the 2146 reproduction (core)",
    join(ROOT, "packages/core"),
    ["test/planner/targets/day-sums.test.ts"],
    [
      "every targeted member, every day and both day kinds: Σ slot kcal/P/C/F = the profile",
      // 1.2.7 (R-73): the case no longer pins 2146 (W-17 changed the plan once).
      "reproduced: Sunday adult_a's plate targets do not sum to the 2150 of his rest day",
      "summing plate targets misses the day target on several member-days, not only Sunday",
    ],
  );
  vitest(
    report,
    "the screens' day target (apps/web/components/plan/logic.test.ts)",
    WEB,
    ["components/plan/logic.test.ts"],
    [
      "F1 Sunday: the day target is 2150 (rest day), with or without schedules",
      "negative control: the pre-fix sum of plate targets gives 2146",
      "F1: Omar's rest day is 2150 kcal and his training day 2390, whatever the slot targets sum to",
    ],
  );
  if (!buildPackages(report) || !buildWeb(report, "G3")) return report.finish();
  const db = await gateDatabase(report, "G3");
  const logDir = mkdtempSync(join(tmpdir(), "leaf-1.4.8-g3-worker-"));
  const w = startWorker(db.url, join(logDir, "worker.log"));
  try {
    await playwright(
      report,
      "1.4.8-G3",
      "G3",
      db,
      V.map((v) => `@1.4.8-G3 Plan and Plate show the day target of the day kind at ${v} px`),
    );
  } finally {
    await w.stop();
    if (report.failures.length > 0) console.log(`       worker output:\n${w.output()}`);
    rmSync(logDir, { recursive: true, force: true });
    await db.drop();
  }
  return report.finish();
}

async function gateG4() {
  const report = new Report("leaf-1.4.8 G4");
  console.log(
    '# G4: "Use for <day> <slot>" calls planMeals.swap; excluded or infeasible dishes are refused with the reason (R-53 deferral, R-58, R-60)',
  );
  if (!buildPackages(report)) return report.finish();
  await withServer(report, (url) =>
    vitest(
      report,
      "planMeals.swap: strict refuses an infeasible dish, flexible keeps the least-bad save",
      WEB,
      ["--dir", "test", "test/api/plan-move.int.test.ts", "-t", "planMeals.swap"],
      [
        "strict: 422 naming the member, the macro and the amount; nothing written",
        "flexible: the least-bad plate is saved as a flexible miss",
      ],
      { DATABASE_URL: url },
    ),
  );
  if (!buildWeb(report, "G4")) return report.finish();
  const db = await gateDatabase(report, "G4");
  const logDir = mkdtempSync(join(tmpdir(), "leaf-1.4.8-g4-worker-"));
  const w = startWorker(db.url, join(logDir, "worker.log"));
  try {
    await playwright(
      report,
      "1.4.8-G4",
      "G4",
      db,
      V.map((v) => `@1.4.8-G4 Use for <day> <slot> on the recipe page at ${v} px`),
    );
  } finally {
    await w.stop();
    if (report.failures.length > 0) console.log(`       worker output:\n${w.output()}`);
    rmSync(logDir, { recursive: true, force: true });
    await db.drop();
  }
  return report.finish();
}

async function gateG5() {
  const report = new Report("leaf-1.4.8 G5");
  console.log(
    "# G5: Playwright and axe-core at 390 and 1280 px (drag, Move menu, substituted cook sheet, Use for); 1.4.4 G1–G3 still pass",
  );
  if (!buildPackages(report) || !buildWeb(report, "G5")) return report.finish();
  const db = await gateDatabase(report, "G5");
  const kg = run(process.execPath, ["scripts/kg-rebuild.ts"], {
    cwd: ROOT,
    env: { DATABASE_URL: db.url },
    timeoutMs: 600_000,
  });
  report.check(kg.code === 0, "knowledge graph rebuilt on the gate's database", tail(kg));
  const logDir = mkdtempSync(join(tmpdir(), "leaf-1.4.8-g5-worker-"));
  const w = startWorker(db.url, join(logDir, "worker.log"));
  try {
    await playwright(report, "1.4.8-G5", "G5", db, [
      "@1.4.8-G5 the substituted cook sheet names the substitute (olive oil → canola oil when served)",
      ...V.map(
        (v) =>
          `@1.4.8-G5 axe on the move, day-target, use-for and substituted states at ${v} px, light and dark`,
      ),
    ]);
  } finally {
    await w.stop();
    if (report.failures.length > 0) console.log(`       worker output:\n${w.output()}`);
    rmSync(logDir, { recursive: true, force: true });
    await db.drop();
  }
  // 1.4.4's gates on this branch (R-58: 1.4.4 G1–G3 still pass), run as its own script does.
  for (const g of ["G1", "G2", "G3"]) {
    const r = run(process.execPath, ["scripts/verify/leaf-1.4.4.mjs", "--gate", g], {
      cwd: ROOT,
      timeoutMs: 1_700_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    report.check(
      r.code === 0 && out.includes(`VERIFY leaf-1.4.4 ${g} PASSED`),
      `leaf 1.4.4 ${g} passes on this branch`,
      out,
    );
  }
  return report.finish();
}

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4, G5: gateG5 };

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const i = process.argv.indexOf("--gate");
  const gate = i === -1 ? undefined : process.argv[i + 1];
  const fn = gate === undefined ? undefined : GATES[gate];
  if (fn === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.4.8.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    process.exit(2);
  }
  const log = keepFullOutput(gate);
  try {
    process.exitCode = await fn();
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    console.log(`VERIFY leaf-1.4.8 ${gate} FAILED (error)`);
    process.exitCode = 1;
  }
  log.finish(process.exitCode !== 0);
}

/**
 * W-1 under gate-check: gate-check shows only the first and last lines of a failing gate's output,
 * so the whole output also goes to a log file that outlives the run, named on the first line, and
 * a failure ends with the failing checks and tests named and the log's path again.
 */
function keepFullOutput(gate) {
  const dir = join(tmpdir(), "leaf-1.4.8-verify");
  mkdirSync(dir, { recursive: true });
  const file = join(
    dir,
    `${gate}-${new Date().toISOString().replaceAll(":", "-")}-${String(process.pid)}.log`,
  );
  const failing = [];
  const tee =
    (write) =>
    (chunk, ...rest) => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      appendFileSync(file, text);
      for (const line of text.split("\n")) {
        const check = /^FAIL - (.*)$/.exec(line);
        const test = /^\s+(failed|timedOut|interrupted|skipped)\s+(.*)$/.exec(line);
        if (check !== null) failing.push(check[1]);
        else if (test !== null) failing.push(`${test[1]}: ${test[2]}`);
      }
      return write(chunk, ...rest);
    };
  process.stdout.write = tee(process.stdout.write.bind(process.stdout));
  process.stderr.write = tee(process.stderr.write.bind(process.stderr));
  // First, so that it survives gate-check's excerpt.
  console.log(`full output: ${file}`);
  return {
    finish(failed) {
      if (!failed) return;
      console.log(`failing: ${failing.length === 0 ? "(see log)" : failing.join(" | ")}`);
      console.log(`full output: ${file}`);
    },
  };
}
