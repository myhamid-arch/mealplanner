// Verify script for leaf 1.4.5 (Reviews, Insights, Chat UI).
// Usage: node scripts/verify/leaf-1.4.5.mjs --gate G1|G2|G3
// Prints "VERIFY leaf-1.4.5 <gate> PASSED" only when every assertion holds, including the gate's
// negative controls; exits non-zero otherwise (leaf-1.4.5 ADR-1).
//
// Each gate, independently of the others (gate-check runs them in parallel):
// 1. builds the workspace packages and the worker when stale (under a lock, as 1.4.1/1.4.6 do);
// 2. creates its own database (leaf145_<gate>_<hex>) on PostgreSQL 16 and migrates and seeds it
//    (catalogue and seed dishes, R-17): DATABASE_URL's server when set, else localhost:5432 when it
//    answers, else a throwaway cluster from the local PostgreSQL 16 binaries (stopped on exit);
// 3. builds the web app into its own directory (.next/verify-1.4.5-<gate>) with DATABASE_URL
//    cleared (R-50);
// 4. starts the worker (apps/worker) on the gate's database, so plan generation, the insights run
//    and its digest post are the real ones (the worker has no model: synthesis is off, the
//    deterministic rules run);
// 5. runs apps/web/e2e/chat.spec.ts with --grep @<gate>; Playwright starts `next start` on a free
//    port with NODE_OPTIONS=--import apps/web/e2e/chat/agent-stub.mjs, the scripted model put in
//    the slot the chat route reads (no app code changes; without it the route answers 503). G3 also
//    starts the same build without the stub on another port (the 503 test). Every named test,
//    negative controls included, must be present and passing (Playwright's JSON report);
// 6. re-checks outcomes in the gate's database with its own queries, each also run on a known-bad
//    record that must fail (G1, G3); G2 runs 1.4.2's shell e2e (@G2) against its own server without
//    a database (BLD-8 W-1), printing the full output on any failure; G3 runs the chat unit tests.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_DIR = join(ROOT, "apps/web");
const WORKER_DIR = join(ROOT, "apps/worker");
const SPEC = "e2e/chat.spec.ts";
const STUB = join(WEB_DIR, "e2e/chat/agent-stub.mjs");
const DEFAULT_URLS = [
  "postgres://postgres:postgres@localhost:5432/postgres",
  "postgres://postgres@localhost:5432/postgres",
];
const PACKAGES = ["core", "db", "ai", "graph", "api-contract", "ui-tokens"];

const G1_TESTS = [
  "@G1 set-up: a household of four with a member login and today's plan",
  "@G1 quick rating at 390 px: Layla rates the meal with stars and one-tap tags",
  "@G1 detailed review at 1280 px: Sara reviews for Omar and for Zayd, part by part",
  "@G1 the proposals appear in the chat at 390 px; accept one, then undo it",
  "@G1 Insights at 1280 px: the other proposal shows what changes and is rejected with a reason",
];
const G2_TESTS = [
  "@G2 set-up: reviews, proposals, a conversation with cards and a household to set up",
  "@G2 every screen at 390 px, light and dark",
  "@G2 every screen at 1280 px, light and dark",
];
const G2_NEGATIVE = [
  "@G2 negative control: the scan reports an unnamed button, low-contrast text and a page wider than the screen",
];
const G3_TESTS = [
  "@G3 set-up: a household with today's plan",
  "@G3 live and replayed: a stubbed turn draws proposal, applied_change, plan_day and job_progress cards",
  "@G3 recorded: recipe (Save, Discard), insight_digest, failed job_progress, macro_table and iteration_limit",
  "@G3 problem states: 409 while another reply runs, 429 over the hourly limit, 503 without a model",
];
const G3_NEGATIVE = [
  "@G3 negative control: the card checks fail on the malformed proposal and on another card type",
];

const GATES = {
  G1: {
    title:
      "Playwright: quick rating and detailed review, proposal appears, accept, undo (stubbed model)",
    required: G1_TESTS,
    negative: [],
  },
  G2: {
    title: "axe-core: no serious or critical violations on these screens",
    required: G2_TESTS,
    negative: G2_NEGATIVE,
  },
  G3: {
    title: "chat renders every AGT-7 card type from recorded tool results",
    required: G3_TESTS,
    negative: G3_NEGATIVE,
  },
};

