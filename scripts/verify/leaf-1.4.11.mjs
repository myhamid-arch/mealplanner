// Verify script for leaf 1.4.11 (Assistant button clearance at phone width: W-15; BLD-8 R-77).
// Usage: node scripts/verify/leaf-1.4.11.mjs --gate G1|G2
// Prints "VERIFY leaf-1.4.11 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise.
//
// G1  Clearance (W-15, UX-4): apps/web/e2e/assistant-clearance.spec.ts, tests tagged @G1, through
//     a real build, database and worker. At 390 × 844 and 360 × 800 as an admin, on /account and
//     on the admin's Plate (today's dinner, planned by the worker), scrolled to the end: the
//     Assistant button's bounding box does not intersect "Delete my account" / "See recipe", and
//     elementFromPoint at the control's centre hits the control. A member (/account, own Plate) and
//     a kitchen user (/account) have no button and keep the pre-fix 100 px. On /account the fix
//     leaves at least a 16 px gap above the button. Negative control (R-78): the pre-fix class
//     lists of the shell's `main` and outer `div`, read here from git at PRE_FIX_COMMIT and passed
//     to the spec, put on the same pages make the button cover "See recipe" by at least 20 px high
//     (CP1 amendment 1) and leave "Delete my account" under 16 px from the button (1.4.6's own
//     padding keeps it just clear), at both widths. Both gaps are printed. The source checks below
//     make sure the control reads the real pre-fix padding and the fix is in place.
// G2  No regression: axe-core at 390 px on both pages scrolled to the end, light and dark (tests
//     tagged @G2; negative control: a known-bad page is reported), then 1.4.2 G1–G2 and 1.4.9 G4
//     through their own verify scripts as child processes (each must print its PASSED marker).
//
// Isolation (gate-check runs gates in parallel): each gate has its own database (random name, on
// DATABASE_URL's server, else localhost:5432, else a throwaway PostgreSQL 16 cluster), Next.js
// build directory (.next/verify-1.4.11-<gate>), port, worker and temp directories. Package builds
// and `next build` run under the same cross-process locks as the other leaves' scripts; `next
// build` runs with DATABASE_URL cleared (R-50), and 1.4.2's regression gates always run with
// DATABASE_URL cleared (R-50). Regression gates run LEAF1411_REGRESSION_JOBS at a time (default
// 3). G1 captures for the architect (G3) go to $SCREENSHOT_DIR when set.
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
import { lockIsStale } from "./lib/lock.mjs";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = join(ROOT, "apps/web");
const WORKER = join(ROOT, "apps/worker");
const PACKAGE_NAMES = ["core", "db", "ai", "graph", "api-contract", "ui-tokens"];
const PACKAGES = PACKAGE_NAMES.map((p) => join(ROOT, "packages", p));
const LABEL = "leaf-1.4.11";
const SHELL = "apps/web/app/(shell)/_shell/app-shell.tsx";
/** This leaf's base commit: `app-shell.tsx` before W-15 (last changed by 1.4.9 at b6a2d7a). */
const PRE_FIX_COMMIT = "83d0811e4df69138d7bdf89933bac8d69b1d137f";
const PRE_FIX_PADDING = "pb-[calc(100px+env(safe-area-inset-bottom))]";
const FIX_PADDING = "pb-[calc(174px+env(safe-area-inset-bottom))]";
const SPEC = "e2e/assistant-clearance.spec.ts";

const VIEWPORTS = ["390", "360"];
const PAGES = ["account", "plate"];
const E2E = {
  G1: [
    ...VIEWPORTS.flatMap((v) =>
      PAGES.map(
        (p) =>
          `@G1 at ${v} px as an admin, ${p} scrolled to the end: the Assistant button misses the last control`,
      ),
    ),
    ...VIEWPORTS.flatMap((v) => [
      `@G1 negative control at ${v} px, account: with the pre-fix padding the gap to the button is under the 16 px margin`,
      `@G1 negative control at ${v} px, plate: with the pre-fix padding the button covers the last control by at least 20 px`,
    ]),
    "@G1 without the assistant (member), account at 390 px keeps the pre-fix padding",
    "@G1 without the assistant (member), plate at 390 px keeps the pre-fix padding",
    "@G1 without the assistant (kitchen), account at 390 px keeps the pre-fix padding",
  ],
  G2: [
    ...PAGES.flatMap((p) =>
      ["light", "dark"].map(
        (s) =>
          `@G2 axe at 390 px, ${p} scrolled to the end (${s}): no serious or critical violations`,
      ),
    ),
    "@G2 negative control: axe reports a known-bad page",
  ],
};
const REGRESSIONS = [
  ["leaf-1.4.2", "G1"],
  ["leaf-1.4.2", "G2"],
  ["leaf-1.4.9", "G4"],
];

