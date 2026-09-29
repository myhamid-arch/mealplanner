// node-1.4 N3 (R-69, R-70): SC-5, the core flows at 390 px and 1280 px, against the built web app and
// the real worker, with recorded model responses (SPEC-Q-6: the onboarding parse and a chat turn;
// no credential, no live call). For each width, a new household goes through:
// - onboarding: at most five questions, then the review, then its first plan from the worker; the
//   household is in the UAE (Asia/Dubai) and metric;
// - the plan of that day; the cook sheet; a quick rating of the dinner;
// - a chat turn in which the agent asks for a protected change: its proposal card is accepted and
//   the accepted change is in the change log.
// axe-core runs on every screen the flows visit, light and dark: no serious or critical finding.
// Negative controls: axe reports a known-bad page (in the flows); a flow fails when its route is
// removed from a disposable copy (the verify script runs this spec against that copy's build).
// The flows themselves are in ./flows.ts, which root R6 runs against a compose stack (R-84).
// Change-log titles are not pinned (R-70 amendment 1): the entry is found by id and source.
import { test } from "@playwright/test";
import { migrateAndSeed } from "@mealplanner/db/seed";
import {
  loadRecordings,
  recordedModelEnv,
  startRecordedModel,
  type RecordedModel,
} from "../../test/node/recorded-model";
import {
  requiredEnv,
  startBuiltApp,
  startWorker,
  type BuiltApp,
  type Child,
} from "../../test/node/support";
import { registerSc5Flows } from "./flows";

let model: RecordedModel;
let app: BuiltApp;
let worker: Child;
/** Stops what the tests started, last first. */
const cleanup: (() => Promise<void>)[] = [];

test.beforeAll(async () => {
  test.setTimeout(600_000);
  const url = requiredEnv("NODE_DB_URL");
  await migrateAndSeed(url);
  model = await startRecordedModel(loadRecordings("product-parse", {}));
  cleanup.push(() => model.close());
  worker = await startWorker(url, recordedModelEnv(model));
  cleanup.push(() => worker.stop());
  app = await startBuiltApp(url, recordedModelEnv(model));
  cleanup.push(() => app.stop());
});

test.afterAll(async () => {
  for (const stop of cleanup.reverse()) await stop();
});

registerSc5Flows({ url: () => app.url, model: () => model });
