// Verify script for the root gates (docs/build/GATES.md R1–R8; BLD-6 root, R-79, R-80).
// Usage: node scripts/verify/root.mjs --gate R1|SC-1|SC-2|SC-3|SC-4|SC-5|SC-6|SC-7
// Prints "VERIFY root <gate> PASSED" only when every assertion, the gate's negative controls
// included, holds; exits non-zero otherwise. The gate's elapsed time is its last `ok` line.
//
// R1    Every node ledger reverified by gate-check, one at a time, each pass cached under the git
//       tree it ran on (lib/root-r1.mjs).
// SC-1 … SC-7 each run against a fresh `docker compose up` of the repo's docker-compose.yml, its
// images built from the repo's Dockerfiles, in a compose project of its own (volume, network,
// images), on free ports of 127.0.0.1, torn down with `down -v` afterwards (lib/root-compose.mjs).
// The stack migrates and loads the catalogue and seed library itself. F1 is built through the
// stack's API (apps/web/test/root/f1-api.ts) and checked against loadFixture(F1). The model is
// recorded: the node gates' recorded-model server, reached by the containers through a relay
// (lib/root-model.mjs); no ANTHROPIC_API_KEY reaches any container (checked with docker inspect).
// SC-1  node-1.2 N3's measure on the persisted plates of F1's week (seed 1, economy 0.4, AI recipes
//       off), re-checked here (lib/root-rechecks.mjs). Control: tampered plate grams fail SC-1.
// SC-2  node-1.2 N3's measure over seeds 1–10 (median ≥ 8 %, every seed ≥ 0 %), re-checked here
//       from the per-seed counts. Controls: SC-2 against itself fails; one seed where economy adds
//       an ingredient fails the re-check.
// SC-3  node-1.3 N3's SC-3 flow and re-check. Control: one 1★ review gives no proposal.
// SC-4  node-1.3 N3's SC-4 flow and re-check. Control: an undo missing a before-image fails.
// SC-5  node-1.4 N3's flows (apps/web/e2e/node-1.4/flows.ts) at 390 and 1280 px with axe-core,
//       re-checked by node-1.4's rule. Control: axe reports a known-bad page.
// SC-6  leaf 1.4.3 G5's SC-6 test (apps/web/e2e/config.spec.ts), judged by its `sc6Problems` and
//       the exact count (SPEC-Q-4). Control: a sixth, required question fails SC-6.
// SC-7  leaf 1.4.3 G5's SC-7 test, judged by its `sc7Problems`. Control: a broken Adjust link
//       fails SC-7.
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPackages,
  chromium,
  judgeTests,
  nodeMain,
  playwrightResults,
  readMeasurements,
  requireTitles,
  ROOT,
  runAsync,
  vitestRun,
  WEB,
} from "./lib/node.mjs";
import { hostGateway, withStack } from "./lib/root-compose.mjs";
import { startRelay } from "./lib/root-model.mjs";
import { gateR1 } from "./lib/root-r1.mjs";
import {
  copiesMatchSources,
  median,
  recheckSc5,
  sc1Ok,
  sc2Ok,
  sc3Ok,
  sc4Ok,
} from "./lib/root-rechecks.mjs";
import { tail } from "./lib/run.mjs";
import { sc6Problems, sc7Problems } from "./leaf-1.4.3.mjs";

const PW_CONFIG = "e2e/root/playwright.config.ts";

/**
 * The frame of every SC gate: the reused re-checks equal their sources, the packages the tests
 * import are built, then `body` runs against a fresh stack with the relay's recorded model.
 */
