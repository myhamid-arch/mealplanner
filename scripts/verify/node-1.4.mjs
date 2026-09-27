// Verify script for node 1.4 Product (BLD-6 node gate definitions, R-69, R-70).
// Usage: node scripts/verify/node-1.4.mjs --gate N2|N3|N4
// Prints "VERIFY node-1.4 <gate> PASSED" only when every assertion, including the gate's negative
// controls, holds; exits non-zero otherwise. N1 and N5 are the architect's.
//
// N2  The branch packages (@mealplanner/core, db, api-contract, ui-tokens) are built; every
//     workspace package that depends on them typechecks against their dist/ declarations; the
//     api-contract contract tests pass. Negative control: in a disposable copy, `GenerateBody.seed`
//     in the contract becomes a string and @mealplanner/web's typecheck fails.
// N3  SC-5 in Playwright (apps/web/e2e/node-1.4/sc5.e2e.ts) at 390 px and 1280 px with axe-core
//     (no serious or critical finding, light and dark), against this gate's `next build` and the
//     real worker on a fresh database, with recorded model responses (SPEC-Q-6): onboarding (at
//     most five questions, UAE, metric) to a first plan, the plan, the cook sheet, a review, a chat
//     proposal accepted and in the change log. Negative controls: axe reports a known-bad page (in
//     the spec); in a disposable copy without the cook sheet's route (apps/web/app/(app)/kitchen),
//     the same spec's cook-sheet flow fails while the flow before it still passes.
// N4  The full suite (scripts/verify/lib/node.mjs `gateN4`).
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireServer,
  buildPackages,
  buildWeb,
  chromium,
  createDatabase,
  distDirFor,
  freePort,
  gateN2,
  gateN4,
  nodeMain,
  playwrightResults,
  readMeasurements,
  ROOT,
  runAsync,
  WEB,
  withSlot,
  COPY_SLOTS,
} from "./lib/node.mjs";
import { tail } from "./lib/run.mjs";
import { copyWorkspace, installCopy } from "./lib/workspace.mjs";

const LABEL = "node-1.4";
const SPEC_CONFIG = "e2e/node-1.4/playwright.config.ts";

const N2_CONTROL = {
  description: "GenerateBody.seed changes from a number to a string",
  file: "packages/api-contract/src/contract/dto.ts",
  find: /seed: z\.number\(\)\.int\(\)\.min\(0\)\.max\(2_147_483_647\)\.default\(1\),/,
  replace: 'seed: z.string().default("1"),',
  packageDir: "packages/api-contract",
  consumer: "@mealplanner/web",
  consumerDir: "apps/web",
  expectError: /^app\/api\/v1\/plans\/generate\/route\.ts\(\d+,\d+\): error TS\d+/,
};

const FLOWS = (w) => [
  `SC-5 onboarding to a first plan at ${w} px: at most five questions, UAE, metric`,
  `SC-5 the plan at ${w} px`,
  `SC-5 the cook sheet at ${w} px`,
  `SC-5 a review at ${w} px`,
  `SC-5 a chat proposal accepted and visible in the change log at ${w} px`,
];
const TESTS = [
  ...FLOWS("390"),
  ...FLOWS("1280"),
  "SC-5 the recorded model answered every request, and no live call was made",
  "negative control: axe reports a known-bad page",
];

