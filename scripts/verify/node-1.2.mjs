// Verify script for node 1.2 Engine (BLD-6 node gate definitions, R-69, R-70).
// Usage: node scripts/verify/node-1.2.mjs --gate N2|N3|N4
// Prints "VERIFY node-1.2 <gate> PASSED" only when every assertion, including the gate's negative
// controls, holds; exits non-zero otherwise. N1 and N5 are the architect's.
//
// N2  The branch packages (@mealplanner/core, @mealplanner/db) are built; every workspace package
//     that depends on them typechecks against their dist/ declarations; the api-contract contract
//     tests pass. Negative control: in a disposable copy, `PlanResult.flags` in the planner's types
//     is renamed and @mealplanner/db's typecheck fails.
// N3  apps/web/test/node/engine.node.ts on a fresh database of the gate's own (migrated from zero,
//     catalogue, F1), used as the template of one database per plan run (SPEC-Q-5). Each run queues
//     `plan.generate` through the API route and the real worker runs it. From the persisted plan of
//     seed 1: SC-1 (in tolerance or flagged; stored per-plate totals against their items, R-70), the
//     OQ-8 repeat gaps, day 1's cook sheet against the plates' raw equivalents. SC-2 over seeds 1–10
//     (economy 0.4 against 0): median ≥ 8 %, every seed ≥ 0 %. Negative controls: persisted plate
//     grams tampered off tolerance fail SC-1, a repeated dish inside the gap fails the repeat
//     check, SC-2 measured against itself fails. The script re-checks every figure, each re-check
//     also run on a known-bad record.
// N4  The full suite (scripts/verify/lib/node.mjs `gateN4`).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireServer,
  buildPackages,
  createDatabase,
  gateN2,
  gateN4,
  judgeTests,
  nodeMain,
  query,
  readMeasurements,
  requireTitles,
  vitestRun,
  WEB,
} from "./lib/node.mjs";

const LABEL = "node-1.2";

const N2_CONTROL = {
  description: "PlanResult.flags is renamed to planFlags",
  file: "packages/core/src/planner/select/types.ts",
  find: /\n {2}flags: PlanFlag\[\];\n {2}generationRequests: PlanGenerationRequest\[\];/,
  replace: "\n  planFlags: PlanFlag[];\n  generationRequests: PlanGenerationRequest[];",
  packageDir: "packages/core",
  consumer: "@mealplanner/db",
  consumerDir: "packages/db",
  expectError: /^(src|test)\/\S+\.ts\(\d+,\d+\): error TS\d+/,
};

const TESTS = [
  "N3 set-up: a fresh database migrated from zero, the catalogue loaded and F1 seeded",
  "N3 plan.generate through the worker persists F1's 7-day plan and SC-2's runs (seeds 1–10, economy 0.4 and 0)",
  "N3 SC-1 from the persisted plates: every targeted member-meal in tolerance or flagged with its reason",
  "N3 the OQ-8 repeat gaps hold on the persisted plan",
  "N3 day 1's cook sheet from the persisted plan: raw totals equal the sum of plate raw equivalents",
  "N3 SC-2 over seeds 1–10 through the job path: median ≥ 8 %, every seed ≥ 0 %",
  "N3 negative control: persisted plate grams tampered off tolerance fail SC-1",
  "N3 negative control: a repeated dish inside the gap fails the repeat check",
  "N3 negative control: SC-2 measured against itself (0 %) fails",
];

/** Re-checks of the measured figures; each also runs on a known-bad record that must fail. */
const sc1Ok = (m) =>
  m !== undefined &&
  m.total > 0 &&
  m.failures.length === 0 &&
  m.inTolerance + m.flagged + m.noPlateFlagged === m.total &&
  m.maxStoredDiff <= 0.001;
const gapsOk = (m) => m !== undefined && m.pairs > 0 && m.violations.length === 0;
const cookOk = (m) => m !== undefined && m.batches > 0 && m.failures.length === 0;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};
/** SC-2 recomputed here from the per-seed counts, not from the test's aggregate. */
const sc2Ok = (perSeed) => {
  if (perSeed?.length !== 10 || perSeed.some((s) => !(s.baseline > 0))) return false;
  const reductions = perSeed.map((s) => 1 - s.economy / s.baseline);
  return median(reductions) >= 0.08 && Math.min(...reductions) >= 0;
};

