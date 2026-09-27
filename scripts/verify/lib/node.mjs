// Shared implementation of the node gates N2–N4 (BLD-6 "Node gate definitions", R-69, R-70).
// `scripts/verify/node-1.<n>.mjs --gate N2|N3|N4` calls `nodeMain` with its node's parameters.
//
// Isolation (the gates may run concurrently): every gate creates its own databases (random names on
// the server it acquired), its own Next.js build directory (.next/verify-node-1.<n>-<gate>), its own
// ports, processes and temp directories. The only shared outputs are the workspace packages'
// dist/ directories, built only when stale and under the same cross-process lock the leaf scripts
// use (`packages-build`); `next build` runs under the `web-next-build` lock with DATABASE_URL
// cleared (R-50). No ANTHROPIC_API_KEY reaches any child process.
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
import { Buffer } from "node:buffer";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./report.mjs";
import { run, tail } from "./run.mjs";
import { copyWorkspace, installCopy, listWorkspacePackages } from "./workspace.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const WEB = join(ROOT, "apps/web");
export const WORKER = join(ROOT, "apps/worker");
const PACKAGE_DIRS = ["core", "db", "ai", "graph", "api-contract", "ui-tokens"].map((p) =>
  join(ROOT, "packages", p),
);
const LOCAL_URL = "postgres://postgres:postgres@localhost:5432/postgres";

/** Environment every child gets on top of the caller's: no model credential, no preloads. */
export const CHILD_ENV = {
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_AUTH_TOKEN: "",
  ANTHROPIC_BASE_URL: "",
  NODE_OPTIONS: "",
  NEXT_TELEMETRY_DISABLED: "1",
  TURBO_TELEMETRY_DISABLED: "1",
};

// ---------------------------------------------------------------------------------------------
// Locks and builds
// ---------------------------------------------------------------------------------------------

export function sleepMs(ms) {
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

/** The lock directory for `name`, the same path the leaf scripts use (1.4.9, 1.4.10). */
function lockPath(name) {
  return join(
    tmpdir(),
    `mealplanner-${name}-${createHash("sha256").update(ROOT).digest("hex").slice(0, 12)}.lock`,
  );
}

function acquireLock(name) {
  const lock = lockPath(name);
  const deadline = Date.now() + 40 * 60_000;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), String(process.pid));
      return lock;
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
}

/** Runs `fn` (sync or async) holding the named cross-process lock; a dead holder's lock is taken over. */
export async function withLock(name, fn) {
  const lock = acquireLock(name);
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function newestMtime(dir) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

function stale(pkgDir) {
  const inputs = Math.max(
    newestMtime(join(pkgDir, "src")),
    newestMtime(join(pkgDir, "test")),
    statSync(join(pkgDir, "package.json")).mtimeMs,
    statSync(join(pkgDir, "tsconfig.json")).mtimeMs,
  );
  const dist = join(pkgDir, "dist");
  return !existsSync(dist) || inputs > newestMtime(dist);
}

/** Builds the workspace packages and the worker when a source is newer than its dist (locked). */
export async function buildPackages(report) {
  const result = await withLock("packages-build", () => {
    if (![...PACKAGE_DIRS, WORKER].some(stale))
      return { code: 0, stdout: "up to date", stderr: "" };
    return runAsync(
      "pnpm",
      ["exec", "turbo", "run", "build", "--filter=./packages/*", "--filter=@mealplanner/worker"],
      { cwd: ROOT, timeoutMs: 1_200_000 },
    );
  });
  return report.check(
    result.code === 0,
    "workspace packages and the worker are built (turbo, only when stale)",
    tail(result, 40),
  );
}

export const distDirFor = (label, gate) =>
  `.next/verify-${label.replace(/[^a-z0-9.-]/gi, "")}-${gate.toLowerCase()}`;

/** `next build` into its own directory, one at a time, without a database (R-50). */
export async function buildWeb(report, distDir, webDir = WEB) {
  const build = await withLock("web-next-build", () =>
    runAsync("pnpm", ["exec", "next", "build"], {
      cwd: webDir,
      env: { MISE_NEXT_DIST_DIR: distDir, DATABASE_URL: "" },
      timeoutMs: 1_500_000,
    }),
  );
  return report.check(
    build.code === 0,
    `apps/web builds into ${distDir} (next build with DATABASE_URL cleared)`,
    tail(build, 60),
  );
}

// ---------------------------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------------------------

/** Runs a command without blocking the event loop; resolves with its exit code and output. */
export function runAsync(command, args, { cwd, env = {}, timeoutMs = 1_800_000 }) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...CHILD_ENV, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun({
        code: code ?? -1,
        stdout,
        stderr: signal === null ? stderr : `${stderr}\n(killed by ${signal})`,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ code: -1, stdout, stderr: `${stderr}\n${String(error)}` });
    });
  });
}

export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16
// ---------------------------------------------------------------------------------------------

async function pgModule() {
  return (await import(pathToFileURL(join(WEB, "node_modules/pg/lib/index.js")).href)).default;
}

export async function query(url, text, values = []) {
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
  return [fromConfig.code === 0 ? fromConfig.stdout.trim() : "", "/usr/lib/postgresql/16/bin"].find(
    (dir) => dir !== "" && existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl")),
  );
}

