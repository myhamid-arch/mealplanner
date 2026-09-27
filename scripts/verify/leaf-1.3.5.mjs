// Verify script for leaf 1.3.5 (admin agent loop and tools).
// Usage: node scripts/verify/leaf-1.3.5.mjs --gate G1|G2|G3
// Prints "VERIFY leaf-1.3.5 <gate> PASSED" only when every assertion holds, including the gate's
// negative controls; exits non-zero otherwise.
//
// Each gate builds the workspace packages its tests import (under a lock, only when stale, so gates
// can run concurrently), then runs:
// - the agent's unit tests in packages/ai with a scripted stub model (no credential is used), and
// - the route's integration test in apps/web against PostgreSQL 16, filtered to the gate. The test
//   file creates and drops its own database (api_<hex>), so concurrent gates never share one.
// Every named test and negative control must be present and pass, no test of the gate may be
// skipped, and the figures the tests measured (written to a per-run scratch file) are re-checked
// here, each re-check also run on a known-bad record that must fail.
//
// Database server: DATABASE_URL when set; otherwise postgres://postgres:postgres@localhost:5432/
// postgres when it answers; otherwise a throwaway PostgreSQL 16 cluster started from the local
// binaries and stopped on exit. Whichever is used must report server_version 16.x.
import { spawn } from "node:child_process";
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
const AI_DIR = join(ROOT, "packages/ai");
const DEFAULT_URLS = [
  "postgres://postgres:postgres@localhost:5432/postgres",
  "postgres://postgres@localhost:5432/postgres",
];
const PACKAGES = ["core", "db", "ai", "graph", "api-contract"];
const PROTECTED_CASES = [
  "removing an allergy exclusion",
  "relaxing an allergy exclusion to a dislike",
  "loosening a tolerance",
  "archiving a member",
  "retiring a dish with reviews",
  "changing a role",
];

