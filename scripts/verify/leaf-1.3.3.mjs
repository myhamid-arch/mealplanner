// Verify script for leaf 1.3.3 (Insights engine and proposals).
// Usage: node scripts/verify/leaf-1.3.3.mjs --gate G1|G2|G3
// Prints "VERIFY leaf-1.3.3 <gate> PASSED" only when every assertion, including the gate's
// negative controls, holds; exits non-zero otherwise.
//
// Isolation (leaf-1.3.3 ADR-3): gates run concurrently, so nothing is shared between them. Each gate
// works in its own temp directory; Vitest runs against the sources through a per-gate config that
// aliases @mealplanner/{core,ai,db}/<sub> to packages/<pkg>/src/<sub>/index.ts (and the built core
// fixtures other leaves' test support imports to their sources), with its cache in that directory,
// so no dist/ is written or read. The type check is `tsc --noEmit` through a per-gate tsconfig with
// the same mapping. PostgreSQL tests create one uniquely named database per test file.
//
// Each gate: (1) type-checks the leaf's sources and pure tests; (2) runs the gate's Vitest files
// and requires the named tests and negative controls to be present and passing, with nothing
// skipped; (3) re-checks the outcome itself: a check file written here drives the real modules on
// fixtures defined in this script and reports raw results, which this script judges against the
// spec's numbers (FBK-6/7/8) written out below. Each judgement is also run on a known-bad result,
// which must fail.
//
// Database (G1, G2): DATABASE_URL when set; otherwise postgres://postgres@localhost:5432/postgres
// when it answers; otherwise a throwaway PostgreSQL 16 cluster in the gate's temp directory on a
// free port, stopped on exit. It must report server_version 16.x.
import { spawn } from "node:child_process";
import {
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Report } from "./lib/report.mjs";
import { run, tail } from "./lib/run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PKG = (name) => join(ROOT, "packages", name);
const DEFAULT_URL = "postgres://postgres@localhost:5432/postgres";

// ---------------------------------------------------------------------------------------------
// The spec's numbers, written out independently of packages/core (FBK-6, FBK-7, FBK-8, SC-3,
// leaf-1.3.3 SPEC-Q-12/13/15, BLD-8 R-33).
// ---------------------------------------------------------------------------------------------

const SPEC = {
  dislikeScore: -0.8,
  variantMinReviews: 3,
  dislikeMaxMean: 2.5,
  frequencySignals: 2,
  windowDays: 30,
  lessOftenGap: 14,
  moreOftenGap: 3,
  budget: 5,
  expiryDays: 14,
  cooldownDays: 30,
  evidenceMultiplier: 2,
  neverProposed: ["access.block", "access.remove", "access.link_member", "support.grant"],
};

