// Verify script for leaf 1.4.7 (Deferred scope W-5: onboarding parse, planning preview, first days;
// BLD-8 R-55, R-56).
// Usage: node scripts/verify/leaf-1.4.7.mjs --gate G1|G2|G3|G4
//        node scripts/verify/leaf-1.4.7.mjs --live      (G6, the owner's credential handoff)
// Prints "VERIFY leaf-1.4.7 <gate> PASSED" (or "VERIFY leaf-1.4.7 LIVE PASSED") only when every
// assertion, including the negative controls, holds; exits non-zero otherwise.
//
// G1  Onboarding parse (R2-ONB-3): the ai unit tests over recorded responses (typed results,
//     schema-failing and invalid answers refused, typed errors, request rules); the route's
//     integration test (typed results through 1.3.1's client, 502 refusals, 503 without a
//     credential, admin only, audit rows); Playwright @G1: the onboarding page without a
//     credential keeps its own reading. Negative control: every recorded schema-failing or
//     invalid reading is refused by the built checks, and every valid one is accepted.
// G2  Planning preview (UX-4): the integration test with the built worker process (no plan rows
//     or change sets written; proposed == the real weights.set + replan, same seed, meal by meal
//     and plate by plate; figures and changes). Negative control: the plan comparison reports a
//     plan that differs in one dish or one plate (in the test); the no-writes scan reports a job
//     file that saves a plan (here).
// G3  First days (R2-ONB-6): the core follow-up engine tests (F1 answers → the expected list, one
//     card a day, answers, checklist) and the API integration test (persistence, one a day,
//     change sets, checklist). Negative control: with the built engine, a settled item (training
//     numbers given) is not proposed while the same household without them proposes it.
// G4  Playwright @G4 at 390 and 1280 px with axe-core (no serious or critical, light and dark):
//     the preview panel, the parse confirmation, the follow-up card and the checklist. Negative
//     controls in the spec (a bad page fails axe; a wide page is reported).
// G6  --live: parses the F1 answers with the real model (ANTHROPIC_API_KEY or any credential the
//     SDK resolves) and compares with the deterministic parse. Refuses without a credential.
//
// Isolation (gates may run at the same time, next to other leaves' gates): every database is the
// gate's own (random name, on DATABASE_URL's server, else localhost:5432, else a throwaway
// PostgreSQL 16 cluster), and so are the Next.js build directory, the port, the worker and the
// temp directories. Package builds and `next build` run under locks; `next build` runs with
// DATABASE_URL cleared (R-50). On any failure the full output is kept in a log (W-1).
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
const CORE = join(ROOT, "packages/core");
const AI = join(ROOT, "packages/ai");
const PACKAGES = ["core", "db", "ai", "graph", "api-contract", "ui-tokens"].map((p) =>
  join(ROOT, "packages", p),
);
const RESPONSES = join(AI, "test/onboarding/fixtures/responses");
const LABEL = "leaf-1.4.7";

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

const distDirFor = (gate) => `.next/verify-1.4.7-${gate.toLowerCase()}`;

