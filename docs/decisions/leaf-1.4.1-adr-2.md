# leaf-1.4.1 ADR-2: jobs (pg-boss 12.34.0), job events and SSE

Status: proposed (CP1)
Requirement: ARC-7, ARC-5 (`jobs/:id/events`), PLN-12, FBK-7, KG-3, R2-ADM-8; SPEC-Q-8, SPEC-Q-11

## Decision

- Queue: `pg-boss` **12.34.0** (declared in `apps/worker`; requested for `apps/web`, which only sends). One queue per job kind, created with `createQueue` at worker start; `send(name, data, { id })` with the `job.id` we generate, so the `job` row and the pg-boss job share an id. Retries: `retryLimit: 0` for `plan.generate` (a re-run must be asked for), 2 with backoff for `kg.*`, `nutrition.recompute`, `plates.resolve`.
- Enqueue path (`apps/web/lib/server/jobs.ts`, `apps/worker/src/jobs/enqueue.ts`): insert `job` (`queued`), commit, then `boss.send`. The worker marks `running`/`succeeded`/`failed` and writes the result or error (`failed` rows feed the platform console).
- Events: `job_event (job_id, seq, household_id, type, payload)`; the worker inserts each `PlanProgress` (and the final `done`/`failed`) and calls `pg_notify('job_event', job_id || ':' || seq)` in the same statement.
- SSE (`GET /api/v1/jobs/:id/events`): household check on the `job` row (other household → 404); replay rows with `seq > Last-Event-ID`; then `LISTEN job_event` on one shared dedicated `pg.Client` per web process (`apps/web/lib/server/events.ts`, fan-out by job id) and stream new rows; close after the terminal event. `id:` = seq, `event:` = type, `data:` = JSON; a comment heartbeat every 15 s. The stream uses the Web `ReadableStream` returned from the route handler (Next.js App Router streaming, `export const dynamic = "force-dynamic"`, `runtime = "nodejs"`).
- The worker (`apps/worker/src/main.ts`) builds: one `pg.Pool`, Drizzle, `PgBoss`, the Claude client (`resolveClaudeConfig`; null model when no credential), `PostgresGraphStore(pool)` and `PostgresKgSource`, then registers every handler in `apps/worker/src/jobs/*`. Graceful shutdown on SIGTERM (`boss.stop({ graceful: true })`).
- G2 runs the **real worker entry** as a child process (`node apps/worker/dist/src/main.js` against the gate's own database), a real HTTP server around the route handlers, and a `fetch` SSE client; see ADR-3.