const GATES = {
  G1: {
    title: "every FBK-7 rule has triggering and non-triggering fixture tests",
    db: true,
    runs: [
      { pkg: "core", files: ["test/learning/rules/rules.test.ts"] },
      { pkg: "db", files: ["test/proposals/sc3.int.test.ts"] },
    ],
    required: [
      "G1 rule 1 triggers",
      "G1 rule 1 does not trigger",
      "G1 dish rule triggers",
      "G1 dish rule does not trigger",
      "G1 rule 2 triggers",
      "G1 rule 2 does not trigger",
      "G1 rule 3 triggers",
      "G1 rule 3 does not trigger",
      "G1 rule 3 stays a note while no revision op exists (R-33)",
      "G1 rule 4 triggers",
      "G1 rule 4 does not trigger",
      "G1 rule 5 triggers",
      "G1 rule 5 does not trigger",
      "G1 more_often triggers",
      "G1 less_often triggers",
      "G1 more_often/less_often do not trigger",
      "G1 never_again triggers",
      "G1 never_again does not trigger",
      "G1 observed frequency triggers",
      "G1 observed frequency does not trigger",
      "G1 targeted quantity triggers: 2 too_little/still_hungry",
      "G1 targeted quantity triggers: 2 too_much",
      "G1 targeted quantity does not trigger",
      "G1 runRules runs every rule and every draft is registry-valid",
      "G1 SC-3: two 1★ reviews by one member on a dish produce a pending dish-dislike proposal",
    ],
    negative: [
      "G1 negative control: the triggering assertion rejects each rule's non-triggering fixture",
      "G1 negative control: a rule with the threshold lowered by one fires on the non-triggering fixture",
      "G1 SC-3 negative control: one 1★ review, or two reviews by different members, produce no proposal",
    ],
  },
  G2: {
    title:
      "FBK-8 guardrails: fingerprint suppression, pending budget, protected ops never proposed, expiry",
    db: true,
    runs: [
      { pkg: "core", files: ["test/learning/rules/guardrails.test.ts"] },
      { pkg: "db", files: ["test/proposals/guardrails.int.test.ts"] },
    ],
    required: [
      "G2 the fingerprint is the target and direction, not the exact value",
      "G2 frequency and distribution fingerprints carry the direction",
      "G2 a draft matching a proposal rejected in the last 30 days is suppressed",
      "G2 it passes once the new evidence has doubled",
      "G2 rejecting one direction does not suppress the opposite one (R-33)",
      "G2 a draft whose ops the current state already satisfies is suppressed (R-33)",
      "G2 at most 5 pending: with 4 pending, 1 of 3 drafts is kept",
      "G2 agent_chat proposals are neither blocked by nor counted against the budget (R-33)",
      "G2 R-10 ops are never proposed, whatever the origin",
      "G2 the engine never proposes a registry-protected op; the agent may (AGT-5)",
      "G2 pending proposals expire after 14 days",
      "G2 a second run over the same reviews after accept proposes nothing",
      "G2 a rejected proposal is not proposed again until the evidence doubles",
      "G2 rejecting one direction does not suppress the opposite direction (R-33)",
      "G2 at most 5 rule/insights proposals are pending; agent_chat ones are neither blocked nor counted",
      "G2 relaxing or removing C3's sesame allergy is never proposed by the engine",
      "G2 R-10 ops are never proposed, even from chat",
      "G2 a synthesised proposal with a protected op is dropped by the service's guardrails",
      "G2 pending proposals expire after 14 days and can no longer be accepted",
      "G2 accepting applies one proposal_accept change set by the admin",
    ],
    negative: [
      "G2 negative control: the same draft without the rejection record is kept",
      "G2 negative control: without the pending rows the same drafts all fit",
      "G2 negative control: the same op kind unprotected is kept",
      "G2 negative control: when the first proposal expired instead of being accepted, the second run proposes it again",
      "G2 negative control: the same six drafts all fit when the budget is not reached",
      "G2 negative control: an unprotected exclusion op from the engine is stored",
    ],
  },
  G3: {
    title: "LLM synthesis output Zod-validated; invalid kinds dropped and logged (stubbed model)",
    db: false,
    runs: [{ pkg: "ai", files: ["test/insights/g3-synthesis.test.ts"] }],
    required: [
      "G3 a valid proposal is kept, with the member label mapped back to the member id",
      "G3 invalid kinds are dropped and logged: R-10, protected, not allowed, and unknown kinds",
      "G3 every other Zod or reference failure is dropped with its reason",
      "G3 a proposal with one invalid op among valid ones is dropped whole",
      "G3 no member name reaches the model",
      "G3 without a credential synthesis is disabled with a stated reason and no call or record",
      "G3 a refusal is a typed failure, recorded, with no proposals",
      "G3 the SDK parses the structured output, invalid kinds are dropped and logged",
    ],
    negative: [
      "G3 negative control: a validator that allows every kind keeps the invalid kinds",
      "G3 negative control: without scrubbing, the same context leaks names",
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Isolated Vitest and tsc
// ---------------------------------------------------------------------------------------------

function aliases() {
  return `[
    { find: /^@mealplanner\\/(core|ai|db)\\/(.+)$/, replacement: ${JSON.stringify(`${ROOT}/packages/`)} + "$1/src/$2/index.ts" },
    { find: /^(?:\\.\\.\\/)+core\\/dist\\/test\\/(.+)\\.js$/, replacement: ${JSON.stringify(`${ROOT}/packages/core/test/`)} + "$1.ts" },
  ]`;
}

function writeVitestConfig(scratch, name, root, extra = "") {
  const file = join(scratch, `vitest.${name}.config.mjs`);
  writeFileSync(
    file,
    `export default {
  root: ${JSON.stringify(root)},
  cacheDir: ${JSON.stringify(join(scratch, `vite-cache-${name}`))},
  resolve: { alias: ${aliases()} },
  test: { testTimeout: 120000, hookTimeout: 300000${extra} },
};
`,
  );
  return file;
}

function vitest(cwd, config, files, env, scratch, name) {
  const outputFile = join(scratch, `report-${name}.json`);
  return new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        join(ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        config,
        "--reporter=json",
        "--reporter=default",
        `--outputFile.json=${outputFile}`,
        ...files,
      ],
      { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const report = existsSync(outputFile) ? JSON.parse(readFileSync(outputFile, "utf8")) : null;
      resolveRun({ code: code ?? -1, output, report });
    });
  });
}