/** `next build` into the gate's own directory, one at a time, without a database (R-50). */
function buildWeb(report, gate) {
  const build = withLock("web-next-build", () =>
    run("pnpm", ["exec", "next", "build"], {
      cwd: WEB,
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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.7-pg-"));
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

/** The server the integration tests create their own databases on (PostgreSQL 16 checked). */
async function testServer(report) {
  const server = await acquireServer();
  const version = (await query(server.url, "SHOW server_version"))[0]?.server_version ?? "?";
  report.check(
    /^16\./.test(version),
    `database server (${server.source}) is PostgreSQL 16 (server_version ${version})`,
  );
  return server;
}

/** A fresh database on the server, migrated and seeded with the catalogue (R-17 loader). */
async function gateDatabase(report, gate) {
  const server = await testServer(report);
  const name = `leaf147_${gate.toLowerCase()}_${String(process.pid)}_${randomBytes(3).toString("hex")}`;
  await query(server.url, `CREATE DATABASE "${name}"`);
  const url = withDatabase(server.url, name);
  const { migrateAndSeed } = await import(
    pathToFileURL(join(ROOT, "packages/db/dist/src/seed/index.js")).href
  );
  await migrateAndSeed(url);
  report.check(true, `database ${name} created, migrated (0006 included) and seeded`);
  return {
    url,
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

/** The pg-boss worker on the gate's database (plan and preview jobs, ARC-7). */
function startWorker(databaseUrl, logFile) {
  const fd = openSync(logFile, "w");
  const env = { ...process.env, DATABASE_URL: databaseUrl, LOG_LEVEL: "warn" };
  // No credential for the worker: recipe generation stays off (REC-2).
  delete env.ANTHROPIC_API_KEY;
  const child = spawn(process.execPath, ["dist/src/main.js"], {
    cwd: WORKER,
    env,
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

/** Runs `setup.spec.ts --grep @<gate>` against the gate's database and checks every title. */
async function playwright(report, gate, db, expected) {
  const dir = mkdtempSync(join(tmpdir(), `leaf-1.4.7-${gate.toLowerCase()}-`));
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
    SETUP_SCREENSHOT_DIR:
      process.env.SETUP_SCREENSHOT_DIR ?? join(tmpdir(), "leaf-1.4.7-screenshots"),
    NEXT_TELEMETRY_DISABLED: "1",
    // The web server must not pick up a credential: parse calls are answered in the browser.
    ANTHROPIC_API_KEY: "",
  };
  if (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE === undefined &&
    existsSync("/opt/pw-browsers/chromium")
  )
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium";
  try {
    const result = run(
      "pnpm",
      ["exec", "playwright", "test", "e2e/setup.spec.ts", "--grep", `@${gate}`, "--reporter=json"],
      { cwd: WEB, env, timeoutMs: 1_800_000 },
    );
    const results = existsSync(jsonFile)
      ? collectPlaywright(JSON.parse(readFileSync(jsonFile, "utf8")))
      : [];
    for (const r of results)
      console.log(
        `       ${r.status.padEnd(8)} ${r.title} (${(r.durationMs / 1000).toFixed(1)} s of ${String(r.timeoutMs / 1000)} s)`,
      );
    const failed = results.filter((r) => r.status !== "passed");
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

/** Runs vitest in `cwd`; checks every test ran and passed and every expected title is among them. */
function vitest(report, label, cwd, args, expected, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.7-vitest-"));
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
      { cwd, env, timeoutMs: 1_500_000 },
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
    // Measured lines the tests print (G2 figures).
    for (const line of `${result.stdout}\n${result.stderr}`.split("\n"))
      if (line.includes("measured:")) console.log(`       ${line.trim()}`);
    return tests;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** An integration test file of apps/web against the gate's database server. */
async function webIntegration(report, label, file, expected) {
  const server = await testServer(report);
  try {
    vitest(report, label, WEB, ["--dir", "test", file], expected, { DATABASE_URL: server.url });
  } finally {
    server.stop();
  }
}

/** An e2e gate: packages, database, build, worker, Playwright; always cleans up. */
async function e2eGate(report, gate, expected) {
  if (!buildPackages(report)) return;
  if (!buildWeb(report, gate)) return;
  const db = await gateDatabase(report, gate);
  const logDir = mkdtempSync(join(tmpdir(), `leaf-1.4.7-${gate.toLowerCase()}-worker-`));
  const w = startWorker(db.url, join(logDir, "worker.log"));
  try {
    await playwright(report, gate, db, expected);
  } finally {
    await w.stop();
    if (report.failures.length > 0) console.log(`       worker output:\n${w.output()}`);
    rmSync(logDir, { recursive: true, force: true });
    await db.drop();
  }
}

const importDist = (pkg, sub) =>
  import(pathToFileURL(join(ROOT, "packages", pkg, "dist/src", sub, "index.js")).href);

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

const V = ["390", "1280"];

async function gateG1() {
  const report = new Report(`${LABEL} G1`);
  console.log(
    "# G1: onboarding parse (R2-ONB-3): typed results from recorded responses, refusals, 503, admin only",
  );
  if (!buildPackages(report)) return report.finish();
  vitest(
    report,
    "packages/ai onboarding parse (recorded responses)",
    AI,
    ["--dir", "test", "test/onboarding"],
    [
      "G1 people: the F1 line reads as the deterministic parse reads it",
      "G1 targets: Adult A's numbers equal the deterministic parse, training day included",
      "G1 never-eat: rules keep the term; the catalogue, not the model, expands it",
      "G1 schema failure refused: schema-targets-string-kcal",
      "G1 schema failure refused: schema-not-json",
      "G1 semantic check refuses: invalid-targets-disagree",
      "G1 semantic check refuses: invalid-never-eat-unknown-person",
      "G1 negative control: the same checks accept the valid reading they refuse when broken",
      "G1 the request: structured output, adaptive thinking, effort low, default fallbacks with the beta",
      "G1 refusal: a typed failure, recorded, never thrown",
      "G1 max_tokens: a typed failure, recorded, never thrown",
      "G1 without a credential: disabled, no call, no audit row",
    ],
  );
  await webIntegration(
    report,
    "POST /api/v1/onboarding/parse",
    "test/api/onboarding-parse.int.test.ts",
    [
      "G1 typed people and targets from recorded responses, as the deterministic parse reads them",
      "G1 a schema-failing answer is refused with 502 and not returned; the audit row keeps why",
      "G1 without a credential: 503 and no audit row (the page keeps its deterministic parse)",
      "G1 admin only: member and kitchen get 403 and the model is not called",
    ],
  );

  // Negative control on the built checks and the recorded readings themselves.
  const { checkOutput } = await importDist("ai", "onboarding");
  const people = ["Zayd", "Sara", "Adult A", "Adult B", "Child C1", "Child C2", "Child C3"];
  const fieldOf = (name) =>
    name.includes("people") ? "people" : name.includes("targets") ? "targets" : "never_eat";
  let valid = 0;
  let refused = 0;
  for (const file of readdirSync(RESPONSES).sort()) {
    const name = file.replace(/\.json$/, "");
    const body = JSON.parse(readFileSync(join(RESPONSES, file), "utf8")).body;
    const text = body.content?.find((b) => b.type === "text")?.text;
    if (!/^(people|targets|never-eat|invalid)-/.test(name) || text === undefined) continue;
    const verdict = checkOutput(fieldOf(name), JSON.parse(text), people);
    if (name.startsWith("invalid-")) {
      refused += 1;
      report.check(!verdict.ok, `negative control: the recorded reading ${name} is refused`);
    } else {
      valid += 1;
      report.check(verdict.ok, `the recorded reading ${name} is accepted`, JSON.stringify(verdict));
    }
  }
  report.check(
    valid >= 7 && refused >= 5,
    `${String(valid)} valid and ${String(refused)} invalid recorded readings checked`,
  );

  // The parse goes through 1.3.1's client; `inferSetup` stays free of any model call.
  const src = readFileSync(join(AI, "src/onboarding/parse.ts"), "utf8");
  report.check(
    /createClaudeClient\(/.test(src) && /deps\.model\.parse\(/.test(src),
    "the parse runs through 1.3.1's structured-output client (createClaudeClient, StructuredModel.parse)",
  );
  const core = readdirSync(join(CORE, "src/onboarding"), { recursive: true })
    .filter((f) => String(f).endsWith(".ts"))
    .map((f) => readFileSync(join(CORE, "src/onboarding", String(f)), "utf8"))
    .join("\n");
  report.check(
    !/@mealplanner\/ai|@anthropic-ai|fetch\(/.test(core),
    "packages/core/src/onboarding (inferSetup, follow-ups) makes no model or network call",
  );

  // The page keeps its own reading without a credential (Playwright @G1).
  if (!buildWeb(report, "G1")) return report.finish();
  const db = await gateDatabase(report, "G1");
  try {
    await playwright(
      report,
      "G1",
      db,
      V.map(
        (v) =>
          `@G1 @G4 without a credential at ${v} px: no confirmation, the page keeps its own reading`,
      ),
    );
  } finally {
    await db.drop();
  }
  return report.finish();
}

/** Static scan: the preview job must not save a plan, write a change set or generate dishes. */
export function writeProblems(source) {
  const problems = [];
  for (const [pattern, what] of [
    [/\bsavePlan\b/, "saves a plan (savePlan)"],
    [/\bgeneratePlan\b/, "runs plan.generate (generatePlan)"],
    [/\bapplyChangeSet\b/, "applies a change set"],
    [/\bgenerateDishes\b|\brequestDishesFor\b/, "runs the AI recipe generator (it saves dishes)"],
    [/\.insert\(|\.update\(|\.delete\(/, "writes rows directly"],
  ])
    if (pattern.test(source)) problems.push(what);
  return problems;
}

async function gateG2() {
  const report = new Report(`${LABEL} G2`);
  console.log(
    "# G2: planning preview (UX-4): current vs proposed, no plan rows written, proposed == the real replan",
  );
  if (!buildPackages(report)) return report.finish();
  await webIntegration(
    report,
    "POST /api/v1/plans/preview with the worker process",
    "test/api/plans-preview.int.test.ts",
    [
      "G2 with no saved plan: current is computed with the current weights; nothing is written",
      "G2 the proposed side equals the real replan with the same weights and seed",
      "G2 over a saved plan: current is the saved plan, and the listed changes are the replan's",
      "G2 negative control: a plan that differs in one dish or one plate is reported",
      "G2 admin only; a member gets 403 and nothing is queued",
    ],
  );
  const job = readFileSync(join(WORKER, "src/jobs/plans-preview.ts"), "utf8");
  const problems = writeProblems(job);
  report.check(
    problems.length === 0,
    "the plans.preview job has no write path (no save, change set, generation or row write)",
    problems.join("\n"),
  );
  report.check(
    writeProblems(`${job}\nawait savePlan(db, ctx, { plan });`).includes("saves a plan (savePlan)"),
    "negative control: the same scan reports a job that saves a plan",
  );
  const handlers = readFileSync(join(WORKER, "src/jobs/handlers.ts"), "utf8");
  report.check(
    /"plans\.preview": plansPreview/.test(handlers) &&
      /"plans\.preview"/.test(
        readFileSync(join(ROOT, "packages/db/src/services/plans/jobs.ts"), "utf8"),
      ),
    "plans.preview is a registered job kind with its worker handler",
  );
  return report.finish();
}

async function gateG3() {
  const report = new Report(`${LABEL} G3`);
  console.log(
    "# G3: first days (R2-ONB-6): only unsettled items, one card a day, answers and dismissals persist, checklist",
  );
  if (!buildPackages(report)) return report.finish();
  vitest(
    report,
    "packages/core follow-up engine",
    CORE,
    ["--dir", "test", "test/onboarding/followups"],
    [
      "G3 F1's five answers leave exactly the nut-free school, dinner time and Adult B's training energy open",
      "G3 negative control: an item the answers already settle is never proposed",
      "G3 yes, nut-free adds a contains_nuts exclusion for each school child; then it is settled",
      "G3 after an answer or a dismissal today there is no card until tomorrow",
      "G3 a dismissed follow-up comes back after the ones never offered, oldest dismissal first",
      "G3 the checklist counts progress as FirstDaysPhone shows it (3 / 6)",
    ],
  );
  await webIntegration(report, "the setup follow-ups API", "test/api/setup-followups.int.test.ts", [
    "G3 the F1 answers leave exactly three follow-ups open: nut-free school, dinner time, Adult B's training energy",
    "G3 only today's card can be answered; a bad choice or an unknown key is refused",
    "G3 yes, nut-free: one change set adds the school children's nut exclusions; no second card today",
    "G3 answers persist: the next day brings the next card, and the settled question stays gone",
    "G3 Not sure · Ask me later: dismissed today, it returns after the others",
    "G3 the checklist counts progress from the household's data",
  ]);

  // Negative control with the built engine: a settled item is not proposed; unsettled, it is.
  const { proposeFollowups } = await importDist("core", "onboarding/followups");
  const member = {
    id: "m1",
    householdId: "h",
    displayName: "Omar",
    color: "sea",
    birthYear: 1985,
    sex: null,
    isTargeted: true,
    appetite: "large",
    notes: null,
    archivedAt: null,
  };
  const profile = (kind) => ({
    id: `p-${kind}`,
    householdId: "h",
    memberId: "m1",
    kind,
    kcal: 2150,
    proteinG: 180,
    carbsG: 200,
    fatG: 70,
    satFatMaxG: null,
    solubleFibreMinG: null,
    fibreMinG: null,
    sodiumMaxMg: null,
  });
  const base = {
    members: [member],
    targetProfiles: [profile("default")],
    slotTypes: [],
    memberSlotSchedules: [],
    trainingSchedules: [
      { householdId: "h", memberId: "m1", weekday: 0, sessionTime: "18:00:00", intensity: null },
    ],
    exclusions: [],
  };
  const open = proposeFollowups(base).map((f) => f.key);
  const settled = proposeFollowups({
    ...base,
    targetProfiles: [profile("default"), profile("training")],
  }).map((f) => f.key);
  report.check(
    open.includes("training_kcal:m1"),
    "positive control: training without training-day numbers is proposed",
    open.join(", "),
  );
  report.check(
    !settled.includes("training_kcal:m1"),
    "negative control: training with training-day numbers is never proposed",
    settled.join(", "),
  );
  return report.finish();
}

async function gateG4() {
  const report = new Report(`${LABEL} G4`);
  console.log(
    "# G4: Playwright at 390 and 1280 px with axe-core: preview panel, parse confirmation, follow-up card, checklist",
  );
  await e2eGate(report, "G4", [
    ...V.flatMap((v) => [
      `@G4 first days at ${v} px: today's card, coming up, the checklist; one answer a day`,
      `@G4 parse confirmation at ${v} px: the assistant's reading is shown, and used on request`,
      `@G1 @G4 without a credential at ${v} px: no confirmation, the page keeps its own reading`,
      `@G4 next-week preview at ${v} px: figures, the meals that change, Save & replan`,
    ]),
    "@G4 negative control: axe reports an unlabelled button on a bad page",
    "@G4 negative control: a page wider than the viewport is reported",
  ]);
  return report.finish();
}

const F1_TEXT = {
  people: "Adult A 40, Adult B 37, Child C1 18 F, Child C2 15 M, Child C3 10 M",
  targets: {
    "Adult A":
      "2150 cal, 180p 200c 70f, sat fat 22 g, soluble fibre 10 g. Training days: 2390 / 180 / 260 / 70",
    "Adult B": "1655 / 130 / 160 / 55, sat fat max 18 g",
  },
  neverEat: "Child C3 is allergic to sesame.",
};

/** G6 (owner handoff): the F1 answers read by the real model match the deterministic parse. */
async function live() {
  const report = new Report(`${LABEL} LIVE`);
  console.log("# G6: live parse of the F1 answers through the real model (owner handoff)");
  if (!buildPackages(report)) return report.finish();
  const { resolveClaudeConfig } = await importDist("ai", "client");
  const config = resolveClaudeConfig();
  if (!config.enabled) {
    console.log(`refused: ${config.reason}`);
    console.log(`VERIFY ${LABEL} LIVE REFUSED (no Anthropic credential; the owner runs this gate)`);
    return 1;
  }
  const { createOnboardingModel, parseOnboardingText } = await importDist("ai", "onboarding");
  const { parseNeverEat, parsePeople, parseTargets } = await importDist("core", "onboarding");
  const model = createOnboardingModel(config);
  const records = [];
  const deps = {
    model,
    recordGeneration: (r) => (records.push(r), Promise.resolve(`live-${String(records.length)}`)),
  };
  const names = parsePeople(F1_TEXT.people).map((p) => p.name);
  const cases = [
    ["people", { field: "people", text: F1_TEXT.people }, { people: parsePeople(F1_TEXT.people) }],
    ...Object.entries(F1_TEXT.targets).map(([who, text]) => [
      `targets of ${who}`,
      { field: "targets", text },
      { targets: parseTargets(text) },
    ]),
    [
      "never-eat",
      { field: "never_eat", text: F1_TEXT.neverEat, people: names },
      { neverEat: parseNeverEat(F1_TEXT.neverEat, names) },
    ],
  ];
  for (const [label, input, expected] of cases) {
    const r = await parseOnboardingText(deps, input);
    const got =
      r.status !== "parsed"
        ? r
        : r.value.field === "people"
          ? { people: r.value.people }
          : r.value.field === "targets"
            ? { targets: r.value.targets }
            : { neverEat: r.value.neverEat };
    report.check(
      JSON.stringify(got) === JSON.stringify(expected),
      `live ${label} (model ${model.model}) equals the deterministic parse`,
      `got ${JSON.stringify(got)}\nexpected ${JSON.stringify(expected)}`,
    );
  }
  const usage = records.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0);
  console.log(
    `       ${String(records.length)} calls, ${String(usage)} tokens, served by ${[...new Set(records.map((r) => r.model))].join(", ")}`,
  );
  return report.finish();
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2, G3: gateG3, G4: gateG4 };

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const isLive = process.argv.includes("--live");
  const i = process.argv.indexOf("--gate");
  const gate = isLive ? "LIVE" : i === -1 ? undefined : process.argv[i + 1];
  const fn = isLive ? live : gate === undefined ? undefined : GATES[gate];
  if (fn === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.4.7.mjs --gate ${Object.keys(GATES).join("|")} | --live`,
    );
    process.exit(2);
  }
  const log = keepFullOutput(gate);
  try {
    process.exitCode = await fn();
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    console.log(`VERIFY ${LABEL} ${gate} FAILED (error)`);
    process.exitCode = 1;
  }
  log.finish(process.exitCode !== 0);
}

/**
 * W-1 under gate-check: the whole output also goes to a log file that outlives the run, named on
 * the first line, and a failure ends with the failing checks and tests named and the log's path.
 */
function keepFullOutput(gate) {
  const dir = join(tmpdir(), "leaf-1.4.7-verify");
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
  console.log(`full output: ${file}`);
  return {
    finish(failed) {
      if (!failed) return;
      console.log(`failing: ${failing.length === 0 ? "(see log)" : failing.join(" | ")}`);
      console.log(`full output: ${file}`);
    },
  };
}
