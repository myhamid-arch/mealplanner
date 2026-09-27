import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Leaf 1.4.9 G4 (leaf-1.4.9 ADR-1): the Updates conversation and the shell at 390 and 1280 px.
// Mirrors apps/web/playwright.config.ts (1.4.2), for specs named *.e2e.ts in this directory (the
// suffix keeps Vitest from collecting them). `next start` serves the build in MISE_NEXT_DIST_DIR.
//
// Environment: PLAYWRIGHT_PORT, PLAYWRIGHT_CHROMIUM_EXECUTABLE, PLAYWRIGHT_OUTPUT_DIR, and for the
// server DATABASE_URL, AUTH_SECRET, APP_URL, MISE_NEXT_DIST_DIR (set by scripts/verify).
const port = Number(process.env.PLAYWRIGHT_PORT ?? "3149");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? join(tmpdir(), "mise-playwright-1.4.9"),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 240_000,
  use: {
    baseURL: `http://localhost:${String(port)}`,
    trace: "off",
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start --port ${String(port)}`,
    cwd: join(import.meta.dirname, "../.."),
    url: `http://localhost:${String(port)}/offline`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
