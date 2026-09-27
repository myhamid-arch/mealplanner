// Verify script for leaf 1.4.6 (sign-in, people & access, account, platform).
// Usage: node scripts/verify/leaf-1.4.6.mjs --gate G1|G2
// Prints "VERIFY leaf-1.4.6 <gate> PASSED" only when every assertion holds, including the gate's
// negative controls; exits non-zero otherwise (leaf-1.4.6 ADR-3).
//
// Each gate, independently of the other (gate-check runs them in parallel):
// 1. builds the workspace packages when stale (under a lock, as leaf-1.4.1's script does);
// 2. creates its own database (leaf146_<gate>_<hex>) on PostgreSQL 16 and migrates it:
//    DATABASE_URL's server when set, else localhost:5432 when it answers, else a throwaway
//    cluster from the local PostgreSQL 16 binaries (stopped on exit);
// 3. builds the web app into its own directory (.next/verify-1.4.6-<gate>) and starts it on a
//    free port, with a random AUTH_SECRET (never printed) and an SMTP stub on another free port
//    (the magic-link and password-reset emails are real library emails; only the transport is
//    local);
// 4. runs apps/web/e2e/admin.spec.ts with --grep @<gate> and requires every named test,
//    negative controls included, to be present and passing (Playwright's JSON report);
// 5. G1: re-checks the outcomes in the gate's database with its own queries, each of which is
//    also run on a known-bad record that must fail; G2: runs 1.4.2's shell e2e (@G2) against its
//    own server without a database (BLD-8 W-1), printing the full output on any failure.
import { Buffer } from "node:buffer";
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
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_DIR = join(ROOT, "apps/web");
const SPEC = "e2e/admin.spec.ts";
const DEFAULT_URLS = [
  "postgres://postgres:postgres@localhost:5432/postgres",
  "postgres://postgres@localhost:5432/postgres",
];
const PACKAGES = ["core", "db", "ai", "graph", "api-contract", "ui-tokens"];

const G1_TESTS = [
  "@G1 create a household: the new admin lands on set-up, signed in as its admin",
  "@G1 password sign-out clears the offline cache; password sign-in at 390 px goes home",
  "@G1 invite then accept: a member invite with link and QR code, accepted at 390 px",
  "@G1 invite-code sign-in: a kitchen invite's code typed on the sign-in page",
  "@G1 magic link: the first email-link sign-in of an unverified account removes its password and says so (R-42); a new one is set from Account",
  "@G1 block: the blocked login's open session gets 401 on its next request and cannot sign in",
  "@G1 change-log undo: the block is undone from the log; an entry changed again later cannot be undone and says why",
  "@G1 remove: removing a login with its member archived ends its session and takes it off the list",
  "@G1 last-admin protection: the only admin cannot be demoted, blocked or removed, in the UI or by request",
];
const G1_NEGATIVE = [
  "@G1 negative control: the notice check fails on a link sign-in that removed nothing (a verified account)",
  "@G1 negative control: the 401 check fails on a session that was not blocked",
  "@G1 negative control: the undo check fails for a change set that was not undone",
];
const G2_TESTS = [
  "@G2 set-up: a household with a member invite, an operator and a two-step account",
  ...["390 px light", "390 px dark", "1280 px light", "1280 px dark"].flatMap((v) => [
    `@G2 signed-out screens at ${v}`,
    `@G2 admin screens at ${v}`,
    `@G2 platform console at ${v}`,
  ]),
];
const G2_NEGATIVE = [
  "@G2 negative control: the scan reports an unnamed button and low-contrast text",
];

const GATES = {
  G1: {
    title:
      "Playwright: password, magic-link stub and invite-code sign-in; invite then accept; block then 401; remove; last-admin protection; change-log undo",
    required: G1_TESTS,
    negative: G1_NEGATIVE,
  },
  G2: {
    title: "axe-core: no serious or critical violations on these screens",
    required: G2_TESTS,
    negative: G2_NEGATIVE,
  },
};

// ---------------------------------------------------------------------------------------------
// Processes, ports, build
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
  const lock = join(tmpdir(), "mealplanner-leaf-1.4.6-build.lock");
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
    if (!dirs.some(stale)) return { code: 0, stdout: "packages up to date", stderr: "" };
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
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.4.6-pg-"));
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
// SMTP stub: accepts every message and writes it as JSON (to, subject, decoded text, time)
// ---------------------------------------------------------------------------------------------