/** Every AGT-7 card type (packages/ai/src/agent/cards.ts `CARD_TYPES`). */
const CARD_TYPES = [
  "proposal",
  "applied_change",
  "plan_day",
  "recipe",
  "macro_table",
  "job_progress",
  "insight_digest",
  "iteration_limit",
];

// ---------------------------------------------------------------------------------------------
// Processes, ports, build, PostgreSQL 16 (as leaf 1.4.6's script)
// ---------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function newestMtime(dir) {
  let newest = 0;
  if (!existsSync(dir)) return newest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(path));
    else newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

function oldestMtime(dir) {
  let oldest = Infinity;
  if (!existsSync(dir)) return 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) oldest = Math.min(oldest, oldestMtime(path));
    else oldest = Math.min(oldest, statSync(path).mtimeMs);
  }
  return oldest === Infinity ? 0 : oldest;
}

function stale(pkgDir) {
  const inputs = Math.max(
    newestMtime(join(pkgDir, "src")),
    statSync(join(pkgDir, "package.json")).mtimeMs,
    statSync(join(pkgDir, "tsconfig.json")).mtimeMs,
  );
  const built = oldestMtime(join(pkgDir, "dist"));
  return built === 0 || inputs > built;
}

/** Builds the workspace packages the web app imports, only when stale, one gate at a time. */
async function buildPackagesLocked() {
  const lock = join(tmpdir(), "mealplanner-leaf-1.4.5-build.lock");
  const deadline = Date.now() + 900_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (Date.now() > deadline)
        return { code: 1, stdout: "", stderr: `build lock ${lock} held for 15 minutes` };
      await sleep(250);
    }
  }
  try {
    const dirs = [...PACKAGES.map((p) => join(ROOT, "packages", p)), join(ROOT, "apps/worker")];
    if (!dirs.some(stale)) return { code: 0, stdout: "packages up to date", stderr: "" };
    return run(
      "pnpm",
      [
        "exec",
        "turbo",
        "run",
        "build",
        ...PACKAGES.flatMap((p) => ["--filter", `@mealplanner/${p}`]),
        "--filter",
        "@mealplanner/worker",
      ],
      { cwd: ROOT, timeoutMs: 900_000 },
    );
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Runs a command and collects its output, without blocking the event loop (the SMTP stub). */
function runAsync(command, args, { cwd, env, timeoutMs = 1_800_000 }) {
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

function chromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16
// ---------------------------------------------------------------------------------------------

async function pgModule() {
  return (await import(pathToFileURL(join(WEB_DIR, "node_modules/pg/lib/index.js")).href)).default;
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

async function startCluster() {
  const bin = pgBinDir();
  if (bin === undefined)
    throw new Error(
      "no DATABASE_URL, nothing on localhost:5432, and no PostgreSQL 16 binaries (initdb) found",
    );
  const asRoot = process.getuid?.() === 0;
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.5-pg-"));
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
  for (const url of DEFAULT_URLS)
    if (await reachable(url)) return { url, source: "localhost:5432", stop: () => undefined };
  return { ...(await startCluster()), source: "throwaway cluster" };
}

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

// ---------------------------------------------------------------------------------------------
// Playwright
// ---------------------------------------------------------------------------------------------

/** Test durations in ms from the last report read, for the timing lines. */
const durations = new Map();

/** Flattens Playwright's JSON report into { title → status }. */
function results(reportFile) {
  const out = new Map();
  if (!existsSync(reportFile)) return out;
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests ?? []) {
        const last = t.results?.at(-1);
        out.set(spec.title, last?.status ?? "skipped");
        durations.set(spec.title, last?.duration ?? 0);
      }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of report.suites ?? []) walk(s);
  return out;
}

async function playwright({ spec, grep, env, outDir }) {
  const reportFile = join(
    outDir,
    `report-${grep.replace(/\W/g, "")}-${randomBytes(3).toString("hex")}.json`,
  );
  const result = await runAsync(
    process.execPath,
    [
      join(WEB_DIR, "node_modules/@playwright/test/cli.js"),
      "test",
      spec,
      "--grep",
      grep,
      "--reporter=list,json",
    ],
    {
      cwd: WEB_DIR,
      env: {
        ...env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        PLAYWRIGHT_OUTPUT_DIR: join(outDir, `artefacts-${spec.replace(/\W/g, "")}`),
        PLAYWRIGHT_SKIP_BUILD: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        ...(chromium() === undefined ? {} : { PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromium() }),
      },
    },
  );
  return { ...result, tests: results(reportFile) };
}

// ---------------------------------------------------------------------------------------------
// Background processes (the worker, the server without a model)
// ---------------------------------------------------------------------------------------------

/** Starts a long-running process; `stop()` ends it and its output is kept for failures. */
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

async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await globalThis.fetch(url);
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Database re-checks (each also run on a known-bad record)
// ---------------------------------------------------------------------------------------------

/** G1: a proposal accepted in the chat whose change set was then undone. */
async function checkAcceptedThenUndone(url, proposalId) {
  const [p] = await query(
    url,
    `SELECT p.status, p.change_set_id, cs.undone_at, cs.undone_by_change_set_id
       FROM proposal p LEFT JOIN change_set cs ON cs.id = p.change_set_id
      WHERE p.id = $1`,
    [proposalId],
  );
  return (
    p !== undefined &&
    p.status === "accepted" &&
    p.change_set_id !== null &&
    p.undone_at !== null &&
    p.undone_by_change_set_id !== null
  );
}

/** G1: a proposal rejected on Insights, with the reason typed there. */
async function checkRejectedWithReason(url, proposalId, note) {
  const [p] = await query(url, `SELECT status, decision_note FROM proposal WHERE id = $1`, [
    proposalId,
  ]);
  return p !== undefined && p.status === "rejected" && p.decision_note === note;
}

/** G3: the conversation's stored rows carry these card types (tool and event rows). */
async function storedCardTypes(url, conversationId) {
  const rows = await query(
    url,
    `SELECT content FROM chat_message WHERE conversation_id = $1 AND role IN ('tool', 'event')`,
    [conversationId],
  );
  const types = new Set();
  for (const r of rows)
    for (const card of Array.isArray(r.content?.cards) ? r.content.cards : [])
      if (typeof card?.type === "string") types.add(card.type);
  return types;
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

/** Every file named `name` under `dir`. */
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

/** The full output of a failed Playwright run, with each failure's page snapshot (BLD-8 W-1). */
function printFull(label, result, outDir) {
  console.log(`----- ${label}: full output (exit ${String(result.code)}) -----`);
  console.log(result.stdout);
  if (result.stderr.trim() !== "") console.log(result.stderr);
  for (const file of findFiles(outDir, "error-context.md"))
    console.log(`----- ${file} -----\n${readFileSync(file, "utf8")}`);
  console.log(`----- end of ${label} -----`);
}

async function main() {
  const gateArg = process.argv[process.argv.indexOf("--gate") + 1];
  const gate = GATES[gateArg] === undefined ? null : gateArg;
  if (gate === null) {
    console.error("usage: node scripts/verify/leaf-1.4.5.mjs --gate G1|G2|G3");
    return 2;
  }
  const report = new Report(`leaf-1.4.5 ${gate}`);
  console.log(`leaf-1.4.5 ${gate}: ${GATES[gate].title}`);
  const started = Date.now();

  const built = await buildPackagesLocked();
  if (!report.check(built.code === 0, "workspace packages and the worker are built", tail(built)))
    return report.finish();

  const server = await acquireServer();
  const [version] = await query(server.url, "SHOW server_version");
  report.check(
    /^16\./.test(version?.server_version ?? ""),
    `PostgreSQL 16 (${server.source}: ${String(version?.server_version)})`,
  );
  const dbName = `leaf145_${gate.toLowerCase()}_${randomBytes(4).toString("hex")}`;
  const outDir = mkdtempSync(join(tmpdir(), `leaf-1.4.5-${gate}-`));
  const worldFile = join(outDir, "world.json");
  /** @type {{ stop: () => Promise<void>, output: () => string, alive: () => boolean }[]} */
  const processes = [];
  try {
    await query(server.url, `CREATE DATABASE ${dbName}`);
    const dbUrl = withDatabase(server.url, dbName);
    const seed = await import(pathToFileURL(join(ROOT, "packages/db/dist/src/seed/index.js")).href);
    await seed.migrateAndSeed(dbUrl);
    const [counts] = await query(
      dbUrl,
      `SELECT (SELECT count(*) FROM ingredient)::int AS ingredients, (SELECT count(*) FROM dish)::int AS dishes`,
    );
    report.check(
      counts.ingredients > 0 && counts.dishes > 0,
      `database ${dbName} migrated and seeded (${String(counts.ingredients)} ingredients, ${String(counts.dishes)} dishes)`,
    );

    const distDir = `.next/verify-1.4.5-${gate}`;
    const build = await runAsync("pnpm", ["exec", "next", "build"], {
      cwd: WEB_DIR,
      // DATABASE_URL is cleared for the build: with it set, prerendering /offline builds the
      // runtime, which also needs AUTH_SECRET (R-50). No model stub in the build either.
      env: {
        MISE_NEXT_DIST_DIR: distDir,
        NEXT_TELEMETRY_DISABLED: "1",
        DATABASE_URL: "",
        NODE_OPTIONS: "",
      },
      timeoutMs: 1_200_000,
    });
    if (
      !report.check(
        build.code === 0,
        `the web app builds into apps/web/${distDir}`,
        tail(build, 60),
      )
    )
      return report.finish();

    const authSecret = randomBytes(32).toString("base64url");
    const worker = background(process.execPath, ["dist/src/main.js"], {
      cwd: WORKER_DIR,
      env: { DATABASE_URL: dbUrl, ANTHROPIC_API_KEY: "", NODE_OPTIONS: "" },
    });
    processes.push(worker);

    const port = await freePort();
    const env = {
      MISE_NEXT_DIST_DIR: distDir,
      PLAYWRIGHT_PORT: String(port),
      APP_URL: `http://localhost:${String(port)}`,
      DATABASE_URL: dbUrl,
      AUTH_SECRET: authSecret,
      ANTHROPIC_API_KEY: "",
      WORLD_FILE: worldFile,
      // The scripted model (ADR-1). It is inherited by the test runner as well, where it only
      // sets an unused global.
      NODE_OPTIONS: `--import ${pathToFileURL(STUB).href}`,
    };
    if (gate === "G3") {
      // The same build without the stub: the chat route has no model and answers 503.
      const bare = await freePort();
      const noModel = background("pnpm", ["exec", "next", "start", "--port", String(bare)], {
        cwd: WEB_DIR,
        env: {
          MISE_NEXT_DIST_DIR: distDir,
          DATABASE_URL: dbUrl,
          AUTH_SECRET: authSecret,
          APP_URL: `http://localhost:${String(bare)}`,
          ANTHROPIC_API_KEY: "",
          NODE_OPTIONS: "",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      });
      processes.push(noModel);
      report.check(
        await waitForHttp(`http://localhost:${String(bare)}/offline`),
        "the server without a model is up",
        noModel.output(),
      );
      env.PLAYWRIGHT_PORT_NO_MODEL = String(bare);
    }
    // BLD-8 W-1 (G2): 1.4.2's shell e2e runs at the same time, against its own server without a
    // database, from the same build.
    const shellRun =
      gate === "G2"
        ? freePort().then((shellPort) =>
            playwright({
              spec: "e2e/shell.spec.ts",
              grep: "@G2",
              env: {
                MISE_NEXT_DIST_DIR: distDir,
                PLAYWRIGHT_PORT: String(shellPort),
                DATABASE_URL: "",
                NODE_OPTIONS: "",
              },
              outDir,
            }),
          )
        : null;
    const e2e = await playwright({ spec: SPEC, grep: `@${gate}`, env, outDir });
    const failed = [...e2e.tests].filter(([, s]) => s !== "passed" && s !== "expected");
    if (e2e.code !== 0 || failed.length > 0) {
      printFull(`${SPEC} @${gate}`, e2e, outDir);
      console.log(`----- worker output (tail) -----\n${worker.output()}`);
    }
    report.check(e2e.code === 0, `${SPEC} @${gate} exits 0`, tail(e2e, 40));
    for (const [title, ms] of durations)
      console.log(`time - ${(ms / 1000).toFixed(1)} s  ${title}`);
    for (const title of [...GATES[gate].required, ...GATES[gate].negative])
      report.check(
        e2e.tests.get(title) === "passed",
        title,
        `status: ${String(e2e.tests.get(title) ?? "missing")}`,
      );
    const known = new Set([...GATES[gate].required, ...GATES[gate].negative]);
    const unexpected = [...e2e.tests.keys()].filter((t) => !known.has(t));
    report.check(
      unexpected.length === 0,
      `no @${gate} test outside the required list`,
      unexpected.join("\n"),
    );
    report.check(worker.alive(), "the worker ran for the whole gate", worker.output());

    const world = existsSync(worldFile) ? JSON.parse(readFileSync(worldFile, "utf8")) : {};
    if (gate === "G1") {
      const accepted = world.g1Accepted;
      const rejected = world.g1Rejected;
      report.check(
        typeof accepted === "string" && (await checkAcceptedThenUndone(dbUrl, accepted)),
        "database: the proposal accepted in the chat is accepted, and its change set is undone",
      );
      report.check(
        typeof rejected === "string" && !(await checkAcceptedThenUndone(dbUrl, rejected)),
        "negative control: the same check rejects the proposal that was rejected",
      );
      report.check(
        typeof rejected === "string" &&
          (await checkRejectedWithReason(dbUrl, rejected, "we have it often enough")),
        "database: the other proposal is rejected with the reason typed on Insights",
      );
      report.check(
        typeof accepted === "string" &&
          !(await checkRejectedWithReason(dbUrl, accepted, "we have it often enough")),
        "negative control: the same check rejects the accepted proposal",
      );
      const [origin] = await query(
        dbUrl,
        `SELECT count(*)::int AS n FROM proposal WHERE id = ANY($1) AND origin = 'rule'`,
        [[accepted, rejected].filter((x) => typeof x === "string")],
      );
      report.check(
        origin?.n === 2,
        "database: both proposals came from the insights engine's rules (FBK-6), not from the page",
      );
    }
    if (gate === "G3") {
      const g3 = world.g3;
      const [live] =
        g3 === undefined
          ? []
          : await query(
              dbUrl,
              `SELECT id FROM conversation WHERE household_id = $1 AND title = $2`,
              [g3.householdId, "Show me every card, please"],
            );
      const liveTypes = live === undefined ? new Set() : await storedCardTypes(dbUrl, live.id);
      const recordedTypes =
        typeof world.g3Recorded === "string"
          ? await storedCardTypes(dbUrl, world.g3Recorded)
          : new Set();
      const all = new Set([...liveTypes, ...recordedTypes]);
      const missing = CARD_TYPES.filter((t) => !all.has(t));
      report.check(
        missing.length === 0,
        `database: the drawn conversations store every AGT-7 card type (${CARD_TYPES.length})`,
        `missing: ${missing.join(", ")}`,
      );
      report.check(
        ["proposal", "applied_change", "plan_day", "job_progress"].every((t) => liveTypes.has(t)),
        "database: the live turn stored proposal, applied_change, plan_day and job_progress cards from the real tools",
        [...liveTypes].join(", "),
      );
      report.check(
        !["proposal", "applied_change", "plan_day"].every((t) => recordedTypes.has(t)),
        "negative control: the same check fails on the recorded conversation",
      );
      const unit = await runAsync(
        process.execPath,
        [join(ROOT, "node_modules/vitest/vitest.mjs"), "run", "--dir", "test", "test/chat"],
        { cwd: WEB_DIR, env: { NODE_OPTIONS: "" }, timeoutMs: 600_000 },
      );
      const passedUnit = /Tests\s+(\d+) passed/.exec(unit.stdout)?.[1];
      report.check(
        unit.code === 0 && passedUnit !== undefined && !/failed/.test(unit.stdout),
        `apps/web/test/chat unit tests pass (${String(passedUnit ?? 0)} tests: Markdown, turns, diffs, cards, reviews, set-up)`,
        tail(unit, 40),
      );
    }
    if (gate === "G2") {
      const shell = await shellRun;
      if (shell === null) throw new Error("the shell e2e did not start");
      const shellFailed = [...shell.tests].filter(([, s]) => s !== "passed");
      if (shell.code !== 0 || shellFailed.length > 0)
        printFull("e2e/shell.spec.ts @G2 (W-1)", shell, outDir);
      report.check(
        shell.code === 0 && shell.tests.size > 0 && shellFailed.length === 0,
        `W-1: apps/web/e2e/shell.spec.ts @G2 passes (${String(shell.tests.size)} tests)`,
      );
    }
  } finally {
    for (const p of processes.reverse()) await p.stop();
    try {
      await query(server.url, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    } catch {
      // The server may already be gone; the throwaway cluster is removed below.
    }
    server.stop();
    rmSync(outDir, { recursive: true, force: true });
  }
  console.log(`time - ${((Date.now() - started) / 1000).toFixed(0)} s  gate ${gate} in total`);
  return report.finish();
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    console.log("VERIFY leaf-1.4.5 FAILED (error)");
    process.exit(1);
  },
);
