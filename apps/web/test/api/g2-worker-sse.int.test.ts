// G2 (ARC-7): a plan job runs in the worker process and streams its progress over SSE to a test
// client. The API is served over real HTTP (node:http around the route handlers); the worker is the
// built `apps/worker` process on the same database. Also: `Last-Event-ID` resumption, household
// scoping of the stream, and the R-40 race between undoing a `recipe.*` change set and the
// worker's claim (exactly one wins).
import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { JobEventDto } from "@mealplanner/api-contract/contract";
import { claimJob, TERMINAL_EVENTS } from "@mealplanner/db/services/plans";
import { job } from "@mealplanner/db/schema";
import { callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { readSse, startHttpServer, type HttpServer, type SseEvent } from "./support/http";
import { measure } from "./support/measure";
import { startWorkerProcess, type WorkerProcess } from "./support/worker";
import { addMembers, applyOps, ok, signupAdmin, type Login } from "./support/world";

let db: TestDatabase;
let app: TestApp;
let http: HttpServer;
let worker: WorkerProcess | null = null;
let a: Login & { householdId: string };
let b: Login & { householdId: string };

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  http = await startHttpServer();
  a = await signupAdmin("Household A");
  await addMembers(a);
  b = await signupAdmin("Household B");
  await addMembers(b);
}, 300_000);

afterAll(async () => {
  if (worker !== null) await worker.stop();
  await http.close();
  await app.close();
  await db.drop();
}, 60_000);

const bearer = (l: Login) => ({ authorization: `Bearer ${l.token}` });

async function postGenerate(dates: string[]): Promise<string> {
  const res = await fetch(`${http.url}/api/v1/plans/generate`, {
    method: "POST",
    headers: { ...bearer(a), "content-type": "application/json" },
    body: JSON.stringify({ dates, seed: 3 }),
  });
  expect(res.status).toBe(202);
  return ((await res.json()) as { jobId: string }).jobId;
}

const eventsUrl = (jobId: string) => `${http.url}/api/v1/jobs/${jobId}/events`;

function parsed(events: SseEvent[]) {
  return events.map((e) => JobEventDto.parse(JSON.parse(e.data)));
}

async function jobRow(id: string) {
  const [row] = await app.rt.db.select().from(job).where(eq(job.id, id));
  return row;
}

/** R-40 acceptance of one race: exactly one of the undo and the claim won. */
function exactlyOne(r: { undoWon: boolean; claimWon: boolean }): boolean {
  return r.undoWon !== r.claimWon;
}

async function queuedRecipeJob(): Promise<{ changeSetId: string; jobId: string }> {
  const changeSetId = await applyOps(a, [
    {
      kind: "recipe.generate",
      payload: { date: "2026-11-20", slotKey: "dinner", count: 2, reason: "more fish" },
    },
  ]);
  const [row] = await app.rt.db
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.householdId, a.householdId),
        eq(job.kind, "recipe.generate"),
        eq(job.status, "queued"),
      ),
    )
    .orderBy(desc(job.createdAt))
    .limit(1);
  if (row === undefined) throw new Error("no queued recipe job");
  return { changeSetId, jobId: row.id };
}