function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function parseMessage(raw) {
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
  const server = createServer((socket) => {
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
          const { subject, text } = parseMessage(raw);
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
    reply("220 localhost ESMTP leaf-1.4.6 stub");
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

// ---------------------------------------------------------------------------------------------
// Playwright
// ---------------------------------------------------------------------------------------------

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
        PLAYWRIGHT_OUTPUT_DIR: join(outDir, "artefacts"),
        PLAYWRIGHT_SKIP_BUILD: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        ...(chromium() === undefined ? {} : { PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromium() }),
      },
    },
  );
  return { ...result, tests: results(reportFile) };
}

// ---------------------------------------------------------------------------------------------
// G1 database re-checks (each also run on a known-bad record)
// ---------------------------------------------------------------------------------------------

/** The block change set was undone by a later change set, and the login is active again. */
async function checkBlockUndone(url, changeSetId, email) {
  const [cs] = await query(
    url,
    `SELECT undone_at, undone_by_change_set_id FROM change_set WHERE id = $1`,
    [changeSetId],
  );
  const [login] = await query(
    url,
    `SELECT hu.status FROM household_user hu JOIN "user" u ON u.id = hu.user_id WHERE u.email = $1`,
    [email],
  );
  return (
    cs !== undefined &&
    cs.undone_at !== null &&
    cs.undone_by_change_set_id !== null &&
    login?.status === "active"
  );
}

/** A removed login: no household_user row, no session, its member archived. */
async function checkRemoved(url, email) {
  const logins = await query(
    url,
    `SELECT 1 FROM household_user hu JOIN "user" u ON u.id = hu.user_id WHERE u.email = $1`,
    [email],
  );
  const sessions = await query(
    url,
    `SELECT 1 FROM session s JOIN "user" u ON u.id = s.user_id WHERE u.email = $1`,
    [email],
  );
  const archived = await query(
    url,
    `SELECT 1 FROM member WHERE display_name = 'Layla' AND archived_at IS NOT NULL`,
  );
  return logins.length === 0 && sessions.length === 0 && archived.length === 1;
}

/** The R-42 account: a new credential exists (set through the reset link) and the email is verified. */
async function checkPasswordReset(url, email) {
  const rows = await query(
    url,
    `SELECT u.email_verified, a.password IS NOT NULL AS has_password
       FROM "user" u JOIN account a ON a.user_id = u.id AND a.provider_id = 'credential'
      WHERE u.email = $1`,
    [email],
  );
  return rows.length === 1 && rows[0].email_verified === true && rows[0].has_password === true;
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
  for (const file of findFiles(join(outDir, "artefacts"), "error-context.md"))
    console.log(`----- ${file} -----\n${readFileSync(file, "utf8")}`);
  console.log(`----- end of ${label} -----`);
}