function assertions(report) {
  return (report?.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
}

/** `tsc --noEmit` over the leaf's sources and pure tests, packages resolved from source. */
function typecheck(scratch) {
  const packages = join(ROOT, "packages");
  const config = {
    extends: join(ROOT, "tsconfig.base.json"),
    compilerOptions: {
      noEmit: true,
      rootDir: packages,
      typeRoots: [join(ROOT, "node_modules/@types")],
      paths: Object.fromEntries(
        ["core", "ai", "db"].map((p) => [
          `@mealplanner/${p}/*`,
          [join(packages, p, "src/*/index.ts")],
        ]),
      ),
    },
    include: [
      join(packages, "core/src"),
      join(packages, "core/test/learning/rules"),
      join(packages, "ai/src"),
      join(packages, "ai/test/insights"),
      join(packages, "db/src"),
    ],
  };
  const file = join(scratch, "tsconfig.json");
  writeFileSync(file, JSON.stringify(config, null, 2));
  return run(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", file], {
    cwd: ROOT,
  });
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL 16
// ---------------------------------------------------------------------------------------------

async function query(url, text) {
  const pg = (await import(pathToFileURL(join(PKG("db"), "node_modules/pg/lib/index.js")).href))
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

/** A throwaway cluster in its own directory on a free port; runs as `postgres` when root. */
async function startCluster() {
  const bin = pgBinDir();
  if (bin === undefined)
    throw new Error(
      "no DATABASE_URL, nothing on localhost:5432, and no PostgreSQL 16 binaries found",
    );
  const asRoot = process.getuid?.() === 0;
  // The cluster directory must be readable by the postgres user, so it lives directly in tmpdir.
  const dir = mkdtempSync(join(tmpdir(), "leaf-1.3.3-pg-"));
  if (asRoot) chownSync(dir, Number(run("id", ["-u", "postgres"], { cwd: ROOT }).stdout.trim()), 0);
  const as = (args) =>
    asRoot ? ["runuser", ["-u", "postgres", "--", ...args]] : [args[0], args.slice(1)];
  const port = await freePort();
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
    source: "throwaway cluster",
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
  return startCluster();
}

// ---------------------------------------------------------------------------------------------
// Independent re-checks: a check file drives the real modules on fixtures defined here and writes
// raw results through `__write`; this script judges them against SPEC.
// ---------------------------------------------------------------------------------------------

const CHECKS = {
  G1: `
import { runRules } from "@mealplanner/core/learning/rules";
import { configFromFixture } from ${JSON.stringify(`${ROOT}/packages/core/test/planner/targets/config.ts`)};
import { F1 } from ${JSON.stringify(`${ROOT}/packages/core/test/fixtures/index.ts`)};

const NOW = new Date("2026-09-26T12:00:00Z");
const DISH = "d0000000-0000-4000-8000-000000000001";
const COMPONENT = "d0000000-0000-4000-8000-000000000002";
const V1 = "d0000000-0000-4000-8000-000000000003";
const V2 = "d0000000-0000-4000-8000-000000000004";
const dish = {
  id: DISH,
  name: "Check dish",
  components: [{ id: COMPONENT, name: "Main", role: "protein", variants: [
    { id: V1, label: "Grilled", isDefault: true, ingredientIds: [], coreIngredientIds: [] },
    { id: V2, label: "Fried", isDefault: false, ingredientIds: [], coreIngredientIds: [] },
  ] }],
};
let n = 0;
const review = (memberId, targetType, targetId, rating, tags, daysAgo) => ({
  id: "e0000000-0000-4000-8000-" + String(++n).padStart(12, "0"),
  memberId, targetType, targetId, planMealId: null, rating, tags, comment: null,
  createdAt: new Date(NOW.getTime() - daysAgo * 86400000),
});
const run = (reviews) =>
  runRules({ now: NOW, today: "2026-09-26", config: configFromFixture(F1), reviews, dishes: [dish], ingredients: [], meals: [] })
    .candidates.map((c) => ({ rule: c.rule, ops: c.ops }));

globalThis.test("independent G1 re-check", () => {
  const scenarios = {
    sc3: run([review("adult_a", "dish", DISH, 1, [], 1), review("adult_a", "dish", DISH, 1, [], 2)]),
    sc3Bad: run([review("adult_a", "dish", DISH, 1, [], 1)]),
    variantAtMean: run([2, 3, 2].map((r, i) => review("adult_b", "variant", V1, r, [], i + 1))),
    variantAboveMean: run([3, 3, 2].map((r, i) => review("adult_b", "variant", V1, r, [], i + 1))),
    lessInWindow: run([review("c1", "dish", DISH, null, ["less_often"], 29), review("c2", "dish", DISH, null, ["less_often"], 3)]),
    lessOutOfWindow: run([review("c1", "dish", DISH, null, ["less_often"], 31), review("c2", "dish", DISH, null, ["less_often"], 3)]),
    moreTwice: run([review("c1", "dish", DISH, null, ["more_often"], 1), review("c1", "dish", DISH, null, ["more_often"], 2)]),
    neverOnce: run([review("c2", "dish", DISH, null, ["never_again"], 1)]),
  };
  ${"__WRITE__"}(scenarios);
});
`,
  G2: `
import { selectProposals, fingerprintOf, proposalExpiry } from "@mealplanner/core/learning/rules";
import { configFromFixture } from ${JSON.stringify(`${ROOT}/packages/core/test/planner/targets/config.ts`)};
import { F1 } from ${JSON.stringify(`${ROOT}/packages/core/test/fixtures/index.ts`)};

const NOW = new Date("2026-09-26T12:00:00Z");
const M = "f0000000-0000-4000-8000-000000000001";
const key = (i) => "f1000000-0000-4000-8000-" + String(i).padStart(12, "0");
const pref = (i, score = -0.8) => ({ kind: "preference.set", payload: { memberId: M, entityType: "dish", entityKey: key(i), score, locked: true } });
const draft = (ops, origin = "rule", priority = 3, count = 2) => ({ origin, title: "t" + JSON.stringify(ops).length + origin + priority + count, rationale: "r", ops, evidence: { reviewIds: [], count, metrics: {} }, priority });
const state = { config: configFromFixture(F1), verifiedIngredientIds: new Set() };
const select = async (drafts, existing = []) => {
  const r = await selectProposals({ drafts, existing, state, now: NOW });
  return { kept: r.kept.map((k) => ({ priority: k.priority, origin: k.origin, kind: k.ops[0].kind })), dropped: r.dropped.map((d) => d.reason) };
};
const rejected = (ops, count, daysAgo) => ({ id: key(900), origin: "rule", status: "rejected", fingerprint: fingerprintOf(ops, state.config), evidenceCount: count, decidedAt: new Date(NOW.getTime() - daysAgo * 86400000), expiresAt: new Date(NOW.getTime() + 86400000) });

globalThis.test("independent G2 re-check", async () => {
  const priorities = [1, 2, 3, 4, 5, 5, 1];
  const out = {
    budgetSeven: await select(priorities.map((p, i) => draft([pref(i)], "rule", p))),
    budgetThree: await select([0, 1, 2].map((i) => draft([pref(i)]))),
    chatOverBudget: await select([0, 1, 2, 3, 4, 5, 6].map((i) => draft([pref(i)], "agent_chat"))),
    rejectedLess: await select([draft([pref(1)], "rule", 3, 5)], [rejected([pref(1)], 3, 10)]),
    rejectedDoubled: await select([draft([pref(1)], "rule", 3, 6)], [rejected([pref(1)], 3, 10)]),
    rejectedOld: await select([draft([pref(1)], "rule", 3, 1)], [rejected([pref(1)], 3, 31)]),
    rejectedOpposite: await select([draft([pref(1, 0.8)], "rule", 3, 1)], [rejected([pref(1)], 3, 10)]),
    neverProposed: await Promise.all(${JSON.stringify(SPEC.neverProposed)}.map((kind) =>
      select([draft([{ kind, payload: kind === "support.grant" ? { operatorUserId: M, expiresAt: "2027-01-01T00:00:00Z" } : kind === "access.link_member" ? { userId: M, memberId: null } : { userId: M } }], "agent_chat")]))),
    protectedFromRule: await select([draft([{ kind: "role.set", payload: { userId: M, role: "member" } }], "rule")]),
    expiry: proposalExpiry(NOW).getTime(),
    now: NOW.getTime(),
  };
  ${"__WRITE__"}(out);
});
`,
  G3: `
import { synthesizeInsights, validateProposals, pseudonyms, synthesisContext, knownIds, evidenceIds } from "@mealplanner/ai/insights";
import { registry } from "@mealplanner/core/changes";

const A = "a0000000-0000-4000-8000-000000000001";
const DISH = "a1000000-0000-4000-8000-000000000001";
const R = "a2000000-0000-4000-8000-000000000001";
const input = {
  referenceDate: "2026-09-26",
  members: [{ id: A, displayName: "Layla Mansour", birthYear: 1990, isTargeted: true }],
  candidates: [], notes: [],
  reviews: [{ id: R, memberId: A, about: "Check dish", rating: 1, tags: [], comment: "Layla found it dry" }],
  settings: { appeal: 0.6 }, rejected: [],
  references: { dishes: [{ id: DISH, name: "Check dish" }], ingredients: [], slots: [] },
};
const op = (kind, payload) => ({ kind, payloadJson: JSON.stringify(payload) });
const proposal = (title, ops) => ({ title, rationale: "r", priority: 3, evidenceReviewIds: [R], ops });
const INVALID = { "access.block": { userId: A }, "support.grant": { operatorUserId: A, expiresAt: "2027-01-01T00:00:00Z" }, "dish.teleport": { dishId: DISH }, "plan.lock": { planMealId: DISH } };
const output = { proposals: [
  proposal("valid", [op("preference.set", { memberId: "Adult A", entityType: "dish", entityKey: DISH, score: -0.5 })]),
  ...Object.entries(INVALID).map(([kind, payload]) => proposal("bad " + kind, [op(kind, payload)])),
] };
const model = {
  model: "stub",
  requests: [],
  parse(request) {
    this.requests.push(request);
    return Promise.resolve({ output: request.schema.parse(output), servedModel: "stub", stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
      content: [{ type: "text", text: JSON.stringify(output) }], messageId: "m" });
  },
};
globalThis.test("independent G3 re-check", async () => {
  const records = [];
  const result = await synthesizeInsights({ model, recordGeneration: (r) => { records.push(r); return Promise.resolve("g1"); } }, input);
  const names = pseudonyms(input);
  const ctx = synthesisContext(input, names);
  const permissive = validateProposals(output.proposals, { pseudonyms: names, knownIds: knownIds(ctx, input), evidenceIds: evidenceIds(input), allowedKinds: [...registry.keys(), "dish.teleport"] });
  ${"__WRITE__"}({
    invalidKinds: Object.keys(INVALID),
    status: result.status,
    kept: result.proposals.map((p) => ({ title: p.title, kinds: p.ops.map((o) => o.kind), memberIds: p.ops.map((o) => o.payload.memberId) })),
    dropped: result.dropped.map((d) => ({ kind: d.kind, reason: d.reason })),
    logged: records.map((r) => r.validationErrors),
    request: JSON.stringify(model.requests),
    permissiveKept: permissive.proposals.map((p) => p.ops[0].kind),
    memberId: A,
  });
});
`,
};

async function runCheck(gateId, scratch) {
  const dir = join(scratch, "check");
  mkdirSync(dir, { recursive: true });
  const out = join(scratch, "check.json");
  const file = `import { writeFileSync } from "node:fs";\nconst __write = (v) => writeFileSync(${JSON.stringify(out)}, JSON.stringify(v));\n${CHECKS[gateId].replace("__WRITE__", "__write")}`;
  writeFileSync(join(dir, "independent.test.mjs"), file);
  const config = writeVitestConfig(scratch, "check", dir, ", globals: true");
  const result = await vitest(dir, config, ["independent.test.mjs"], {}, scratch, "check");
  const data = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
  return { result, data };
}

// Judgements, each also run on a known-bad result (negative control).

function judgeG1(d) {
  const f = [];
  const only = (list, rule) => list.filter((c) => c.rule === rule);
  const sc3 = only(d.sc3, "dish_dislike");
  const p = sc3[0]?.ops[0]?.payload;
  if (!(
    sc3.length === 1 &&
    p?.memberId === "adult_a" &&
    p?.score === SPEC.dislikeScore &&
    p?.locked === true
  ))
    f.push(
      `SC-3: two 1★ reviews must give one locked ${SPEC.dislikeScore} dish proposal for adult_a (got ${JSON.stringify(sc3)})`,
    );
  if (only(d.sc3Bad, "dish_dislike").length !== 0)
    f.push("SC-3: one 1★ review must give no proposal");
  if (only(d.variantAtMean, "variant_dislike").length !== 1)
    f.push(
      `rule 1: mean 2.33 ≤ ${SPEC.dislikeMaxMean} over ${SPEC.variantMinReviews} reviews must trigger`,
    );
  if (only(d.variantAboveMean, "variant_dislike").length !== 0)
    f.push("rule 1: mean 2.67 must not trigger");
  const less = only(d.lessInWindow, "less_often");
  if (!(less.length === 1 && less[0].ops[0].payload.minGapDays === SPEC.lessOftenGap))
    f.push(
      `FBK-6: ${SPEC.frequencySignals} less_often in ${SPEC.windowDays} days must propose min gap ${SPEC.lessOftenGap}`,
    );
  if (only(d.lessOutOfWindow, "less_often").length !== 0)
    f.push("FBK-6: a signal older than 30 days must not count");
  const more = only(d.moreTwice, "more_often");
  if (!(more.length === 1 && more[0].ops[0].payload.minGapDays === SPEC.moreOftenGap))
    f.push(`FBK-6: 2 more_often must propose min gap ${SPEC.moreOftenGap}`);
  const never = only(d.neverOnce, "never_again");
  if (!(never.length === 1 && never[0].ops[0].payload.hard === "never"))
    f.push("FBK-6: never_again must propose hard never at once");
  return f;
}

function judgeG2(d) {
  const f = [];
  const kept = (r) => r.kept.length;
  if (kept(d.budgetSeven) !== SPEC.budget)
    f.push(`budget: ${kept(d.budgetSeven)} kept of 7, expected ${SPEC.budget}`);
  const pr = d.budgetSeven.kept.map((k) => k.priority);
  if (JSON.stringify(pr) !== JSON.stringify([5, 5, 4, 3, 2]))
    f.push(`budget keeps highest priority first: ${JSON.stringify(pr)}`);
  if (kept(d.chatOverBudget) !== 7)
    f.push("agent_chat drafts must not be limited by the budget (R-33)");
  if (kept(d.rejectedLess) !== 0)
    f.push(`evidence 5 < ${SPEC.evidenceMultiplier}×3 must stay suppressed`);
  if (kept(d.rejectedDoubled) !== 1) f.push(`evidence 6 = ${SPEC.evidenceMultiplier}×3 must pass`);
  if (kept(d.rejectedOld) !== 1)
    f.push(`a rejection older than ${SPEC.cooldownDays} days must not suppress`);
  if (kept(d.rejectedOpposite) !== 1)
    f.push("the opposite direction must not be suppressed (R-33)");
  if (!d.neverProposed.every((r) => kept(r) === 0 && r.dropped[0] === "protected"))
    f.push("R-10 kinds must never be proposed, even from agent_chat");
  if (kept(d.protectedFromRule) !== 0) f.push("the engine must not propose a protected op");
  if (d.expiry - d.now !== SPEC.expiryDays * 86_400_000)
    f.push(`expiry must be ${SPEC.expiryDays} days`);
  return f;
}

function judgeG3(d) {
  const f = [];
  if (d.status !== "ok") f.push(`status ${d.status}`);
  if (!(
    d.kept.length === 1 &&
    d.kept[0].title === "valid" &&
    d.kept[0].memberIds[0] === d.memberId
  ))
    f.push(
      `only the valid proposal is kept, with its label mapped to the member id (got ${JSON.stringify(d.kept)})`,
    );
  for (const kind of d.invalidKinds) {
    if (!d.dropped.some((x) => x.kind === kind && x.reason === "invalid_kind"))
      f.push(`${kind} not dropped as invalid_kind`);
    if (!JSON.stringify(d.logged).includes(kind))
      f.push(`${kind} not logged in ai_generation.validation_errors`);
    if (d.kept.some((k) => k.kinds.includes(kind))) f.push(`${kind} was kept`);
  }
  if (/Layla|Mansour/.test(d.request)) f.push("a member name reached the model");
  return f;
}

function negativeControl(id, d) {
  // Known-bad results: the same judgement must reject them.
  if (id === "G1") return judgeG1({ ...d, sc3: d.sc3Bad, variantAboveMean: d.variantAtMean });
  if (id === "G2")
    return judgeG2({ ...d, budgetSeven: d.budgetThree, rejectedLess: d.rejectedDoubled });
  return judgeG3({
    ...d,
    kept: d.permissiveKept.map((k) => ({ title: k, kinds: [k], memberIds: [] })),
  });
}

// ---------------------------------------------------------------------------------------------

async function gate(id) {
  const spec = GATES[id];
  const report = new Report(`leaf-1.3.3 ${id}`);
  console.log(`# ${id}: ${spec.title}`);
  const scratch = mkdtempSync(join(tmpdir(), `leaf-1.3.3-${id}-`));
  let database = null;
  try {
    const tsc = typecheck(scratch);
    report.check(
      tsc.code === 0,
      "tsc --noEmit: the leaf's sources and pure tests type-check (from source)",
      tail(tsc),
    );

    const env = {};
    if (spec.db) {
      database = await acquireDatabase();
      const rows = await query(database.url, "SHOW server_version");
      const version = String(rows[0]?.server_version ?? "");
      report.check(
        /^16\./.test(version),
        `database (${database.source}) is PostgreSQL 16 (server_version ${version})`,
      );
      env.DATABASE_URL = database.url;
    }

    const results = [];
    for (const [i, { pkg, files }] of spec.runs.entries()) {
      const root = PKG(pkg);
      const config = writeVitestConfig(scratch, `${pkg}${i}`, root);
      const result = await vitest(root, config, files, env, scratch, `${pkg}${i}`);
      const where = `packages/${pkg}: ${files.join(", ")}`;
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
      `the gate has ${String(spec.negative.length)} negative control test(s)`,
    );

    const { result, data } = await runCheck(id, scratch);
    report.check(
      result.code === 0 && data !== null,
      "the independent check ran on the real modules",
      tail({ stdout: result.output, stderr: "" }, 40),
    );
    if (data !== null) {
      const judge = { G1: judgeG1, G2: judgeG2, G3: judgeG3 }[id];
      const failures = judge(data);
      report.check(
        failures.length === 0,
        `independent re-check against the spec's numbers (${id})`,
        failures.join("\n"),
      );
      const bad = negativeControl(id, data);
      report.check(
        bad.length > 0,
        "negative control: the same judgement rejects a known-bad result",
        bad.join("\n"),
      );
    }
  } finally {
    database?.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
  return report.finish();
}

const flag = process.argv.indexOf("--gate");
const id = flag === -1 ? undefined : process.argv[flag + 1];
if (id === undefined || !(id in GATES)) {
  console.error(`usage: node scripts/verify/leaf-1.3.3.mjs --gate ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
process.exit(await gate(id));
