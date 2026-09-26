// Enqueueing jobs from the API (ARC-7; leaf-1.4.1 ADR-2): insert the `job` row (queued), then send
// it to pg-boss with the same id. The worker claims the row atomically (R-40).
import { PgBoss } from "pg-boss";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Json } from "@mealplanner/core/types";
import { JOB_KINDS, createJob, type JobKind } from "@mealplanner/db/services/plans";

export interface JobQueue {
  send(kind: JobKind, jobId: string): Promise<void>;
  close(): Promise<void>;
}

/** pg-boss as a sender: queues are created idempotently; no supervision or schedules here. */
export class PgBossQueue implements JobQueue {
  private boss: PgBoss | null = null;
  private starting: Promise<PgBoss> | null = null;

  constructor(private readonly databaseUrl: string) {}

  private async ready(): Promise<PgBoss> {
    if (this.boss !== null) return this.boss;
    this.starting ??= (async () => {
      const boss = new PgBoss({
        connectionString: this.databaseUrl,
        supervise: false,
        schedule: false,
        max: 2,
      });
      boss.on("error", () => undefined);
      await boss.start();
      for (const kind of JOB_KINDS) await boss.createQueue(kind);
      this.boss = boss;
      return boss;
    })();
    return this.starting;
  }

  async send(kind: JobKind, jobId: string): Promise<void> {
    const boss = await this.ready();
    await boss.send(kind, { jobId }, { id: jobId });
  }

  async close(): Promise<void> {
    const boss =
      this.boss ?? (this.starting === null ? null : await this.starting.catch(() => null));
    if (boss !== null) await boss.stop({ graceful: false, close: true });
    this.boss = null;
    this.starting = null;
  }
}

/** Creates the job row and queues it. Returns the job id. */
export async function enqueueJob(
  db: NodePgDatabase,
  queue: JobQueue,
  args: {
    kind: JobKind;
    householdId: string | null;
    payload: Json;
    createdByUserId: string | null;
  },
): Promise<string> {
  const row = await createJob(db, args);
  await queue.send(args.kind, row.id);
  return row.id;
}
