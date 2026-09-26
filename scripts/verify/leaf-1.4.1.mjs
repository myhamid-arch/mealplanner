// Verify script for leaf 1.4.1 (API, auth, worker, SSE).
// Usage: node scripts/verify/leaf-1.4.1.mjs --gate G1|G2|G3|G4|G5
// Prints "VERIFY leaf-1.4.1 <gate> PASSED" only when every assertion holds, including the gate's
// negative controls; exits non-zero otherwise.
//
// Each gate builds the workspace packages and the worker (under a lock, only when stale, so gates
// can run concurrently without rewriting a build another gate is reading), runs its test file in
// apps/web against PostgreSQL 16 (each test file creates and drops its own database, api_<hex>),
// requires the named tests and their negative controls to be present and passing, then re-checks
// the figures the tests measured (written to a per-gate scratch file). Every such re-check is also
// run on a known-bad record that must fail. G3 also validates the built OpenAPI document here.
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
const WORKER_DIR = join(ROOT, "apps/worker");
const DEFAULT_URLS = [
  "postgres://postgres:postgres@localhost:5432/postgres",
  "postgres://postgres@localhost:5432/postgres",
];
const BUILT = ["core", "db", "ai", "graph", "api-contract"].map((p) => join(ROOT, "packages", p));
const ENDPOINT_TEST = (id) =>
  `G1 endpoint ${id}: contract in and out, ARC-6 matrix and cross-household denial`;

