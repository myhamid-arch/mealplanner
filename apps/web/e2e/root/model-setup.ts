// Global setup of the root Playwright runs whose tests start no model (leaf 1.4.3's G5 tests for
// SC-6 and SC-7): the recorded onboarding parse responses (test/node/recorded/product-parse.json)
// served to the compose stack through the relay. At teardown it records what the model received,
// so root.mjs can require that every request was answered from a recording.
import { measure } from "../../../../packages/db/test/node/support";
import { loadRecordings } from "../../test/node/recorded-model";
import { recordedModel } from "../../test/root/stack";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const model = await recordedModel(loadRecordings("product-parse", {}));
  return async () => {
    measure({
      check: "model",
      requests: model.requests.length,
      answered: Object.fromEntries(model.answered),
      failures: model.failures,
    });
    await model.close();
  };
}
