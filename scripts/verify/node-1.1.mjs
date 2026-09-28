// Verify script for node 1.1 Foundation (BLD-6 node gate definitions, R-69, R-70).
// Usage: node scripts/verify/node-1.1.mjs --gate N2|N3|N4
// Prints "VERIFY node-1.1 <gate> PASSED" only when every assertion, including the gate's negative
// control, holds; exits non-zero otherwise. N1 and N5 are the architect's.
//
// N2  The branch packages (@mealplanner/core, @mealplanner/db) are built; every workspace package
//     that depends on them typechecks against their dist/ declarations; the api-contract contract
//     tests pass. Negative control: in a disposable copy, `ReviewRow.rating` in core's entity types
//     becomes a string and @mealplanner/db's typecheck fails.
//     The api-contract contract tests are apps/web's test/api/g1-contract-matrix.int.test.ts and
//     g3-openapi.int.test.ts: packages/api-contract has no tests of its own (pre-CP2 finding 13).
//     Every run builds the branch packages (tsc, into a private directory) and requires the
//     declarations they emit to equal the published ones in dist/ (finding 10).
// N3  On a fresh, empty database of the gate's own: migrations 0000 onward, the catalogue, F1
//     (packages/db/test/node/foundation.node.ts). A change set across members, targets, exclusions
//     and settings is applied and undone through the changes service, then through the built web
//     app's API (apps/web/test/node/foundation-http.node.ts): every compared table equals its
//     pre-apply snapshot (SC-4 at foundation level). Negative control on both paths: an undo with
//     one before-image removed from the stored inverse fails the equality check. The script
//     re-checks the measured figures, each re-check also run on a known-bad record.
// N4  The full suite (scripts/verify/lib/node.mjs `gateN4`).
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  query,
  readMeasurements,
  requireTitles,
  ROOT,
  vitestRun,
  WEB,
} from "./lib/node.mjs";

const LABEL = "node-1.1";

const N2_CONTROL = {
  description: "ReviewRow.rating changes from number | null to string | null",
  file: "packages/core/src/types/entities.ts",
  find: /(export interface ReviewRow \{[^}]*?)rating: number \| null;/,
  replace: "$1rating: string | null;",
  packageDir: "packages/core",
  consumer: "@mealplanner/db",
  consumerDir: "packages/db",
  expectError: /^(src|test)\/\S+\.ts\(\d+,\d+\): error TS\d+/,
};

const SERVICE_TESTS = [
  "N3 migrations 0000 onward on an empty database",
  "N3 the catalogue loads and F1 is seeded",
  "N3 service: a change set across members, targets, exclusions and settings is undone exactly",
  "N3 negative control: an undo that skips one before-image fails the equality check",
];
const HTTP_TESTS = [
  "N3 HTTP: the change set applied and undone through the API restores every table exactly",
  "N3 HTTP negative control: an undo that skips one before-image fails the equality check",
];
/** The tables the set must change (members, targets, exclusions, settings). */
const MUST_CHANGE = ["exclusion", "household", "member", "planning_weights", "target_profile"];
const NOT_COMPARED = ["change_set", "job", "session", "account", "verification", "user"];

/** A flow's record is acceptable: every required table changed, none excluded, exact restore. */
const flowAcceptable = (m) =>
  m !== undefined &&
  MUST_CHANGE.every((t) => (m.changed ?? []).includes(t)) &&
  (m.entities ?? []).every((e) => !NOT_COMPARED.includes(e)) &&
  m.restoreDiff === 0;

const controlAcceptable = (m) => m !== undefined && m.restoreDiff > 0;

async function gateN3(report) {
  if (!(await buildPackages(report))) return;
  const distDir = distDirFor(LABEL, "N3");
  if (!(await buildWeb(report, distDir))) return;
  const server = await acquireServer(report, `${LABEL}-n3`);
  const scratch = mkdtempSync(join(tmpdir(), `${LABEL}-n3-`));
  const measureFile = join(scratch, "measure.jsonl");
  let db;
  try {
    db = await createDatabase(server, "node11_n3");
    const [{ n }] = await query(
      db.url,
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')",
    );
    report.check(n === 0, `database ${db.name} starts empty (${String(n)} tables)`);

    const service = await vitestRun(
      join(ROOT, "packages/db"),
      ["--config", "test/node/vitest.config.ts", "test/node/foundation.node.ts"],
      { NODE_DB_URL: db.url, NODE_MEASURE_FILE: measureFile },
    );
    judgeTests(report, "packages/db test/node/foundation.node.ts (changes service)", service);
    requireTitles(report, service.tests, SERVICE_TESTS);

    const http = await vitestRun(
      WEB,
      ["--config", "test/node/vitest.config.ts", "test/node/foundation-http.node.ts"],
      {
        NODE_DB_URL: db.url,
        NODE_MEASURE_FILE: measureFile,
        NODE_DIST_DIR: distDir,
        NODE_PORT: String(await freePort()),
      },
    );
    judgeTests(report, "apps/web test/node/foundation-http.node.ts (built app, HTTP API)", http);
    requireTitles(report, http.tests, HTTP_TESTS);

    const m = readMeasurements(measureFile);
    const one = (check) => m.find((r) => r.check === check);
    const migrations = one("migrations");
    console.log(
      `       measured: ${String(migrations?.applied)} of ${String(migrations?.files)} migrations applied from 0000, ${String(migrations?.tables)} tables`,
    );
    report.check(
      migrations !== undefined && migrations.applied === migrations.files && migrations.files > 0,
      "every committed migration was applied to the empty database",
    );
    const seed = one("seed");
    console.log(
      `       measured: catalogue ${String(seed?.ingredients)} ingredients, ${String(seed?.dishes)} dishes; F1 ${String(seed?.members)} members`,
    );
    report.check(
      seed !== undefined && seed.ingredients > 0 && seed.dishes > 0 && seed.members === 5,
      "catalogue loaded and F1 seeded (5 members)",
    );
    for (const path of ["service", "http"]) {
      const r = one(path);
      console.log(
        `       measured (${path}): ops ${(r?.ops ?? []).join(", ")}; changed ${(r?.changed ?? []).join(", ")}; ${String(r?.restoreDiff)} row(s) differ after undo`,
      );
      report.check(
        flowAcceptable(r),
        `${path}: the change touched ${MUST_CHANGE.join(", ")} and the undo restored every compared table exactly`,
      );
      report.check(
        !flowAcceptable({ ...r, restoreDiff: 1 }),
        `${path}: negative control of the re-check: one differing row is rejected`,
      );
      const control = one(`${path}-control`);
      console.log(
        `       measured (${path} negative control): ${String(control?.restoreDiff)} row(s) differ after the undo without one before-image`,
      );
      report.check(
        controlAcceptable(control) && !flowAcceptable({ ...r, restoreDiff: control?.restoreDiff }),
        `${path}: the undo without one before-image fails the equality check`,
      );
    }
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
      gateN2(report, { label: LABEL, branchPackages: ["core", "db"], n2Control: N2_CONTROL }),
    N3: gateN3,
    N4: (report) => gateN4(report, { label: LABEL }),
  },
});
