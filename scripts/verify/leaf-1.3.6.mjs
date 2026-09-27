// Verify script for leaf 1.3.6 (live-model fixes, W-11, R-64, R-66, R-67).
// Usage:
//   node scripts/verify/leaf-1.3.6.mjs --gate G1|G2
//   ANTHROPIC_API_KEY=… node scripts/verify/leaf-1.3.6.mjs --measure <dishes>   (live, costs money)
// A gate prints "VERIFY leaf-1.3.6 <gate> PASSED" only when every assertion holds, including its
// negative controls; it exits non-zero otherwise.
//
// G1 runs leaf 1.3.1's G1–G3 (which build core and ai) and 1.4.1's G2 (R-67), this leaf's recipe
// tests, and then checks the budget with this script's own arithmetic against the live measurements
// logged in docs/build/live/leaf-1.3.6-budget-measure-*.log, on the wire through the recorded SDK
// client, and the R-67 follow-up (it fills candidates; an infeasible dish counts as missing).
// G2 runs leaf 1.3.5's G1–G3 (which build the workspace and need PostgreSQL 16), this leaf's agent
// tests and the web test proving get_household carries the logins (R-67), and then checks the
// diagnosis record, grades the logged live transcripts, and compares the eval set with the one that
// failed (commit 9d23db6): only the case R-66 ruled on may differ.
// Database for the web test: DATABASE_URL, else localhost:5432, else a throwaway PostgreSQL 16
// cluster (the same order as leaf 1.3.5's script).
// Both gates hold one lock for their whole run, because the two dependency scripts build the same
// dist directories under different locks.
//
// --measure <n> streams the real recipe request for n F1 dinner dishes at a 64 000-token budget and
// prints one JSON line {count, model, stop, out, …}: the format G1 reads (ADR-1).
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AI = join(ROOT, "packages/ai");
const LIVE = join(ROOT, "docs/build/live");
const LOCK = join(ROOT, "node_modules/.cache/leaf-1.3.6/gate.lock");
const LOCK_WAIT_MS = 60 * 60_000;
const LOCK_STALE_MS = 90 * 60_000;
/** The commit whose eval set failed live (W-11): the reference for "expectations unchanged". */
const FAILED_EVAL_COMMIT = "9d23db6";
const FAILED_CASES = ["allergy-sesame", "weekend-appeal", "make-sara-admin"];
/** R-66: the one expectation the architect allowed to change, and to what. */
const RULED = {
  ruling: "R-66",
  caseId: "allergy-sesame",
  match: { kind: "dietary_flag", key: "contains_sesame", reason: "allergy", hard: true },
};
/** Budget rule of ADR-1, restated here: 20 000 tokens per dish, capped at 128 000. */
const expectedBudget = (n) => Math.min(128_000, 20_000 * n);

