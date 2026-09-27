// Verify script for node 1.3 Intelligence (BLD-6 node gate definitions, R-69, R-70).
// Usage: node scripts/verify/node-1.3.mjs --gate N2|N3|N4
// Prints "VERIFY node-1.3 <gate> PASSED" only when every assertion, including the gate's negative
// controls, holds; exits non-zero otherwise. N1 and N5 are the architect's.
//
// N2  The branch packages (@mealplanner/core, db, ai, graph) are built; every workspace package that
//     depends on them typechecks against their dist/ declarations; the api-contract contract tests
//     pass. Negative control: in a disposable copy, `AgentPorts.getPreferences` in @mealplanner/ai
//     returns another type and @mealplanner/web's typecheck fails.
// N3  apps/web/test/node/intelligence.node.ts against the built web app and the real worker on a
//     fresh database of the gate's own (migrated from zero, catalogue, F1), with recorded model
//     responses served over ANTHROPIC_BASE_URL (SPEC-Q-6; no credential, no live call): SC-3
//     through the API and the worker's insights.run, the proposal accepted into the change log,
//     the kg.sync DISLIKES edge, get_preferences reporting it, SC-4 for an agent apply_change.
//     Negative controls: one 1★ review gives no proposal; an undo that skips one before-image
//     fails the equality check. The script re-checks every figure on a known-bad record too.
// N4  The full suite (scripts/verify/lib/node.mjs `gateN4`).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireServer,
  buildPackages,
  buildWeb,
  createDatabase,
  distDirFor,
  freePort,
  gateN2,
  gateN4,
  judgeTests,
  nodeMain,
  readMeasurements,
  requireTitles,
  vitestRun,
  WEB,
} from "./lib/node.mjs";

const LABEL = "node-1.3";

const N2_CONTROL = {
  description: "AgentPorts.getPreferences returns Promise<number> instead of Promise<ToolOutput>",
  file: "packages/ai/src/agent/types.ts",
  find: /getPreferences\(input: ToolInput<"get_preferences">, call: ToolCall\): Promise<ToolOutput>;/,
  replace: 'getPreferences(input: ToolInput<"get_preferences">, call: ToolCall): Promise<number>;',
  packageDir: "packages/ai",
  consumer: "@mealplanner/web",
  consumerDir: "apps/web",
  expectError: /^lib\/server\/agent\.ts\(\d+,\d+\): error TS\d+/,
};

const TESTS = [
  "N3 set-up: fresh database, catalogue and F1; the built app, the worker and a plan from plan.generate",
  "N3 negative control: one 1★ review gives no proposal",
  "N3 SC-3: a second 1★ review lowers the member's dish appeal and insights.run proposes the dislike",
  "N3 accepting the proposal through the API writes a proposal_accept change set to the log",
  "N3 kg.sync gives the graph the member's dislike edge",
  "N3 the agent's get_preferences reports the dislike to the model (recorded turn)",
  "N3 SC-4: an agent apply_change is in the change log as the agent's and its undo restores the prior state exactly",
  "N3 negative control: an undo that skips one before-image fails the equality check",
  "N3 the recorded model answered every request from its recordings, and no live call was made",
];

const sc3Ok = (m) =>
  m !== undefined &&
  m.appealAfter < m.appealBefore &&
  m.scoreAfter < m.scoreBefore &&
  m.othersUnchanged === true &&
  m.proposals === 1;
const sc4Ok = (m) =>
  m !== undefined &&
  m.actor === "agent" &&
  m.source === "agent_apply" &&
  m.restoreDiff === 0 &&
  m.undone === true &&
  m.entities.length > 0 &&
  m.entities.every((e) => !m.excluded.includes(e)) &&
  m.turnWrites.every((t) => m.excluded.includes(t));

