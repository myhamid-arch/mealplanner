// The node-gate tests (R-69) run against the built web app and a real worker that a node verify
// script builds and configures, so the default runs (`--dir test`, the default include) never
// collect them: their files end in `.node.ts`, which only this config includes (Request R-1 in
// docs/decisions/node-scripts-questions.md).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: join(dirname(fileURLToPath(import.meta.url)), "../.."),
  test: {
    include: ["test/node/**/*.node.ts"],
    testTimeout: 1_200_000,
    hookTimeout: 1_200_000,
    fileParallelism: false,
  },
});