/** Runs the SC-5 spec in `webDir` against `distDir`; returns its results and output. */
async function runSpec(webDir, distDir, server, prefix, grep) {
  const db = await createDatabase(server, prefix);
  const out = mkdtempSync(join(tmpdir(), `${LABEL}-n3-pw-`));
  const reportFile = join(out, "report.json");
  const measureFile = join(out, "measure.jsonl");
  try {
    const r = await runAsync(
      process.execPath,
      [
        join(webDir, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        SPEC_CONFIG,
        "--reporter=list,json",
        ...(grep === undefined ? [] : ["--grep", grep]),
      ],
      {
        cwd: webDir,
        env: {
          NODE_DB_URL: db.url,
          NODE_DIST_DIR: distDir,
          NODE_PORT: String(await freePort()),
          NODE_MEASURE_FILE: measureFile,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
          PLAYWRIGHT_OUTPUT_DIR: join(out, "artefacts"),
          ...(chromium() === undefined ? {} : { PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromium() }),
        },
        timeoutMs: 2_400_000,
      },
    );
    return { r, tests: playwrightResults(reportFile), measures: readMeasurements(measureFile) };
  } finally {
    await db.drop().catch(() => undefined);
    rmSync(out, { recursive: true, force: true });
  }
}

function recheck(report, m) {
  for (const w of ["390", "1280"]) {
    const one = (check) => m.find((r) => r.check === check && r.width === w);
    const onb = one("onboarding");
    console.log(
      `       measured at ${w} px: ${String(onb?.questions)} onboarding questions (${String(onb?.requiredInputs)} required inputs), ${String(onb?.timezone)}, ${String(onb?.countryCode)}, ${String(onb?.unitSystem)}; first plan ${String(onb?.meals)} meals; plan shows ${String(one("plan")?.dishes)} dishes; cook sheet ${String(one("cooksheet")?.quantities)} quantities in g/kg; ${String(one("review")?.stored)} review stored; accepted proposal ${String(one("chat")?.changeSetId)} (${String(one("chat")?.source)})`,
    );
    const ok = (o) =>
      o !== undefined &&
      o.questions > 0 &&
      o.questions <= 5 &&
      o.timezone === "Asia/Dubai" &&
      o.countryCode === "AE" &&
      o.unitSystem === "metric" &&
      o.meals > 0;
    report.check(ok(onb), `${w} px: at most five questions, UAE and metric, a first plan`);
    report.check(
      !ok({ ...onb, questions: 6 }),
      `${w} px: negative control of the re-check: six questions are rejected`,
    );
    report.check(
      one("cooksheet")?.quantities > 0 &&
        one("review")?.stored === 1 &&
        one("chat")?.source === "proposal_accept",
      `${w} px: the cook sheet shows metric quantities, the review is stored, the accepted proposal is in the log`,
    );
  }
  const axe = m.filter((r) => r.check === "axe");
  const serious = axe.reduce((n, r) => n + r.serious, 0);
  const screens = new Set(axe.map((r) => r.where));
  console.log(
    `       measured: axe on ${String(screens.size)} screens × light/dark (${String(axe.length)} runs), ${String(serious)} serious or critical`,
  );
  report.check(
    axe.length >= 20 && serious === 0,
    "axe: no serious or critical finding on any screen",
  );
  const control = m.find((r) => r.check === "axe-control");
  console.log(
    `       measured (negative control): axe on the known-bad page: ${(control?.ids ?? []).join(", ")}`,
  );
  report.check(control?.serious > 0, "negative control: axe reports the known-bad page");
  const model = m.find((r) => r.check === "model");
  console.log(
    `       measured: ${String(model?.requests)} model request(s): ${String(model?.parse)} onboarding parse, ${String(model?.chat)} chat; ${String(model?.failures?.length)} unrecorded`,
  );
  report.check(
    model?.failures?.length === 0 && model?.parse > 0 && model?.chat === 2,
    "the recorded model answered every request",
  );
}

async function gateN3(report) {
  if (!(await buildPackages(report))) return;
  const distDir = distDirFor(LABEL, "N3");
  if (!(await buildWeb(report, distDir))) return;
  const server = await acquireServer(report, `${LABEL}-n3`);
  try {
    // Playwright runs of every gate on this machine share NODE_E2E_SLOTS slots (lib/node.mjs).
    const slots = Math.max(1, Number(process.env.NODE_E2E_SLOTS ?? "2") || 2);
    const { r, tests, measures } = await withSlot("e2e-run", slots, () =>
      runSpec(WEB, distDir, server, "node14_n3"),
    );
    const failed = tests.filter((t) => t.status !== "passed");
    if (r.code !== 0 || failed.length > 0)
      console.log(`----- sc5.e2e.ts output (exit ${String(r.code)}) -----\n${tail(r, 120)}`);
    report.check(
      r.code === 0 && tests.length > 0 && failed.length === 0,
      `apps/web/e2e/node-1.4/sc5.e2e.ts: ${String(tests.length)} tests, ${String(tests.length - failed.length)} passed, none skipped or failed`,
      failed
        .map((t) => `[${t.status}] ${t.title}\n${t.error}`)
        .join("\n")
        .slice(0, 8000),
    );
    for (const title of TESTS) {
      const hit = tests.filter((t) => t.title === title);
      report.check(
        hit.length === 1 && hit[0].status === "passed",
        `ran and passed: ${title}`,
        hit.map((t) => t.status).join(", ") || "missing",
      );
    }
    const unexpected = tests.filter((t) => !TESTS.includes(t.title));
    report.check(
      unexpected.length === 0,
      "no test outside the required list",
      unexpected.map((t) => t.title).join("\n"),
    );
    recheck(report, measures);

    // Negative control: the same spec against a copy without the cook sheet's route.
    // Workspace copies of every gate share COPY_SLOTS machine-wide slots (lib/node.mjs).
    await withSlot("copy", COPY_SLOTS, async () => {
      const copy = copyWorkspace(ROOT);
      try {
        const install = installCopy(copy.dir);
        if (!report.check(install.code === 0, "negative control: the copy installs", tail(install)))
          return;
        const kitchen = join(copy.dir, "apps/web/app/(app)/kitchen");
        rmSync(kitchen, { recursive: true, force: true });
        report.check(
          !existsSync(kitchen),
          "negative control: the copy has no apps/web/app/(app)/kitchen route",
        );
        const build = await runAsync(
          "pnpm",
          [
            "exec",
            "turbo",
            "run",
            "build",
            "--filter=./packages/*",
            "--filter=@mealplanner/worker",
          ],
          { cwd: copy.dir, timeoutMs: 1_200_000 },
        );
        if (
          !report.check(
            build.code === 0,
            "negative control: the copy's packages build",
            tail(build, 30),
          )
        )
          return;
        if (!(await buildWeb(report, ".next/node-1.4-n3-control", join(copy.dir, "apps/web"))))
          return;
        const control = await withSlot("e2e-run", slots, () =>
          runSpec(
            join(copy.dir, "apps/web"),
            ".next/node-1.4-n3-control",
            server,
            "node14_n3c",
            "at 390 px",
          ),
        );
        const status = (title) => control.tests.find((t) => t.title === title)?.status ?? "missing";
        const [onboarding, plan, cook] = FLOWS("390");
        console.log(
          `       measured (negative control): without the route: onboarding ${status(onboarding)}, plan ${status(plan)}, cook sheet ${status(cook)}`,
        );
        report.check(
          status(onboarding) === "passed" && status(plan) === "passed",
          "negative control is sound: the flows before the cook sheet still pass in the copy",
        );
        report.check(
          control.r.code !== 0 && status(cook) === "failed",
          "negative control: the cook-sheet flow fails when its route is removed",
        );
      } finally {
        copy.dispose();
      }
    });
  } finally {
    server.stop();
  }
}

await nodeMain({
  label: LABEL,
  gates: {
    N2: (report) =>
      gateN2(report, {
        label: LABEL,
        branchPackages: ["core", "db", "api-contract", "ui-tokens"],
        n2Control: N2_CONTROL,
      }),
    N3: gateN3,
    N4: (report) => gateN4(report, { label: LABEL }),
  },
});