async function main() {
  const gateArg = process.argv[process.argv.indexOf("--gate") + 1];
  const gate = GATES[gateArg] === undefined ? null : gateArg;
  if (gate === null) {
    console.error("usage: node scripts/verify/leaf-1.4.6.mjs --gate G1|G2");
    return 2;
  }
  const report = new Report(`leaf-1.4.6 ${gate}`);
  console.log(`leaf-1.4.6 ${gate}: ${GATES[gate].title}`);

  const built = await buildPackagesLocked();
  if (!report.check(built.code === 0, "workspace packages are built", tail(built)))
    return report.finish();

  const server = await acquireServer();
  const [version] = await query(server.url, "SHOW server_version");
  report.check(
    /^16\./.test(version?.server_version ?? ""),
    `PostgreSQL 16 (${server.source}: ${String(version?.server_version)})`,
  );
  const dbName = `leaf146_${gate.toLowerCase()}_${randomBytes(4).toString("hex")}`;
  const outDir = mkdtempSync(join(tmpdir(), `leaf-1.4.6-${gate}-`));
  const mailDir = join(outDir, "mail");
  mkdirSync(mailDir);
  let smtp = null;
  try {
    await query(server.url, `CREATE DATABASE ${dbName}`);
    const dbUrl = withDatabase(server.url, dbName);
    const migrations = await import(
      pathToFileURL(join(ROOT, "packages/db/dist/src/migrations/index.js")).href
    );
    await migrations.runMigrations(dbUrl);
    report.check(true, `database ${dbName} created and migrated`);

    const distDir = `.next/verify-1.4.6-${gate}`;
    const build = await runAsync("pnpm", ["exec", "next", "build"], {
      cwd: WEB_DIR,
      env: { MISE_NEXT_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: "1" },
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

    smtp = await startSmtp(mailDir);
    const port = await freePort();
    const env = {
      MISE_NEXT_DIST_DIR: distDir,
      PLAYWRIGHT_PORT: String(port),
      APP_URL: `http://localhost:${String(port)}`,
      DATABASE_URL: dbUrl,
      AUTH_SECRET: randomBytes(32).toString("base64url"),
      EMAIL_SERVER: `smtp://127.0.0.1:${String(smtp.port)}`,
      EMAIL_FROM: "Mise <no-reply@example.com>",
      MAIL_DIR: mailDir,
    };
    const e2e = await playwright({ spec: SPEC, grep: `@${gate}`, env, outDir });
    const failed = [...e2e.tests].filter(([, s]) => s !== "passed" && s !== "expected");
    if (e2e.code !== 0 || failed.length > 0) printFull(`${SPEC} @${gate}`, e2e, outDir);
    report.check(e2e.code === 0, `${SPEC} @${gate} exits 0`, tail(e2e, 40));
    for (const title of GATES[gate].required)
      report.check(
        e2e.tests.get(title) === "passed",
        title,
        `status: ${String(e2e.tests.get(title) ?? "missing")}`,
      );
    for (const title of GATES[gate].negative)
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

    if (gate === "G1") {
      const sent = readdirSync(mailDir).map((f) =>
        JSON.parse(readFileSync(join(mailDir, f), "utf8")),
      );
      const links = sent.filter(
        (m) =>
          /sign-in link/i.test(m.subject) && /\/api\/auth\/magic-link\/verify\?token=/.test(m.text),
      );
      const resets = sent.filter(
        (m) => /reset/i.test(m.subject) && /\/api\/auth\/reset-password\//.test(m.text),
      );
      report.check(
        links.length === 2 && resets.length === 1 && sent.every((m) => /^layla-/.test(m.to)),
        `the SMTP stub received the library's emails: 2 sign-in links and 1 reset link, all to the R-42 account (${String(sent.length)} messages)`,
        sent.map((m) => `${m.to}: ${m.subject}`).join("\n"),
      );
      const [blockCs] = await query(
        dbUrl,
        `SELECT id FROM change_set WHERE summary = 'Block login' ORDER BY applied_at DESC LIMIT 1`,
      );
      const [priya] = await query(dbUrl, `SELECT email FROM "user" WHERE email LIKE 'priya-%'`);
      const [layla] = await query(dbUrl, `SELECT email FROM "user" WHERE email LIKE 'layla-%'`);
      report.check(
        blockCs !== undefined &&
          priya !== undefined &&
          (await checkBlockUndone(dbUrl, blockCs.id, priya.email)),
        "database: the block change set is undone and the login is active again",
      );
      const [notUndone] = await query(
        dbUrl,
        `SELECT id FROM change_set WHERE undone_at IS NULL AND summary = 'Household settings' LIMIT 1`,
      );
      report.check(
        notUndone !== undefined &&
          priya !== undefined &&
          !(await checkBlockUndone(dbUrl, notUndone.id, priya.email)),
        "negative control: the same check rejects a change set that was not undone",
      );
      report.check(
        layla !== undefined && (await checkRemoved(dbUrl, layla.email)),
        "database: the removed login has no membership and no session, and its member is archived",
      );
      report.check(
        priya !== undefined && !(await checkRemoved(dbUrl, priya.email)),
        "negative control: the same check rejects a login that was not removed",
      );
      report.check(
        layla !== undefined && (await checkPasswordReset(dbUrl, layla.email)),
        "database: the R-42 account has a new password and a verified email",
      );
      report.check(
        !(await checkPasswordReset(dbUrl, "nobody@example.com")),
        "negative control: the same check rejects an account without a password",
      );
    } else {
      // BLD-8 W-1: 1.4.2's shell e2e, against its own server without a database.
      const shellPort = await freePort();
      const shellEnv = { MISE_NEXT_DIST_DIR: distDir, PLAYWRIGHT_PORT: String(shellPort) };
      const shell = await playwright({
        spec: "e2e/shell.spec.ts",
        grep: "@G2",
        env: { ...shellEnv, DATABASE_URL: "" },
        outDir,
      });
      const shellFailed = [...shell.tests].filter(([, s]) => s !== "passed");
      if (shell.code !== 0 || shellFailed.length > 0)
        printFull("e2e/shell.spec.ts @G2 (W-1)", shell, outDir);
      report.check(
        shell.code === 0 && shell.tests.size > 0 && shellFailed.length === 0,
        `W-1: apps/web/e2e/shell.spec.ts @G2 passes (${String(shell.tests.size)} tests)`,
      );
    }
  } finally {
    smtp?.stop();
    try {
      await query(server.url, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    } catch {
      // The server may already be gone; the throwaway cluster is removed below.
    }
    server.stop();
    rmSync(outDir, { recursive: true, force: true });
  }
  return report.finish();
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    console.log("VERIFY leaf-1.4.6 FAILED (error)");
    process.exit(1);
  },
);
