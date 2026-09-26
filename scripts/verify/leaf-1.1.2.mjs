// Verify script for leaf 1.1.2 (Schema, repositories, change-set service).
// Usage: node scripts/verify/leaf-1.1.2.mjs --gate G1|G2|G3|G4|G5|G6
// Prints "VERIFY leaf-1.1.2 <gate> PASSED" only when every assertion holds, including the gate's
// negative controls; exits non-zero otherwise.
//
// Database: DATABASE_URL when set; otherwise postgres://postgres@localhost:5432/postgres when it
// answers; otherwise a throwaway PostgreSQL 16 cluster started from the local binaries and stopped
// on exit. Whichever is used must report server_version 16.x.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DB_DIR = join(ROOT, "packages/db");
const CORE_DIR = join(ROOT, "packages/core");
const DEFAULT_URL = "postgres://postgres@localhost:5432/postgres";

/**
 * Per gate: the test files it runs, and the tests that must be present and pass (substring of the
 * full test name). `negative` names the negative-control tests; each gate has at least one.
 */
const GATES = {
  G1: {
    title:
      "migrations apply and re-run idempotently; introspection finds every 02/13 table and column",
    runs: [{ dir: DB_DIR, files: ["test/migrations.int.test.ts"] }],
    required: [
      "apply to an empty PostgreSQL 16 database and re-run idempotently",
      "introspection finds every table and column of 02, 13 and the BLD-8 rulings",
      "the database enforces the spec's value rules",
      "the committed migrations equal the TypeScript schema",
      "a database built from the migrations equals one built from the schema",
    ],
    negative: [
      "negative control: a missing column or table is reported",
      "negative control: an edited committed migration is detected",
      "negative control: a schema change without a migration is detected",
    ],
  },
  G2: {
    title: "cross-household access through every repository throws (DM-1)",
    runs: [{ dir: DB_DIR, files: ["test/repos.int.test.ts"] }],
    required: [
      "every household-owned table has a repository and a row of household A to attack",
      "global catalogue rows are readable by both households and writable by neither",
      "the change-set service and config reads are scoped too",
    ],
    negative: [
      "negative control: the same checks fail against a repository without household filtering",
    ],
  },
  G3: {
    title:
      "every AGT-6 op: apply then inverse restores the exact prior state on F1 and F3; protected ops flagged",
    runs: [{ dir: DB_DIR, files: ["test/changes.int.test.ts"] }],
    required: [
      "G3 on F1 the registry is exactly the AGT-6 v1 ops plus the BLD-8 R-10 ops",
      "G3 on F3 the registry is exactly the AGT-6 v1 ops plus the BLD-8 R-10 ops",
      "F1: a multi-op change set (every op kind once) is restored exactly",
      "F3: a multi-op change set (every op kind once) is restored exactly",
      "F1: every sampled op is flagged protected exactly when AGT-5 / R-10 says so",
      "F3: every sampled op is flagged protected exactly when AGT-5 / R-10 says so",
      "F1: conditionally protected ops are flagged on the relaxing branch only",
      "F3: conditionally protected ops are flagged on the relaxing branch only",
      "F1: the server turns protected agent_apply ops into a refusal and writes nothing",
      "F3: the server turns protected agent_apply ops into a refusal and writes nothing",
      "F1: rows.restore is internal and rejected as a public op",
      "F3: rows.restore is internal and rejected as a public op",
    ],
    negative: [
      "F1: negative control — a write that bypasses ChangeTx is not restored",
      "F3: negative control — a write that bypasses ChangeTx is not restored",
      "F1: negative control — an unflagged protected op is reported",
      "F3: negative control — an unflagged protected op is reported",
    ],
  },
  G4: {
    title: "undo refuses with a conflict when a later change set touched the same entity",
    runs: [{ dir: DB_DIR, files: ["test/undo.int.test.ts"] }],
    required: [
      "refuses, names the later change set, and keeps the later change",
      "an unrelated later change does not block the undo",
      "conflicts are found through child rows too",
      "the change log shows Undo disabled with the conflicting change",
      "an undone change set cannot be undone again",
    ],
    negative: ["negative control: without the conflict check, the later change is lost"],
  },
  G5: {
    title: "the service refuses to block, remove or demote the final admin (R2-ADM-4)",
    runs: [{ dir: DB_DIR, files: ["test/last-admin.int.test.ts"] }],
    required: [
      "a household with one admin: demote, block and remove are all refused and nothing is written",
      "with two admins one can be blocked; then the remaining admin is protected",
      "the rule applies to the change set's result",
    ],
    negative: [
      "negative control: the same attempts without the invariant take the last admin away",
    ],
  },
  G6: {
    title: "fixtures F1, F2, F3 load",
    runs: [
      { dir: CORE_DIR, files: ["test/fixtures/fixtures.test.ts"] },
      { dir: DB_DIR, files: ["test/fixtures.int.test.ts"] },
    ],
    required: [
      "F1 is the reference household of 11-build-plan §2",
      "F2 is one targeted adult with breakfast, lunch and dinner",
      "F3 is 8 members (5 targeted), 10 slots with 2 custom",
      "every catalogue reference of the fixtures exists in the fixture catalogue",
      "F1 loads and matches the fixture",
      "F2 loads and matches the fixture",
      "F3 loads and matches the fixture",
      "F1 stores the BLD-2 reference numbers and the C3 sesame allergy",
    ],
    negative: [
      "negative control: a dangling reference, a missing admin or an invalid target is rejected",
      "negative control: a fixture with an unknown catalogue key or a dangling reference is rejected and writes nothing",
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16
// ---------------------------------------------------------------------------------------------

/** Runs psql-free SQL through the pg driver installed in packages/db. */
async function query(url, text) {
  const pg = (await import(pathToFileURL(join(DB_DIR, "node_modules/pg/lib/index.js")).href))
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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.1.2-pg-"));
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
      `-p ${String(port)} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`,
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
  if (await reachable(DEFAULT_URL))
    return { url: DEFAULT_URL, source: "localhost:5432", stop: () => undefined };
  const cluster = await startCluster();
  return { ...cluster, source: "throwaway cluster" };
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

/** Runs Vitest with the JSON reporter; resolves to the parsed report (or null) and the output. */
function vitest(dir, files, env) {
  const outputFile = join(mkdtempSync(join(tmpdir(), "leaf-1.1.2-vitest-")), "report.json");
  return new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        join(ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        "--dir",
        "test",
        "--reporter=json",
        "--reporter=default",
        `--outputFile.json=${outputFile}`,
        ...files,
      ],
      { cwd: dir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
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

async function gate(id) {
  const spec = GATES[id];
  const report = new Report(`leaf-1.1.2 ${id}`);
  console.log(`# ${id}: ${spec.title}`);

  const build = run(
    "pnpm",
    ["--filter", "@mealplanner/core", "--filter", "@mealplanner/db", "build"],
    { cwd: ROOT },
  );
  if (!report.check(build.code === 0, "packages core and db build", tail(build)))
    return report.finish();

  const database = await acquireDatabase();
  try {
    const rows = await query(database.url, "SHOW server_version");
    const version = String(rows[0]?.server_version ?? "");
    report.check(
      /^16\./.test(version),
      `database (${database.source}) is PostgreSQL 16 (server_version ${version})`,
    );

    const results = [];
    for (const { dir, files } of spec.runs) {
      const result = await vitest(dir, files, { DATABASE_URL: database.url });
      const where = `${dir.slice(ROOT.length + 1)}: ${files.join(", ")}`;
      report.check(
        result.code === 0,
        `vitest exits 0 (${where})`,
        tail({ stdout: result.output, stderr: "" }, 60),
      );
      report.check(result.report !== null, `vitest wrote a JSON report (${where})`);
      results.push(...assertions(result.report));
    }

    const byStatus = (status) => results.filter((r) => r.status === status);
    console.log(
      `       tests: ${String(results.length)} (passed ${String(byStatus("passed").length)}, failed ${String(byStatus("failed").length)})`,
    );
    report.check(results.length > 0, "the gate ran tests");
    report.check(
      results.every((r) => r.status === "passed"),
      "every test passed; none failed, skipped, pending or todo",
      results
        .filter((r) => r.status !== "passed")
        .map((r) => `${r.status}: ${r.fullName}`)
        .join("\n"),
    );
    for (const name of [...spec.required, ...spec.negative]) {
      const matches = results.filter((r) => r.fullName.includes(name));
      report.check(
        matches.length > 0 && matches.every((r) => r.status === "passed"),
        `ran and passed: ${name}`,
      );
    }
    report.check(
      spec.negative.length > 0,
      `the gate has ${String(spec.negative.length)} negative control(s)`,
    );

    // Coverage measured from the built packages, not hard-coded.
    if (id === "G2") {
      const repos = await import(pathToFileURL(join(DB_DIR, "dist/src/repos/index.js")).href);
      const perRepository = results.filter((r) =>
        /repository \S+: get, list, update, remove and insert across households throw/.test(
          r.fullName,
        ),
      );
      const tested = new Set(perRepository.map((r) => /repository (\S+):/.exec(r.fullName)?.[1]));
      console.log(
        `       repositories: ${String(repos.REPOSITORY_NAMES.length)}, each attacked in both directions`,
      );
      report.check(
        repos.REPOSITORY_NAMES.length > 0 &&
          repos.REPOSITORY_NAMES.every((name) => tested.has(name)),
        `every repository (${String(repos.REPOSITORY_NAMES.length)}) has a passing cross-household test`,
        repos.REPOSITORY_NAMES.filter((n) => !tested.has(n)).join(", "),
      );
    }
    if (id === "G3") {
      const changes = await import(pathToFileURL(join(CORE_DIR, "dist/src/changes/index.js")).href);
      const kinds = changes.PUBLIC_OPS.map((op) => op.kind);
      console.log(`       registry ops: ${String(kinds.length)} public (+ internal rows.restore)`);
      for (const fixture of ["F1", "F3"]) {
        const missing = kinds.filter(
          (kind) =>
            !results.some(
              (r) =>
                r.status === "passed" &&
                r.fullName.includes(
                  `${fixture}: ${kind} — apply then inverse restores the exact prior state`,
                ),
            ),
        );
        report.check(
          missing.length === 0,
          `${fixture}: every one of the ${String(kinds.length)} ops passed apply → inverse → exact prior state`,
          missing.join(", "),
        );
      }
    }
  } finally {
    database.stop();
  }
  return report.finish();
}

const flag = process.argv.indexOf("--gate");
const id = flag === -1 ? undefined : process.argv[flag + 1];
if (id === undefined || !(id in GATES)) {
  console.error(`usage: node scripts/verify/leaf-1.1.2.mjs --gate ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
process.exit(await gate(id));