async function startCluster(label) {
  const bin = pgBinDir();
  if (bin === undefined)
    throw new Error("no DATABASE_URL, nothing on localhost:5432, and no PostgreSQL 16 initdb");
  const asRoot = process.getuid?.() === 0;
  const dir = mkdtempSync(join(tmpdir(), `${label}-pg-`));
  const port = await freePort();
  const as = (args) =>
    asRoot ? ["runuser", ["-u", "postgres", "--", ...args]] : [args[0], args.slice(1)];
  if (asRoot) run("chown", ["postgres", dir], { cwd: ROOT });
  const data = join(dir, "data");
  const init = run(
    ...as([join(bin, "initdb"), "-D", data, "-U", "postgres", "--auth=trust", "--no-sync"]),
    { cwd: tmpdir() },
  );
  if (init.code !== 0) throw new Error(`initdb failed:\n${tail(init)}`);
  const start = run(
    ...as([
      join(bin, "pg_ctl"),
      "-D",
      data,
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
      run(...as([join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "stop"]), { cwd: tmpdir() });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** DATABASE_URL's server, else localhost:5432, else a throwaway PostgreSQL 16 cluster. */
export async function acquireServer(report, label) {
  let server;
  if (process.env.DATABASE_URL)
    server = { url: process.env.DATABASE_URL, source: "DATABASE_URL", stop: () => undefined };
  else if (await reachable(LOCAL_URL))
    server = { url: LOCAL_URL, source: "localhost:5432", stop: () => undefined };
  else server = await startCluster(label);
  const version = (await query(server.url, "SHOW server_version"))[0]?.server_version ?? "?";
  report.check(
    /^16\./.test(version),
    `database server (${server.source}) is PostgreSQL 16 (server_version ${version})`,
  );
  return server;
}

export function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** A new, empty database of the gate's own on `server` (random name); `drop()` removes it. */
export async function createDatabase(server, prefix) {
  const name = `${prefix}_${String(process.pid)}_${randomBytes(4).toString("hex")}`;
  await query(server.url, `CREATE DATABASE "${name}"`);
  return {
    name,
    url: withDatabase(server.url, name),
    drop: async () => {
      await query(
        server.url,
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [name],
      );
      await query(server.url, `DROP DATABASE IF EXISTS "${name}"`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Test runners (vitest and Playwright with JSON reports)
// ---------------------------------------------------------------------------------------------

function collectVitest(json) {
  return (json?.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((a) => ({
      file: relative(ROOT, file.name ?? ""),
      title: a.title,
      fullName: a.fullName ?? a.title,
      status: a.status,
      failure: (a.failureMessages ?? []).join("\n"),
    })),
  );
}

/** Runs vitest with a JSON report; returns { code, tests, output, files } without judging. */
export async function vitestRun(cwd, args, env = {}, timeoutMs = 2_400_000) {
  const dir = mkdtempSync(join(tmpdir(), "node-gate-vitest-"));
  const out = join(dir, "report.json");
  try {
    const result = await runAsync(
      process.execPath,
      [
        join(ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        ...args,
        "--reporter=json",
        `--outputFile.json=${out}`,
        "--reporter=default",
      ],
      { cwd, env, timeoutMs },
    );
    const json = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
    return {
      code: result.code,
      tests: collectVitest(json),
      files: (json?.testResults ?? []).map((f) => ({
        file: relative(ROOT, f.name ?? ""),
        status: f.status,
        message: f.message ?? "",
      })),
      output: `${result.stdout}\n${result.stderr}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every test passed and none was skipped, todo or pending; returns the counts. */
export function judgeTests(report, label, r) {
  const counts = {};
  for (const t of r.tests) counts[t.status] = (counts[t.status] ?? 0) + 1;
  const notPassed = r.tests.filter((t) => t.status !== "passed");
  const brokenFiles = (r.files ?? []).filter((f) => f.status === "failed" && f.message !== "");
  const summary = Object.entries(counts)
    .map(([k, v]) => `${String(v)} ${k}`)
    .join(", ");
  report.check(
    r.code === 0 && r.tests.length > 0 && notPassed.length === 0 && brokenFiles.length === 0,
    `${label}: ${String(r.tests.length)} tests (${summary || "none"}), none skipped or failed`,
    notPassed.length > 0 || brokenFiles.length > 0
      ? [
          ...notPassed.map((t) => `--- [${t.status}] ${t.fullName}\n${t.failure}`),
          ...brokenFiles.map((f) => `--- ${f.file}\n${f.message}`),
        ]
          .join("\n")
          .slice(0, 20_000)
      : r.output.split("\n").slice(-60).join("\n"),
  );
  return { total: r.tests.length, passed: counts.passed ?? 0 };
}

/** Required titles each ran exactly once and passed. */
export function requireTitles(report, tests, titles) {
  for (const title of titles) {
    const hit = tests.filter((t) => t.title === title);
    report.check(
      hit.length === 1 && hit[0].status === "passed",
      `ran and passed: ${title}`,
      hit.length === 0 ? "not found" : hit.map((t) => t.status).join(", "),
    );
  }
}

/** Measurements the N3 tests append as JSON lines to NODE_MEASURE_FILE. */
export function readMeasurements(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

export function chromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
}

/** Playwright JSON report → [{ file, title, tags, status }] (last retry's status; skipped kept). */
export function playwrightResults(reportFile) {
  const out = [];
  if (!existsSync(reportFile)) return out;
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests ?? [])
        out.push({
          file: spec.file ?? file,
          title: spec.title,
          project: t.projectName ?? "",
          status: t.status === "skipped" ? "skipped" : (t.results?.at(-1)?.status ?? "skipped"),
          error: (t.results?.at(-1)?.errors ?? []).map((e) => e.message ?? "").join("\n"),
        });
    for (const child of suite.suites ?? []) walk(child, suite.file ?? file);
  };
  for (const s of JSON.parse(readFileSync(reportFile, "utf8")).suites ?? []) walk(s, s.file);
  return out;
}

// ---------------------------------------------------------------------------------------------
// N2: interfaces
// ---------------------------------------------------------------------------------------------

/** Workspace packages that depend on any of `names`, directly or transitively. */
export function consumersOf(names) {
  const packages = listWorkspacePackages(ROOT);
  const deps = (m) =>
    Object.keys({ ...m.dependencies, ...m.devDependencies, ...m.peerDependencies }).filter((d) =>
      d.startsWith("@mealplanner/"),
    );
  const found = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const { manifest } of packages) {
      if (found.has(manifest.name)) continue;
      if (deps(manifest).some((d) => names.includes(d) || found.has(d))) {
        found.add(manifest.name);
        grew = true;
      }
    }
  }
  return packages.filter((p) => found.has(p.manifest.name));
}

/** Subpaths of `pkg` imported anywhere in the consumers' sources (`@scope/pkg/x/y` → "x/y"). */
function importedSubpaths(pkgName, consumerDirs) {
  const subpaths = new Set();
  const re = new RegExp(`["']${pkgName.replace("/", "\\/")}(?:/([a-z0-9/_-]+))?["']`, "g");
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", ".next", ".turbo"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|mts)$/.test(entry.name))
        for (const m of readFileSync(path, "utf8").matchAll(re)) subpaths.add(m[1] ?? "");
    }
  };
  for (const dir of consumerDirs) walk(join(ROOT, dir));
  return [...subpaths].sort();
}

/**
 * The types a consumer resolves for `pkg/subpath` through the package's `exports` map, which must
 * be a built declaration file under dist/ (the published types, not src/).
 */
function exportedTypes(manifest, pkgDir, subpath) {
  const exportsMap = manifest.exports ?? {};
  const key = subpath === "" ? "." : `./${subpath}`;
  let entry = exportsMap[key];
  let star = "";
  if (entry === undefined && subpath !== "") {
    entry = exportsMap["./*"];
    star = subpath;
  }
  if (entry === undefined) return null;
  const types = typeof entry === "string" ? entry : (entry.types ?? entry.default);
  return join(pkgDir, types.replace("*", star));
}

export async function gateN2(report, node) {
  if (!(await buildPackages(report))) return;
  const names = node.branchPackages.map((p) => `@mealplanner/${p}`);
  const consumers = consumersOf(names);
  console.log(`       branch packages: ${names.join(", ")}`);
  console.log(`       consumers: ${consumers.map((c) => c.manifest.name).join(", ")}`);
  report.check(
    consumers.length > 0,
    `the branch packages have workspace consumers (${String(consumers.length)})`,
  );

  // 1. Consumers resolve the branch packages' published types in dist/.
  for (const name of names) {
    const dir = join(ROOT, "packages", name.split("/")[1]);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const subpaths = importedSubpaths(
      name,
      consumers.map((c) => c.dir),
    );
    const bad = [];
    for (const sub of subpaths) {
      const file = exportedTypes(manifest, dir, sub);
      if (
        file === null ||
        relative(join(dir, "dist"), file).startsWith("..") ||
        !file.endsWith(".d.ts") ||
        !existsSync(file)
      )
        bad.push(`${name}${sub === "" ? "" : `/${sub}`} → ${file ?? "no export"}`);
    }
    report.check(
      subpaths.length > 0 && bad.length === 0,
      `${name}: all ${String(subpaths.length)} imported entry points resolve to built declarations in dist/`,
      bad.join("\n"),
    );
  }

  // 2. Every consumer typechecks against them.
  const typechecks = await Promise.all(
    consumers.map(async (c) => {
      const started = Date.now();
      const r = await runAsync("pnpm", ["run", "typecheck"], {
        cwd: join(ROOT, c.dir),
        timeoutMs: 1_200_000,
      });
      return { c, r, seconds: Math.round((Date.now() - started) / 1000) };
    }),
  );
  for (const { c, r, seconds } of typechecks)
    report.check(
      r.code === 0,
      `${c.manifest.name} typechecks against the branch packages (${String(seconds)} s)`,
      tail(r, 40),
    );

  // 3. The api-contract contract tests.
  const server = await acquireServer(report, `${node.label}-n2`);
  try {
    const contract = await vitestRun(
      WEB,
      ["test/api/g1-contract-matrix.int.test.ts", "test/api/g3-openapi.int.test.ts"],
      { DATABASE_URL: server.url, LOG_LEVEL: "silent" },
    );
    const counts = judgeTests(
      report,
      "@mealplanner/api-contract contract tests (g1, g3)",
      contract,
    );
    const files = new Set(contract.tests.map((t) => t.file));
    report.check(
      files.has("apps/web/test/api/g1-contract-matrix.int.test.ts") &&
        files.has("apps/web/test/api/g3-openapi.int.test.ts") &&
        counts.total > 0,
      "both contract test files ran",
      [...files].join("\n"),
    );
  } finally {
    server.stop();
  }

  // 4. Negative control: an incompatible change to an exported type fails a consumer's typecheck.
  await n2NegativeControl(report, node.n2Control);
}

/**
 * In a disposable copy: the consumer typechecks, then one exported type of a branch package
 * changes incompatibly, the package is rebuilt, and the consumer's typecheck fails in its own file.
 */
async function n2NegativeControl(report, control) {
  const copy = copyWorkspace(ROOT);
  try {
    const install = installCopy(copy.dir);
    if (!report.check(install.code === 0, "negative control: the copy installs", tail(install)))
      return;
    const build = await runAsync(
      "pnpm",
      ["exec", "turbo", "run", "build", "--filter=./packages/*", "--filter=@mealplanner/worker"],
      { cwd: copy.dir, timeoutMs: 1_200_000 },
    );
    if (!report.check(build.code === 0, "negative control: the copy builds", tail(build, 40)))
      return;
    const consumerDir = join(copy.dir, control.consumerDir);
    const before = await runAsync("pnpm", ["run", "typecheck"], {
      cwd: consumerDir,
      timeoutMs: 1_200_000,
    });
    report.check(
      before.code === 0,
      `negative control is sound: ${control.consumer} typechecks in the unchanged copy`,
      tail(before, 30),
    );
    const file = join(copy.dir, control.file);
    const text = readFileSync(file, "utf8");
    const changed = text.replace(control.find, control.replace);
    if (
      !report.check(
        changed !== text,
        `negative control: ${control.description} (${control.file})`,
        `pattern ${String(control.find)} not found`,
      )
    )
      return;
    writeFileSync(file, changed);
    const rebuild = await runAsync("pnpm", ["run", "build"], {
      cwd: join(copy.dir, control.packageDir),
      timeoutMs: 600_000,
    });
    report.check(
      rebuild.code === 0,
      `negative control: ${control.packageDir} still builds with the changed type`,
      tail(rebuild, 30),
    );
    const after = await runAsync("pnpm", ["run", "typecheck"], {
      cwd: consumerDir,
      timeoutMs: 1_200_000,
    });
    const output = `${after.stdout}\n${after.stderr}`;
    const errors = output
      .split("\n")
      .filter((line) => /error TS\d+/.test(line))
      .map((line) => line.trim());
    report.check(
      after.code !== 0 && errors.length > 0 && errors.some((l) => control.expectError.test(l)),
      `negative control: ${control.consumer}'s typecheck fails on the changed type (${String(errors.length)} error(s), e.g. ${errors[0] ?? "none"})`,
      output.split("\n").slice(-40).join("\n"),
    );
  } finally {
    copy.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// N4: the full suite on the integration tree
// ---------------------------------------------------------------------------------------------

/** Workspace packages with a given script, as { dir, name }. */
function withScript(script) {
  return listWorkspacePackages(ROOT)
    .filter((p) => typeof p.manifest.scripts?.[script] === "string")
    .map((p) => ({ dir: p.dir, name: p.manifest.name }));
}

/**
 * Runs `script` (test:unit or test:integration) of every workspace package that has it, through
 * the package's own script with a JSON report appended. Returns per-package results.
 */
export async function runVitestSuite(root, script, env = {}) {
  const packages = listWorkspacePackages(root).filter(
    (p) => typeof p.manifest.scripts?.[script] === "string",
  );
  const out = [];
  for (const p of packages) {
    const dir = mkdtempSync(join(tmpdir(), "node-gate-suite-"));
    const file = join(dir, "report.json");
    try {
      const r = await runAsync(
        "pnpm",
        ["run", script, "--reporter=json", `--outputFile.json=${file}`, "--reporter=default"],
        { cwd: join(root, p.dir), env, timeoutMs: 2_400_000 },
      );
      const json = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
      out.push({
        name: p.manifest.name,
        code: r.code,
        reported: json !== null,
        tests: collectVitest(json),
        files: (json?.testResults ?? []).map((f) => ({
          file: f.name ?? "",
          status: f.status,
          message: f.message ?? "",
        })),
        output: `${r.stdout}\n${r.stderr}`,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return out;
}

/** The verdict on a suite's results: every package exited 0 and reported, nothing failed or skipped. */
export function judgeSuite(results) {
  const problems = [];
  let total = 0;
  let passed = 0;
  for (const r of results) {
    total += r.tests.length;
    passed += r.tests.filter((t) => t.status === "passed").length;
    if (r.code !== 0) problems.push(`${r.name}: exit ${String(r.code)}`);
    if (!r.reported) problems.push(`${r.name}: no JSON report`);
    for (const t of r.tests.filter((x) => x.status !== "passed"))
      problems.push(`${r.name}: [${t.status}] ${t.fullName}`);
    for (const f of r.files.filter((x) => x.status === "failed" && x.message !== ""))
      problems.push(`${r.name}: ${relative(ROOT, f.file)}: ${f.message.split("\n")[0]}`);
  }
  return { total, passed, problems, ok: total > 0 && problems.length === 0 };
}

function reportSuite(report, label, results) {
  for (const r of results) {
    const counts = {};
    for (const t of r.tests) counts[t.status] = (counts[t.status] ?? 0) + 1;
    console.log(
      `       ${label} ${r.name}: ${String(r.tests.length)} tests (${
        Object.entries(counts)
          .map(([k, v]) => `${String(v)} ${k}`)
          .join(", ") || "none"
      }), exit ${String(r.code)}`,
    );
  }
  const verdict = judgeSuite(results);
  const failedOutput = results
    .filter((r) => r.code !== 0)
    .map((r) => `--- ${r.name}\n${r.output.split("\n").slice(-40).join("\n")}`)
    .join("\n");
  report.check(
    verdict.ok,
    `${label}: ${String(verdict.passed)} of ${String(verdict.total)} tests passed in ${String(results.length)} packages, none failed or skipped`,
    `${verdict.problems.join("\n")}\n${failedOutput}`.slice(0, 30_000),
  );
  return verdict;
}

// Web e2e (SPEC-Q-1): every Playwright spec of apps/web, once per tag group, each group in the
// environment its leaf's verify script gives that tag (fresh database, the worker, the stubs).

/** The runs that make up the web e2e suite: a spec file (default config) or a whole config. */
const E2E_SPECS = [
  { file: "e2e/shell.spec.ts", env: "shell" },
  { file: "e2e/config.spec.ts", env: "app", worker: (tag) => tag !== "@G3" },
  { file: "e2e/plan.spec.ts", env: "app", worker: () => true, graph: ["@G3", "@1.4.8-G5"] },
  { file: "e2e/setup.spec.ts", env: "app", worker: () => true },
  { file: "e2e/chat.spec.ts", env: "chat" },
  { file: "e2e/admin.spec.ts", env: "admin" },
  { config: "test/chat/playwright.config.ts", env: "updates" },
  { config: "e2e/node-1.4/playwright.config.ts", env: "node14" },
];

const PLAYWRIGHT_CLI = (webDir) => join(webDir, "node_modules/@playwright/test/cli.js");

/** Every Playwright config of apps/web (outside node_modules and build output). */
function playwrightConfigs(webDir) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", "dist", ".turbo"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "playwright.config.ts") found.push(relative(webDir, path));
    }
  };
  walk(webDir);
  return found.sort();
}

/** `playwright test --list` for a config (and optional file): [{ file, title }]. */
async function listTests(webDir, config, file) {
  const dir = mkdtempSync(join(tmpdir(), "node-gate-list-"));
  const reportFile = join(dir, "list.json");
  try {
    const r = await runAsync(
      process.execPath,
      [
        PLAYWRIGHT_CLI(webDir),
        "test",
        "--config",
        config,
        ...(file ? [file] : []),
        "--list",
        "--reporter=json",
      ],
      { cwd: webDir, env: { PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile }, timeoutMs: 300_000 },
    );
    if (r.code !== 0) throw new Error(`playwright --list ${config} ${file ?? ""}:\n${tail(r, 30)}`);
    // Spec paths in the report are relative to the config's test directory (config.rootDir).
    const rootDir = JSON.parse(readFileSync(reportFile, "utf8")).config?.rootDir ?? webDir;
    return playwrightResults(reportFile).map((t) => ({
      file: relative(webDir, join(rootDir, t.file)),
      title: t.title,
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tagOf = (title) => /^(@[\w.-]+)/.exec(title)?.[1] ?? null;
const grepFor = (tag) => `${tag.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?![\\w.-])`;

// A minimal SMTP sink for admin.spec.ts (the protocol leaf 1.4.6's verify script speaks): every
// message is written to MAIL_DIR as JSON { to, subject, text, at }, which is what the spec reads.
function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function parseMail(raw) {
  const split = raw.search(/\r?\n\r?\n/);
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split).replace(/^\r?\n\r?\n/, "");
  const headers = head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  const header = (name) =>
    headers
      .find((h) => h.toLowerCase().startsWith(`${name.toLowerCase()}:`))
      ?.slice(name.length + 1)
      .trim() ?? "";
  const encoding = header("Content-Transfer-Encoding").toLowerCase();
  const text =
    encoding === "quoted-printable"
      ? decodeQuotedPrintable(body)
      : encoding === "base64"
        ? Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8")
        : body;
  return { subject: header("Subject"), text };
}

function startSmtp(dir) {
  let count = 0;
  const server = createNetServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let inData = false;
    let to = [];
    const reply = (line) => socket.write(`${line}\r\n`);
    const pump = () => {
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          const raw = buffer
            .slice(0, end)
            .split("\r\n")
            .map((l) => (l.startsWith("..") ? l.slice(1) : l))
            .join("\r\n");
          buffer = buffer.slice(end + 5);
          inData = false;
          const { subject, text } = parseMail(raw);
          count += 1;
          writeFileSync(
            join(dir, `${String(Date.now())}-${String(count).padStart(4, "0")}.json`),
            JSON.stringify({ to: to.join(", "), subject, text, at: Date.now() }),
          );
          to = [];
          reply("250 OK queued");
          continue;
        }
        const eol = buffer.indexOf("\r\n");
        if (eol === -1) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO") socket.write("250-localhost\r\n250 8BITMIME\r\n");
        else if (verb === "HELO") reply("250 localhost");
        else if (verb === "RCPT") {
          to.push(
            line
              .replace(/^RCPT TO:\s*/i, "")
              .replace(/[<>]/g, "")
              .trim(),
          );
          reply("250 OK");
        } else if (verb === "DATA") {
          inData = true;
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (verb === "RSET") {
          to = [];
          reply("250 OK");
        } else if (verb === "QUIT") {
          socket.end("221 Bye\r\n");
          return;
        } else reply("250 OK");
      }
    };
    reply("220 localhost ESMTP node-gate stub");
    socket.on("data", (chunk) => {
      buffer += chunk;
      pump();
    });
    socket.on("error", () => undefined);
  });
  return new Promise((resolveStart) => {
    server.listen(0, "127.0.0.1", () => {
      resolveStart({ port: server.address().port, stop: () => server.close() });
    });
  });
}

/** A background process whose output is kept (bounded) for failure messages. */
function background(command, args, { cwd, env }) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...CHILD_ENV, ...env } });
  let output = "";
  child.stdout.on("data", (d) => (output = (output + d).slice(-20_000)));
  child.stderr.on("data", (d) => (output = (output + d).slice(-20_000)));
  return {
    output: () => output,
    stop: () =>
      new Promise((resolveStop) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
        child.once("close", () => resolveStop());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000);
      }),
  };
}

async function waitForHttp(url, ms = 120_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      if ((await globalThis.fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${url} did not answer`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * One run of the web e2e suite: `spec` (a file under the default config, or a whole config) with
 * `tag` (or everything), in its environment. Returns the Playwright results and the output.
 */
async function e2eRun({ webDir, distDir, server, spec, tag }) {
  const scratch = mkdtempSync(join(tmpdir(), "node-gate-e2e-"));
  const reportFile = join(scratch, "report.json");
  const processes = [];
  let db;
  let smtp;
  try {
    const port = await freePort();
    const appUrl = `http://localhost:${String(port)}`;
    const secret = randomBytes(32).toString("base64url");
    const env = {
      MISE_NEXT_DIST_DIR: distDir,
      PLAYWRIGHT_PORT: String(port),
      PLAYWRIGHT_SKIP_BUILD: "1",
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
      PLAYWRIGHT_OUTPUT_DIR: join(scratch, "artefacts"),
      SHELL_SCREENSHOT_DIR: join(scratch, "shots"),
      SETUP_SCREENSHOT_DIR: join(scratch, "shots"),
      SCREENSHOT_DIR: join(scratch, "shots"),
      LEAF143_TRACE_DIR: join(scratch, "trace"),
      ...(chromium() === undefined ? {} : { PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromium() }),
    };
    if (spec.env === "shell") {
      // R-50 / W-1: the shell e2e runs without a database.
      env.DATABASE_URL = "";
    } else {
      db = await createDatabase(server, "node_e2e");
      const seed = await import(
        pathToFileURL(join(ROOT, "packages/db/dist/src/seed/index.js")).href
      );
      const migrations = await import(
        pathToFileURL(join(ROOT, "packages/db/dist/src/migrations/index.js")).href
      );
      // admin.spec.ts works on a migrated database without the catalogue (leaf 1.4.6).
      if (spec.env === "admin") await migrations.runMigrations(db.url);
      else if (spec.env !== "node14") await seed.migrateAndSeed(db.url);
      Object.assign(env, { DATABASE_URL: db.url, AUTH_SECRET: secret, APP_URL: appUrl });
      if (spec.env === "node14")
        Object.assign(env, {
          DATABASE_URL: "",
          NODE_DB_URL: db.url,
          NODE_DIST_DIR: distDir,
          NODE_PORT: String(port),
          NODE_MEASURE_FILE: join(scratch, "measure.jsonl"),
        });
      if (spec.graph?.includes(tag)) {
        const kg = await runAsync(process.execPath, ["scripts/kg-rebuild.ts"], {
          cwd: ROOT,
          env: { DATABASE_URL: db.url },
          timeoutMs: 600_000,
        });
        if (kg.code !== 0) throw new Error(`kg-rebuild failed:\n${tail(kg, 30)}`);
      }
      const wantsWorker =
        spec.env === "chat" || spec.env === "updates" || (spec.env === "app" && spec.worker(tag));
      if (wantsWorker) {
        const worker = background(process.execPath, ["dist/src/main.js"], {
          cwd: WORKER,
          env: { DATABASE_URL: db.url, DATA_DIR: join(ROOT, "data"), LOG_LEVEL: "warn" },
        });
        processes.push(worker);
      }
      if (spec.env === "chat") {
        env.WORLD_FILE = join(scratch, "world.json");
        env.NODE_OPTIONS = `--import ${pathToFileURL(join(webDir, "e2e/chat/agent-stub.mjs")).href}`;
        // The same build without the scripted model, for the chat route's 503 (leaf 1.4.5 G3).
        const bare = await freePort();
        const noModel = background(
          process.execPath,
          [join(webDir, "node_modules/next/dist/bin/next"), "start", "--port", String(bare)],
          {
            cwd: webDir,
            env: {
              MISE_NEXT_DIST_DIR: distDir,
              DATABASE_URL: db.url,
              AUTH_SECRET: secret,
              APP_URL: `http://localhost:${String(bare)}`,
            },
          },
        );
        processes.push(noModel);
        await waitForHttp(`http://localhost:${String(bare)}/offline`);
        env.PLAYWRIGHT_PORT_NO_MODEL = String(bare);
      }
      if (spec.env === "updates") env.WORLD_FILE = join(scratch, "world.json");
      if (spec.env === "admin") {
        const mailDir = join(scratch, "mail");
        mkdirSync(mailDir);
        smtp = await startSmtp(mailDir);
        Object.assign(env, {
          EMAIL_SERVER: `smtp://127.0.0.1:${String(smtp.port)}`,
          EMAIL_FROM: "Mise <no-reply@example.com>",
          MAIL_DIR: mailDir,
        });
      }
      if (spec.env === "updates") {
        // Its config starts `next start` itself and never builds (leaf 1.4.9).
        env.APP_URL = appUrl;
      }
    }
    const args = spec.file
      ? ["test", spec.file, ...(tag === null ? [] : ["--grep", grepFor(tag)])]
      : ["test", "--config", spec.config];
    const r = await runAsync(
      process.execPath,
      [PLAYWRIGHT_CLI(webDir), ...args, "--reporter=list,json"],
      {
        cwd: webDir,
        env,
        timeoutMs: 3_000_000,
      },
    );
    return { r, tests: playwrightResults(reportFile), processes: processes.map((p) => p.output()) };
  } finally {
    for (const p of processes.reverse()) await p.stop();
    smtp?.stop();
    if (db !== undefined) await db.drop().catch(() => undefined);
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The web e2e suite (SPEC-Q-1): every spec file and tag group; returns the per-run results. */
export async function runE2ESuite(report, { webDir, distDir, server }) {
  // Coverage: every Playwright config and every spec file it collects is one of E2E_SPECS.
  const configs = playwrightConfigs(webDir);
  const knownConfigs = new Set([
    "playwright.config.ts",
    ...E2E_SPECS.filter((s) => s.config).map((s) => s.config),
  ]);
  report.check(
    configs.every((c) => knownConfigs.has(c)),
    `every Playwright config of apps/web is run (${configs.join(", ")})`,
    configs.filter((c) => !knownConfigs.has(c)).join("\n"),
  );
  const defaultTests = await listTests(webDir, "playwright.config.ts");
  const defaultFiles = [...new Set(defaultTests.map((t) => t.file))].sort();
  const knownFiles = new Set(E2E_SPECS.filter((s) => s.file).map((s) => s.file));
  report.check(
    defaultFiles.every((f) => knownFiles.has(f)),
    `every spec file of the default config is run (${defaultFiles.join(", ")})`,
    defaultFiles.filter((f) => !knownFiles.has(f)).join("\n"),
  );

  const runs = [];
  for (const spec of E2E_SPECS) {
    if (spec.config) {
      const listed = await listTests(webDir, spec.config);
      runs.push({ spec, tag: null, label: spec.config, expected: listed.map((t) => t.title) });
      continue;
    }
    const listed = defaultTests.filter((t) => t.file === spec.file);
    const untagged = listed.filter((t) => tagOf(t.title) === null);
    report.check(
      listed.length > 0 && untagged.length === 0,
      `${spec.file}: ${String(listed.length)} tests, every one in a tag group`,
      untagged.map((t) => t.title).join("\n") || "no tests listed",
    );
    const tags = [...new Set(listed.map((t) => tagOf(t.title)).filter((t) => t !== null))].sort();
    for (const tag of tags)
      runs.push({
        spec,
        tag,
        label: `${spec.file} ${tag}`,
        expected: listed.filter((t) => tagOf(t.title) === tag).map((t) => t.title),
      });
  }

  const jobs = Math.max(1, Number(process.env.NODE_E2E_JOBS ?? "2") || 2);
  const queue = [...runs];
  const done = new Map();
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      for (let run = queue.shift(); run !== undefined; run = queue.shift()) {
        const started = Date.now();
        try {
          const out = await e2eRun({ webDir, distDir, server, spec: run.spec, tag: run.tag });
          done.set(run.label, { ...out, seconds: Math.round((Date.now() - started) / 1000) });
        } catch (error) {
          done.set(run.label, { error: String(error?.stack ?? error), tests: [], seconds: 0 });
        }
      }
    }),
  );
  let total = 0;
  let passed = 0;
  for (const run of runs) {
    const out = done.get(run.label);
    const tests = out?.tests ?? [];
    total += tests.length;
    passed += tests.filter((t) => t.status === "passed").length;
    const bad = tests.filter((t) => t.status !== "passed");
    const missing = run.expected.filter((title) => !tests.some((t) => t.title === title));
    const ok =
      out?.error === undefined &&
      out?.r?.code === 0 &&
      bad.length === 0 &&
      missing.length === 0 &&
      tests.length > 0;
    if (!ok)
      console.log(
        `----- ${run.label} (exit ${String(out?.r?.code)}) -----\n${out?.error ?? tail(out.r, 80)}\n${(out?.processes ?? []).map((o) => o.slice(-3000)).join("\n")}`,
      );
    report.check(
      ok,
      `e2e ${run.label}: ${String(tests.length - bad.length)} of ${String(run.expected.length)} tests passed (${String(out?.seconds)} s)`,
      [
        ...bad.map((t) => `[${t.status}] ${t.title}\n${t.error.slice(0, 1500)}`),
        ...missing.map((m) => `[not run] ${m}`),
      ].join("\n"),
    );
  }
  report.check(
    total > 0 && passed === total,
    `web e2e suite: ${String(passed)} of ${String(total)} tests passed in ${String(runs.length)} runs, none skipped`,
  );
}

/** N4: format, lint, typecheck, build, unit, integration, web e2e; plus the negative control. */
export async function gateN4(report, node) {
  if (!(await buildPackages(report))) return;
  const step = async (label, command, args, cwd = ROOT, env = {}) => {
    const started = Date.now();
    const r = await runAsync(command, args, { cwd, env, timeoutMs: 1_800_000 });
    report.check(
      r.code === 0,
      `${label} (${String(Math.round((Date.now() - started) / 1000))} s)`,
      tail(r, 60),
    );
    return r;
  };
  await step("pnpm format:check exits 0", "pnpm", ["format:check"]);
  await step("pnpm lint exits 0", "pnpm", ["lint"]);

  // typecheck: every workspace package's own typecheck script (not turbo, whose cache can replay
  // an earlier result), and the root's `tsc -p scripts`.
  const typecheckers = withScript("typecheck");
  const typechecks = await Promise.all(
    typecheckers.map(async (p) => ({
      p,
      r: await runAsync("pnpm", ["run", "typecheck"], {
        cwd: join(ROOT, p.dir),
        timeoutMs: 1_200_000,
      }),
    })),
  );
  for (const { p, r } of typechecks) report.check(r.code === 0, `typecheck ${p.name}`, tail(r, 40));
  await step("typecheck scripts (tsc -p scripts)", process.execPath, [
    join(ROOT, "node_modules/typescript/bin/tsc"),
    "-p",
    "scripts",
  ]);

  // build: each package's and the worker's compile into a private directory (concurrent gates keep
  // reading the shared dist/), and `next build` into this gate's own directory (R-50).
  const outRoot = mkdtempSync(join(tmpdir(), `${node.label}-n4-build-`));
  try {
    const builders = withScript("build").filter((p) => p.dir !== "apps/web");
    const builds = await Promise.all(
      builders.map(async (p) => ({
        p,
        r: await runAsync(
          process.execPath,
          [
            join(ROOT, "node_modules/typescript/bin/tsc"),
            "-p",
            "tsconfig.json",
            "--outDir",
            join(outRoot, p.dir),
          ],
          { cwd: join(ROOT, p.dir), timeoutMs: 1_200_000 },
        ),
      })),
    );
    for (const { p, r } of builds) report.check(r.code === 0, `build ${p.name} (tsc)`, tail(r, 40));
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
  const distDir = distDirFor(node.label, "N4");
  if (!(await buildWeb(report, distDir))) return;

  const server = await acquireServer(report, `${node.label}-n4`);
  try {
    reportSuite(report, "test:unit", await runVitestSuite(ROOT, "test:unit"));
    reportSuite(
      report,
      "test:integration",
      await runVitestSuite(ROOT, "test:integration", { DATABASE_URL: server.url }),
    );
    await runE2ESuite(report, { webDir: WEB, distDir, server });
  } finally {
    server.stop();
  }

  // Negative control: a disposable copy with one failing unit test fails the same unit verdict.
  const copy = copyWorkspace(ROOT);
  try {
    const install = installCopy(copy.dir);
    if (!report.check(install.code === 0, "negative control: the copy installs", tail(install)))
      return;
    const build = await runAsync(
      "pnpm",
      ["exec", "turbo", "run", "build", "--filter=./packages/*", "--filter=@mealplanner/worker"],
      { cwd: copy.dir, timeoutMs: 1_200_000 },
    );
    if (!report.check(build.code === 0, "negative control: the copy builds", tail(build, 30)))
      return;
    const title = "node N4 negative control: this unit test fails";
    writeFileSync(
      join(copy.dir, "packages/core/test/node-n4-control.test.ts"),
      `import { expect, it } from "vitest";\n\nit(${JSON.stringify(title)}, () => {\n  expect(1 + 1).toBe(3);\n});\n`,
    );
    const results = await runVitestSuite(copy.dir, "test:unit");
    const verdict = judgeSuite(results);
    const named = verdict.problems.some((p) => p.includes(title));
    console.log(
      `       measured (negative control): ${String(verdict.problems.length)} problem(s) in the copy: ${verdict.problems.slice(0, 3).join("; ")}`,
    );
    report.check(
      !verdict.ok && named,
      "negative control: one failing unit test in a copy fails the unit-suite verdict",
    );
  } finally {
    copy.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point shared by node-1.<n>.mjs
// ---------------------------------------------------------------------------------------------

/**
 * @param {{ label: string, gates: Record<string, (report: Report) => Promise<void>> }} node
 */
export async function nodeMain(node) {
  const i = process.argv.indexOf("--gate");
  const gate = i === -1 ? undefined : process.argv[i + 1];
  if (gate === undefined || node.gates[gate] === undefined) {
    console.error(
      `usage: node scripts/verify/${node.label}.mjs --gate ${Object.keys(node.gates).join("|")}`,
    );
    process.exit(2);
  }
  // The full output also goes to a log file (gate-check keeps only a bounded transcript).
  const logFile = join(tmpdir(), `${node.label}-${gate.toLowerCase()}-${String(process.pid)}.log`);
  writeFileSync(logFile, "");
  const print = console.log.bind(console);
  console.log = (...args) => {
    print(...args);
    try {
      appendFileSync(logFile, `${args.map(String).join(" ")}\n`);
    } catch {
      // The log is a convenience; the verdict does not depend on it.
    }
  };
  console.log(`full output: ${logFile}`);
  const report = new Report(`${node.label} ${gate}`);
  const started = Date.now();
  let code;
  try {
    await node.gates[gate](report);
  } catch (error) {
    report.check(false, "the gate ran to completion", String(error?.stack ?? error));
  } finally {
    const seconds = Math.round((Date.now() - started) / 1000);
    // R-70: elapsed time is the last `ok` line.
    report.check(true, `elapsed ${String(seconds)} s (gate ${gate})`);
    code = report.finish();
  }
  process.exit(code);
}

export { Report, randomBytes };
