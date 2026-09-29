// Root R6 (SC-5) on a fresh compose stack (R-79, R-80): node-1.4 N3's flows (../node-1.4/flows.ts,
// one flow for both, R-84) at 390 px and 1280 px with axe-core, against the stack's web container
// and worker, with the recorded onboarding parse and chat responses served to them through the
// relay (no credential in any container, no live call).
import { test } from "@playwright/test";
import { loadRecordings, type RecordedModel } from "../../test/node/recorded-model";
import { appUrl, recordedModel } from "../../test/root/stack";
import { registerSc5Flows } from "../node-1.4/flows";

let model: RecordedModel;

test.beforeAll(async () => {
  model = await recordedModel(loadRecordings("product-parse", {}));
});

test.afterAll(async () => {
  await model.close();
});

registerSc5Flows({ url: appUrl, model: () => model });