// ---------------------------------------------------------------------------------------------
// Locks and builds
// ---------------------------------------------------------------------------------------------

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
      // W-21: a dead holder, or none recorded (killed between mkdir and the pid write).
      if (lockIsStale(lock)) {
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

const distDirFor = (gate) => `.next/verify-1.4.11-${gate.toLowerCase()}`;

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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.11-pg-"));
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
  const name = `leaf1411_${gate.toLowerCase()}_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
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
  const jobs = Math.max(1, Number(process.env.LEAF1411_REGRESSION_JOBS ?? "3") || 3);
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
// Sources: the pre-fix class lists and the fix
// ---------------------------------------------------------------------------------------------

/** The literal className of the JSX element whose opening tag starts with `opening`. */
function classNameOf(source, opening) {
  const at = source.indexOf(opening);
  if (at === -1) return undefined;
  const m = /className="([^"]*)"/.exec(source.slice(at, at + 600));
  return m?.[1];
}

/** Reads the pre-fix shell from git (fetching the commit once in a shallow clone). */
function preFixSource() {
  const show = () => run("git", ["show", `${PRE_FIX_COMMIT}:${SHELL}`], { cwd: ROOT });
  let r = show();
  if (r.code !== 0) {
    withLock("git-fetch", () =>
      run("git", ["fetch", "--quiet", "--depth=1", "origin", PRE_FIX_COMMIT], {
        cwd: ROOT,
        timeoutMs: 120_000,
      }),
    );
    r = show();
  }
  return r;
}

/** Source checks; returns the pre-fix class lists for the negative control, or undefined. */
function sources(report) {
  const pre = preFixSource();
  if (
    !report.check(
      pre.code === 0,
      `the pre-fix ${SHELL} is read from git at ${PRE_FIX_COMMIT.slice(0, 7)}`,
      tail(pre),
    )
  )
    return undefined;
  const main = classNameOf(pre.stdout, "<main");
  const shell = classNameOf(pre.stdout, '<div className="flex min-h-dvh');
  report.check(
    main !== undefined &&
      main.split(/\s+/).includes(PRE_FIX_PADDING) &&
      !pre.stdout.includes("174px"),
    `pre-fix main carries ${PRE_FIX_PADDING} for every role: "${String(main)}"`,
  );
  report.check(
    shell !== undefined && shell.includes("lg:[&:has(>aside>button)>main]:pb-[100px]"),
    `pre-fix outer div class read (W-10b desktop rule): "${String(shell)}"`,
  );
  const now = readFileSync(join(ROOT, SHELL), "utf8");
  report.check(
    now.includes(`assistant ? "${FIX_PADDING}" : "${PRE_FIX_PADDING}"`),
    `current main pads ${FIX_PADDING} while the button shows and keeps ${PRE_FIX_PADDING} otherwise`,
  );
  report.check(
    classNameOf(now, '<div className="flex min-h-dvh') === shell,
    "the outer div (W-10b desktop rule) is unchanged",
  );
  if (main === undefined || shell === undefined) return undefined;
  return { main, shell };
}

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

/** Build, database, worker and the spec's tests for one tag; checks every title passed. */
async function e2e(report, gate, preFix) {
  if (!buildPackages(report)) return;
  if (!buildWeb(report, gate)) return;
  const server = await acquireServer(report);
  const outDir = mkdtempSync(join(tmpdir(), `leaf-1.4.11-${gate.toLowerCase()}-`));
  const processes = [];
  let db;
  try {
    db = await gateDatabase(report, server, gate);
    const worker = background(process.execPath, ["dist/src/main.js"], {
      cwd: WORKER,
      env: { DATABASE_URL: db.url, ANTHROPIC_API_KEY: "", NODE_OPTIONS: "", LOG_LEVEL: "warn" },
    });
    processes.push(worker);
    const port = await freePort();
    const reportFile = join(outDir, "report.json");
    const started = Date.now();
    const r = await runAsync(
      process.execPath,
      [
        join(WEB, "node_modules/@playwright/test/cli.js"),
        "test",
        SPEC,
        "--grep",
        `@${gate}`,
        "--reporter=list,json",
      ],
      {
        cwd: WEB,
        env: {
          PLAYWRIGHT_SKIP_BUILD: "1",
          MISE_NEXT_DIST_DIR: distDirFor(gate),
          PLAYWRIGHT_PORT: String(port),
          APP_URL: `http://localhost:${String(port)}`,
          DATABASE_URL: db.url,
          AUTH_SECRET: randomBytes(32).toString("base64url"),
          ANTHROPIC_API_KEY: "",
          NODE_OPTIONS: "",
          PREFIX_MAIN_CLASS: preFix?.main ?? "",
          PREFIX_SHELL_CLASS: preFix?.shell ?? "",
          SCREENSHOT_DIR: process.env.SCREENSHOT_DIR ?? "",
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
          PLAYWRIGHT_OUTPUT_DIR: join(outDir, "artefacts"),
          NEXT_TELEMETRY_DISABLED: "1",
          ...(chromium() === undefined ? {} : { PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromium() }),
        },
      },
    );
    const tests = playwrightResults(reportFile);
    const failed = [...tests].filter(([, s]) => s !== "passed");
    // The measurements the spec prints (button and control boxes, overlap, hit) go to the log.
    console.log(
      r.stdout
        .split("\n")
        .filter((l) => /px, (after|pre-fix):/.test(l))
        .join("\n"),
    );
    if (r.code !== 0 || failed.length > 0) {
      console.log(
        `----- ${SPEC}: full output (exit ${String(r.code)}) -----\n${r.stdout}\n${r.stderr}`,
      );
      for (const f of findFiles(outDir, "error-context.md"))
        console.log(`----- ${f} -----\n${readFileSync(f, "utf8")}`);
      console.log(`----- worker output (tail) -----\n${worker.output()}`);
    }
    report.check(
      r.code === 0,
      `${SPEC} --grep @${gate} exits 0 (${String(Math.round((Date.now() - started) / 1000))} s)`,
      tail(r, 40),
    );
    for (const title of E2E[gate])
      report.check(
        tests.get(title) === "passed",
        title,
        `status: ${String(tests.get(title) ?? "missing")}`,
      );
    const unexpected = [...tests.keys()].filter((t) => !E2E[gate].includes(t));
    report.check(
      unexpected.length === 0,
      "no test outside the required list",
      unexpected.join("\n"),
    );
    report.check(worker.alive(), "the worker ran for the whole gate", worker.output());
  } finally {
    for (const p of processes.reverse()) await p.stop();
    if (db !== undefined) await db.drop().catch(() => undefined);
    server.stop();
    rmSync(outDir, { recursive: true, force: true });
  }
}

async function gateG1(report) {
  const preFix = sources(report);
  if (preFix === undefined) return;
  await e2e(report, "G1", preFix);
}

async function gateG2(report) {
  await e2e(report, "G2", undefined);
  await regressions(report, REGRESSIONS);
}

const GATES = { G1: gateG1, G2: gateG2 };
async function main() {
  const i = process.argv.indexOf("--gate");
  const gate = i === -1 ? undefined : process.argv[i + 1];
  if (gate === undefined || GATES[gate] === undefined) {
    console.error("usage: node scripts/verify/leaf-1.4.11.mjs --gate G1|G2");
    return 2;
  }
  // The full output also goes to a log file (gate-check keeps only a bounded transcript; W-1).
  const logFile = join(tmpdir(), `leaf-1.4.11-${gate.toLowerCase()}-last.log`);
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
