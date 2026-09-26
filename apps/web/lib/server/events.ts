// Job events for SSE (ARC-7; leaf-1.4.1 ADR-2): one dedicated LISTEN connection per web process,
// fanned out to the streams that wait on a job. Notifications carry `<job id>:<seq>`; readers
// fetch the rows themselves (and replay after Last-Event-ID), so a missed notification only delays
// an event until the next one or the poll.
import pg from "pg";
import { JOB_EVENT_CHANNEL } from "@mealplanner/db/services/plans";

type Waiter = () => void;

export class JobEventHub {
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private readonly waiters = new Map<string, Set<Waiter>>();

  constructor(private readonly databaseUrl: string) {}

  private async connect(): Promise<void> {
    if (this.client !== null) return;
    this.connecting ??= (async () => {
      const client = new pg.Client({ connectionString: this.databaseUrl });
      client.on("error", () => {
        // A dropped listener reconnects on the next subscription; streams also poll.
        this.client = null;
        this.connecting = null;
      });
      client.on("notification", (msg) => {
        const jobId = msg.payload?.split(":")[0];
        if (jobId === undefined) return;
        for (const wake of this.waiters.get(jobId) ?? []) wake();
      });
      await client.connect();
      await client.query(`LISTEN ${JOB_EVENT_CHANNEL}`);
      this.client = client;
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /** Calls `wake` whenever the job gets an event; returns the unsubscribe function. */
  async subscribe(jobId: string, wake: Waiter): Promise<() => void> {
    await this.connect();
    const set = this.waiters.get(jobId) ?? new Set<Waiter>();
    set.add(wake);
    this.waiters.set(jobId, set);
    return () => {
      set.delete(wake);
      if (set.size === 0) this.waiters.delete(jobId);
    };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.waiters.clear();
    if (client !== null) await client.end().catch(() => undefined);
  }
}
