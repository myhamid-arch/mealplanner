// W-25: the API integration tests sign users up and in (scrypt password hashing) and make many
// database round trips per test. Vitest's 5 s default timed them out under CPU load (a full build,
// or another node's gates running alongside), so failures depended on what else the machine did.
// Tests that need more still pass their own timeout.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