function recheck(report, m) {
  const one = (check) => m.find((r) => r.check === check);
  const runs = one("runs");
  console.log(
    `       measured: ${String(runs?.runs)} plan.generate runs by the worker (${(runs?.seconds ?? []).join(", ")} s); seed 1 persisted ${String(runs?.days)} days, ${String(runs?.meals)} meals, ${String(runs?.plates)} plates`,
  );
  report.check(
    runs?.runs === 20 && runs?.days === 7,
    "20 runs; the seed-1 plan has 7 persisted days",
  );

  const sc1 = one("sc1");
  console.log(
    `       measured SC-1: ${String(sc1?.inTolerance)} of ${String(sc1?.total)} targeted member-meals in tolerance, ${String(sc1?.flagged)} flagged with a reason, ${String(sc1?.noPlateFlagged)} flagged without a plate, ${String(sc1?.failures?.length)} unflagged misses; ${String(sc1?.memberDays)} member-days`,
  );
  console.log(
    `       measured: largest |recomputed − stored per-plate total| ${String(sc1?.maxStoredDiff)} (${String(sc1?.maxStoredDiffAt)})`,
  );
  report.check(
    sc1Ok(sc1),
    "SC-1: every targeted member-meal in tolerance or flagged; stored totals match their items",
  );
  report.check(
    !sc1Ok({ ...sc1, failures: ["x: out of tolerance and not flagged"] }),
    "negative control of the re-check: an unflagged miss is rejected",
  );
  report.check(
    !sc1Ok({ ...sc1, maxStoredDiff: 0.5 }),
    "negative control of the re-check: a stored total 0.5 off its items is rejected",
  );

  const gaps = one("gaps");
  console.log(
    `       measured OQ-8: ${String(gaps?.pairs)} same-dish pairs with a shared eater, ${String(gaps?.relaxed)} relaxed, ${String(gaps?.violations?.length)} inside the gap`,
  );
  report.check(gapsOk(gaps), "OQ-8 repeat gaps hold on the persisted plan");
  report.check(
    !gapsOk({ ...gaps, violations: ["x"] }),
    "negative control of the re-check: one violation is rejected",
  );

  const cook = one("cooksheet");
  console.log(
    `       measured cook sheet (day 1): ${String(cook?.batches)} batches, ${String(cook?.lines)} ingredient lines, largest difference ${String(cook?.maxDiffG)} g`,
  );
  report.check(cookOk(cook), "day 1's cook sheet raw totals equal the plates' raw equivalents");
  report.check(
    !cookOk({ ...cook, failures: ["x"] }),
    "negative control of the re-check: one differing line is rejected",
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
  report.check(sc2Ok(sc2?.perSeed), "SC-2 (recomputed here): median ≥ 8 %, every seed ≥ 0 %");
  report.check(
    !sc2Ok((sc2?.perSeed ?? []).map((s) => ({ ...s, economy: s.baseline }))),
    "negative control of the re-check: the baseline against itself (0 %) is rejected",
  );
  report.check(
    !sc2Ok((sc2?.perSeed ?? []).map((s, i) => (i === 0 ? { ...s, economy: s.baseline + 1 } : s))),
    "negative control of the re-check: one seed where economy adds an ingredient is rejected",
  );

  const tampered = one("sc1-control");
  console.log(
    `       measured (negative control): tampered plate grams give ${String(tampered?.failures)} SC-1 failure(s); repeated dish gives ${String(one("gaps-control")?.violations)} gap violation(s)`,
  );
  report.check(
    tampered?.failures > 0 &&
      !sc1Ok({ ...sc1, failures: new Array(tampered?.failures ?? 0).fill("x") }),
    "the tampered persisted plate fails SC-1",
  );
  report.check(
    one("gaps-control")?.violations > 0,
    "the repeated dish inside the gap fails the repeat check",
  );
  report.check(one("sc2-control")?.self?.pass === false, "SC-2 against itself fails");
}

async function gateN3(report) {
  if (!(await buildPackages(report))) return;
  const server = await acquireServer(report, `${LABEL}-n3`);
  const scratch = mkdtempSync(join(tmpdir(), `${LABEL}-n3-`));
  const measureFile = join(scratch, "measure.jsonl");
  let db;
  try {
    db = await createDatabase(server, "node12_n3");
    const r = await vitestRun(
      WEB,
      ["--config", "test/node/vitest.config.ts", "test/node/engine.node.ts"],
      { NODE_SERVER_URL: server.url, NODE_DB_URL: db.url, NODE_MEASURE_FILE: measureFile },
      3_000_000,
    );
    judgeTests(report, "apps/web test/node/engine.node.ts (worker plan.generate)", r);
    requireTitles(report, r.tests, TESTS);
    recheck(report, readMeasurements(measureFile));
  } finally {
    if (db !== undefined) {
      // The per-run copies carry the template's name as their prefix.
      const copies = await query(
        server.url,
        "SELECT datname FROM pg_database WHERE datname LIKE $1",
        [`${db.name.slice(0, 40)}\\_r%`],
      );
      for (const { datname } of copies)
        await query(server.url, `DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`).catch(
          () => undefined,
        );
      await db.drop().catch(() => undefined);
    }
    server.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
}

await nodeMain({
  label: LABEL,
  gates: {
    N2: (report) =>
      gateN2(report, { label: LABEL, branchPackages: ["core", "db"], n2Control: N2_CONTROL }),
    N3: gateN3,
    N4: (report) => gateN4(report, { label: LABEL }),
  },
});
