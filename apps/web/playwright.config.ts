import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End-to-end tests (ARC-1: Playwright, Chromium). Leaf specs live in e2e/.
//
// Environment:
// - PLAYWRIGHT_CHROMIUM_EXECUTABLE: a Chromium binary to use instead of Playwright's download
//   (for example /opt/pw-browsers/chromium in the build containers).
// - PLAYWRIGHT_PORT: port for `next start` (default 3142).
// - PLAYWRIGHT_SKIP_BUILD=1: start the existing `.next` build instead of building first.
// - PLAYWRIGHT_OUTPUT_DIR: where failure artefacts go (default: the OS temp dir, so nothing
//   lands in the working tree).
const port = Number(process.env.PLAYWRIGHT_PORT ?? "3142");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const build = process.env.PLAYWRIGHT_SKIP_BUILD === "1" ? "" : "pnpm exec next build && ";

export default defineConfig({
  testDir: "./e2e",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? join(tmpdir(), "mise-playwright"),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${String(port)}`,
    trace: "off",
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${build}pnpm exec next start --port ${String(port)}`,
    url: `http://localhost:${String(port)}/offline`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
