// Verify script for leaf 1.4.9 (Chat and setup follow-ups: W-9, W-10; BLD-8 R-61, R-63).
// Usage: node scripts/verify/leaf-1.4.9.mjs --gate G1|G2|G3|G4
// Prints "VERIFY leaf-1.4.9 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise.
//
// G1  Done automatically (W-9a): the event-builder unit tests (packages/ai digest-*.test.ts), the
//     card-schema tests (a stored digest without `automatic` still parses), and the integration
//     test through the built worker (reviews → learning change sets → `POST /insights/run` → the
//     digest lists exactly the portion moves since the previous digest). Negative control (in the
//     integration test): the listing check fails when a user, accepted-proposal or
//     preference-only change set in the same window is listed, or the move is missing.
// G2  Plan ready in Updates (W-9b): the same unit tests (plan-ready row, unchanged agent-started
//     completion), the card-schema tests (a job card without `ready` still parses), and the
//     integration test through the built worker (a UI plan job reaches every admin; an
//     agent-started one only its conversation). Negative control (in the integration test): the
//     routing check fails on an agent-started job that also reached Updates, and on a plan job
//     that reached no admin.
// G3  Names in the deterministic parse (W-10a): the core onboarding tests (parse-names: F1 lines
//     plus 12 phrasings, and `inferSetup` on the architect's line). Negative control: the pre-fix
//     `parse-people.ts` (commit a780706) loaded in place of the current one fails the same tests.
//     Regressions: 1.4.3 G1–G5 and 1.4.7 G1, G3 (their own verify scripts).
// G4  Playwright at 390 and 1280 px with axe-core (apps/web/test/chat/updates.e2e.ts, own config;
//     ADR-1): the Updates conversation (automatic block with Undo, plan-ready row, an older
//     digest), the floating Assistant button (390 shown, 1280 hidden), the panel opener covering
//     no content at 1280 px on Planning balance, Plan and Chat (R-63). Negative controls in the
//     spec. Regressions: 1.4.2 G1–G2, 1.3.5 G1–G3 and 1.4.5 G1–G3 (their own verify scripts).
//
// Isolation (gate-check runs gates in parallel): each gate has its own database (random name, on
// DATABASE_URL's server, else localhost:5432, else a throwaway PostgreSQL 16 cluster), Next.js
// build directory (.next/verify-1.4.9-<gate>), port, worker and temp directories. Package builds
// run under a lock; `next build` runs with DATABASE_URL cleared (R-50). Regression gates run as
// child processes, LEAF149_REGRESSION_JOBS at a time (default 2); a failure prints their output.
// 1.4.2's regression gates always run with DATABASE_URL cleared (R-50). G4 captures for the
// architect (G5) go to $SCREENSHOT_DIR when set.
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
const AI = join(ROOT, "packages/ai");
const PACKAGE_NAMES = ["core", "db", "ai", "graph", "api-contract", "ui-tokens"];
const PACKAGES = PACKAGE_NAMES.map((p) => join(ROOT, "packages", p));
const LABEL = "leaf-1.4.9";
/** The base commit of this leaf: `parse-people.ts` before W-10a. */
const PRE_FIX_COMMIT = "a780706";

