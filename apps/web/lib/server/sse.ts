// Server-Sent Events for job progress (ARC-5 `jobs/:id/events`, ARC-7; leaf-1.4.1 ADR-2). Replays
// stored events after `Last-Event-ID`, then streams new ones as they are notified (with a 2 s poll
// as a safety net), and closes after the terminal event. `id:` is the event's seq.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { TERMINAL_EVENTS, jobEventsAfter, type JobEventRow } from "@mealplanner/db/services/plans";
import type { JobEventHub } from "./events";

const HEARTBEAT_MS = 15_000;
const POLL_MS = 2_000;

export function sseFrame(e: JobEventRow): string {
  const data = JSON.stringify({
    jobId: e.jobId,
    seq: e.seq,
    type: e.type,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  });
  return `id: ${String(e.seq)}\nevent: ${e.type}\ndata: ${data}\n\n`;
}

export function jobEventStream(args: {
  db: NodePgDatabase;
  hub: JobEventHub;
  jobId: string;
  afterSeq: number;
  signal: AbortSignal;
}): Response {
  const encoder = new TextEncoder();
  let last = args.afterSeq;
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let draining: Promise<void> = Promise.resolve();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat !== null) clearInterval(heartbeat);
        if (poll !== null) clearInterval(poll);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const drain = async () => {
        if (closed) return;
        const events = await jobEventsAfter(args.db, args.jobId, last);
        for (const e of events) {
          controller.enqueue(encoder.encode(sseFrame(e)));
          last = e.seq;
          if (TERMINAL_EVENTS.has(e.type)) {
            close();
            return;
          }
        }
      };
      const schedule = () => {
        draining = draining.then(drain).catch(() => {
          close();
        });
      };
      args.signal.addEventListener("abort", close);
      unsubscribe = await args.hub.subscribe(args.jobId, schedule);
      controller.enqueue(encoder.encode(`retry: 3000\n\n`));
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: keep-alive\n\n`));
      }, HEARTBEAT_MS);
      poll = setInterval(schedule, POLL_MS);
      schedule();
      await draining;
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat !== null) clearInterval(heartbeat);
      if (poll !== null) clearInterval(poll);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
