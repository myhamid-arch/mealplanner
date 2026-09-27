// Verify script for leaf 1.4.3 (Onboarding, Family, Settings, detail levels).
// Usage: node scripts/verify/leaf-1.4.3.mjs --gate G1|G2|G3|G4|G5
// Prints "VERIFY leaf-1.4.3 <gate> PASSED" only when every assertion, including the negative
// controls, holds; exits non-zero otherwise. Design: docs/decisions/leaf-1.4.3-adr-2.md.
//
// G1  Playwright @G1 at 390 and 1280 px against a real database and worker: onboarding → the plan
//     for tomorrow; family edits; settings edits; no horizontal scroll; the mockups' structure.
// G2  Playwright @G2: axe-core on every screen state, light and dark, no serious or critical
//     violation (ADR-1).
// G3  R2-DL: the rebalance / "yours" unit tests (components/detail-level/logic.test.ts), the
//     detail-level API integration test (persistence per member and section, R2-DL-1), and
//     Playwright @G3 (auto tags, override, back to auto, keep / reset).
// G4  inferSetup golden tests (packages/core/test/onboarding): F1's answers give F1's
//     configuration, sesame expands through the catalogue flags, the free-text parser is stubbed.
// G5  Playwright @G5 writes what it measured (onboarding screens, their inputs, Adjust links and
//     where each one landed); this script computes SC-6 and SC-7 from that record.
//
// Isolation (gates may run at the same time, and next to other leaves' gates): each e2e gate
// uses its own database (on DATABASE_URL's server, else localhost:5432, else a throwaway
// PostgreSQL 16 cluster on a free port), its own Next.js build directory, a free port, its own
// worker process and its own temp directory. Package builds and `next build` run under locks.
// On any failed test the full error and output are printed (W-1).
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
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
const CORE = join(ROOT, "packages/core");
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

const distDirFor = (gate) => `.next/verify-1.4.3-${gate.toLowerCase()}`;

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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.3-pg-"));
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
  const name = `leaf143_${gate.toLowerCase()}_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
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
  const dir = mkdtempSync(join(tmpdir(), `leaf-1.4.3-${gate.toLowerCase()}-`));
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
      ["exec", "playwright", "test", "e2e/config.spec.ts", "--grep", `@${gate}`, "--reporter=json"],
      {
        cwd: WEB,
        env,
        timeoutMs: 1_800_000,
      },
    );
    const results = existsSync(jsonFile)
      ? collectPlaywright(JSON.parse(readFileSync(jsonFile, "utf8")))
      : [];
    for (const r of results) console.log(`       ${r.status.padEnd(8)} ${r.title}`);
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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.3-vitest-"));
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
async function e2eGate(report, gate, { worker }, body) {
  if (!buildPackages(report)) return;
  if (!buildWeb(report, gate)) return;
  const db = await gateDatabase(report, gate);
  const logDir = mkdtempSync(join(tmpdir(), `leaf-1.4.3-${gate.toLowerCase()}-worker-`));
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
  const report = new Report("leaf-1.4.3 G1");
  console.log(
    "# G1: at 390 and 1280 px: onboarding to the first plan, family edits, settings edits (R2-ONB, UX-4)",
  );
  await e2eGate(report, "G1", { worker: true }, (db) =>
    playwright(report, "G1", db, [
      ...V.flatMap((v) => [
        `@G1 onboarding to tomorrow's plan at ${v} px`,
        `@G1 family edits at ${v} px`,
        `@G1 settings edits at ${v} px`,
      ]),
      "@G1 negative control: a page wider than the viewport is reported",
    ]),
  );
  return report.finish();
}