// Test titles each gate requires (vitest `it` titles and Playwright test titles).
const UNIT_EVENTS = [
  "names the member, the role and the change",
  "groups roles that moved together, and says larger",
  "falls back to the summary when no move can be read",
  "adds the automatic list and mentions it",
  "without automatic changes the card is as before (no field)",
  "a digest with only automatic changes is news",
];
const UNIT_PLAN = [
  "builds the ChatPhoneDigest row",
  "several days, meals off target, no targeted plates",
  "with a plan: one job_progress card with `ready`, no text",
  "without a plan: unchanged (the agent-started completion)",
];
const CARDS_DIGEST = [
  "a stored digest without the field still parses, with no automatic changes",
  "the field parses",
  "a malformed entry is reported",
];
const CARDS_JOB = [
  "a stored job card without the field still parses",
  "a malformed one is reported",
];
const INT_DIGEST = [
  "G1 set-up: a too-much review for Zayd, a preference-only review, a user and an accepted-proposal portion change",
  "G1 the first digest lists the portion move, with its title, and none of the others",
  "G1 Undo is the change-set undo, and the next digest lists only what came after the previous one",
  "G1 negative control: the listing check fails on the user, accepted-proposal and preference-only change sets, and on a missing move",
];
const INT_PLAN = [
  "G2 a plan the admin generated from the plan screen is announced to every admin",
  "G2 a plan an agent turn started posts only into that conversation, as before",
  "G2 a recipe draft asked for a named day and slot carries them for the card's Use for link (R-66)",
  "G2 negative control: the routing check fails when an agent-started job also reaches Updates, or a plan job reaches no admin",
];
const PHRASINGS = 12;
const PARSE_NAMES = [
  'F1 as onboarding answer 1 keeps its names ("Child C1" is a name)',
  "the mockup's line",
  "F1 written with relation words",
  ...Array.from({ length: PHRASINGS }, (_, i) => `phrasing ${String(i + 1)}: `),
  "a bare singular relation word stays a name when nothing else is given",
  "the architect's line gives five plain names",
  "gives the viewer, Sara, Layla, Adam and Zayd with their ages",
];
const E2E = [
  "@G4 set-up: the mockup's family, a too-much rating for Zayd, the insights run and Monday's plan",
  "@G4 the Updates conversation at 390 px: Done automatically with Undo, the plan-ready row, an older digest",
  "@G4 the Updates conversation at 1280 px: Done automatically with Undo, the plan-ready row, an older digest",
  "@G4 Undo at 390 px undoes the learning change set through the change log",
  "@G4 the floating Assistant button shows at 390 px and is hidden at 1280 px",
  "@G4 at 1280 px the side panel's opener covers no content on Planning balance, Plan and Chat",
];
const E2E_NEGATIVE = [
  "@G4 negative control: axe reports a known-bad page",
  "@G4 negative control: the overlap check finds content under the opener when its space is not reserved",
  "@G4 negative control: the hidden check fails when the floating button is forced visible at 1280 px",
];
const REGRESSIONS = {
  G3: [
    ["leaf-1.4.3", "G1"],
    ["leaf-1.4.3", "G2"],
    ["leaf-1.4.3", "G3"],
    ["leaf-1.4.3", "G4"],
    ["leaf-1.4.3", "G5"],
    ["leaf-1.4.7", "G1"],
    ["leaf-1.4.7", "G3"],
  ],
  G4: [
    ["leaf-1.4.2", "G1"],
    ["leaf-1.4.2", "G2"],
    ["leaf-1.3.5", "G1"],
    ["leaf-1.3.5", "G2"],
    ["leaf-1.3.5", "G3"],
    ["leaf-1.4.5", "G1"],
    ["leaf-1.4.5", "G2"],
    ["leaf-1.4.5", "G3"],
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

const distDirFor = (gate) => `.next/verify-1.4.9-${gate.toLowerCase()}`;

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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.9-pg-"));
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
  const name = `leaf149_${gate.toLowerCase()}_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.9-vitest-"));
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
  const jobs = Math.max(1, Number(process.env.LEAF149_REGRESSION_JOBS ?? "2") || 2);
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

function unitEvents(report, titles) {
  vitest(
    report,
    "packages/ai digest-*.test.ts",
    AI,
    ["--dir", "test", "test/agent/digest-"],
    titles,
  );
}

function unitCards(report, titles) {
  vitest(
    report,
    "apps/web test/chat/digest-cards.test.ts",
    WEB,
    ["--dir", "test", "test/chat/digest-cards"],
    titles,
  );
}

async function integration(report, file, titles) {
  const server = await acquireServer(report);
  try {
    vitest(report, `apps/web ${file} (built worker)`, WEB, ["--dir", "test", file], titles, {
      DATABASE_URL: server.url,
    });
  } finally {
    server.stop();
  }
}

async function gateG1(report) {
  if (!buildPackages(report)) return;
  unitEvents(report, UNIT_EVENTS);
  unitCards(report, CARDS_DIGEST);
  await integration(report, "test/api/chat-events-digest.int.test.ts", INT_DIGEST);
}

async function gateG2(report) {
  if (!buildPackages(report)) return;
  unitEvents(report, UNIT_PLAN);
  unitCards(report, CARDS_JOB);
  await integration(report, "test/api/chat-events-plan.int.test.ts", INT_PLAN);
}

async function gateG3(report) {
  if (!buildPackages(report)) return;
  const current = vitest(
    report,
    "packages/core onboarding tests",
    CORE,
    ["--dir", "test", "test/onboarding"],
    PARSE_NAMES,
  );
  const phrasings = current.tests.filter((t) => /^phrasing \d+: /.test(t.title));
  report.check(
    phrasings.length >= 8 && phrasings.every((t) => t.status === "passed"),
    `measured: ${String(phrasings.length)} phrasings beside the F1 lines pass (at least 8)`,
  );
  // Negative control: the pre-fix parser through the same assertions.
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.9-prefix-"));
  try {
    const old = run(
      "git",
      ["show", `${PRE_FIX_COMMIT}:packages/core/src/onboarding/parse-people.ts`],
      {
        cwd: ROOT,
      },
    );
    if (
      report.check(
        old.code === 0 && old.stdout.includes("export function parsePeople"),
        `the pre-fix parse-people.ts is read from ${PRE_FIX_COMMIT}`,
        tail(old),
      )
    ) {
      const file = join(dir, "parse-people.ts");
      writeFileSync(file, old.stdout);
      const pre = vitestRun(CORE, ["--dir", "test", "test/onboarding/parse-names"], {
        PARSE_PEOPLE_MODULE: file,
      });
      const byTitle = (prefix) => pre.tests.filter((t) => matches(t.title, prefix));
      const failedPhrasings = pre.tests.filter(
        (t) => /^phrasing \d+: /.test(t.title) && t.status === "failed",
      );
      const architectLine = byTitle("the architect's line gives five plain names")[0];
      report.check(
        pre.code !== 0 &&
          architectLine?.status === "failed" &&
          /my wife Sara/.test(architectLine.failure) &&
          byTitle("gives the viewer, Sara, Layla, Adam and Zayd with their ages")[0]?.status ===
            "failed" &&
          failedPhrasings.length >= 8,
        `negative control: the pre-fix parse fails (it yields "my wife Sara"; ${String(failedPhrasings.length)} phrasings fail)`,
        pre.output,
      );
      report.check(
        byTitle('F1 as onboarding answer 1 keeps its names ("Child C1" is a name)')[0]?.status ===
          "passed",
        "negative control is sound: the pre-fix parse still reads the plain F1 line (the module was loaded)",
        pre.output,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await regressions(report, REGRESSIONS.G3);
}

async function gateG4(report) {
  if (!buildPackages(report)) return;
  if (!buildWeb(report, "G4")) return;
  const server = await acquireServer(report);
  const outDir = mkdtempSync(join(tmpdir(), "leaf-1.4.9-g4-"));
  const processes = [];
  let db;
  try {
    db = await gateDatabase(report, server, "G4");
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
        "test/chat/playwright.config.ts",
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
        `----- updates.e2e.ts: full output (exit ${String(e2e.code)}) -----\n${e2e.stdout}\n${e2e.stderr}`,
      );
      for (const f of findFiles(outDir, "error-context.md"))
        console.log(`----- ${f} -----\n${readFileSync(f, "utf8")}`);
      console.log(`----- worker output (tail) -----\n${worker.output()}`);
    }
    report.check(e2e.code === 0, "apps/web/test/chat/updates.e2e.ts exits 0", tail(e2e, 40));
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
    const expectedShots = [
      "updates-390-light",
      "updates-390-dark",
      "updates-1280-light",
      "updates-1280-dark",
      "planning-balance-1280",
      "plan-1280",
    ];
    const missing = expectedShots.filter((s) => !existsSync(join(shots, `${s}.png`)));
    report.check(
      missing.length === 0,
      `captures for G5 written (${expectedShots.length})`,
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
    console.error("usage: node scripts/verify/leaf-1.4.9.mjs --gate G1|G2|G3|G4");
    return 2;
  }
  // The full output also goes to a log file (gate-check keeps only a bounded transcript; W-1).
  const logFile = join(tmpdir(), `leaf-1.4.9-${gate.toLowerCase()}-last.log`);
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
