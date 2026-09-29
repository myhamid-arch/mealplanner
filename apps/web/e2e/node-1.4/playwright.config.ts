import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// node-1.4 N3 (R-69): SC-5 against the built web app and the real worker, which the spec itself
// starts (with the recorded model server) on the database, build directory and port the node
// verify script gives it (NODE_DB_URL, NODE_DIST_DIR, NODE_PORT). The `.e2e.ts` suffix keeps the
// spec out of the default Playwright run (`e2e/*.spec.ts`) and out of vitest (Request R-1).
const port = process.env.NODE_PORT ?? "3190";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? join(tmpdir(), "node-1.4-playwright"),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 300_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "off",
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