function recheck(report, m) {
  const one = (check) => m.find((r) => r.check === check);
  const control = one("sc3-control");
  const sc3 = one("sc3");
  console.log(
    `       measured SC-3: after one 1★ review ${String(control?.pending)} pending proposal(s); after two: dish score ${String(sc3?.scoreBefore)} → ${String(sc3?.scoreAfter)}, plate appeal ${String(sc3?.appealBefore)} → ${String(sc3?.appealAfter)}, other members unchanged ${String(sc3?.othersUnchanged)}, ${String(sc3?.proposals)} dislike proposal(s)`,
  );
  report.check(control?.pending === 0, "one 1★ review gives no proposal");
  report.check(sc3Ok(sc3), "two 1★ reviews lower the member's dish score and appeal and give one proposal");
  report.check(
    !sc3Ok({ ...sc3, appealAfter: sc3?.appealBefore }),
    "negative control of the re-check: an unchanged appeal is rejected",
  );
  const accept = one("accept");
  console.log(
    `       measured: the accepted proposal is change set ${String(accept?.changeSetId)} (actor ${String(accept?.actor)}, source ${String(accept?.source)})`,
  );
  report.check(accept?.source === "proposal_accept", "the accepted proposal is a proposal_accept change set in the log");
  const kg = one("kg");
  console.log(
    `       measured: DISLIKES edge weight ${String(kg?.weight)} (locked ${String(kg?.locked)}), ${String(kg?.syncJobs)} kg.sync job(s) succeeded`,
  );
  report.check(kg?.weight === 0.8 && kg?.syncJobs > 0, "kg.sync wrote the member's DISLIKES edge at 0.8");
  const prefs = one("get_preferences");
  report.check(
    prefs?.resultCarriesDish === true && prefs?.failures.length === 0,
    "get_preferences sent the disliked dish back to the model",
  );
  const sc4 = one("sc4");
  console.log(
    `       measured SC-4: agent change set ${String(sc4?.changeSetId)} (${String(sc4?.actor)}/${String(sc4?.source)}) touched ${(sc4?.entities ?? []).join(", ")}; the turn also wrote ${(sc4?.turnWrites ?? []).join(", ")}; ${String(sc4?.restoreDiff)} row(s) differ after undo; not compared: ${(sc4?.excluded ?? []).join(", ")}`,
  );
  report.check(sc4Ok(sc4), "SC-4: the agent's change is logged as the agent's and its undo restores every compared table");
  report.check(!sc4Ok({ ...sc4, restoreDiff: 1 }), "negative control of the re-check: one differing row is rejected");
  const sc4c = one("sc4-control");
  console.log(`       measured (negative control): ${String(sc4c?.restoreDiff)} row(s) differ after the undo without one before-image`);
  report.check(sc4c?.restoreDiff > 0 && !sc4Ok({ ...sc4, restoreDiff: sc4c?.restoreDiff }), "the undo without one before-image fails the check");
  const model = one("model");
  console.log(
    `       measured: ${String(model?.requests)} model request(s), all answered from recordings; ${String(model?.failures?.length)} unrecorded`,
  );
  report.check(model?.failures?.length === 0 && model?.remaining?.length === 0, "every model request was answered from a recording");
}

async function gateN3(report) {
  if (!(await buildPackages(report))) return;
  const distDir = distDirFor(LABEL, "N3");
  if (!(await buildWeb(report, distDir))) return;
  const server = await acquireServer(report, `${LABEL}-n3`);
  const scratch = mkdtempSync(join(tmpdir(), `${LABEL}-n3-`));
  const measureFile = join(scratch, "measure.jsonl");
  let db;
  try {
    db = await createDatabase(server, "node13_n3");
    const r = await vitestRun(
      WEB,
      ["--config", "test/node/vitest.config.ts", "test/node/intelligence.node.ts"],
      {
        NODE_DB_URL: db.url,
        NODE_MEASURE_FILE: measureFile,
        NODE_DIST_DIR: distDir,
        NODE_PORT: String(await freePort()),
      },
    );
    judgeTests(report, "apps/web test/node/intelligence.node.ts (built app, worker, recorded model)", r);
    requireTitles(report, r.tests, TESTS);
    recheck(report, readMeasurements(measureFile));
  } finally {
    if (db !== undefined) await db.drop().catch(() => undefined);
    server.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
}

await nodeMain({
  label: LABEL,
  gates: {
    N2: (report) =>
      gateN2(report, {
        label: LABEL,
        branchPackages: ["core", "db", "ai", "graph"],
        n2Control: N2_CONTROL,
      }),
    N3: gateN3,
    N4: (report) => gateN4(report, { label: LABEL }),
  },
});
