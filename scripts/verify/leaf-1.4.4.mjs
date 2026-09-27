// Verify script for leaf 1.4.4 (Today, Plan, Plate, Recipes, Kitchen screens).
// Usage: node scripts/verify/leaf-1.4.4.mjs --gate G1|G2|G3
// Prints "VERIFY leaf-1.4.4 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise. Design: docs/decisions/leaf-1.4.4-adr-1.md.
//
// G1  Playwright @G1 at 390 and 1280 px against a real database and worker: plan a week, swap,
//     lock through regeneration, one-off shared / individual override, cook sheet print view, and
//     the Today / Plate / Recipes / Kitchen screens; the screens' pure helpers (unit tests); the
//     R-52 publish and meal-status routes (integration test).
// G2  Playwright @G2: axe-core on every screen state, light and dark, no serious or critical
//     violation.
// G3  R2-UX-1: the flag listing with its substitution job and result (integration test on the
//     real worker handler), and Playwright @G3: a kitchen flag on the cook sheet → substitution
//     and plate re-solve, checked through the API independently of the UI, visible to admins.
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

const distDirFor = (gate) => `.next/verify-1.4.4-${gate.toLowerCase()}`;

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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.4-pg-"));
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
  const name = `leaf144_${gate.toLowerCase()}_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
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

/** Runs `config.spec.ts --grep @<gate>` against the gate's database and checks every title. */
async function playwright(report, gate, db, expected, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), `leaf-1.4.4-${gate.toLowerCase()}-`));
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
      ["exec", "playwright", "test", "e2e/plan.spec.ts", "--grep", `@${gate}`, "--reporter=json"],
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
      `Playwright @${gate} run exits 0 with a JSON report`,
      detail,
    );
    report.check(
      results.length >= expected.length && failed.length === 0,
      `${String(results.length)} @${gate} tests ran and every one passed (none skipped)`,
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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.4-vitest-"));
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
    const failed = tests.filter((t) => t.status !== "passed");
    const detail =
      failed.length > 0
        ? failed.map((t) => `--- ${t.title}\n${t.failure}`).join("\n")
        : `${result.stdout}\n${result.stderr}`;
    report.check(
      result.code === 0 && tests.length > 0 && failed.length === 0,
      `${label}: ${String(tests.length)} tests ran and passed`,
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

/** An e2e gate: packages, database, build, worker, Playwright; always cleans up. */
async function e2eGate(report, gate, { worker, graph = false }, body) {
  if (!buildPackages(report)) return;
  if (!buildWeb(report, gate)) return;
  const db = await gateDatabase(report, gate);
  if (graph) {
    // The knowledge graph (SUBSTITUTES_FOR edges, KG-4.3) on the gate's database (1.3.4's rebuild).
    const kg = run(process.execPath, ["scripts/kg-rebuild.ts"], {
      cwd: ROOT,
      env: { DATABASE_URL: db.url },
      timeoutMs: 600_000,
    });
    report.check(kg.code === 0, "knowledge graph rebuilt on the gate's database", tail(kg));
  }
  const logDir = mkdtempSync(join(tmpdir(), `leaf-1.4.4-${gate.toLowerCase()}-worker-`));
  const w = worker ? startWorker(db.url, join(logDir, "worker.log")) : null;
  try {
    await body(db);
  } finally {
    await w?.stop();
    if (w !== null && report.failures.length > 0)
      console.log(`       worker output:\n${w.output()}`);
    rmSync(logDir, { recursive: true, force: true });
    await db.drop();
  }
}

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

const V = ["390", "1280"];

async function gateG1() {
  const report = new Report("leaf-1.4.4 G1");
  console.log(
    "# G1: at 390 and 1280 px: plan a week, swap, lock, one-off override, cook sheet print view (UX-4, PLN-13, R2-MEAL-2, PLN-14)",
  );
  vitest(
    report,
    "the screens' pure helpers (apps/web/components/plan/logic.test.ts)",
    WEB,
    ["components/plan/logic.test.ts"],
    [
      "local date and minutes follow the household zone",
      "weeks start on Monday (R-24)",
      "carbs are total unless the basis says available",
      "sat-fat cap defaults to 6 % of energy; fibre to 14 g / 1,000 kcal, a quarter soluble",
      "summarises targeted plates only",
      "counts distinct raw ingredients, cuisines and targeted plates on target",
      "averages top-level ratings per dish, skipping replies and unmapped targets",
      "F1: Omar's rest day is 2150 kcal and his training day 2390, whatever the slot targets sum to",
      "day overrides win over the schedule, as in the resolver",
      "without schedules, the profile nearest the slot targets; one profile is used every day",
      "negative control: summing slot targets is not the day target",
    ],
  );
  await e2eGate(report, "G1", { worker: true }, async (db) => {
    vitest(
      report,
      "Send to kitchen and Mark cooked through the API (R-52)",
      WEB,
      ["--dir", "test", "test/api/plan-status.int.test.ts"],
      [
        "an admin sends a draft day to the kitchen; it is logged, and undo returns it to draft",
        "publishing twice, or a date with no plan, is refused with 422",
        "members and kitchen users cannot publish; another household's day is untouched",
        "the kitchen marks a meal cooked; the response carries the meal; undo restores planned",
        "an admin sets skipped and back to planned; the same status twice is refused with 422",
        "a member cannot set a status; an unknown status is a 400; another household's meal is 404",
      ],
      { DATABASE_URL: db.serverUrl },
    );
    await playwright(report, "G1", db, [
      ...V.flatMap((v) => [
        `@G1 plan a week at ${v} px`,
        `@G1 swap a meal at ${v} px`,
        `@G1 lock keeps a meal through regeneration at ${v} px`,
        `@G1 one-off shared / individual override at ${v} px`,
        `@G1 cook sheet print view at ${v} px`,
        `@G1 today, plate, recipes and kitchen at ${v} px`,
        `@G1 day targets and the week's training days follow F1 at ${v} px`,
      ]),
      "@G1 negative control: a page wider than the viewport is reported",
      "@G1 negative control: the print check fails without the print stylesheet",
      "@G1 negative control: a swap the server did not apply is not reported as done",
    ]);
  });
  return report.finish();
}