const GATES = {
  G1: {
    title:
      "scripted stub model: parallel tool results in one message, invalid tool JSON returns is_error, refusal/max_tokens/pause_turn handled, iteration cap enforced (AGT-2)",
    ai: ["test/agent/g1-loop.test.ts", "test/agent/tools.test.ts"],
    aiFilter: "G1|tool definitions|the request carries",
    webFilter: "G1",
    required: [
      "G1 parallel tool calls run concurrently and all results return in one user message",
      "G1 an input that fails its schema returns is_error INVALID_JSON and the tool does not run",
      "G1 unknown tools and extra fields are refused before any port runs",
      "G1 the SDK's tool-JSON parse error re-issues the request (≤ 2) and then ends the turn",
      "G1 only the SDK's parse error is caught; typed API errors end the turn as errors",
      "G1 the real SDK stream: malformed tool JSON on the wire becomes ToolJsonError",
      "G1 refusal: no tool runs, the unrun calls are answered, the turn ends with a refusal event",
      "G1 max_tokens with a tool_use: the cut-off call does not run; without one the text is kept",
      "G1 pause_turn is resumed by sending the paused response back, with no extra user message",
      "G1 typed API errors end the turn with an error event and an audit record",
      "G1 an unexpected port failure answers is_error and the turn continues",
      "G1 an abort mid-stream ends the turn without storing a partial response",
      "G1 the cap: exactly 12 model calls, the last call's tools are not run, and a report is stored",
      "defines exactly the AGT-4 tools, each with eager input streaming and an object schema",
      "the request carries the fallback and compaction betas, adaptive thinking and effort",
      "G1 parallel tool calls through the route: results in one user message, events on the contract, audit rows",
      "G1 invalid tool input through the route: is_error INVALID_JSON, nothing runs, the turn continues",
      "G1 an aborted turn releases its lock: a concurrent POST gets 409, the next one succeeds",
      "G1 refusals before anything is stored: 503 without a model, 429 over the hourly limit, 404 and 403",
    ],
    negative: [
      "G1 negative control: results split over two user messages fail the one-message check",
      "G1 negative control: a transcript with an unanswered tool_use fails the history check",
    ],
  },
  G2: {
    title: "protected ops sent via apply_change become proposals, enforced server-side (AGT-5)",
    ai: ["test/agent/tools.test.ts"],
    aiFilter: "change tools",
    webFilter: "G2",
    required: [
      "a server refusal (protected) becomes an agent proposal with the same ops",
      "G2 every AGT-5 protected op sent through apply_change becomes a pending agent proposal",
      "G2 an unprotected op the admin asked for is applied as an agent change set",
      "G2 with 'assistant may apply' off, an unprotected op also becomes a proposal",
      "G2 an ingredient exclusion keyed by id is refused with the slug (R-36); access ops are refused",
    ],
    negative: [
      "G2 negative control: the same protected op without the server's agent enforcement is applied, and the check fails",
    ],
  },
  G3: {
    title: "history append-only: replayed stored blocks are byte-identical (AGT-8)",
    ai: ["test/agent/g3-history.test.ts"],
    aiFilter: "G3",
    webFilter: "G3",
    required: [
      "G3 three turns: each request extends the previous one byte-for-byte",
      "G3 three turns: each request replays the stored rows byte-for-byte; GET returns the stored blocks",
    ],
    negative: [
      "G3 negative control: requests without the digest, or unlike the stored rows, fail the check",
      "G3 negative control: an edited earlier message breaks the append-only check",
      "G3 negative control: an edited stored row no longer replays the bytes that were sent",
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Build (locked, only when stale)
// ---------------------------------------------------------------------------------------------

function newestMtime(dir) {
  let newest = 0;
  if (!existsSync(dir)) return newest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

function oldestMtime(dir) {
  if (!existsSync(dir)) return 0;
  let oldest = Infinity;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    oldest = Math.min(
      oldest,
      entry.isDirectory() ? oldestMtime(path) || Infinity : statSync(path).mtimeMs,
    );
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildLocked() {
  const lock = join(tmpdir(), "mealplanner-leaf-1.3.5-build.lock");
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
    const dirs = PACKAGES.map((p) => join(ROOT, "packages", p));
    if (!dirs.some(stale)) return { code: 0, stdout: "build up to date", stderr: "" };
    return run(
      "pnpm",
      [
        "exec",
        "turbo",
        "run",
        "build",
        ...PACKAGES.flatMap((p) => ["--filter", `@mealplanner/${p}`]),
      ],
      { cwd: ROOT, timeoutMs: 900_000 },
    );
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16
// ---------------------------------------------------------------------------------------------

async function query(url, text) {
  const pg = (await import(pathToFileURL(join(WEB_DIR, "node_modules/pg/lib/index.js")).href))
    .default;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await client.connect();
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
  const candidates = [
    fromConfig.code === 0 ? fromConfig.stdout.trim() : "",
    "/usr/lib/postgresql/16/bin",
  ];
  return candidates.find(
    (dir) => dir !== "" && existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl")),
  );
}

/** Starts a throwaway cluster; returns { url, stop }. Runs as the `postgres` user when root. */
async function startCluster() {
  const bin = pgBinDir();
  if (bin === undefined)
    throw new Error(
      "no DATABASE_URL, nothing on localhost:5432, and no PostgreSQL 16 binaries (initdb) found",
    );
  const asRoot = process.getuid?.() === 0;
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.3.5-pg-"));
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

async function acquireDatabase() {
  if (process.env.DATABASE_URL)
    return { url: process.env.DATABASE_URL, source: "DATABASE_URL", stop: () => undefined };
  for (const url of DEFAULT_URLS)
    if (await reachable(url)) return { url, source: "localhost:5432", stop: () => undefined };
  const cluster = await startCluster();
  return { ...cluster, source: "throwaway cluster" };
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

function vitest(cwd, files, filter, env) {
  const outputFile = join(mkdtempSync(join(tmpdir(), "leaf-1.3.5-vitest-")), "report.json");
  return new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        join(ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        "--reporter=json",
        "--reporter=default",
        `--outputFile.json=${outputFile}`,
        "-t",
        filter,
        ...files,
      ],
      { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const report = existsSync(outputFile) ? JSON.parse(readFileSync(outputFile, "utf8")) : null;
      rmSync(dirname(outputFile), { recursive: true, force: true });
      resolveRun({ code: code ?? -1, output, report });
    });
  });
}

function assertions(report) {
  return (report?.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
}

function measurements(file, gate) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((m) => m.gate === gate);
}

// ---------------------------------------------------------------------------------------------
// Re-checks of measured figures (each with a known-bad record that must fail)
// ---------------------------------------------------------------------------------------------

/** G1: the route turn stored user, assistant, tool, assistant and streamed its events. */
const g1Acceptable = (m) => m !== undefined && m.rows === 4 && m.events >= 6;

/** G2: every AGT-5 protected case became a proposal. */
const g2Acceptable = (m) =>
  m !== undefined &&
  m.kinds === PROTECTED_CASES.length &&
  PROTECTED_CASES.every((name) => m.names.includes(name));

/** G3: three turns, five model calls, every row stored. */
const g3Acceptable = (m) => m !== undefined && m.requests === 5 && m.rows >= 10;

function recheck(report, gate, measured) {
  const one = (check) => measured.find((m) => m.check === check);
  if (gate === "G1") {
    const m = one("route-parallel");
    console.log(`       measured: ${String(m?.events)} SSE events, ${String(m?.rows)} stored rows`);
    report.check(g1Acceptable(m), "the route turn streamed its events and stored 4 rows in order");
    report.check(
      !g1Acceptable({ ...m, rows: 3 }),
      "negative control: the same re-check rejects a turn with a missing row",
    );
  }
  if (gate === "G2") {
    const m = one("protected");
    console.log(
      `       measured: ${String(m?.kinds)} protected cases became proposals: ${(m?.names ?? []).join("; ")}`,
    );
    report.check(
      g2Acceptable(m),
      `all ${String(PROTECTED_CASES.length)} AGT-5 protected cases became proposals`,
    );
    report.check(
      !g2Acceptable({ kinds: m?.kinds - 1, names: (m?.names ?? []).slice(1) }),
      "negative control: the same re-check rejects a run missing one protected case",
    );
  }
  if (gate === "G3") {
    const m = one("replay");
    console.log(
      `       measured: ${String(m?.requests)} requests replayed from ${String(m?.rows)} stored rows`,
    );
    report.check(g3Acceptable(m), "three turns replayed from the stored rows");
    report.check(
      !g3Acceptable({ ...m, requests: 4 }),
      "negative control: the same re-check rejects a run with a missing request",
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const i = process.argv.indexOf("--gate");
  const gate = i === -1 ? undefined : process.argv[i + 1];
  const spec = gate === undefined ? undefined : GATES[gate];
  if (spec === undefined) {
    console.error(
      `usage: node scripts/verify/leaf-1.3.5.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    return 2;
  }
  const report = new Report(`leaf-1.3.5 ${gate}`);
  console.log(`# leaf-1.3.5 ${gate}: ${spec.title}`);

  const build = await buildLocked();
  if (!report.check(build.code === 0, "workspace packages build", tail(build)))
    return report.finish();

  const db = await acquireDatabase();
  try {
    const version = (await query(db.url, "SHOW server_version"))[0]?.server_version ?? "";
    if (!report.check(version.startsWith("16."), `PostgreSQL 16 (${db.source}: ${version})`))
      return report.finish();

    const scratch = mkdtempSync(join(tmpdir(), `leaf-1.3.5-${gate}-`));
    const measureFile = join(scratch, "measure.jsonl");
    try {
      const [ai, web] = await Promise.all([
        vitest(AI_DIR, spec.ai, spec.aiFilter, {}),
        vitest(WEB_DIR, ["test/api/conversations-messages.int.test.ts"], spec.webFilter, {
          DATABASE_URL: db.url,
          API_MEASURE_FILE: measureFile,
        }),
      ]);
      report.check(
        ai.code === 0,
        `packages/ai tests pass (${spec.ai.join(", ")})`,
        ai.output.split("\n").slice(-40).join("\n"),
      );
      report.check(
        web.code === 0,
        "apps/web route integration tests pass",
        web.output.split("\n").slice(-60).join("\n"),
      );
      const results = [...assertions(ai.report), ...assertions(web.report)];
      for (const name of [...spec.required, ...spec.negative]) {
        const found = results.filter((t) => t.title === name);
        report.check(
          found.length === 1 && found[0].status === "passed",
          `ran and passed: ${name}`,
          found.length === 0 ? "not found" : found.map((t) => t.status).join(", "),
        );
      }
      const skipped = results.filter(
        (t) =>
          t.status !== "passed" &&
          t.status !== "failed" &&
          [...spec.required, ...spec.negative].includes(t.title),
      );
      report.check(
        skipped.length === 0,
        "no test of the gate is skipped",
        skipped.map((t) => t.title).join("\n"),
      );
      recheck(report, gate, measurements(measureFile, gate));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } finally {
    db.stop();
  }
  return report.finish();
}

process.exitCode = await main();
