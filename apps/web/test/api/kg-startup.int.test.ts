// W-13 (leaf 1.4.10 G2, KG-3): the worker's start-up graph sync on an empty graph with the seed
// library, at WORKER_CONCURRENCY 2. `startWorker` queues the global catalogue sync and the
// seed-library dish sync together (`syncCatalogueGraph`); no attempt of either may fail.
// Reproduction recorded in docs/decisions/leaf-1.4.10-w13.md.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startWorker } from "../../../worker/src/main";
import { createWorkerRuntime, type WorkerRuntime } from "../../../worker/src/runtime";
import { createTestDatabase, type TestDatabase } from "./support/db";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
let db: TestDatabase;
let rt: WorkerRuntime;

beforeAll(async () => {
  db = await createTestDatabase();
  rt = await createWorkerRuntime({
    databaseUrl: db.url,
    dataDir: join(ROOT, "data"),
    aiRecipeDailyLimit: 0,
    concurrency: 2,
  });
}, 120_000);

afterAll(async () => {
  await rt.close();
  await db.drop();
});

type Event = { kind: string; type: string; payload: unknown };

async function startUpEvents(): Promise<Event[]> {
  for (;;) {
    const open = await rt.db.execute(
      sql`SELECT count(*)::int AS n FROM job WHERE kind = 'kg.sync' AND status IN ('queued', 'running')`,
    );
    if ((open.rows[0] as { n: number }).n === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const rows = await rt.db.execute(
    sql`SELECT j.payload->'request'->>'kind' AS kind, e.type, e.payload
        FROM job_event e JOIN job j ON j.id = e.job_id
        WHERE j.kind = 'kg.sync' ORDER BY e.created_at, e.seq`,
  );
  return rows.rows as Event[];
}

describe("W-13 start-up graph sync at concurrency 2", () => {
  it("no kg.sync attempt fails on an empty graph with the seed library", async () => {
    const empty = await rt.db.execute(sql`SELECT count(*)::int AS n FROM kg_node`);
    expect((empty.rows[0] as { n: number }).n).toBe(0);
    await startWorker(rt);
    const events = await startUpEvents();
    expect(events.filter((e) => e.type === "done").map((e) => e.kind).sort()).toEqual([
      "catalogue",
      "dish",
    ]);
    expect(events.filter((e) => e.type === "retrying" || e.type === "failed")).toEqual([]);
  }, 120_000);
});