const GATES = {
  G1: {
    title:
      "every endpoint has a contract test and an authorisation-matrix test including cross-household denial (ARC-5, ARC-6)",
    files: ["test/api/g1-contract-matrix.int.test.ts"],
    required: [
      "G1 every route file is a contract endpoint, every endpoint has its route file and a matrix case",
      "G1 ARC-6: a member reads only their own member and targets; a kitchen login cannot read targets or plates",
      "G1 ARC-6: kitchen writes kitchen tags only; members change only their own taste preferences",
      "G1 ARC-6: the cook sheet shows the kitchen the plating table of the day",
      "G1 ARC-6: with members_see_plates off a member's cook sheet has only their own plating rows, and with kitchen_sees_names off the kitchen's sheet carries no member name",
      "G1 ARC-6: the kitchen's review list has kitchen-tag reviews only, without ratings, comments or hidden author names",
      "G1 people, access and support ops are refused on /change-sets (their endpoints add checks), and an invalid time zone is refused",
    ],
    negative: [
      "G1 negative control: a cook sheet built without the caller's view carries the names the kitchen must not see",
      "G1 negative control: an unregistered route file and a missing route are both reported",
      "G1 negative control: a route that skips the household and role check fails the matrix",
      "G1 negative control: a response that violates its schema fails the contract check",
    ],
  },
  G2: {
    title: "a plan job runs in the worker and streams progress over SSE to a test client (ARC-7)",
    files: ["test/api/g2-worker-sse.int.test.ts", "test/api/jobs.int.test.ts"],
    worker: true,
    required: [
      "jobs: the catalogue loader is idempotent and marks NUT-4 failures and their variants for review",
      "jobs: recipe.generate saves the surviving dishes as household ai dishes through a change set, with ai_generation rows",
      "jobs: recipe.revise rewrites a household dish's variant from a recorded revision, as a new dish version",
      "jobs: recipe.revise of a seed dish creates the household's copy and leaves the seed dish unchanged (REC-7)",
      "jobs: without a credential or over the daily limit no model call is made and the reason is reported (REC-2, ARC-6)",
      "jobs: kg.sync after a household dish change set puts the dish into the graph; kg.nightly recomputes the library",
      "jobs: insights.run stores the digest as the job result and reports synthesis as unavailable without a model",
      "jobs: plates.substitute replaces an unavailable ingredient in future meals with a graph substitute outside the household's exclusions",
      "jobs: household.purge deletes a household whose grace has passed, and nothing of another household",
      "jobs: an idempotent job kind that fails once is retried in the run and succeeds; other kinds fail at once",
      "jobs: a job left running by a lost worker is failed by the scheduler tick with a terminal event",
      "jobs: the scheduler queues each daily job once per window, and one household's invalid time zone does not stop the others",
      "jobs: the daily AI dish limit counts every generation requested today, revisions included, and an undo does not reset it",
      "jobs: a job row is sent to its queue once while outstanding, and again after its pg-boss job finished (a redo)",
      "G2 a plan job runs in the worker process and streams progress over SSE to a test client (ARC-7)",
      "G2 Last-Event-ID resumes the stream after the given event",
      "G2 another household can neither open the job's stream nor read the job (404)",
      "G2 R-40: undoing a recipe.generate change set races the worker's claim and exactly one wins",
    ],
    negative: [
      "G2 negative control: with no worker running the job stays queued and the stream carries no terminal event",
      "G2 negative control: an undo that bypasses the queued-only guard lets both the claim and the undo win",
    ],
  },
  G3: {
    title: "OpenAPI document generated and valid",
    files: ["test/api/g3-openapi.int.test.ts"],
    required: [
      "G3 the generated OpenAPI 3.1 document is valid",
      "G3 every contract endpoint and route file is in the document with parameters, bodies, responses, security and roles",
      "G3 the served /api/v1/openapi.json is the generated document",
    ],
    negative: [
      "G3 negative control: a document with a broken $ref fails validation",
      "G3 negative control: a document missing an operation's response and an endpoint fails the coverage check",
    ],
  },
  G4: {
    title:
      "block revokes all sessions immediately (next request 401); invites single-use with expiry; TOTP enforced when required (R2-ADM)",
    files: ["test/api/g4-access.int.test.ts"],
    required: [
      "G4 blocking a login deletes all its sessions at once: the next request is 401 and sign-in is refused; unblocking restores access",
      "G4 a platform block revokes every session of the user and refuses sign-in",
      "G4 the last active admin cannot be blocked or removed",
      "G4 an invite is single-use: a second accept and a lookup after use are refused with 410",
      "G4 an expired or revoked invite is refused with 410",
      "G4 twenty concurrent accepts of one invite admit exactly one login",
      "G4 the TOTP helper matches the RFC 6238 test vector",
      "G4 TOTP enforced when required: 403 for an admin without it, 200 after enabling it with an RFC 6238 code, and sign-in then needs the second step",
      "G4 undoing an unblock blocks the login again and revokes its sessions",
      "G4 a removed login rejoins with a new invite and its own credentials",
      "G4 a suspended household's admin still sees and cancels an operator's deletion, and nothing else",
    ],
    negative: [
      "G4 negative control: an access.block applied without the session revocation leaves the sessions alive",
      "G4 negative control: an accept without the single-use guard admits several logins under concurrency",
      "G4 negative control: the same check on a household without the requirement lets a TOTP-less admin through",
    ],
  },
  G5: {
    title:
      "platform endpoints refuse household data without an active support grant, and each access is logged (R2-ADM-8)",
    files: ["test/api/g5-support.int.test.ts"],
    required: [
      "G5 support endpoints refuse household data with no grant, an expired grant, a revoked grant, another operator's grant or another household's grant, and log nothing",
      "G5 with an active grant each support read returns the household's data and logs exactly one access row (operator, grant, method, path)",
      "G5 the household sees every support access in its change log as a support view that cannot be undone",
      "G5 platform-wide endpoints carry no household data",
    ],
    negative: [
      "G5 negative control: a support read that skips the grant check returns household data and logs nothing",
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildLocked() {
  const lock = join(tmpdir(), "mealplanner-leaf-1.4.1-build.lock");
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
    const dirs = [...BUILT, WORKER_DIR];
    if (!dirs.some(stale)) return { code: 0, stdout: "build up to date", stderr: "" };
    // Dependency order: turbo builds each package after its workspace dependencies.
    return run(
      "pnpm",
      [
        "exec",
        "turbo",
        "run",
        "build",
        ...[
          "@mealplanner/core",
          "@mealplanner/db",
          "@mealplanner/ai",
          "@mealplanner/graph",
          "@mealplanner/api-contract",
          "@mealplanner/worker",
        ].flatMap((f) => ["--filter", f]),
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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.1-pg-"));
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

function vitest(files, env) {
  const outputFile = join(mkdtempSync(join(tmpdir(), "leaf-1.4.1-vitest-")), "report.json");
  return new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        join(ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        "--reporter=json",
        "--reporter=default",
        `--outputFile.json=${outputFile}`,
        ...files,
      ],
      { cwd: WEB_DIR, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
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

const importContract = () =>
  import(pathToFileURL(join(ROOT, "packages/api-contract/dist/src/contract/index.js")).href);
const importOpenApi = () =>
  import(pathToFileURL(join(ROOT, "packages/api-contract/dist/src/openapi/index.js")).href);

// ---------------------------------------------------------------------------------------------
// Gate-specific re-checks (each with a known-bad input that must fail)
// ---------------------------------------------------------------------------------------------

/** One endpoint's measured matrix is acceptable. */
function endpointAcceptable(m) {
  const household = m.auth === "household";
  return (
    m.failures === 0 &&
    m.successes > 0 &&
    (m.auth === "public" || m.auth === "optional" || m.refusals > 0) &&
    (!household || m.crossHousehold > 0)
  );
}

async function checkG1(report, measured, results) {
  const { ENDPOINTS } = await importContract();
  const ids = ENDPOINTS.map((e) => e.id);
  for (const id of ids) {
    const r = results.filter((t) => t.fullName.includes(ENDPOINT_TEST(id)));
    if (!(r.length === 1 && r[0].status === "passed"))
      report.check(false, `ran and passed: ${ENDPOINT_TEST(id)}`);
  }
  report.check(
    ids.every((id) =>
      results.some((t) => t.fullName.includes(ENDPOINT_TEST(id)) && t.status === "passed"),
    ),
    `one passing contract-and-matrix test per endpoint (${String(ids.length)} endpoints)`,
  );
  const [comp] = measured.filter((m) => m.check === "completeness");
  report.check(
    comp !== undefined &&
      comp.routes === ids.length &&
      comp.endpoints === ids.length &&
      comp.cases === ids.length &&
      comp.missingRoutes.length === 0 &&
      comp.unregistered.length === 0,
    `route files = ENDPOINTS = matrix cases (${String(comp?.routes)} / ${String(comp?.endpoints)} / ${String(comp?.cases)})`,
  );
  const per = measured.filter((m) => m.check === "endpoint");
  const sum = (k) => per.reduce((n, m) => n + m[k], 0);
  console.log(
    `       measured: ${String(per.length)} endpoints, ${String(sum("calls"))} calls: ${String(sum("refusals"))} refusals (401/403/404), ${String(sum("invalidInputs"))} invalid inputs (400), ${String(sum("successes"))} valid calls, ${String(sum("crossHousehold"))} cross-household calls; ${String(sum("failures"))} failures`,
  );
  const measuredIds = new Set(per.map((m) => m.id));
  report.check(
    ids.every((id) => measuredIds.has(id)) && per.length === ids.length,
    "every endpoint recorded its matrix",
  );
  const bad = per.filter((m) => !endpointAcceptable(m)).map((m) => m.id);
  report.check(
    bad.length === 0,
    "every endpoint: no failed call, a valid call, refusals where auth applies, and cross-household denial for household endpoints",
    bad.join(", "),
  );
  const household = per.filter((m) => m.auth === "household");
  report.check(
    household.length > 0 && household.every((m) => m.crossHousehold > 0),
    `${String(household.length)} household endpoints each denied another household's admin`,
  );
  const sample = per.find((m) => m.auth === "household");
  report.check(
    sample !== undefined &&
      !endpointAcceptable({ ...sample, failures: 1 }) &&
      !endpointAcceptable({ ...sample, crossHousehold: 0 }),
    "negative control: the same acceptance rejects an endpoint with one failed call, or without cross-household denial",
  );
  const neg = (check) => measured.find((m) => m.check === check);
  const proj = neg("projection-cook-sheet");
  const projOk = (m) =>
    m !== undefined &&
    m.foreignRows === 0 &&
    m.kitchenNamesShown.length === 0 &&
    m.toleranceNotes === 0;
  report.check(
    projOk(proj) && neg("projection-reviews")?.kitchenSees < neg("projection-reviews")?.adminSees,
    "ARC-6 projections: a member's cook sheet has only their plates; the kitchen sees no hidden names, tolerance notes, ratings or comments",
  );
  report.check(
    neg("negative-unprojected-sheet")?.namesShown > 0 &&
      !projOk({ ...proj, kitchenNamesShown: ["x"] }),
    "negative control: the unprojected sheet shows names, which the same check rejects",
  );
  report.check(
    neg("negative-completeness")?.unregistered === 1 &&
      neg("negative-completeness")?.missingRoutes === 1,
    "negative control: an extra route file and a missing route were each reported",
  );
  report.check(
    (neg("negative-skipped-check")?.failures ?? 0) >= 3,
    `negative control: the route skipping the household check failed the matrix (${String(neg("negative-skipped-check")?.failures)} failed calls)`,
  );
  report.check(
    (neg("negative-bad-response")?.failures ?? 0) > 0 &&
      neg("negative-bad-response")?.directProblems > 0 &&
      neg("negative-bad-response")?.realProblems === 0,
    "negative control: a schema-violating response failed the contract check; the real one passed it",
  );
}

function checkG2(report, measured) {
  const one = (check) => measured.find((m) => m.check === check);
  const job = one("plan-job");
  if (job !== undefined)
    console.log(
      `       measured: ${String(job.events)} events (${job.types.join(", ")}), ${String(job.receivedBeforeFinish)} received before the job finished, done after ${String(job.msToDone)} ms`,
    );
  const acceptable = (m) =>
    m !== undefined &&
    m.first === "started" &&
    m.last === "done" &&
    m.progress > 2 &&
    m.contiguous === true &&
    m.idsMatchSeq === true &&
    m.receivedBeforeFinish > 0 &&
    m.closedByServer === true &&
    m.status === "succeeded" &&
    m.daysPlanned === 2 &&
    m.workerLogged === true;
  report.check(
    acceptable(job),
    "the worker process ran the plan job; the client received started, progress and done, in order, live, and the stream closed",
  );
  report.check(
    !acceptable({ ...job, receivedBeforeFinish: 0 }) && !acceptable({ ...job, last: "failed" }),
    "negative control: the same acceptance rejects a replay-only stream and a failed job",
  );
  const resume = one("resume");
  report.check(
    resume !== undefined &&
      resume.resumedFirst === resume.resumeAfter + 1 &&
      resume.resumedCount === resume.total - resume.resumeAfter,
    `Last-Event-ID ${String(resume?.resumeAfter)} resumed at ${String(resume?.resumedFirst)}`,
  );
  const scope = one("stream-scope");
  report.check(
    scope?.otherHousehold === 404 && scope.jobRead === 404 && scope.anonymous === 401,
    "another household: 404 for the stream and the job; anonymous: 401",
  );
  const race = one("undo-claim-race");
  if (race !== undefined)
    console.log(
      `       measured: ${String(race.runs)} concurrent undo/claim races: undo won ${String(race.undoWins)}, claim won ${String(race.claimWins)}`,
    );
  report.check(
    race !== undefined &&
      race.runs >= 20 &&
      race.exactlyOne === race.runs &&
      race.undoWins + race.claimWins === race.runs &&
      race.claimFirstUndoStatus === 409 &&
      race.undoFirstClaim === false,
    "R-40: every undo/claim race had exactly one winner; claim-then-undo is 409, undo-then-claim claims nothing",
  );
  report.check(
    one("negative-unguarded-undo")?.exactlyOne === false,
    "negative control: an undo bypassing the queued-only guard let both win",
  );
  const loader = one("loader");
  report.check(
    loader?.changedRows === 0 && loader.needsReview > 0 && loader.unflaggedVariants === 0,
    `catalogue loader re-run changed 0 rows (${String(loader?.ingredients)} ingredients, ${String(loader?.dishes)} dishes, ${String(loader?.needsReview)} need review; SPEC-Q-20 variants flagged)`,
  );
  const gen = one("recipe-generate");
  report.check(
    gen?.status === "succeeded" && gen.calls === 1 && gen.saved > 0 && gen.changeSets > 0,
    `recipe.generate from one recorded response saved ${String(gen?.saved)} dishes through a change set`,
  );
  report.check(
    one("recipe-revise")?.versionAfter === one("recipe-revise")?.versionBefore + 1 &&
      one("recipe-revise-seed")?.copied === true &&
      one("recipe-revise-seed")?.seedUnchanged === true,
    "recipe.revise: a household dish gets a new version; a seed dish gets a household copy and stays unchanged",
  );
  report.check(
    one("ai-limit")?.calls === 0 &&
      one("ai-limit-counting")?.calls === 0 &&
      one("ai-limit-counting")?.afterUndo === one("ai-limit-counting")?.used,
    "the daily AI limit refuses before any model call, counts revisions and survives an undo",
  );
  const sub = one("substitute");
  report.check(
    sub?.status === "succeeded" && sub.remaining === 0 && sub.changeSet !== null,
    `plates.substitute left ${String(sub?.remaining)} plate items with the unavailable ${String(sub?.ingredient)}`,
  );
  report.check(
    one("purge")?.householdGone === true && one("purge")?.otherMembers === true,
    "household.purge removed the due household only",
  );
  report.check(
    JSON.stringify(one("retry")?.retriedEvents) ===
      JSON.stringify(["started", "retrying", "done"]) &&
      one("reaper")?.status === "failed" &&
      one("scheduler")?.secondEnqueued === 0 &&
      one("scheduler")?.errors > 0 &&
      one("send-semantics")?.duplicate === false &&
      one("send-semantics")?.redo === true,
    "runner retries, stale-job reaping, once-a-day scheduling despite a bad time zone, and singleton sends",
  );
  const noWorker = one("negative-no-worker");
  report.check(
    noWorker?.terminal === 0 && noWorker.status === "queued" && noWorker.closedByServer === false,
    "negative control: without a worker the job stayed queued and no terminal event was streamed",
  );
}

async function checkG3(report, measured) {
  const v = measured.find((m) => m.check === "validity");
  const cov = measured.find((m) => m.check === "coverage");
  const served = measured.find((m) => m.check === "served");
  console.log(
    `       measured: OpenAPI ${String(v?.openapi)}, ${String(v?.paths)} paths, ${String(v?.operations)} operations, ${String(v?.schemas)} component schemas`,
  );
  const { ENDPOINTS } = await importContract();
  report.check(
    v?.valid === true && v.operations === ENDPOINTS.length,
    "the tests validated a document with one operation per endpoint",
  );
  report.check(
    cov?.problems === 0 && cov.undocumented.length === 0,
    "every endpoint and route file is documented",
  );
  report.check(served?.equal === true, "the served document equals the generated one");
  report.check(
    measured.find((m) => m.check === "negative-broken-ref")?.valid === false &&
      measured.find((m) => m.check === "negative-coverage")?.problems.length === 2,
    "negative controls: a broken $ref failed validation; a missing response and endpoint were reported",
  );
  // Independent of the tests: validate the built document here.
  const parser = await import(
    pathToFileURL(join(WEB_DIR, "node_modules/@readme/openapi-parser/dist/index.js")).href
  );
  const { buildOpenApiDocument } = await importOpenApi();
  const doc = buildOpenApiDocument();
  const result = await parser.validate(structuredClone(doc));
  report.check(
    result.valid === true && /^3\.1\./.test(doc.openapi),
    "the built document validates as OpenAPI 3.1 (checked by this script)",
    result.valid ? "" : parser.compileErrors(result),
  );
  const broken = structuredClone(doc);
  broken.paths["/api/v1/me"].get.responses["200"].content["application/json"].schema = {
    $ref: "#/components/schemas/Missing",
  };
  const brokenResult = await parser.validate(broken);
  report.check(
    brokenResult.valid === false,
    "negative control: the same validation rejects the document with a dangling $ref",
  );
}

function checkG4(report, measured) {
  const one = (check) => measured.find((m) => m.check === check);
  const block = one("block");
  const blockOk = (m) =>
    m !== undefined &&
    m.sessionsBefore === 2 &&
    m.sessionsAfter === 0 &&
    m.nextStatuses.every((s) => s === 401) &&
    m.signInWhileBlocked === 403 &&
    m.signInAfterUnblock === 200;
  report.check(
    blockOk(block),
    `block: ${String(block?.sessionsBefore)} sessions → ${String(block?.sessionsAfter)}; next requests ${JSON.stringify(block?.nextStatuses)}; sign-in ${String(block?.signInWhileBlocked)}`,
  );
  report.check(
    !blockOk({ ...block, sessionsAfter: one("negative-naive-block")?.sessionsLeft ?? 0 }),
    `negative control: the naive block left ${String(one("negative-naive-block")?.sessionsLeft)} session(s), which the same check rejects`,
  );
  const pb = one("platform-block");
  report.check(
    pb?.sessionsAfter === 0 && pb.next === 401 && pb.signIn === 403,
    "platform block: no session left, next request 401, sign-in refused",
  );
  report.check(
    one("last-admin")?.block === 409 && one("last-admin")?.remove === 409,
    "the last admin cannot be blocked or removed (409)",
  );
  const su = one("single-use");
  report.check(
    su?.second === 410 && su.signedIn === 410 && su.lookupAfter === 410,
    "a used invite: second accept 410 (signed up or signed in), lookup 410",
  );
  const ex = one("expiry");
  report.check(
    ex?.expired === 410 && ex.revoked === 410 && ex.expiredLookup === 410 && ex.ttlHours === 24,
    "expired and revoked invites are 410; a 24h invite expires 24 h after creation",
  );
  const race = one("concurrent-accept");
  const raceOk = (m) => m !== undefined && m.successes === 1 && m.loginsCreated === 1;
  report.check(
    raceOk(race) && race.usersLeft === 1 && race.other.length === 0,
    `20 concurrent accepts: ${String(race?.successes)} success, ${String(race?.loginsCreated)} login, ${String(race?.usersLeft)} user account left`,
  );
  report.check(
    !raceOk({ successes: 1, loginsCreated: one("negative-naive-accept")?.admitted ?? 0 }),
    `negative control: the unguarded accept admitted ${String(one("negative-naive-accept")?.admitted)} logins, which the same check rejects`,
  );
  const t = one("totp");
  const totpOk = (m) =>
    m !== undefined &&
    m.refused === 403 &&
    m.refusedCode === "totp_required" &&
    m.allowed === 200 &&
    m.step1Redirect === true &&
    m.step1Session === 401 &&
    m.afterStep2 === 200;
  report.check(
    totpOk(t) && t.member === 200 && t.wrongCode === 422 && t.disableWhileRequired === 409,
    "TOTP required: 403 totp_required without it, 200 after enabling it; sign-in needs the second step",
  );
  report.check(
    one("undo-unblock")?.sessionsAfter === 0 &&
      one("undo-unblock")?.next === 401 &&
      one("rejoin")?.rejoin === 200 &&
      one("rejoin")?.wrongPassword === 401 &&
      one("suspended-cancel")?.cancel === 200 &&
      one("suspended-cancel")?.other === 403,
    "undoing an unblock revokes sessions; a removed login rejoins with its credentials; a suspended household can cancel its deletion",
  );
  const noReq = one("negative-no-requirement");
  report.check(
    noReq?.status === 200 && !totpOk({ ...t, refused: noReq.status, refusedCode: undefined }),
    "negative control: a household without the requirement lets a TOTP-less admin through, which the same check rejects",
  );
}

function checkG5(report, measured) {
  const one = (check) => measured.find((m) => m.check === check);
  const r = one("refusals");
  const refusedOk = (m) =>
    m !== undefined && m.problems === 0 && m.conditions >= 4 && m.calls >= 16;
  report.check(
    refusedOk(r) && r.adminStatuses.every((s) => s === 403),
    `${String(r?.calls)} support reads under ${String(r?.conditions)} grantless conditions: all 403, no data, nothing logged`,
  );
  const neg = one("negative-skipped-grant");
  report.check(
    neg !== undefined &&
      neg.activeGrantsOfB === 0 &&
      neg.problems.length > 0 &&
      !refusedOk({ ...r, problems: neg.problems.length }),
    `negative control: the grant-skipping read produced ${String(neg?.problems.length)} problems, which the same check rejects`,
  );
  const g = one("granted");
  report.check(
    g?.reads === 4 && g.logged === 4 && g.statuses.every((s) => s === 200),
    "with an active grant: 4 reads, 4 access rows",
  );
  const log = one("change-log");
  report.check(
    log !== undefined && log.views === log.logged && log.undoable === 0,
    `the household change log shows ${String(log?.views)} support views for ${String(log?.logged)} accesses, none undoable`,
  );
  const pw = one("platform-wide");
  report.check(
    pw?.leaks.length === 0 && pw.statuses.every((s) => s === 200),
    "platform-wide endpoints returned no household data",
  );
}

// ---------------------------------------------------------------------------------------------

async function gate(id) {
  const spec = GATES[id];
  const report = new Report(`leaf-1.4.1 ${id}`);
  console.log(`# ${id}: ${spec.title}`);

  const build = await buildLocked();
  if (!report.check(build.code === 0, "packages and the worker are built", tail(build)))
    return report.finish();
  if (spec.worker)
    report.check(
      existsSync(join(WORKER_DIR, "dist/src/main.js")),
      "the worker entry apps/worker/dist/src/main.js exists",
    );

  const database = await acquireDatabase();
  const scratch = mkdtempSync(join(tmpdir(), `leaf-1.4.1-${id}-`));
  const measureFile = join(scratch, "measure.jsonl");
  try {
    const rows = await query(database.url, "SHOW server_version");
    const version = String(rows[0]?.server_version ?? "");
    report.check(
      /^16\./.test(version),
      `database (${database.source}) is PostgreSQL 16 (server_version ${version})`,
    );

    const result = await vitest(spec.files, {
      DATABASE_URL: database.url,
      API_MEASURE_FILE: measureFile,
      LOG_LEVEL: "silent",
    });
    report.check(
      result.code === 0,
      `vitest exits 0 (${spec.files.join(", ")})`,
      tail({ stdout: result.output, stderr: "" }, 60),
    );
    report.check(result.report !== null, "vitest wrote a JSON report");
    const results = assertions(result.report);
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
      `the gate has ${String(spec.negative.length)} negative control test(s)`,
    );

    const measured = measurements(measureFile, id);
    report.check(measured.length > 0, `the tests recorded ${String(measured.length)} measurements`);
    if (id === "G1") await checkG1(report, measured, results);
    if (id === "G2") checkG2(report, measured);
    if (id === "G3") await checkG3(report, measured);
    if (id === "G4") checkG4(report, measured);
    if (id === "G5") checkG5(report, measured);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    database.stop();
  }
  return report.finish();
}

const flag = process.argv.indexOf("--gate");
const id = flag === -1 ? undefined : process.argv[flag + 1];
if (id === undefined || !(id in GATES)) {
  console.error(`usage: node scripts/verify/leaf-1.4.1.mjs --gate ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
process.exit(await gate(id));