async function stackGate(report, gate, body) {
  const drift = copiesMatchSources();
  report.check(
    drift.length === 0,
    "the node gates' re-checks used here are byte-identical to their sources (lib/root-rechecks.mjs)",
    drift.join("\n"),
  );
  const mutated = copiesMatchSources((file) =>
    readFileSync(join(ROOT, file), "utf8")
      .replace("median(reductions) >= 0.08", "median(reductions) >= 0.07")
      .replace("m.proposals === 1", "m.proposals >= 1")
      .replace("axe.length >= 20", "axe.length >= 2"),
  );
  report.check(
    mutated.length === 3,
    `negative control: a changed source is reported as drift (${mutated.join("; ")})`,
  );
  if (!(await buildPackages(report))) return;
  const relay = await startRelay(await hostGateway());
  const scratch = mkdtempSync(join(tmpdir(), `root-${gate.toLowerCase()}-`));
  try {
    await withStack(report, gate, relay, async (stack) => {
      await body({
        stack,
        scratch,
        measureFile: join(scratch, "measure.jsonl"),
        env: {
          ROOT_APP_URL: stack.appUrl,
          ROOT_DB_URL: stack.dbUrl,
          ROOT_MODEL_TARGET_FILE: relay.targetFile,
          NODE_MEASURE_FILE: join(scratch, "measure.jsonl"),
          DATABASE_URL: "",
        },
      });
      relay.endOfTest();
    });
    console.log(
      `       measured: the relay forwarded ${String(relay.stats.forwarded)} model connection(s) from the containers, refused ${String(relay.stats.refused)} (no recorded server yet), ${String(relay.stats.errors.length)} error(s); ${String(relay.stats.afterTest)} refused after the test ended`,
    );
    report.check(
      relay.stats.refused === 0 && relay.stats.errors.length === 0,
      "every model connection from the containers reached the recorded model (none refused or broken)",
      relay.stats.errors.join("\n"),
    );
  } finally {
    await relay.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A vitest root test file against the stack: every test passes, the required ones by title. */
async function rootVitest(report, ctx, file, titles) {
  const r = await vitestRun(
    WEB,
    ["--config", "test/root/vitest.config.ts", file],
    ctx.env,
    14_400_000,
  );
  judgeTests(report, `apps/web/${file} against the compose stack`, r);
  requireTitles(report, r.tests, titles);
  const unexpected = r.tests.filter((t) => !titles.includes(t.title));
  report.check(
    unexpected.length === 0,
    "no test outside the required list",
    unexpected.map((t) => t.title).join("\n"),
  );
  return readMeasurements(ctx.measureFile);
}

/** The F1 set-up check every flow ran: the API-built household equals loadFixture(F1). */
function reportSetup(report, m) {
  // SC-2 records the comparison with its runs, the other gates with their set-up.
  const setup = m.find((r) => r.check === "setup") ?? m.find((r) => r.check === "runs");
  const compared = setup?.compared ?? {};
  console.log(
    `       measured F1 (API-built, compared with loadFixture(F1) by natural key): ${Object.entries(
      compared,
    )
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(", ")}`,
  );
  report.check(
    (compared.members ?? 0) === 5 && (compared.slotTypes ?? 0) > 0,
    "F1 built through the stack's API equals loadFixture(F1) (5 members, slots, schedules, targets, logins)",
  );
}

function reportModel(report, m, { requests } = {}) {
  const model = m.find((r) => r.check === "model");
  console.log(
    `       measured: ${String(model?.requests)} model request(s) to the recorded server${model?.syntheses === undefined ? "" : ` (${String(model.syntheses)} insight syntheses)`}, ${String(model?.failures?.length)} unanswered`,
  );
  report.check(
    model !== undefined &&
      model.failures.length === 0 &&
      (requests === undefined || requests(model.requests, model)),
    "the recorded model answered every request; no live call",
    JSON.stringify(model?.failures ?? "no record"),
  );
}

// SC-1 ------------------------------------------------------------------------------------------

const SC1_TESTS = [
  "SC-1 F1 through the stack's API, and plan.generate by its worker persists the 7-day plan (seed 1, economy 0.4, AI recipes off)",
  "SC-1 from the persisted plates: every targeted member-meal in tolerance or flagged with its reason",
  "SC-1 negative control: persisted plate grams tampered off tolerance fail SC-1",
  "SC-1 the recorded model answered every request (insight syntheses only), and no live call was made",
];

async function gateSc1(report) {
  await stackGate(report, "SC-1", async (ctx) => {
    const m = await rootVitest(report, ctx, "test/root/sc1.root.ts", SC1_TESTS);
    reportSetup(report, m);
    const one = (check) => m.find((r) => r.check === check);
    const setup = one("setup");
    console.log(
      `       measured: seed 1 persisted ${String(setup?.days)} days, ${String(setup?.meals)} meals, ${String(setup?.plates)} plates in ${String(setup?.seconds)} s; the job's result has ${String(setup?.flags)} flag(s) (${(setup?.flagKinds ?? []).join(", ") || "none"})`,
    );
    report.check(setup?.days === 7, "the stack's worker persisted 7 days");
    const sc1 = one("sc1");
    console.log(
      `       measured SC-1: ${String(sc1?.inTolerance)} of ${String(sc1?.total)} targeted member-meals in tolerance, ${String(sc1?.flagged)} flagged with a reason, ${String(sc1?.noPlateFlagged)} flagged without a plate, ${String(sc1?.failures?.length)} unflagged misses; ${String(sc1?.memberDays)} member-days; largest |recomputed − stored per-plate total| ${String(sc1?.maxStoredDiff)}`,
    );
    report.check(
      sc1Ok(sc1),
      "SC-1 (re-checked by node-1.2's rule): every targeted member-meal in tolerance or flagged; stored totals match their items",
    );
    report.check(
      !sc1Ok({ ...sc1, failures: ["x: out of tolerance and not flagged"] }),
      "negative control of the re-check: an unflagged miss is rejected",
    );
    const tampered = one("sc1-control");
    console.log(
      `       measured (negative control): tampered plate grams give ${String(tampered?.failures)} SC-1 failure(s), ${String(tampered?.storedDrift)} drifting plate(s)`,
    );
    report.check(
      tampered?.failures > 0 &&
        !sc1Ok({
          ...sc1,
          failures: new Array(tampered?.failures ?? 0).fill("x"),
          storedDrift: tampered?.storedDrift,
        }),
      "negative control: the tampered persisted plate fails SC-1",
    );
    reportModel(report, m, { requests: (n, model) => n === model.syntheses });
  });
}

// SC-2 ------------------------------------------------------------------------------------------

const SC2_TESTS = [
  "SC-2 21 API-built F1 households (seeds 1–10 × economy 0.4 and 0, and seed 1 again) planned by the stack's worker",
  "SC-2 seed 1 repeated in another household persists the same plan",
  "SC-2 over seeds 1–10 through the stack's job path: median ≥ 8 %, every seed ≥ 0 %",
  "SC-2 negative control: SC-2 measured against itself (0 %) fails",
  "SC-2 the recorded model answered every request (insight syntheses only), and no live call was made",
];

async function gateSc2(report) {
  await stackGate(report, "SC-2", async (ctx) => {
    const m = await rootVitest(report, ctx, "test/root/sc2.root.ts", SC2_TESTS);
    reportSetup(report, m);
    const one = (check) => m.find((r) => r.check === check);
    const runs = one("runs");
    console.log(
      `       measured: ${String(runs?.runs)} plan.generate runs by the stack's worker in ${String(runs?.households)} API-built F1 households (seconds from queueing: ${(runs?.seconds ?? []).join(", ")})`,
    );
    report.check(runs?.runs === 21, "21 runs (20 for SC-2, 1 repeat)");
    const rep = one("repeat");
    console.log(
      `       measured: seed 1 repeated in another household: ${String(rep?.differing)} of ${String(rep?.meals)} meals differ`,
    );
    report.check(
      rep?.meals > 0 && rep?.differing === 0,
      "the repeated seed-1 plan equals the first (sharing one stack biases nothing)",
    );
    const sc2 = one("sc2");
    for (const s of sc2?.perSeed ?? [])
      console.log(
        `       measured SC-2 seed ${String(s.seed)}: ${String(s.economy)} core ingredients at economy 0.4, ${String(s.baseline)} at 0 → ${(100 * (1 - s.economy / s.baseline)).toFixed(1)} %`,
      );
    const reductions = (sc2?.perSeed ?? []).map((s) => 1 - s.economy / s.baseline);
    if (reductions.length > 0)
      console.log(
        `       measured SC-2: median ${(100 * median(reductions)).toFixed(1)} %, min ${(100 * Math.min(...reductions)).toFixed(1)} %, max ${(100 * Math.max(...reductions)).toFixed(1)} %`,
      );
    report.check(
      sc2Ok(sc2?.perSeed),
      "SC-2 (re-checked by node-1.2's rule from the per-seed counts): median ≥ 8 %, every seed ≥ 0 %",
    );
    report.check(
      !sc2Ok((sc2?.perSeed ?? []).map((s) => ({ ...s, economy: s.baseline }))),
      "negative control: SC-2 of the baseline against itself (0 %) is rejected",
    );
    report.check(
      !sc2Ok((sc2?.perSeed ?? []).map((s, i) => (i === 0 ? { ...s, economy: s.baseline + 1 } : s))),
      "negative control: one seed where economy adds an ingredient is rejected",
    );
    report.check(
      one("sc2-control")?.self?.pass === false,
      "negative control (in the test): SC-2 against itself fails",
    );
    reportModel(report, m, { requests: (n, model) => n === model.syntheses });
  });
}

// SC-3, SC-4 --------------------------------------------------------------------------------------

const SC3_TESTS = [
  "SC-3 set-up: F1 through the stack's API, Adult B's own login, and a plan from the stack's worker",
  "SC-3 negative control: one 1★ review gives no proposal",
  "SC-3 a second 1★ review lowers the member's dish appeal and insights.run proposes the dislike",
  "SC-3 the recorded model answered every request, and no live call was made",
];

async function gateSc3(report) {
  await stackGate(report, "SC-3", async (ctx) => {
    const m = await rootVitest(report, ctx, "test/root/sc3.root.ts", SC3_TESTS);
    reportSetup(report, m);
    const one = (check) => m.find((r) => r.check === check);
    const control = one("sc3-control");
    const sc3 = one("sc3");
    console.log(
      `       measured SC-3: after one 1★ review ${String(control?.pending)} pending proposal(s); after two: dish score ${String(sc3?.scoreBefore)} → ${String(sc3?.scoreAfter)}, plate appeal ${String(sc3?.appealBefore)} → ${String(sc3?.appealAfter)}, ${String(sc3?.others)} other member(s) on the meal unchanged ${String(sc3?.othersUnchanged)}, ${String(sc3?.proposals)} dislike proposal(s)`,
    );
    report.check(control?.pending === 0, "negative control: one 1★ review gives no proposal");
    report.check(
      sc3Ok(sc3),
      "SC-3 (re-checked by node-1.3's rule): two 1★ reviews lower the member's dish score and appeal and give one proposal",
    );
    report.check(
      !sc3Ok({ ...sc3, appealAfter: sc3?.appealBefore }),
      "negative control of the re-check: an unchanged appeal is rejected",
    );
    report.check(
      !sc3Ok({ ...sc3, proposals: control?.pending }),
      "negative control of the re-check: the one-review state (no proposal) is rejected",
    );
    const model = one("model");
    console.log(
      `       measured: ${String(model?.syntheses)} insight synthesis request(s) answered from the recording`,
    );
    reportModel(report, m, { requests: (n) => n === model?.syntheses && n >= 2 });
  });
}

const SC4_TESTS = [
  "SC-4 set-up: F1 through the stack's API and a conversation",
  "SC-4 an agent apply_change is in the change log as the agent's and its undo restores the prior state exactly",
  "SC-4 negative control: an undo that skips one before-image fails the equality check",
  "SC-4 the recorded model answered every request, and no live call was made",
];

async function gateSc4(report) {
  await stackGate(report, "SC-4", async (ctx) => {
    const m = await rootVitest(report, ctx, "test/root/sc4.root.ts", SC4_TESTS);
    reportSetup(report, m);
    const one = (check) => m.find((r) => r.check === check);
    const sc4 = one("sc4");
    console.log(
      `       measured SC-4: agent change set ${String(sc4?.changeSetId)} (${String(sc4?.actor)}/${String(sc4?.source)}) touched ${(sc4?.entities ?? []).join(", ")}; the turn also wrote ${(sc4?.turnWrites ?? []).join(", ")}; ${String(sc4?.restoreDiff)} row(s) differ after undo; not compared: ${(sc4?.excluded ?? []).join(", ")}`,
    );
    report.check(
      sc4Ok(sc4),
      "SC-4 (re-checked by node-1.3's rule): the agent's change is logged as the agent's and its undo restores every compared table",
    );
    report.check(
      !sc4Ok({ ...sc4, restoreDiff: 1 }),
      "negative control of the re-check: one differing row is rejected",
    );
    const c = one("sc4-control");
    console.log(
      `       measured (negative control): ${String(c?.restoreDiff)} row(s) differ after the undo without one before-image (only member rows: ${String(c?.onlyMember)})`,
    );
    report.check(
      c?.removed === 1 &&
        c?.restoreDiff > 0 &&
        c?.onlyMember === true &&
        !sc4Ok({ ...sc4, restoreDiff: c?.restoreDiff }),
      "negative control: the undo without one before-image fails SC-4",
    );
    reportModel(report, m, { requests: (n) => n >= 4 });
  });
}

// Playwright gates ------------------------------------------------------------------------------

async function rootPlaywright(report, ctx, args, extraEnv = {}) {
  const reportFile = join(ctx.scratch, "report.json");
  const r = await runAsync(
    process.execPath,
    [
      join(WEB, "node_modules/@playwright/test/cli.js"),
      "test",
      "--config",
      PW_CONFIG,
      "--reporter=list,json",
      ...args,
    ],
    {
      cwd: WEB,
      env: {
        ...ctx.env,
        ...extraEnv,
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        PLAYWRIGHT_OUTPUT_DIR: join(ctx.scratch, "artefacts"),
        ...(chromium() === undefined ? {} : { PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromium() }),
      },
      timeoutMs: 3_600_000,
    },
  );
  const tests = playwrightResults(reportFile);
  const failed = tests.filter((t) => t.status !== "passed");
  if (r.code !== 0 || failed.length > 0)
    console.log(`----- Playwright output (exit ${String(r.code)}) -----\n${tail(r, 120)}`);
  report.check(
    r.code === 0 && tests.length > 0 && failed.length === 0,
    `Playwright ${args.join(" ")} against the compose stack: ${String(tests.length)} tests, ${String(tests.length - failed.length)} passed, none skipped or failed`,
    failed
      .map((t) => `[${t.status}] ${t.title}\n${t.error}`)
      .join("\n")
      .slice(0, 8000),
  );
  return tests;
}

function requirePlaywright(report, tests, titles) {
  for (const title of titles) {
    const hit = tests.filter((t) => t.title === title);
    report.check(
      hit.length === 1 && hit[0].status === "passed",
      `ran and passed: ${title}`,
      hit.map((t) => t.status).join(", ") || "missing",
    );
  }
  const unexpected = tests.filter((t) => !titles.includes(t.title));
  report.check(
    unexpected.length === 0,
    "no test outside the required list",
    unexpected.map((t) => t.title).join("\n"),
  );
}

const FLOWS = (w) => [
  `SC-5 onboarding to a first plan at ${w} px: at most five questions, UAE, metric`,
  `SC-5 the plan at ${w} px`,
  `SC-5 the cook sheet at ${w} px`,
  `SC-5 a review at ${w} px`,
  `SC-5 a chat proposal accepted and visible in the change log at ${w} px`,
];
const SC5_TESTS = [
  ...FLOWS("390"),
  ...FLOWS("1280"),
  "SC-5 the recorded model answered every request, and no live call was made",
  "negative control: axe reports a known-bad page",
];

async function gateSc5(report) {
  await stackGate(report, "SC-5", async (ctx) => {
    const tests = await rootPlaywright(report, ctx, ["root/sc5.e2e.ts"]);
    requirePlaywright(report, tests, SC5_TESTS);
    recheckSc5(report, readMeasurements(ctx.measureFile));
  });
}

/** SC-6 as SPEC-Q-4 reads it: sc6Problems, plus the exact counts the product asks. */
function sc6Verdict(sc6) {
  const problems = [];
  for (const kind of ["answered", "skipped"]) {
    const run = sc6?.[kind];
    if (run === undefined) {
      problems.push(`${kind}: not recorded`);
      continue;
    }
    const m = sc6Problems(run);
    problems.push(...m.problems.map((p) => `${kind}: ${p}`));
    if (m.questions !== 5)
      problems.push(`${kind}: ${String(m.questions)} question screens (exactly 5)`);
    // R2-ONB-2: every question can be skipped, so the product requires no answer at all.
    if (m.required !== 0)
      problems.push(
        `${kind}: ${String(m.required)} required answers (every question can be skipped: 0)`,
      );
  }
  return problems;
}

async function gateSc6(report) {
  await stackGate(report, "SC-6", async (ctx) => {
    const traceDir = join(ctx.scratch, "trace");
    const tests = await rootPlaywright(report, ctx, ["config.spec.ts", "--grep", "@G5 SC-6"], {
      LEAF143_TRACE_DIR: traceDir,
      ROOT_SETUP_MODEL: "1",
    });
    requirePlaywright(report, tests, [
      "@G5 SC-6 the answers asked before the first plan, answered and skipped",
    ]);
    const file = join(traceDir, "sc6.json");
    if (!report.check(existsSync(file), "the e2e run recorded SC-6 (leaf 1.4.3 G5's trace)"))
      return;
    const sc6 = JSON.parse(readFileSync(file, "utf8"));
    for (const kind of ["answered", "skipped"]) {
      const m = sc6Problems(sc6[kind]);
      console.log(
        `       measured SC-6 (${kind}): ${String(m.questions)} question screens (${sc6[kind].steps.map((s) => `${s.step} "${s.heading}" ${String(s.requiredInputs)} required${s.skipOffered ? ", skip offered" : ""}`).join("; ")}), ${String(m.required)} required answers, first plan ${String(sc6[kind].planned)}`,
      );
    }
    const problems = sc6Verdict(sc6);
    report.check(
      problems.length === 0,
      "SC-6: exactly 5 questions before the first plan, answered and skipped, none of them required (0 required answers); a first plan both ways",
      problems.join("\n"),
    );
    const bad = {
      ...sc6,
      answered: {
        ...sc6.answered,
        steps: [
          ...sc6.answered.steps,
          { step: "5b", heading: "Extra", inputs: 1, requiredInputs: 1, skipOffered: false },
        ],
      },
    };
    const badProblems = sc6Verdict(bad);
    report.check(
      badProblems.length > 0 && sc6Problems(bad.answered).problems.length > 0,
      `negative control: a sixth, required question fails SC-6 (${badProblems.join("; ")})`,
    );
    reportModel(report, readMeasurements(ctx.measureFile));
  });
}

async function gateSc7(report) {
  await stackGate(report, "SC-7", async (ctx) => {
    const traceDir = join(ctx.scratch, "trace");
    const tests = await rootPlaywright(report, ctx, ["config.spec.ts", "--grep", "@G5 SC-7"], {
      LEAF143_TRACE_DIR: traceDir,
      ROOT_SETUP_MODEL: "1",
    });
    requirePlaywright(report, tests, [
      "@G5 SC-7 every Adjust link after confirmation resolves to its setting",
    ]);
    const file = join(traceDir, "sc7.json");
    if (!report.check(existsSync(file), "the e2e run recorded SC-7 (leaf 1.4.3 G5's trace)"))
      return;
    const sc7 = JSON.parse(readFileSync(file, "utf8"));
    for (const r of sc7.results)
      console.log(
        `       measured SC-7: ${r.href} → ${String(r.status)}, ${r.target} ${r.visible ? "shown" : "not shown"}`,
      );
    const problems = sc7Problems(sc7);
    report.check(
      problems.length === 0 && sc7.results.length === sc7.explanations && sc7.explanations > 0,
      `SC-7: all ${String(sc7.results.length)} Adjust links of ${String(sc7.explanations)} inferred settings answered 200 and showed their setting`,
      problems.join("\n"),
    );
    const bad = {
      ...sc7,
      results: sc7.results.map((r, i) => (i === 0 ? { ...r, status: 404, visible: false } : r)),
    };
    report.check(
      sc7Problems(bad).length > 0,
      `negative control: a broken Adjust link fails SC-7 (${sc7Problems(bad).join("; ")})`,
    );
    reportModel(report, readMeasurements(ctx.measureFile));
  });
}

await nodeMain({
  label: "root",
  gates: {
    R1: (report) => gateR1(report),
    "SC-1": gateSc1,
    "SC-2": gateSc2,
    "SC-3": gateSc3,
    "SC-4": gateSc4,
    "SC-5": gateSc5,
    "SC-6": gateSc6,
    "SC-7": gateSc7,
  },
});
