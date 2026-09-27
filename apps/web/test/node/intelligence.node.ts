// node-1.3 N3 (R-69, R-70): the intelligence branch end to end, with recorded model responses and no
// live call (SPEC-Q-6). The built web app (`next start`) and the real worker run on the gate's fresh
// database (migrated from zero, catalogue, F1); every step goes through the HTTP API and the
// worker's jobs:
// - SC-3: two 1★ reviews by one member (their own login) lower that member's dish score and plate
//   appeal, and the worker's `insights.run` turns them into a pending proposal; after one review it
//   gives none (negative control, run first on the same household);
// - accepting the proposal writes a `proposal_accept` change set to the log, and the worker's
//   `kg.sync` gives the graph the member's DISLIKES edge to the dish;
// - the agent's `get_preferences` (recorded turn) reports the dislike to the model;
// - SC-4: an agent `apply_change` (recorded turn) is in the change log as the agent's, and its undo
//   restores the prior state exactly; the same undo with one before-image removed fails the check.
// Change-log titles are not pinned (R-70 amendment 1): entries are found by id, actor and source.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { resolveScore } from "@mealplanner/core/learning/preferences";
import type { HouseholdContext } from "@mealplanner/core/types";
import { migrateAndSeed } from "@mealplanner/db/seed";
import { loadFixture, type LoadedFixture } from "@mealplanner/db/services/config";
import { createRepos } from "@mealplanner/db/repos";
import { F1 } from "../../../../packages/core/dist/test/fixtures/index.js";
import { appealOf } from "../../../../packages/db/test/reviews/measure";
import {
  changedTables,
  diffSnapshots,
  imageEntities,
  measure,
  NOT_COMPARED,
} from "../../../../packages/db/test/node/support";
import { snapshotDatabase } from "../../../../packages/db/test/support/snapshot";
import {
  loadRecordings,
  recordedModelEnv,
  startRecordedModel,
  type RecordedModel,
} from "./recorded-model";
import {
  api,
  requiredEnv,
  signIn,
  startBuiltApp,
  startWorker,
  waitForJob,
  type Api,
  type BuiltApp,
  type Child,
  type Login,
} from "./support";

const PLAN_DATE = "2026-09-28";
const ADMIN = "adult.a@f1.example";
const MEMBER = "adult.b@f1.example";
/**
 * Tables a chat turn itself writes besides its change set (the conversation, its messages and the
 * model-call audit), left out of the SC-4 comparison like SPEC-Q-4's; the test asserts the change
 * set's own before-images name none of them.
 */
const TURN_TABLES = ["ai_generation", "chat_message", "conversation"];
const EXCLUDED = new Set([...NOT_COMPARED, ...TURN_TABLES]);

let database: { url: string; pool: pg.Pool };
let f1: LoadedFixture;
let model: RecordedModel;
let app: BuiltApp;
let worker: Child;
let adminLogin: Login;
let adminApi: Api;
let memberApi: Api;
let ctx: HouseholdContext;
let memberId: string;
let dishId: string;
let planMealId: string;
let proposalId: string;
let conversationId = "";
/** Stops what the tests started, last first. */
const cleanup: (() => Promise<void>)[] = [];
const snapshot = () => snapshotDatabase(database.pool, EXCLUDED);
/** Every table but SPEC-Q-4's, to see which tables a turn writes outside its change set. */
const fullSnapshot = () => snapshotDatabase(database.pool, NOT_COMPARED);

async function prefsScore(): Promise<number> {
  const prefs = await createRepos(drizzle(database.pool), ctx).preference.list();
  return resolveScore(prefs, memberId, "dish", dishId);
}

async function runInsights(): Promise<void> {
  const run = await adminApi("POST", "/insights/run");
  expect(run.status, JSON.stringify(run.json)).toBe(202);
  await waitForJob(adminApi, (run.json as { jobId: string }).jobId);
}

async function pendingProposals(): Promise<{ id: string; kind: string; payload: unknown }[]> {
  const r = await adminApi("GET", "/proposals?status=pending");
  expect(r.status).toBe(200);
  return (r.json as { proposals: { id: string; kind: string; payload: unknown }[] }).proposals;
}

