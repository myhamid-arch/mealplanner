// The built worker as a separate process (G2): `apps/worker/dist/src/main.js` with the test
// database, exactly as `pnpm --filter @mealplanner/worker start` runs it. No model credential is
// passed, so AI generation reports itself unavailable (REC-2) instead of calling out.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
export const WORKER_MAIN = join(ROOT, "apps/worker/dist/src/main.js");

export interface WorkerProcess {
  child: ChildProcess;
  output(): string;
  stop(): Promise<number | null>;
}

export async function startWorkerProcess(databaseUrl: string): Promise<WorkerProcess> {
  if (!existsSync(WORKER_MAIN)) throw new Error(`${WORKER_MAIN} is not built`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DATA_DIR: join(ROOT, "data"),
    LOG_LEVEL: "info",
  };
  delete env.ANTHROPIC_API_KEY;
  const child = spawn(process.execPath, [WORKER_MAIN], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (c: Buffer) => (out += c.toString()));
  child.stderr.on("data", (c: Buffer) => (out += c.toString()));
  const deadline = Date.now() + 60_000;
  while (!out.includes("worker started")) {
    if (child.exitCode !== null)
      throw new Error(`worker exited ${String(child.exitCode)}:\n${out}`);
    if (Date.now() > deadline) throw new Error(`worker did not start:\n${out}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    child,
    output: () => out,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve(child.exitCode);
          return;
        }
        child.once("exit", (code) => {
          resolve(code);
        });
        child.kill("SIGTERM");
      }),
  };
}