async function gateG2() {
  const report = new Report("leaf-1.4.4 G2");
  console.log("# G2: axe-core finds no serious or critical violation on the leaf's screens (UX-6)");
  await e2eGate(report, "G2", { worker: true }, (db) =>
    playwright(report, "G2", db, [
      ...V.map((v) => `@G2 axe on every screen of the leaf at ${v} px, light and dark`),
      "@G2 negative control: axe reports an unlabelled image and button on a bad page",
    ]),
  );
  return report.finish();
}

async function gateG3() {
  const report = new Report("leaf-1.4.4 G3");
  console.log(
    "# G3: a kitchen flag 'ingredient unavailable' triggers substitution and a plate re-solve, visible to admins (R2-UX-1)",
  );
  await e2eGate(report, "G3", { worker: true, graph: true }, async (db) => {
    vitest(
      report,
      "the flag listing with its substitution job and result (R-52, real worker handler)",
      WEB,
      ["--dir", "test", "test/api/cook-sheet-flags.int.test.ts"],
      [
        "a kitchen flag is listed for admins at once, with its queued job and no result yet",
        "after the job runs, the result names the substitute and every re-solved meal",
        "the kitchen sees only its own flags; members are refused; another date or household has none",
      ],
      { DATABASE_URL: db.serverUrl },
    );
    await playwright(report, "G3", db, [
      "@G3 kitchen flags an unavailable ingredient; substitution and re-solve reach the admins",
      "@G3 negative control: the admin view without the substitution result fails the check",
    ]);
  });
  return report.finish();
}

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3 };

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const i = process.argv.indexOf("--gate");
  const gate = i === -1 ? undefined : process.argv[i + 1];
  const fn = gate === undefined ? undefined : GATES[gate];
  if (fn === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.4.4.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    process.exit(2);
  }
  const log = keepFullOutput(gate);
  try {
    process.exitCode = await fn();
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    console.log(`VERIFY leaf-1.4.4 ${gate} FAILED (error)`);
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
  const dir = join(tmpdir(), "leaf-1.4.4-verify");
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
