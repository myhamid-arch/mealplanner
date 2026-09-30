// Verify script for leaf 1.4.12 (Contract gaps in the planning screens; BLD-8 R-82, R-84).
// Usage: node scripts/verify/leaf-1.4.12.mjs --gate G1|G2|G3
// Prints "VERIFY leaf-1.4.12 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise. The harness (builds, database, worker, runners) is
// 1.4.8's, with this leaf's names (docs/decisions/leaf-1.4.12-adr-1.md).
//
// G1  PLN-3: Playwright @1.4.12-G1 (apps/web/e2e/contract-gaps.spec.ts) at 390 and 1280 px: one
//     tap on "Replaces lunch on the days it's on" for Packed school lunch; the stored schedule has
//     the child off lunch on exactly the packed weekdays; the week the real worker plans next has
//     no lunch plate and a packed plate for the child on those days and a lunch plate on the
//     others. Negative control (same check functions): a twin household without the tap keeps its
//     lunch plates and fails both checks.
// G2  R2-DL-6: Playwright @1.4.12-G2 at 390 and 1280 px, with the recorded agent turn
//     (apps/web/e2e/contract-gaps/agent-turn.mjs) preloaded into `next start`: every section with
//     the detail-level control on a member's page offers "Tell the assistant"; the chat opens with
//     a request naming the member and the section; the turn applies the section's op at the level
//     shown; the API agrees and the section, still at that level, shows it. Negative control: the
//     same check on the page with one section's link removed fails and names the section.
//     Before Playwright, the script checks the preload itself: a direct call of its model slot
//     answers a section request with get_household and then apply_change, and an unrelated
//     request with neither.
// G3  No regression: leaf-1.4.3 G1 and G3 pass, run as its own script runs them.
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
import { lockIsStale } from "./lib/lock.mjs";
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

const distDirFor = (gate) => `.next/verify-1.4.12-${gate.toLowerCase()}`;

