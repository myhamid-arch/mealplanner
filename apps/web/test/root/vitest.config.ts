// The root-gate tests (R-79, R-80) run against the fresh compose stack scripts/verify/root.mjs
// starts for each gate, so the default runs (`--dir test`, the default include) never collect them:
// their files end in `.root.ts`, which only this config includes.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: join(dirname(fileURLToPath(import.meta.url)), "../.."),
  test: {
    include: ["test/root/**/*.root.ts"],
    testTimeout: 14_400_000,
    hookTimeout: 1_200_000,
    fileParallelism: false,
  },
});
