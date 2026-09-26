// Process helpers shared by scripts/verify/leaf-*.mjs.
import { spawnSync } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";

/**
 * Runs a command synchronously and returns its exit code and output.
 * `pnpm`/`npx` are resolved to their `.cmd` shims on Windows.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} options
 */
export function run(command, args, { cwd, env, timeoutMs = 600_000 }) {
  const shim = IS_WINDOWS && (command === "pnpm" || command === "npx");
  const result = spawnSync(shim ? `${command}.cmd` : command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    shell: shim,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

/** The last `lines` lines of a command's combined output, for failure messages. */
export function tail(result, lines = 25) {
  return `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-lines).join("\n");
}