describe("G2 without a worker", () => {
  it("G2 negative control: with no worker running the job stays queued and the stream carries no terminal event", async () => {
    const jobId = await postGenerate(["2026-11-09"]);
    const read = await readSse(eventsUrl(jobId), bearer(a), { timeoutMs: 4_000 });
    const terminal = read.events.filter((e) => TERMINAL_EVENTS.has(e.event ?? ""));
    const status = (await jobRow(jobId))?.status;
    measure("G2", "negative-no-worker", {
      events: read.events.length,
      terminal: terminal.length,
      closedByServer: read.closedByServer,
      status,
    });
    expect(read.status).toBe(200);
    expect(terminal).toEqual([]);
    expect(read.closedByServer).toBe(false);
    expect(status).toBe("queued");
  }, 30_000);

  it("G2 R-40: undoing a recipe.generate change set races the worker's claim and exactly one wins", async () => {
    const results: Array<{ undoWon: boolean; claimWon: boolean; undoStatus: number }> = [];
    for (let i = 0; i < 30; i += 1) {
      const { changeSetId, jobId } = await queuedRecipeJob();
      // The claim starts 0–58 ms after the undo request, so both orders occur across the runs.
      const delay = (i % 30) * 2;
      const [undo, claimed] = await Promise.all([
        callJson(c.changeSetsUndo, { params: { id: changeSetId } }, a),
        new Promise((r) => setTimeout(r, delay)).then(() => claimJob(app.rt.db, jobId)),
      ]);
      results.push({
        undoWon: undo.status === 200,
        claimWon: claimed !== null,
        undoStatus: undo.status,
      });
      if (undo.status !== 200) expect(undo.status).toBe(409);
      // A claimed job is left to finish as the worker would; tidy it so the next undo is fresh.
      if (claimed !== null)
        await app.rt.db
          .update(job)
          .set({ status: "cancelled", finishedAt: new Date() })
          .where(eq(job.id, jobId));
    }
    // Deterministic orders too: claim first → the undo is refused; undo first → nothing to claim.
    const first = await queuedRecipeJob();
    const claimedFirst = await claimJob(app.rt.db, first.jobId);
    const refused = await callJson(c.changeSetsUndo, { params: { id: first.changeSetId } }, a);
    const second = await queuedRecipeJob();
    const undoneFirst = await callJson(c.changeSetsUndo, { params: { id: second.changeSetId } }, a);
    const claimAfter = await claimJob(app.rt.db, second.jobId);
    measure("G2", "undo-claim-race", {
      runs: results.length,
      undoWins: results.filter((r) => r.undoWon).length,
      claimWins: results.filter((r) => r.claimWon).length,
      exactlyOne: results.filter(exactlyOne).length,
      claimFirstUndoStatus: refused.status,
      undoFirstClaim: claimAfter !== null,
    });
    expect(results.every(exactlyOne)).toBe(true);
    expect(claimedFirst).not.toBeNull();
    expect(refused.status).toBe(409);
    expect((refused.json as { code: string }).code).toBe("job_started");
    expect(undoneFirst.status).toBe(200);
    expect(claimAfter).toBeNull();
    expect(await jobRow(second.jobId)).toBeUndefined();
  }, 120_000);

  it("G2 negative control: an undo that bypasses the queued-only guard lets both the claim and the undo win", async () => {
    const { jobId } = await queuedRecipeJob();
    const claimWon = (await claimJob(app.rt.db, jobId)) !== null;
    // Faulty undo: deletes the job row with the guard switched off (as only a purge may).
    const deleted = await app.rt.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('mealplanner.purge', 'on', true)`);
      return tx.delete(job).where(eq(job.id, jobId)).returning({ id: job.id });
    });
    const r = { undoWon: deleted.length === 1, claimWon };
    measure("G2", "negative-unguarded-undo", { ...r, exactlyOne: exactlyOne(r) });
    expect(exactlyOne(r)).toBe(false);
  }, 30_000);
});

describe("G2 with the worker process", () => {
  it("G2 a plan job runs in the worker process and streams progress over SSE to a test client (ARC-7)", async () => {
    worker = await startWorkerProcess(db.url);
    const dates = ["2026-11-10", "2026-11-11"];
    const jobId = await postGenerate(dates);
    const opened = Date.now();
    const read = await readSse(eventsUrl(jobId), bearer(a), { timeoutMs: 180_000 });
    const events = parsed(read.events);
    const row = await jobRow(jobId);
    const types = events.map((e) => e.type);
    const seqs = events.map((e) => e.seq);
    const progress = events.filter((e) => !["started", "done", "failed"].includes(e.type));
    const finishedAt = row?.finishedAt?.getTime() ?? 0;
    const beforeFinish = read.events.filter((e) => e.receivedAt < finishedAt).length;
    const plans = ok<{ days: Array<{ date: string; meals: unknown[] }> }>(
      await callJson(c.plansList, { query: { from: dates[0], to: dates[1] } }, a),
      "plans",
    );
    measure("G2", "plan-job", {
      jobId,
      events: events.length,
      types: [...new Set(types)],
      progress: progress.length,
      first: types[0],
      last: types.at(-1),
      contiguous: seqs.every((s, i) => s === i + 1),
      idsMatchSeq: read.events.every((e, i) => e.id === String(seqs[i])),
      receivedBeforeFinish: beforeFinish,
      closedByServer: read.closedByServer,
      status: row?.status,
      daysPlanned: plans.days.filter((d) => d.meals.length > 0).length,
      msToDone: (read.events.at(-1)?.receivedAt ?? 0) - opened,
      workerLogged: worker.output().includes('"kind":"plan.generate"'),
    });
    expect(read.status).toBe(200);
    expect(read.contentType.startsWith("text/event-stream")).toBe(true);
    expect(types[0]).toBe("started");
    expect(types.at(-1)).toBe("done");
    expect(types.filter((t) => TERMINAL_EVENTS.has(t))).toEqual(["done"]);
    expect(progress.length).toBeGreaterThan(2);
    expect(types).toContain("day_started");
    expect(types).toContain("meal_planned");
    expect(seqs.every((s, i) => s === i + 1)).toBe(true);
    expect(read.events.every((e, i) => e.id === String(seqs[i]))).toBe(true);
    expect(read.closedByServer).toBe(true);
    expect(row?.status).toBe("succeeded");
    // Streamed live: events reached the client while the job was still running.
    expect(beforeFinish).toBeGreaterThan(0);
    expect(plans.days.filter((d) => d.meals.length > 0).map((d) => d.date)).toEqual(dates);
    // The job queued while no worker ran (negative control above) is picked up too.
    const [stale] = await app.rt.db
      .select({ status: job.status })
      .from(job)
      .where(and(eq(job.householdId, a.householdId), eq(job.kind, "plan.generate")))
      .orderBy(job.createdAt)
      .limit(1);
    const deadline = Date.now() + 90_000;
    let staleStatus = stale?.status;
    while (staleStatus === "queued" || staleStatus === "running") {
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 1_000));
      const [s] = await app.rt.db
        .select({ status: job.status })
        .from(job)
        .where(and(eq(job.householdId, a.householdId), eq(job.kind, "plan.generate")))
        .orderBy(job.createdAt)
        .limit(1);
      staleStatus = s?.status;
    }
    expect(staleStatus).toBe("succeeded");
  }, 300_000);

  it("G2 Last-Event-ID resumes the stream after the given event", async () => {
    const [done] = await app.rt.db
      .select({ id: job.id })
      .from(job)
      .where(
        and(
          eq(job.householdId, a.householdId),
          eq(job.kind, "plan.generate"),
          eq(job.status, "succeeded"),
        ),
      )
      .orderBy(desc(job.createdAt))
      .limit(1);
    if (done === undefined) throw new Error("no finished plan job");
    const full = parsed(
      (await readSse(eventsUrl(done.id), bearer(a), { timeoutMs: 20_000 })).events,
    );
    const resumeAfter = Math.floor(full.length / 2);
    const resumed = await readSse(
      eventsUrl(done.id),
      { ...bearer(a), "last-event-id": String(resumeAfter) },
      { timeoutMs: 20_000 },
    );
    const seqs = parsed(resumed.events).map((e) => e.seq);
    measure("G2", "resume", {
      total: full.length,
      resumeAfter,
      resumedFirst: seqs[0],
      resumedCount: seqs.length,
    });
    expect(seqs[0]).toBe(resumeAfter + 1);
    expect(seqs).toEqual(full.slice(resumeAfter).map((e) => e.seq));
    expect(resumed.closedByServer).toBe(true);
  }, 60_000);

  it("G2 another household can neither open the job's stream nor read the job (404)", async () => {
    const [any] = await app.rt.db
      .select({ id: job.id })
      .from(job)
      .where(eq(job.householdId, a.householdId))
      .limit(1);
    if (any === undefined) throw new Error("no job");
    const stream = await readSse(eventsUrl(any.id), bearer(b), { timeoutMs: 10_000 });
    const read = await callJson(c.jobsGet, { params: { id: any.id } }, b);
    const anon = await readSse(eventsUrl(any.id), {}, { timeoutMs: 10_000 });
    measure("G2", "stream-scope", {
      otherHousehold: stream.status,
      jobRead: read.status,
      anonymous: anon.status,
    });
    expect(stream.status).toBe(404);
    expect(stream.events).toEqual([]);
    expect(read.status).toBe(404);
    expect(anon.status).toBe(401);
  }, 30_000);
});