async function gateG2() {
  const report = new Report("leaf-1.4.3 G2");
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
  const report = new Report("leaf-1.4.3 G3");
  console.log(
    "# G3: R2-DL auto tags, per-value override and back to auto, keep / reset when lowering",
  );
  await e2eGate(report, "G3", { worker: false }, async (db) => {
    vitest(
      report,
      "detail-level logic (apps/web/components/detail-level)",
      WEB,
      ["components/detail-level/logic.test.ts"],
      [
        "G3 automatic shares follow the PLN-2 weights and sum to 1",
        "G3 one value set: it is kept, the others rebalance in proportion, the day sums to 100 %",
        "G3 two values set of five slots are recovered",
        "G3 ambiguous: as many user values as siblings (2 of 4) shows every value as yours",
        "G3 a stored split equal to the automatic one has no user values",
        "G3 negative control: an inference that ignored the ratios would miss the user's value",
      ],
    );
    vitest(
      report,
      "detail levels persist per (member, section) through the API (R2-DL-1)",
      WEB,
      ["--dir", "test", "test/api/detail-levels.int.test.ts"],
      [
        "an admin sets member and household sections; the list returns them; a second PUT updates",
        "levels are per member: one member's level does not change another's",
        "a member sets only their own taste level and sees only their own rows",
        "another household sees none of these rows and cannot write to this household's members",
      ],
      { DATABASE_URL: db.serverUrl },
    );
    await playwright(report, "G3", db, [
      "@G3 automatic values carry auto; one value set is yours, the rest rebalance to 100 %, back to auto clears it",
      "@G3 lowering the level with your values asks Keep or Reset; keep hides them, reset clears them",
      "@G3 the level is per member and per section",
      "@G3 negative control: a value without its tag is reported",
    ]);
  });
  return report.finish();
}