async function reviewOnce(): Promise<void> {
  const r = await memberApi("POST", "/reviews", {
    targetType: "dish",
    targetId: dishId,
    planMealId,
    rating: 1,
    tags: [],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
}

/** Sends one chat message and reads the whole SSE reply. */
async function chat(conversationId: string, text: string): Promise<string> {
  const res = await fetch(`${app.url}/api/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminLogin.token}`,
      "x-household-id": adminLogin.householdId,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  expect(res.status, body).toBe(200);
  return body;
}

async function changeLog(): Promise<
  { type: string; id: string; actor: string; source: string; undoneAt: string | null }[]
> {
  const r = await adminApi("GET", "/change-sets?limit=200");
  expect(r.status).toBe(200);
  return (r.json as { entries: [] }).entries;
}

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  ms = 180_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}\n${worker.output()}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function storedInverse(changeSetId: string): Promise<unknown[]> {
  const { rows } = await database.pool.query<{ inverse: unknown[] }>(
    "SELECT inverse FROM change_set WHERE id = $1",
    [changeSetId],
  );
  return rows[0]?.inverse ?? [];
}

/** The agent change set a chat turn applied, found by actor and source among the new entries. */
async function agentChangeSet(before: ReadonlySet<string>) {
  const entries = await changeLog();
  const fresh = entries.filter(
    (e) =>
      e.type === "change_set" &&
      !before.has(e.id) &&
      e.actor === "agent" &&
      e.source === "agent_apply",
  );
  expect(fresh.length, JSON.stringify(entries.slice(0, 5))).toBe(1);
  return fresh[0];
}

beforeAll(async () => {
  database = {
    url: requiredEnv("NODE_DB_URL"),
    pool: new pg.Pool({ connectionString: requiredEnv("NODE_DB_URL"), max: 4 }),
  };
  cleanup.push(() => database.pool.end());
  model = await startRecordedModel([]);
  cleanup.push(() => model.close());
});

afterAll(async () => {
  for (const stop of cleanup.reverse()) await stop();
});

describe("node-1.3 N3 intelligence (built app, worker, recorded model)", () => {
  it("N3 set-up: fresh database, catalogue and F1; the built app, the worker and a plan from plan.generate", async () => {
    const { rows } = await database.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(rows[0]?.n).toBe(0);
    await migrateAndSeed(database.url);
    f1 = await loadFixture(drizzle(database.pool), F1);
    ctx = { householdId: f1.householdId, userId: null, role: "system" };
    memberId = f1.members.adult_b ?? "";
    expect(memberId).not.toBe("");
    worker = await startWorker(database.url, recordedModelEnv(model));
    cleanup.push(() => worker.stop());
    app = await startBuiltApp(database.url, recordedModelEnv(model));
    cleanup.push(() => app.stop());
    adminLogin = await signIn(app, database.url, ADMIN);
    adminApi = api(app, adminLogin);
    memberApi = api(app, await signIn(app, database.url, MEMBER));
    const weights = await adminApi("POST", "/change-sets", {
      summary: "node-1.3 N3: AI recipes off",
      ops: [{ kind: "weights.set", payload: { aiGeneration: "off" } }],
    });
    expect(weights.status).toBe(201);
    const gen = await adminApi("POST", "/plans/generate", { dates: [PLAN_DATE], seed: 1 });
    expect(gen.status, JSON.stringify(gen.json)).toBe(202);
    await waitForJob(adminApi, (gen.json as { jobId: string }).jobId);
    const { rows: meals } = await database.pool.query<{ id: string; dish_id: string }>(
      `SELECT m.id, m.dish_id FROM plan_meal m
         JOIN plan_day d ON d.id = m.plan_day_id
         JOIN slot_type s ON s.id = m.slot_type_id
         JOIN plate p ON p.plan_meal_id = m.id
        WHERE d.date = $1 AND s.key = 'dinner' AND p.member_id = $2`,
      [PLAN_DATE, memberId],
    );
    expect(meals.length).toBe(1);
    planMealId = meals[0]?.id ?? "";
    dishId = meals[0]?.dish_id ?? "";
    model.add(
      loadRecordings("intelligence", {
        MEMBER_ID: memberId,
        CHILD_ID: f1.members.c1 ?? "",
        DISH_ID: dishId,
      }),
    );
    measure({ check: "setup", planMealId, dishId, memberId });
  });

  it("N3 negative control: one 1★ review gives no proposal", async () => {
    await reviewOnce();
    await runInsights();
    const pending = await pendingProposals();
    measure({ check: "sc3-control", pending: pending.length });
    expect(pending).toEqual([]);
  });

  it("N3 SC-3: a second 1★ review lowers the member's dish appeal and insights.run proposes the dislike", async () => {
    const db = drizzle(database.pool);
    const members = Object.values(f1.members).filter((m) => m !== memberId);
    const { rows: plated } = await database.pool.query<{ member_id: string }>(
      "SELECT member_id FROM plate WHERE plan_meal_id = $1",
      [planMealId],
    );
    const others = plated.map((p) => p.member_id).filter((m) => members.includes(m));
    const scoreBefore = await prefsScore();
    const appealBefore = await appealOf(db, ctx, planMealId, memberId);
    const othersBefore = await Promise.all(others.map((m) => appealOf(db, ctx, planMealId, m)));
    await reviewOnce();
    const scoreAfter = await prefsScore();
    const appealAfter = await appealOf(db, ctx, planMealId, memberId);
    const othersAfter = await Promise.all(others.map((m) => appealOf(db, ctx, planMealId, m)));
    await runInsights();
    const pending = await pendingProposals();
    const mine = pending.filter((p) => {
      const ops =
        (p.payload as { ops?: { kind: string; payload: Record<string, unknown> }[] }).ops ?? [];
      return ops.some(
        (o) =>
          o.kind === "preference.set" &&
          o.payload.memberId === memberId &&
          o.payload.entityType === "dish" &&
          o.payload.entityKey === dishId &&
          o.payload.score === -0.8,
      );
    });
    measure({
      check: "sc3",
      scoreBefore,
      scoreAfter,
      appealBefore,
      appealAfter,
      othersUnchanged: JSON.stringify(othersBefore) === JSON.stringify(othersAfter),
      pending: pending.length,
      proposals: mine.length,
    });
    expect(appealAfter).toBeLessThan(appealBefore);
    expect(scoreAfter).toBeLessThan(scoreBefore);
    expect(othersAfter).toEqual(othersBefore);
    expect(mine.length).toBe(1);
    proposalId = mine[0]?.id ?? "";
  });

  it("N3 accepting the proposal through the API writes a proposal_accept change set to the log", async () => {
    const r = await adminApi("POST", `/proposals/${proposalId}/accept`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const changeSetId = (r.json as { changeSetId: string }).changeSetId;
    const entry = (await changeLog()).find((e) => e.id === changeSetId);
    measure({ check: "accept", changeSetId, actor: entry?.actor, source: entry?.source });
    expect(entry?.type).toBe("change_set");
    expect(entry?.source).toBe("proposal_accept");
    expect(await prefsScore()).toBe(-0.8);
  });

  it("N3 kg.sync gives the graph the member's dislike edge", async () => {
    const edge = await waitFor("the DISLIKES edge at 0.8", async () => {
      const { rows } = await database.pool.query<{ weight: string; locked: boolean | null }>(
        `SELECT e.weight::text, (e.props->>'locked')::boolean AS locked
           FROM kg_edge e
           JOIN kg_node s ON s.id = e.src_id
           JOIN kg_node d ON d.id = e.dst_id
          WHERE e.type = 'DISLIKES' AND s.type = 'Member' AND s.key = $1
            AND d.type = 'Dish' AND d.key = $2 AND e.household_id = $3`,
        [memberId, dishId, ctx.householdId],
      );
      const row = rows[0];
      return row !== undefined && Math.abs(Number(row.weight) - 0.8) < 1e-9 ? row : undefined;
    });
    const { rows: jobs } = await database.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM job WHERE kind = 'kg.sync' AND status = 'succeeded' AND household_id = $1",
      [ctx.householdId],
    );
    measure({
      check: "kg",
      weight: Number(edge.weight),
      locked: edge.locked,
      syncJobs: jobs[0]?.n,
    });
    expect(jobs[0]?.n).toBeGreaterThan(0);
  });

  it("N3 the agent's get_preferences reports the dislike to the model (recorded turn)", async () => {
    const conv = await adminApi("POST", "/conversations", { title: "node-1.3 N3" });
    expect(conv.status).toBe(201);
    conversationId = (conv.json as { id: string }).id;
    const reply = await chat(conversationId, "What does Adult B think of tonight's dinner?");
    const request = model.requests.at(-1) as { messages: { content: unknown }[] };
    const sent = JSON.stringify(request.messages.at(-1)?.content);
    measure({
      check: "get_preferences",
      requests: model.requests.length,
      resultCarriesDish: sent.includes(dishId),
      failures: model.failures,
    });
    expect(model.failures, model.failures.join("\n")).toEqual([]);
    expect(sent).toContain(dishId);
    expect(reply).toContain("-0.8");
  });

  it("N3 SC-4: an agent apply_change is in the change log as the agent's and its undo restores the prior state exactly", async () => {
    const known = new Set((await changeLog()).map((e) => e.id));
    const before = await snapshot();
    const fullBefore = await fullSnapshot();
    await chat(conversationId, "Weigh appeal higher, please.");
    expect(model.failures, model.failures.join("\n")).toEqual([]);
    const entry = await agentChangeSet(known);
    const after = await snapshot();
    const entities = imageEntities(await storedInverse(entry?.id ?? ""));
    // The tables the turn wrote besides its change set are the turn's own (TURN_TABLES).
    const turnWrites = changedTables(fullBefore, await fullSnapshot()).filter(
      (t) => !entities.includes(t),
    );
    const undo = await adminApi("POST", `/change-sets/${entry?.id ?? ""}/undo`);
    expect(undo.status, JSON.stringify(undo.json)).toBe(200);
    const restored = await snapshot();
    const diff = diffSnapshots(before, restored);
    const undone = (await changeLog()).find((e) => e.id === entry?.id);
    measure({
      check: "sc4",
      changeSetId: entry?.id,
      actor: entry?.actor,
      source: entry?.source,
      changed: changedTables(before, after),
      entities,
      excluded: [...EXCLUDED],
      turnWrites,
      restoreDiff: diff.length,
      undone: undone?.undoneAt !== null,
    });
    expect(changedTables(before, after)).toContain("planning_weights");
    expect(entities.filter((e) => EXCLUDED.has(e))).toEqual([]);
    expect(turnWrites.every((t) => TURN_TABLES.includes(t))).toBe(true);
    expect(turnWrites).toContain("chat_message");
    expect(diff, diff.join("\n")).toEqual([]);
    expect(undone?.undoneAt).not.toBeNull();
  });

  it("N3 negative control: an undo that skips one before-image fails the equality check", async () => {
    const known = new Set((await changeLog()).map((e) => e.id));
    const before = await snapshot();
    await chat(conversationId, "Rename Child C1, please.");
    const entry = await agentChangeSet(known);
    const inverse = (await storedInverse(entry?.id ?? "")) as {
      payload: { images: { entity: string; before: unknown }[] };
    }[];
    for (const op of inverse) {
      const i = op.payload.images.findIndex((x) => x.entity === "member" && x.before !== null);
      if (i !== -1) {
        op.payload.images.splice(i, 1);
        break;
      }
    }
    await database.pool.query("UPDATE change_set SET inverse = $1::jsonb WHERE id = $2", [
      JSON.stringify(inverse),
      entry?.id,
    ]);
    const undo = await adminApi("POST", `/change-sets/${entry?.id ?? ""}/undo`);
    expect(undo.status).toBe(200);
    const diff = diffSnapshots(before, await snapshot());
    measure({ check: "sc4-control", restoreDiff: diff.length });
    expect(diff.length).toBeGreaterThan(0);
  });

  it("N3 the recorded model answered every request from its recordings, and no live call was made", () => {
    measure({
      check: "model",
      requests: model.requests.length,
      failures: model.failures,
      remaining: model.remaining(),
    });
    expect(model.failures, model.failures.join("\n")).toEqual([]);
    expect(model.remaining()).toEqual([]);
    expect(model.requests.length).toBe(8);
  });
});