// ---------------------------------------------------------------------------------------------
// Lock, dependency gates, tests
// ---------------------------------------------------------------------------------------------

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** True while the process that took the lock is alive (a killed gate must not block the next). */
function holderAlive() {
  try {
    const pid = Number(readFileSync(join(LOCK, "pid"), "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error?.code === "EPERM";
  }
}

async function withLock(fn) {
  mkdirSync(dirname(LOCK), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "pid"), String(process.pid));
      break;
    } catch {
      try {
        // A lock without a live holder is stale: its gate was killed (e.g. by a checker timeout).
        const age = Date.now() - statSync(LOCK).mtimeMs;
        if ((age > 2_000 && !holderAlive()) || age > LOCK_STALE_MS)
          rmSync(LOCK, { recursive: true, force: true });
      } catch {
        // Released between the two calls.
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`timed out waiting for ${LOCK}`);
      sleep(500);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

/** Runs another leaf's gate and requires its own PASSED marker. */
function dependencyGate(report, leaf, gate) {
  const result = run(
    process.execPath,
    [join(ROOT, `scripts/verify/leaf-${leaf}.mjs`), "--gate", gate],
    {
      cwd: ROOT,
      timeoutMs: 30 * 60_000,
    },
  );
  return report.check(
    result.code === 0 && result.stdout.includes(`VERIFY leaf-${leaf} ${gate} PASSED`),
    `leaf ${leaf} ${gate} passes (its own verify script)`,
    tail(result, 40),
  );
}

/** Runs Vitest files in packages/ai; every named test must be present and pass, none skipped. */
function vitest(report, label, files, required, { cwd = AI, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.3.6-vitest-"));
  const outputFile = join(dir, "report.json");
  const result = run(
    process.execPath,
    [
      join(ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      "--no-cache",
      "--reporter=json",
      `--outputFile=${outputFile}`,
      ...files,
    ],
    { cwd, env },
  );
  const json = existsSync(outputFile) ? JSON.parse(readFileSync(outputFile, "utf8")) : null;
  rmSync(dir, { recursive: true, force: true });
  const tests = (json?.testResults ?? []).flatMap((f) => f.assertionResults ?? []);
  const passed = tests.filter((t) => t.status === "passed").length;
  const notPassed = tests
    .filter((t) => t.status !== "passed")
    .map((t) => `${t.status}: ${t.fullName}`);
  const missing = required.filter(
    (name) => !tests.some((t) => t.status === "passed" && t.fullName.includes(name)),
  );
  report.check(
    result.code === 0 && passed > 0 && notPassed.length === 0 && missing.length === 0,
    `Vitest ${label}: ${String(passed)} passed, none failed or skipped, ${String(required.length)} required tests present`,
    [...notPassed, ...missing.map((m) => `missing: ${m}`), tail(result, 30)].join("\n"),
  );
}

async function loadAi(path) {
  return import(pathToFileURL(join(AI, "dist", path)).href);
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16 for the web test (as leaf 1.3.5's script: DATABASE_URL, else localhost:5432, else a
// throwaway cluster started from the local binaries and stopped afterwards)
// ---------------------------------------------------------------------------------------------

const WEB = join(ROOT, "apps/web");
const DEFAULT_URLS = [
  "postgres://postgres:postgres@localhost:5432/postgres",
  "postgres://postgres@localhost:5432/postgres",
];

async function reachable(url) {
  const pg = (await import(pathToFileURL(join(WEB, "node_modules/pg/lib/index.js")).href)).default;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
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
      "no DATABASE_URL, nothing on localhost:5432, and no PostgreSQL 16 binaries found",
    );
  const asRoot = process.getuid?.() === 0;
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.3.6-pg-"));
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

async function acquireDatabase() {
  if (process.env.DATABASE_URL)
    return { url: process.env.DATABASE_URL, source: "DATABASE_URL", stop: () => undefined };
  for (const url of DEFAULT_URLS)
    if (await reachable(url)) return { url, source: "localhost:5432", stop: () => undefined };
  return startCluster();
}

// ---------------------------------------------------------------------------------------------
// Live logs
// ---------------------------------------------------------------------------------------------

const HEADER =
  /^# cmd: .+ \| utc: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \| exit: -?\d+ \| commit: [0-9a-f]{7,40}\b/;

/** The measurement lines of every budget log: {count, stop, out, file}. */
function budgetMeasurements() {
  return readdirSync(LIVE)
    .filter((f) => /^leaf-1\.3\.6-budget-measure-.+\.log$/.test(f))
    .sort()
    .flatMap((file) => {
      const lines = readFileSync(join(LIVE, file), "utf8").split("\n");
      return lines
        .filter((l) => l.startsWith('{"count":'))
        .map((l) => ({ ...JSON.parse(l), file, header: HEADER.test(lines[0] ?? "") }));
    });
}

/** Every budget covers each measurement of its dish count at least twice over. */
function budgetCovers(budget, list) {
  return (
    list.length > 0 && list.every((m) => m.stop === "end_turn" && budget(m.count) >= 2 * m.out)
  );
}

/** The logged transcript of a diagnosed case: the JSON after the log's comment lines. */
function transcript(caseId) {
  const file = join(LIVE, `leaf-1.3.6-diag-${caseId}.log`);
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").split("\n");
  return {
    header: HEADER.test(lines[0] ?? ""),
    data: JSON.parse(lines.filter((l) => !l.startsWith("# ")).join("\n")),
  };
}

function toolCalls(rows) {
  return rows
    .filter((r) => r.role === "assistant" && Array.isArray(r.content))
    .flatMap((r) => r.content)
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ name: b.name, input: b.input }));
}

// ---------------------------------------------------------------------------------------------
// Eval set
// ---------------------------------------------------------------------------------------------

function yamlLoader() {
  return createRequire(join(AI, "package.json"))("js-yaml");
}

/** Eval cases by id, from the working tree or from a commit. */
function evalCases(EvalFileSchema, source) {
  const yaml = yamlLoader();
  const files =
    source === "worktree"
      ? readdirSync(join(ROOT, "evals/agent"))
          .filter((f) => f.endsWith(".yaml"))
          .map((f) => [f, readFileSync(join(ROOT, "evals/agent", f), "utf8")])
      : spawnSync("git", ["ls-tree", "--name-only", source, "evals/agent/"], {
          cwd: ROOT,
          encoding: "utf8",
        })
          .stdout.split("\n")
          .filter((p) => p.endsWith(".yaml"))
          .map((p) => [
            p.split("/").at(-1),
            spawnSync("git", ["show", `${source}:${p}`], { cwd: ROOT, encoding: "utf8" }).stdout,
          ]);
  const cases = new Map();
  for (const [, text] of files.sort((a, b) => (a[0] < b[0] ? -1 : 1)))
    for (const c of EvalFileSchema.parse(yaml.load(text)).cases) cases.set(c.id, c);
  return cases;
}

/**
 * Every case equal to the failed set's, except the ruled case, whose only difference is its
 * expected payload (now the ruled match). Returns the list of problems.
 */
function expectationDrift(before, after) {
  const problems = [];
  if (!isDeepStrictEqual([...before.keys()].sort(), [...after.keys()].sort()))
    problems.push("the set of case ids changed");
  for (const [id, now] of after) {
    const was = before.get(id);
    if (was === undefined) continue;
    if (id !== RULED.caseId) {
      if (!isDeepStrictEqual(was, now)) problems.push(`${id} changed without a ruling`);
      continue;
    }
    const strip = (c) => ({ ...c, expect: { ...c.expect, payloads: [] } });
    if (!isDeepStrictEqual(strip(was), strip(now)))
      problems.push(`${id} changed beyond its payload`);
    if (
      now.expect.payloads.length !== 1 ||
      now.expect.payloads[0].kind !== "exclusion.add" ||
      !isDeepStrictEqual(now.expect.payloads[0].match, RULED.match)
    )
      problems.push(`${id} payload is not the ${RULED.ruling} match`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// G1
// ---------------------------------------------------------------------------------------------

async function gateG1(report) {
  for (const gate of ["G1", "G2", "G3"]) if (!dependencyGate(report, "1.3.1", gate)) return;
  if (!dependencyGate(report, "1.4.1", "G2")) return;
  vitest(
    report,
    "recipes",
    [
      "test/recipes/budget.test.ts",
      "test/recipes/g3-errors.test.ts",
      "test/recipes/g1-pipeline.test.ts",
      "test/recipes/g2-request.test.ts",
    ],
    [
      "covers every live measurement at least twice over",
      "a 3-dish request sends 60 000 with an explicit timeout",
      "the follow-up is sized by the replacements it asks for",
      "negative control: without the explicit timeout the SDK refuses",
      "is a typed max_tokens failure naming the budget",
      "a caller without maxTokens keeps the 20 000 default",
      "rejects one dish of each REC-5 defect class",
      "does not detect a duplicate when the library does not hold the dish (control)",
    ],
  );

  const recipes = await loadAi("src/recipes/index.js");
  const client = await loadAi("src/client/index.js");
  const { scenario, f1DinnerRequest } = await loadAi("test/recipes/support/scenario.js");
  const { recordedClient, batchFixture, batchResponse, wireFixture } = await loadAi(
    "test/recipes/support/recorded.js",
  );

  // The budget rule, restated independently, against the package.
  const counts = [1, 2, 3, 4, 5, 6, 7, 10];
  report.check(
    counts.every((n) => recipes.recipeMaxTokens(n) === expectedBudget(n)),
    `recipeMaxTokens(n) = min(128 000, 20 000 × n) for n in ${counts.join(", ")}`,
    counts.map((n) => `${String(n)}: ${String(recipes.recipeMaxTokens(n))}`).join(", "),
  );

  // The live measurements (computed from the logs, never restated here).
  const measured = budgetMeasurements();
  const three = measured.filter((m) => m.count === 3);
  report.check(
    measured.length >= 2 && three.length >= 1 && measured.every((m) => m.header),
    `${String(measured.length)} live measurement(s) logged with command, time, exit and commit (${measured
      .map((m) => `${String(m.count)} dish(es): ${String(m.out)} tokens`)
      .join("; ")})`,
  );
  report.check(
    budgetCovers(recipes.recipeMaxTokens, measured),
    "the budget is at least twice every measured output of its dish count",
    measured
      .map(
        (m) =>
          `${m.file}: count ${String(m.count)} out ${String(m.out)} budget ${String(recipes.recipeMaxTokens(m.count))}`,
      )
      .join("\n"),
  );
  report.check(
    !budgetCovers(() => client.MAX_OUTPUT_TOKENS, three) &&
      three.some((m) => m.out > client.MAX_OUTPUT_TOKENS),
    `negative control: the old fixed ${String(client.MAX_OUTPUT_TOKENS)} is below a measured 3-dish output (${three.map((m) => String(m.out)).join(", ")})`,
  );

  // On the wire, through the real SDK with a recorded network.
  const s = scenario([batchResponse(batchFixture("valid-batch"))]);
  const runOk = await recipes.generateRecipes(s.deps, f1DinnerRequest(undefined, { count: 3 }));
  const sent = s.recorder.requests[0];
  const timeoutS = String(Math.trunc(Math.max(600_000, (3_600_000 * 60_000) / 128_000) / 1000));
  report.check(
    runOk.candidates.length + runOk.infeasible.length > 0 &&
      sent?.body.max_tokens === 60_000 &&
      sent.headers["x-stainless-timeout"] === timeoutS,
    `3 dishes: max_tokens 60 000 and a ${timeoutS} s timeout on the wire; the batch parsed and saved`,
    JSON.stringify({ max: sent?.body.max_tokens, timeout: sent?.headers["x-stainless-timeout"] }),
  );
  const cut = scenario([wireFixture("max-tokens")]);
  const err = await recipes
    .generateRecipes(cut.deps, f1DinnerRequest(undefined, { count: 3 }))
    .catch((e) => e);
  report.check(
    err instanceof recipes.RecipeGenerationError &&
      err.code === "model_call" &&
      err.cause instanceof client.ClaudeCallError &&
      err.cause.code === "max_tokens" &&
      err.cause.message.includes("(60000)") &&
      cut.ports.records.length === 1 &&
      cut.ports.records[0].requestSummary.maxTokens === 60_000 &&
      cut.ports.saved.length === 0,
    "a response cut at the 60 000 budget: typed max_tokens failure naming it, one record, nothing saved",
    String(err),
  );
  let refused = null;
  try {
    const bare = recordedClient([batchResponse(batchFixture("valid-batch"))], { maxRetries: 0 });
    await bare.anthropic.beta.messages.create({
      model: "m",
      max_tokens: 60_000,
      messages: [{ role: "user", content: "x" }],
    });
  } catch (error) {
    refused = error;
  }
  report.check(
    refused !== null && /Streaming is required/.test(String(refused)),
    "negative control: the SDK refuses a 60 000 non-streaming budget without the explicit timeout",
  );

  // R-67: the follow-up fills candidates. The defects batch without a library holds two candidates
  // and one dish infeasible for both adults (every dish survives, as in the live 1.3.1 G4 run).
  const { INFEASIBLE_DISH } = await loadAi("test/recipes/support/expectations.js");
  const f = scenario([
    batchResponse(batchFixture("defects-batch")),
    batchResponse(batchFixture("follow-up-batch")),
  ]);
  const runF = await recipes.generateRecipes(f.deps, f1DinnerRequest());
  const firstCall = runF.candidates.filter((d) => d.call === 1).length;
  const survivors1 = firstCall + runF.infeasible.filter((d) => d.call === 1).length;
  const count = f1DinnerRequest().context.count;
  const note = String(f.recorder.requests[1]?.body.messages.at(-1)?.content ?? "");
  const infeasible = runF.infeasible.find((d) => d.dish.name === INFEASIBLE_DISH);
  const quoted = (infeasible?.reasons ?? []).every((r) => note.includes(r.message));
  report.check(
    runF.calls === 2 &&
      count - firstCall === 1 &&
      note.includes("Write 1 replacement dish") &&
      note.includes(`- ${INFEASIBLE_DISH}: `) &&
      (infeasible?.reasons.length ?? 0) > 0 &&
      quoted &&
      f.recorder.requests[1]?.body.max_tokens === expectedBudget(1) &&
      f.ports.saved.flatMap((x) => x.dishes).some((d) => d.dish.name === INFEASIBLE_DISH),
    `R-67: ${String(firstCall)} candidates of ${String(count)} (+1 infeasible, saved): one follow-up for ${String(count - firstCall)} dish, quoting the solver's reasons`,
    note.slice(0, 600),
  );
  report.check(
    count - survivors1 <= 0 && count - firstCall > 0,
    "negative control: counting survivors (the superseded SPEC-Q-6) would have asked for no follow-up here",
  );
}

// ---------------------------------------------------------------------------------------------
// G2
// ---------------------------------------------------------------------------------------------

async function gateG2(report) {
  for (const gate of ["G1", "G2", "G3"]) if (!dependencyGate(report, "1.3.5", gate)) return;
  vitest(
    report,
    "agent",
    [
      "test/agent/prompt.test.ts",
      "test/agent/evals.test.ts",
      "test/agent/tools.test.ts",
      "test/agent/g1-loop.test.ts",
      "test/agent/g3-history.test.ts",
    ],
    [
      "states every weekday with the number the domain uses",
      "lists every food-naming dietary flag",
      "the sesame example names every catalogue ingredient the flag covers",
      "sends role.set through apply_change",
      "no longer says roles are off-limits",
      "R-66: a sesame allergy excluded only as the sesame-seeds ingredient fails",
      "sends 'more often' / 'less often' to frequency.set",
      "says a liking (preference.set) does not change how often a dish repeats",
    ],
  );

  // R-67: the production get_household carries the logins role.set needs (real route, PostgreSQL).
  const database = await acquireDatabase();
  try {
    vitest(
      report,
      `web get_household logins (${database.source})`,
      ["test/api/agent-household.int.test.ts"],
      [
        "an admin's get_household returns every login, equal to People & access without emails",
        "with that userId, role.set through apply_change becomes a pending proposal",
        "negative control: non-admins cannot reach get_household",
      ],
      { cwd: WEB, env: { DATABASE_URL: database.url } },
    );
  } finally {
    database.stop();
  }
  const port = readFileSync(join(ROOT, "apps/web/lib/server/agent.ts"), "utf8");
  const household = port.slice(port.indexOf("getHousehold:"), port.indexOf("getPlan:"));
  const portBefore = spawnSync(
    "git",
    ["show", `${FAILED_EVAL_COMMIT}:apps/web/lib/server/agent.ts`],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  ).stdout;
  const householdBefore = portBefore.slice(
    portBefore.indexOf("getHousehold:"),
    portBefore.indexOf("getPlan:"),
  );
  report.check(
    /logins: \(await listAccess\(rt, caller\)\)/.test(household) &&
      !/\bemails?\s*:/.test(household) &&
      householdBefore.length > 0 &&
      !householdBefore.includes("logins"),
    "get_household adds the logins from listAccess without emails; at the failed commit it had none (negative control)",
  );

  const agent = await loadAi("src/agent/index.js");

  // The diagnosis record: one section per case, a root cause, the transcript it was read from.
  const record = readFileSync(join(ROOT, "docs/decisions/leaf-1.3.6-evals.md"), "utf8");
  const sections = record.split(/\n(?=## )/);
  for (const id of FAILED_CASES) {
    const section =
      sections.find((s) => s.startsWith("## ") && s.split("\n")[0].includes(id)) ?? "";
    const t = transcript(id);
    report.check(
      section.includes("**Transcript.**") &&
        section.includes("**Root cause.**") &&
        section.includes("**Fix") &&
        record.includes(`leaf-1.3.6-diag-${id}.log`) &&
        t !== null &&
        t.header &&
        t.data.case === id &&
        t.data.rows.length >= 2,
      `${id}: diagnosed (transcript, root cause, fix) from its logged live transcript`,
    );
  }

  // The logged transcripts are the failing behaviour: graded against the eval set that failed,
  // each fails (negative control for the grader and the diagnosis).
  const before = evalCases(agent.EvalFileSchema, FAILED_EVAL_COMMIT);
  const after = evalCases(agent.EvalFileSchema, "worktree");
  for (const id of FAILED_CASES) {
    const t = transcript(id);
    const g = t === null ? null : agent.gradeCase(before.get(id), toolCalls(t.data.rows));
    report.check(
      g !== null && !g.pass,
      `negative control: the logged ${id} transcript fails the eval set it failed live (${g?.failures.join("; ") ?? "no transcript"})`,
    );
  }
  // weekend-appeal: the logged weekdays mean Sunday and Monday in the domain's numbering.
  const weekend = toolCalls(transcript("weekend-appeal")?.data.rows ?? [])
    .flatMap((c) => c.input?.ops ?? [])
    .find((op) => op.kind === "preset.upsert");
  const { weekdayOf } = await import(
    pathToFileURL(join(ROOT, "packages/core/dist/src/types/index.js")).href
  );
  const named = (weekend?.payload.appliesToWeekdays ?? []).map(
    (d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d],
  );
  report.check(
    weekdayOf("2026-10-03") === 5 && weekdayOf("2026-10-04") === 6 && named.join("+") === "Sun+Mon",
    `weekend-appeal root cause holds: the live preset [${String(weekend?.payload.appliesToWeekdays)}] is ${named.join("+")} (0 = Monday), not Sat+Sun [5,6]`,
  );
  // allergy-sesame under R-66: the same live op now grades as the ruling intends.
  const allergy = transcript("allergy-sesame");
  report.check(
    allergy !== null && agent.gradeCase(after.get(RULED.caseId), toolCalls(allergy.data.rows)).pass,
    `${RULED.ruling}: the logged allergy-sesame op (dietary_flag contains_sesame, hard) passes the ruled expectation`,
  );

  // Expectations: unchanged except the ruled one; the ruling is cited in the YAML and the plan.
  const drift = expectationDrift(before, after);
  const yamlText = readFileSync(join(ROOT, "evals/agent/changes.yaml"), "utf8");
  const plan = readFileSync(join(ROOT, "docs/spec/11-build-plan.md"), "utf8");
  report.check(
    drift.length === 0 &&
      yamlText.includes(RULED.ruling) &&
      new RegExp(`\\*\\*${RULED.ruling} [^\\n]*\\n[^\\n]*${RULED.caseId}`).test(plan),
    `eval expectations equal those of ${FAILED_EVAL_COMMIT} except ${RULED.caseId}, changed as ${RULED.ruling} rules and cited`,
    drift.join("\n"),
  );
  const tampered = new Map(after);
  const w = after.get("weekend-appeal");
  tampered.set("weekend-appeal", { ...w, expect: { ...w.expect, payloads: [] } });
  report.check(
    expectationDrift(before, tampered).some((p) => p.startsWith("weekend-appeal")),
    "negative control: an unruled change to another case's expectation is caught",
  );
  report.check(
    agent.EVAL_PASS_THRESHOLD === 0.9,
    `the eval threshold stays at 90 % (${String(agent.EVAL_PASS_THRESHOLD * 100)} %)`,
  );
}

// ---------------------------------------------------------------------------------------------
// --measure (live)
// ---------------------------------------------------------------------------------------------

async function measure(count) {
  const require = createRequire(join(AI, "package.json"));
  const Anthropic = (await import(pathToFileURL(require.resolve("@anthropic-ai/sdk")).href))
    .default;
  const { betaZodOutputFormat } = await import(
    pathToFileURL(require.resolve("@anthropic-ai/sdk/helpers/beta/zod")).href
  );
  const { buildRecipeRequest } = await loadAi("src/recipes/index.js");
  const { structuredParams, resolveClaudeConfig } = await loadAi("src/client/index.js");
  const { loadCatalogue } = await loadAi("test/recipes/support/catalogue.js");
  const { f1DinnerRequest } = await loadAi("test/recipes/support/scenario.js");
  const { f1Config } = await loadAi("test/recipes/support/household.js");
  const config = resolveClaudeConfig(process.env);
  if (!config.enabled) {
    console.error(config.reason);
    return 2;
  }
  const cfg = f1Config();
  const req = buildRecipeRequest(
    loadCatalogue(),
    f1DinnerRequest(cfg, { count }).context,
    cfg.slotTypes.filter((s) => s.active).map((s) => s.key),
  );
  // Streamed, at a budget above any expected output, so the measurement cannot be cut short.
  const params = {
    ...structuredParams(config.model, req, betaZodOutputFormat(req.schema)),
    max_tokens: 64_000,
  };
  const t0 = Date.now();
  const msg = await new Anthropic().beta.messages.stream(params).finalMessage();
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  let dishes = null;
  try {
    dishes = JSON.parse(text).dishes.length;
  } catch {
    // Reported as null.
  }
  console.log(
    JSON.stringify({
      count,
      model: msg.model,
      stop: msg.stop_reason,
      out: msg.usage.output_tokens,
      textChars: text.length,
      dishes,
      seconds: Math.round((Date.now() - t0) / 1000),
      thinkingBlocks: msg.content.filter((b) => b.type === "thinking").length,
    }),
  );
  return msg.stop_reason === "end_turn" ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------

const GATES = { G1: gateG1, G2: gateG2 };

async function main() {
  const m = process.argv.indexOf("--measure");
  if (m >= 0) {
    const count = Number(process.argv[m + 1]);
    if (!Number.isInteger(count) || count < 1) {
      console.error("usage: node scripts/verify/leaf-1.3.6.mjs --measure <dishes>");
      return 2;
    }
    return measure(count);
  }
  const at = process.argv.indexOf("--gate");
  const gate = at >= 0 ? process.argv[at + 1] : undefined;
  if (gate === undefined || !(gate in GATES)) {
    console.error(
      `usage: node scripts/verify/leaf-1.3.6.mjs --gate ${Object.keys(GATES).join("|")}`,
    );
    return 2;
  }
  const report = new Report(`leaf-1.3.6 ${gate}`);
  try {
    await withLock(() => GATES[gate](report));
  } catch (error) {
    report.check(
      false,
      "the gate ran to completion",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
  return report.finish();
}

process.exitCode = await main();