async function gateG4() {
  const report = new Report("leaf-1.4.3 G4");
  console.log("# G4: inferSetup golden tests (R2-ONB-3)");
  vitest(
    report,
    "packages/core onboarding",
    CORE,
    ["--dir", "test", "test/onboarding"],
    [
      "G4 the F1 answers produce exactly the F1 configuration (SPEC-Q-2 fields apart)",
      "G4 the three rule fields take their R2 values (SPEC-Q-2)",
      "G4 kids get no macro targets and adults' targets are what was typed",
      "G4 negative control: one changed answer is reported as a difference",
      "G4 sesame resolves to the contains_sesame flag, covering tahini, hummus and za'atar",
      "G4 negative control: without the flag on tahini the expansion no longer covers it",
      "G4 the mockup's never-eat answer becomes the exclusions R2-ONB-3 describes",
      "G4 a model parse of text the rules cannot read gives the same configuration as the rules",
      "G4 the model cannot widen or narrow an expansion: slugs come from the catalogue flags",
    ],
  );
  // The sesame expansion must be computed from the catalogue, so the data must hold the case.
  const data = JSON.parse(readFileSync(join(ROOT, "data/ingredients.v1.json"), "utf8"));
  const sesame = data.ingredients
    .filter((i) => i.dietary_flags.includes("contains_sesame"))
    .map((i) => i.slug);
  report.check(
    ["tahini", "hummus", "zaatar"].every((s) => sesame.includes(s)),
    `the catalogue flags tahini, hummus and za'atar contains_sesame (${String(sesame.length)} sesame ingredients: ${sesame.join(", ")})`,
  );
  // No model call in the engine: the deterministic part never imports the AI package.
  const src = readdirSync(join(CORE, "src/onboarding"))
    .map((f) => readFileSync(join(CORE, "src/onboarding", f), "utf8"))
    .join("\n");
  report.check(
    !/@mealplanner\/ai|@anthropic-ai|fetch\(/.test(src),
    "packages/core/src/onboarding makes no model or network call",
  );
  return report.finish();
}

/** SC-6 from a recorded run: screens before the plan, and the answers they require. */
export function sc6Problems(run, { planned = true } = {}) {
  const problems = [];
  const questions = run.steps.filter((s) => s.step !== "5" && s.step !== "planned");
  const required = questions.filter((s) => s.requiredInputs > 0 || !s.skipOffered).length;
  if (questions.length > 5)
    problems.push(`${String(questions.length)} questions before the first plan (at most 5)`);
  if (required > 5) problems.push(`${String(required)} required answers (at most 5)`);
  if (planned && run.planned !== true) problems.push("no plan for tomorrow after the flow");
  return { problems, questions: questions.length, required };
}

/** SC-7: every Adjust link answered 200 and showed its setting. */
export function sc7Problems(trace) {
  const problems = [];
  if (trace.results.length === 0) problems.push("no Adjust links");
  if (trace.results.length !== trace.explanations)
    problems.push(`${String(trace.results.length)} links checked of ${String(trace.explanations)}`);
  for (const r of trace.results)
    if (r.status !== 200 || r.visible !== true)
      problems.push(
        `${r.href}: status ${String(r.status)}, ${r.target} ${r.visible ? "shown" : "not shown"}`,
      );
  return problems;
}

async function gateG5() {
  const report = new Report("leaf-1.4.3 G5");
  console.log(
    "# G5: SC-6 at most 5 required answers to the first plan; SC-7 every Adjust link resolves",
  );
  const traceDir = mkdtempSync(join(tmpdir(), "leaf-1.4.3-g5-trace-"));
  try {
    await e2eGate(report, "G5", { worker: true }, (db) =>
      playwright(
        report,
        "G5",
        db,
        [
          "@G5 SC-6 the answers asked before the first plan, answered and skipped",
          "@G5 SC-7 every Adjust link after confirmation resolves to its setting",
        ],
        { LEAF143_TRACE_DIR: traceDir },
      ),
    );
    const sc6File = join(traceDir, "sc6.json");
    const sc7File = join(traceDir, "sc7.json");
    report.check(existsSync(sc6File) && existsSync(sc7File), "the e2e run recorded SC-6 and SC-7");
    if (existsSync(sc6File)) {
      const sc6 = JSON.parse(readFileSync(sc6File, "utf8"));
      for (const kind of ["answered", "skipped"]) {
        const m = sc6Problems(sc6[kind]);
        report.check(
          m.problems.length === 0,
          `SC-6 (${kind}): ${String(m.questions)} question screens, ${String(m.required)} required answers, then tomorrow is planned`,
          m.problems.join("\n"),
        );
      }
      // Negative control: the same computation on a flow with a sixth, required question.
      const bad = {
        planned: true,
        steps: [
          ...sc6.answered.steps.filter((s) => s.step !== "5"),
          { step: "5b", heading: "Extra", inputs: 1, requiredInputs: 1, skipOffered: false },
        ],
      };
      report.check(
        sc6Problems(bad).problems.length > 0,
        "SC-6 negative control: a sixth, required question is reported",
      );
    }
    if (existsSync(sc7File)) {
      const sc7 = JSON.parse(readFileSync(sc7File, "utf8"));
      const problems = sc7Problems(sc7);
      report.check(
        problems.length === 0,
        `SC-7: all ${String(sc7.results.length)} Adjust links answered 200 and showed their setting`,
        problems.join("\n"),
      );
      const bad = {
        ...sc7,
        results: sc7.results.map((r, i) => (i === 0 ? { ...r, status: 404, visible: false } : r)),
      };
      report.check(
        sc7Problems(bad).length > 0,
        "SC-7 negative control: a broken Adjust link is reported",
      );
    }
  } finally {
    rmSync(traceDir, { recursive: true, force: true });
  }
  return report.finish();
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4, G5: gateG5 };

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const i = process.argv.indexOf("--gate");
  const gate = i === -1 ? undefined : process.argv[i + 1];
  const fn = gate === undefined ? undefined : GATES[gate];
  if (fn === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.4.3.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    process.exit(2);
  }
  try {
    process.exitCode = await fn();
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    console.log(`VERIFY leaf-1.4.3 ${gate} FAILED (error)`);
    process.exitCode = 1;
  }
}