/** `next build` into the gate's own directory; builds of the web app run one at a time. */
function buildWeb(report, gate) {
  const build = withLock("web-next-build", () =>
    run("pnpm", ["exec", "next", "build"], {
      cwd: WEB,
      // Built without a database: the static /offline page must not need a runtime (as in 1.4.2).
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        MISE_NEXT_DIST_DIR: distDirFor(gate),
        DATABASE_URL: "",
        NODE_OPTIONS: "",
      },
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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.12-pg-"));
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
  const name = `leaf1412_${gate.toLowerCase()}_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
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
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      ANTHROPIC_API_KEY: "",
      NODE_OPTIONS: "",
      LOG_LEVEL: "warn",
    },
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
 * Runs `contract-gaps.spec.ts --grep @<tag>` against the gate's database and build (`gate`) and checks
 * every title.
 */
async function playwright(report, tag, gate, db, expected, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), `leaf-1.4.12-${gate.toLowerCase()}-`));
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
    // No live model anywhere in this leaf's runs (rule 7); G2 passes the recorded turn instead.
    ANTHROPIC_API_KEY: "",
    NODE_OPTIONS: "",
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
      ["exec", "playwright", "test", SPEC, "--grep", `@${tag}`, "--reporter=json"],
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

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

const SPEC = "e2e/contract-gaps.spec.ts";
const TURN = join(WEB, "e2e/contract-gaps/agent-turn.mjs");
const V = ["390", "1280"];

/** One e2e gate: builds, its own database and worker, then the tagged Playwright tests. */
async function e2eGate(report, gate, expected, extraEnv = {}) {
  if (!buildPackages(report) || !buildWeb(report, gate)) return;
  const db = await gateDatabase(report, gate);
  const logDir = mkdtempSync(join(tmpdir(), `leaf-1.4.12-${gate.toLowerCase()}-worker-`));
  const w = startWorker(db.url, join(logDir, "worker.log"));
  try {
    await playwright(report, `1.4.12-${gate}`, gate, db, expected, extraEnv);
  } finally {
    await w.stop();
    if (report.failures.length > 0) console.log(`       worker output:\n${w.output()}`);
    rmSync(logDir, { recursive: true, force: true });
    await db.drop();
  }
}

async function gateG1() {
  const report = new Report("leaf-1.4.12 G1");
  console.log(
    "# G1: PLN-3 at 390 and 1280 px: one tap makes the packed school lunch replace lunch; the stored schedule and the next generated plan follow; without the tap the lunch plate stays",
  );
  await e2eGate(report, "G1", [
    ...V.map((v) => `@1.4.12-G1 one tap: the packed school lunch replaces lunch at ${v} px`),
    "@1.4.12-G1 negative control: without the tap the lunch plate stays",
  ]);
  return report.finish();
}

/**
 * The preload on its own, in a child process (it resolves @mealplanner/core from apps/web as
 * `next start` does): a section request gets get_household, then apply_change with that
 * section's op for the named member; a request that is not a section's gets neither.
 */
function checkTurn(report) {
  const probe = `
    const model = globalThis[Symbol.for("mealplanner.web.agentModel")];
    const household = {
      members: [{ id: "m-omar", displayName: "Omar" }, { id: "m-zayd", displayName: "Zayd" }],
      slots: [
        { id: "s-b", key: "breakfast", active: true, isTrainingSlot: false },
        { id: "s-l", key: "lunch", active: true, isTrainingSlot: false },
        { id: "s-d", key: "dinner", active: true, isTrainingSlot: false },
        { id: "s-s", key: "snack", active: true, isTrainingSlot: false },
        { id: "s-p", key: "post_workout", active: true, isTrainingSlot: true },
        { id: "s-x", key: "packed_school_lunch", active: false, isTrainingSlot: false },
      ],
      schedules: { slotSchedules: [] },
    };
    const user = (t) => ({ role: "user", content: [{ type: "text", text: t }] });
    const turn = async (said) => {
      const first = await model.stream({ messages: [user(said)] }, () => {});
      const calls = first.content.filter((b) => b.type === "tool_use");
      if (calls.length === 0) return { first: first.stop_reason, calls: [] };
      const second = await model.stream({ messages: [user(said),
        { role: "assistant", content: first.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: calls[0].id, content: JSON.stringify(household) }] }] }, () => {});
      return { first: first.stop_reason, calls: [...calls, ...second.content.filter((b) => b.type === "tool_use")] };
    };
    const out = {};
    for (const [k, said] of Object.entries({
      targets: "Change Omar's daily targets: 2250 kcal",
      meals: "Change how Omar's day is split across meals: lunch 40 %",
      tastes: "Change Omar's tastes: more Levantine food",
      other: "Omar likes Levantine food",
    })) out[k] = await turn(said);
    console.log(JSON.stringify(out));
  `;
  const r = run(
    process.execPath,
    ["--import", pathToFileURL(TURN).href, "--input-type=module", "-e", probe],
    {
      cwd: WEB,
      env: { NODE_OPTIONS: "" },
      timeoutMs: 60_000,
    },
  );
  let out = null;
  try {
    out = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "null");
  } catch {
    out = null;
  }
  report.check(r.code === 0 && out !== null, "the recorded turn loads and answers", tail(r));
  if (out === null) return;
  const recorded = JSON.parse(readFileSync(join(WEB, "e2e/contract-gaps/recorded.json"), "utf8"));
  const names = (k) => out[k].calls.map((c) => c.name).join(",");
  const op = (k) => out[k].calls.find((c) => c.name === "apply_change")?.input?.ops?.[0];
  for (const k of ["targets", "meals", "tastes"])
    report.check(
      out[k].first === "tool_use" && names(k) === "get_household,apply_change",
      `${k}: get_household, then apply_change (stop_reason tool_use)`,
      JSON.stringify(out[k]),
    );
  const t = op("targets");
  report.check(
    t?.kind === "target.set" &&
      t.payload.memberId === "m-omar" &&
      t.payload.kind === "default" &&
      JSON.stringify(t.payload.profile) === JSON.stringify(recorded.targets),
    "targets: target.set of Omar's default profile to the recorded values",
    JSON.stringify(t),
  );
  const m = op("meals");
  const shares = m?.payload?.shares ?? [];
  const sum = shares.reduce((a, s) => a + s.share, 0);
  const byId = Object.fromEntries(shares.map((s) => [s.slotTypeId, s.share]));
  // Breakfast 0.25, dinner 0.3, snack 0.1 of the core weights keep their ratio in the other 60 %.
  const ratio = (a, b) => Math.abs(byId[a] / byId[b] - 0.25 / 0.3) < 0.002;
  report.check(
    m?.kind === "distribution.set" &&
      m.payload.memberId === "m-omar" &&
      m.payload.dayKind === "default" &&
      byId["s-l"] === recorded.lunchShare &&
      Math.abs(sum - 1) < 1e-9 &&
      Object.keys(byId).sort().join(",") === "s-b,s-d,s-l,s-s" &&
      ratio("s-b", "s-d"),
    "meals: distribution.set with lunch at the recorded share, the rest-day meals only, rebalanced to 100 % in their automatic ratio",
    JSON.stringify(m),
  );
  const p = op("tastes");
  report.check(
    p?.kind === "preference.set" &&
      p.payload.memberId === "m-omar" &&
      p.payload.entityKey === recorded.cuisine &&
      p.payload.score === recorded.like &&
      p.payload.source === "explicit",
    "tastes: preference.set of the recorded cuisine for Omar, explicit",
    JSON.stringify(p),
  );
  report.check(
    out.other.first === "end_turn" && out.other.calls.length === 0,
    "negative control: a request that is not a section's (the pre-R-84 Tastes prompt) applies nothing",
    JSON.stringify(out.other),
  );
}

async function gateG2() {
  const report = new Report("leaf-1.4.12 G2");
  console.log(
    '# G2: R2-DL-6 at 390 and 1280 px: every detail-level section on a member page offers "Tell the assistant"; the request names member and section; a recorded agent turn applies the change at the section\'s level; a section without the control fails the same check',
  );
  if (!buildPackages(report)) return report.finish();
  checkTurn(report);
  await e2eGate(
    report,
    "G2",
    [
      ...V.map(
        (v) =>
          `@1.4.12-G2 every detail-level section tells the assistant, applied at its level, at ${v} px`,
      ),
      "@1.4.12-G2 negative control: a section without the control fails the same check",
    ],
    // The recorded turn in the slot the chat route reads (ADR-1). The test runner inherits it too,
    // where it only sets an unused global.
    { NODE_OPTIONS: `--import ${pathToFileURL(TURN).href}` },
  );
  return report.finish();
}

async function gateG3() {
  const report = new Report("leaf-1.4.12 G3");
  console.log("# G3: no regression: leaf-1.4.3 G1 and G3 pass");
  for (const g of ["G1", "G3"]) {
    const r = run(process.execPath, ["scripts/verify/leaf-1.4.3.mjs", "--gate", g], {
      cwd: ROOT,
      env: { NODE_OPTIONS: "" },
      timeoutMs: 1_700_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    report.check(
      r.code === 0 && out.includes(`VERIFY leaf-1.4.3 ${g} PASSED`),
      `leaf 1.4.3 ${g} passes on this branch`,
      out,
    );
  }
  return report.finish();
}

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3 };

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const i = process.argv.indexOf("--gate");
  const gate = i === -1 ? undefined : process.argv[i + 1];
  const fn = gate === undefined ? undefined : GATES[gate];
  if (fn === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.4.12.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    process.exit(2);
  }
  const log = keepFullOutput(gate);
  try {
    process.exitCode = await fn();
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    console.log(`VERIFY leaf-1.4.12 ${gate} FAILED (error)`);
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
  const dir = join(tmpdir(), "leaf-1.4.12-verify");
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
