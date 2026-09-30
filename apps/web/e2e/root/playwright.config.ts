import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Root R6–R8 (R-79, R-80): Playwright against the fresh compose stack scripts/verify/root.mjs
// starts for the gate (ROOT_APP_URL), with no webServer of its own. `testDir` is e2e/ so the same
// config runs the root SC-5 spec (root/sc5.e2e.ts) and leaf 1.4.3's G5 tests (config.spec.ts
// --grep @G5, for SC-6 and SC-7). For the G5 tests, which start no model themselves, ROOT_SETUP_MODEL
// makes the global setup serve the recorded onboarding parse responses to the stack.
// Node N4 runs every other playwright.config.ts of apps/web; this one needs the compose stack a root
// gate starts, so N4 names it as run by R6–R8 (R-86, SPEC-Q-8).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const appUrl = process.env.ROOT_APP_URL;
if (appUrl === undefined || appUrl === "")
  throw new Error("ROOT_APP_URL is not set: run this through scripts/verify/root.mjs");

export default defineConfig({
  testDir: "..",
  testMatch: ["root/*.e2e.ts", "config.spec.ts"],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? join(tmpdir(), "root-playwright"),
  ...(process.env.ROOT_SETUP_MODEL === "1" ? { globalSetup: "./model-setup.ts" } : {}),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 300_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: appUrl,
    trace: "off",
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
