// The worker's jobs and the catalogue loader (ARC-7, R-2 wiring, R-17), run in-process through the
// worker's own runner against a test database. Claude calls go through the real SDK client with
// only `fetch` replaced by recorded wire responses (the 1.3.1 fixtures); no live call is made
// (1.3.1 G4's live check stays the owner's handoff).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import {
  createClaudeClient,
  resolveClaudeConfig,
  type StructuredModel,
} from "@mealplanner/ai/client";
import {
  aiGeneration,
  changeSet,
  dish,
  exclusion,
  household,
  member,
  newId,
} from "@mealplanner/db/schema";
import { loadCatalogue } from "@mealplanner/db/seed";
import {
  QUEUE_OPTIONS,
  aiDishesToday,
  claimJob,
  createJob,
  generatePlan,
  sendOptions,
  type JobKind,
} from "@mealplanner/db/services/plans";
import type { Json } from "@mealplanner/core/types";
import { createWorkerRuntime, type WorkerRuntime } from "../../../worker/src/runtime";
import { HANDLERS } from "../../../worker/src/jobs/handlers";
import { runJob } from "../../../worker/src/runner";
import { syncCatalogueGraph } from "../../../worker/src/main";
import { tick } from "../../../worker/src/schedule";
import { callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { measure } from "./support/measure";
import { addMembers, applyOps, signupAdmin, type Login } from "./support/world";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DATA_DIR = join(ROOT, "data");
const FIXTURES = join(ROOT, "packages/ai/test/recipes/fixtures");

// The SDK is a dependency of @mealplanner/ai; resolved from there (the web app does not depend on it).
const requireFromAi = createRequire(join(ROOT, "packages/ai/package.json"));
type AnthropicCtor = new (opts: {
  apiKey: string;
  fetch: typeof fetch;
  maxRetries: number;
}) => unknown;
const Anthropic = (requireFromAi("@anthropic-ai/sdk") as { default: AnthropicCtor }).default;

type Batch = {
  dishes: Array<{
    name: string;
    components: Array<{ role: string; variants: Array<{ method: string }> }>;
  }>;
  newIngredients: unknown[];
};
const validBatch = requireFromAi(join(FIXTURES, "valid-batch.json")) as Batch;

/** A structured model whose SDK client answers from recorded message bodies, in order. */
function recordedModel(bodies: unknown[]): { model: StructuredModel; calls: () => number } {
  const queue = [...bodies];
  let calls = 0;
  const fakeFetch = (): Promise<Response> => {
    calls += 1;
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error("no recorded response left"));
    return Promise.resolve(
      new Response(JSON.stringify(next), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": `req_recorded_${String(calls)}`,
        },
      }),
    );
  };
  const anthropic = new Anthropic({
    apiKey: "sk-ant-test-not-a-real-key",
    fetch: fakeFetch,
    maxRetries: 0,
  });
  const model = createClaudeClient(
    resolveClaudeConfig({ ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key" }),
    {
      anthropic: anthropic as never,
    },
  );
  if (model === null) throw new Error("model disabled");
  return { model, calls: () => calls };
}

function message(batch: unknown) {
  return {
    id: `msg_recorded_${String(Math.random()).slice(2, 10)}`,
    type: "message",
    role: "assistant",
    model: "claude-fable-5-1",
    content: [
      { type: "thinking", thinking: "", signature: "sig_recorded" },
      { type: "text", text: JSON.stringify(batch), citations: null },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 2100,
      output_tokens: 6400,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

const oneDish = (i: number): Batch => ({
  dishes: [validBatch.dishes[i] as Batch["dishes"][number]],
  newIngredients: validBatch.newIngredients,
});

let db: TestDatabase;
let app: TestApp;
let admin: Login & { householdId: string };

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  admin = await signupAdmin("Jobs");
  await addMembers(admin);
}, 300_000);

afterAll(async () => {
  await app.close();
  await db.drop();
}, 60_000);

async function worker(
  model: StructuredModel | null,
  env: { aiRecipeDailyLimit?: number } = {},
): Promise<WorkerRuntime> {
  return createWorkerRuntime(
    {
      databaseUrl: db.url,
      dataDir: DATA_DIR,
      aiRecipeDailyLimit: env.aiRecipeDailyLimit ?? 60,
      concurrency: 1,
    },
    { model },
  );
}

async function runKind(
  rt: WorkerRuntime,
  kind: JobKind,
  payload: Json,
  householdId: string | null,
  userId: string | null = null,
) {
  const job = await createJob(rt.db, { kind, householdId, payload, createdByUserId: userId });
  const handler = HANDLERS[kind];
  if (handler === undefined) throw new Error(`no handler ${kind}`);
  await runJob(rt, job.id, handler);
  const [row] = await rt.db
    .execute<{ status: string; error: Json }>(
      sql`SELECT status, error FROM job WHERE id = ${job.id}`,
    )
    .then((r) => r.rows);
  const events = await rt.db.execute<{ type: string; payload: Json }>(
    sql`SELECT type, payload FROM job_event WHERE job_id = ${job.id} ORDER BY seq`,
  );
  return {
    id: job.id,
    status: row?.status,
    error: row?.error ?? null,
    events: events.rows,
    result: events.rows.at(-1)?.payload ?? null,
  };
}

async function aiDishes(householdId: string) {
  return app.rt.db
    .select({ id: dish.id, name: dish.name, source: dish.source })
    .from(dish)
    .where(and(eq(dish.householdId, householdId), eq(dish.source, "ai")));
}

describe("catalogue loader (R-17)", () => {
  it("jobs: the catalogue loader is idempotent and marks NUT-4 failures and their variants for review", async () => {
    const again = await loadCatalogue(app.rt.db, { dataDir: DATA_DIR });
    const [counts] = await app.rt.db
      .execute<{ ingredients: number; dishes: number; review: number }>(
        sql`SELECT (SELECT count(*)::int FROM ingredient WHERE created_by_household_id IS NULL) AS ingredients,
                 (SELECT count(*)::int FROM dish WHERE household_id IS NULL) AS dishes,
                 (SELECT count(*)::int FROM ingredient WHERE needs_review) AS review`,
      )
      .then((r) => r.rows);
    const reviewSlugs = new Set(again.ingredientsNeedingReview);
    const [flaggedVariants] = await app.rt.db
      .execute<{ n: number }>(
        sql`SELECT count(DISTINCT v.id)::int AS n FROM variant v JOIN variant_ingredient vi ON vi.variant_id = v.id
          JOIN ingredient i ON i.id = vi.ingredient_id WHERE i.needs_review AND NOT v.needs_review`,
      )
      .then((r) => r.rows);
    measure("G2", "loader", {
      changedRows: again.changedRows,
      ingredients: again.ingredients,
      dishes: again.dishes,
      variants: again.variants,
      needsReview: again.ingredientsNeedingReview.length,
      unflaggedVariants: flaggedVariants?.n,
    });
    expect(again.changedRows).toBe(0);
    expect(counts?.ingredients).toBe(again.ingredients);
    expect(counts?.review).toBe(reviewSlugs.size);
    expect(reviewSlugs.size).toBeGreaterThan(0);
    // SPEC-Q-20: a variant using an ingredient that needs review needs review too.
    expect(flaggedVariants?.n).toBe(0);
  }, 120_000);
});

describe("AI recipe jobs with recorded responses", () => {
  it("jobs: recipe.generate saves the surviving dishes as household ai dishes through a change set, with ai_generation rows", async () => {
    const { model, calls } = recordedModel([message(validBatch)]);
    const rt = await worker(model);
    try {
      const before = (await aiDishes(admin.householdId)).length;
      const r = await runKind(
        rt,
        "recipe.generate",
        { date: "2026-11-20", slotKey: "dinner", count: 3, reason: "more variety" },
        admin.householdId,
      );
      const saved = await aiDishes(admin.householdId);
      const gens = await app.rt.db
        .select()
        .from(aiGeneration)
        .where(eq(aiGeneration.householdId, admin.householdId));
      const sets = await app.rt.db
        .select({ id: changeSet.id, actor: changeSet.actor, source: changeSet.source })
        .from(changeSet)
        .where(
          and(
            eq(changeSet.householdId, admin.householdId),
            sql`${changeSet.summary} like 'Add % AI recipe%'`,
          ),
        );
      measure("G2", "recipe-generate", {
        status: r.status,
        calls: calls(),
        saved: saved.length - before,
        generations: gens.length,
        changeSets: sets.length,
      });
      expect(r.status, JSON.stringify(r.error)).toBe("succeeded");
      expect(calls()).toBe(1);
      expect(saved.length - before).toBeGreaterThan(0);
      expect(gens.length).toBeGreaterThan(0);
      expect(sets.length).toBeGreaterThan(0);
      expect(sets.every((s) => s.actor === "system" && s.source === "learning")).toBe(true);
    } finally {
      await rt.close();
    }
  }, 120_000);

  it("jobs: recipe.revise rewrites a household dish's variant from a recorded revision, as a new dish version", async () => {
    const [target] = await app.rt.db
      .select({ id: dish.id, version: dish.version, name: dish.name })
      .from(dish)
      .where(and(eq(dish.householdId, admin.householdId), eq(dish.source, "ai")))
      .orderBy(dish.createdAt)
      .limit(1);
    if (target === undefined) throw new Error("no household dish to revise");
    const index = validBatch.dishes.findIndex((d) => d.name === target.name);
    const { model } = recordedModel([message(oneDish(index === -1 ? 0 : index))]);
    const rt = await worker(model);
    try {
      const r = await runKind(
        rt,
        "recipe.revise",
        { dishId: target.id, variantId: null, notes: ["too_salty"] },
        admin.householdId,
      );
      const [after] = await app.rt.db
        .select({ version: dish.version })
        .from(dish)
        .where(eq(dish.id, target.id));
      const result = r.result as { revisedVariants?: string[]; copiedFrom?: string | null } | null;
      measure("G2", "recipe-revise", {
        status: r.status,
        revised: result?.revisedVariants?.length ?? 0,
        versionBefore: target.version,
        versionAfter: after?.version,
      });
      expect(r.status, JSON.stringify(r.error)).toBe("succeeded");
      expect(result?.copiedFrom).toBeNull();
      expect(result?.revisedVariants?.length ?? 0).toBeGreaterThan(0);
      expect(after?.version).toBe(target.version + 1);
    } finally {
      await rt.close();
    }
  }, 120_000);

  it("jobs: recipe.revise of a seed dish creates the household's copy and leaves the seed dish unchanged (REC-7)", async () => {
    // A seed dish with a component whose role and method the recorded revision also has.
    const wanted = new Set(
      validBatch.dishes.flatMap((d, i) =>
        d.components.flatMap((comp) =>
          comp.variants.map((v) => `${String(i)}|${comp.role}|${v.method}`),
        ),
      ),
    );
    const rows = await app.rt.db.execute<{
      dish_id: string;
      role: string;
      method: string;
      slot_keys: string[];
    }>(
      sql`SELECT d.id AS dish_id, c.role, m.key AS method, d.slot_keys FROM dish d JOIN component c ON c.dish_id = d.id
          JOIN variant v ON v.component_id = c.id JOIN preparation_method m ON m.id = v.method_id
          WHERE d.household_id IS NULL AND d.source = 'seed' AND 'dinner' = ANY(d.slot_keys) ORDER BY d.slug`,
    );
    let pick: { dishId: string; batch: number } | undefined;
    for (const row of rows.rows)
      for (let i = 0; i < validBatch.dishes.length && pick === undefined; i += 1)
        if (wanted.has(`${String(i)}|${row.role}|${row.method}`))
          pick = { dishId: row.dish_id, batch: i };
    if (pick === undefined)
      throw new Error("no seed dish shares a component with the recorded batch");
    const [seedBefore] = await app.rt.db
      .select({ version: dish.version })
      .from(dish)
      .where(eq(dish.id, pick.dishId));
    // A household without the recorded dishes in its library (they would be duplicates, REC-5).
    const other = await signupAdmin("Seed reviser");
    await addMembers(other);
    const { model } = recordedModel([message(oneDish(pick.batch))]);
    const rt = await worker(model);
    try {
      const r = await runKind(
        rt,
        "recipe.revise",
        { dishId: pick.dishId, variantId: null, notes: ["too_oily"] },
        other.householdId,
      );
      const result = r.result as { dishId?: string; copiedFrom?: string | null } | null;
      expect(r.status, JSON.stringify(r.error)).toBe("succeeded");
      const [seedAfter] = await app.rt.db
        .select({ version: dish.version })
        .from(dish)
        .where(eq(dish.id, pick.dishId));
      const [copy] = await app.rt.db
        .select({ householdId: dish.householdId })
        .from(dish)
        .where(eq(dish.id, result?.dishId ?? ""));
      measure("G2", "recipe-revise-seed", {
        status: r.status,
        copied: result?.copiedFrom === pick.dishId,
        seedUnchanged: seedAfter?.version === seedBefore?.version,
      });
      expect(r.status, JSON.stringify(r.error)).toBe("succeeded");
      expect(result?.copiedFrom).toBe(pick.dishId);
      expect(copy?.householdId).toBe(other.householdId);
      expect(seedAfter?.version).toBe(seedBefore?.version);
    } finally {
      await rt.close();
    }
  }, 120_000);

  it("jobs: without a credential or over the daily limit no model call is made and the reason is reported (REC-2, ARC-6)", async () => {
    const off = await worker(null);
    try {
      const r = await runKind(
        off,
        "recipe.generate",
        { date: "2026-11-21", slotKey: "dinner", count: 2, reason: "x" },
        admin.householdId,
      );
      expect(r.status).toBe("failed");
      expect(JSON.stringify(r.error)).toMatch(/credential|disabled/i);
      // Plan generation in auto mode reports the unavailable generation as an event and still plans.
      await applyOps(admin, [{ kind: "weights.set", payload: { aiGeneration: "auto" } }]).catch(
        () => undefined,
      );
      const plan = await runKind(
        off,
        "plan.generate",
        { dates: ["2026-11-24"], seed: 5 },
        admin.householdId,
        admin.userId,
      );
      expect(plan.status, JSON.stringify(plan.error)).toBe("succeeded");
      measure("G2", "ai-unavailable", {
        recipeStatus: r.status,
        planStatus: plan.status,
        aiUnavailableEvents: plan.events.filter((e) => e.type === "ai_unavailable").length,
      });
    } finally {
      await off.close();
    }
    const { model, calls } = recordedModel([message(validBatch)]);
    const limited = await worker(model, { aiRecipeDailyLimit: 1 });
    try {
      const r = await runKind(
        limited,
        "recipe.generate",
        { date: "2026-11-22", slotKey: "dinner", count: 3, reason: "x" },
        admin.householdId,
      );
      measure("G2", "ai-limit", { status: r.status, calls: calls() });
      expect(r.status).toBe("failed");
      expect(JSON.stringify(r.error)).toMatch(/daily AI recipe limit/);
      expect(calls()).toBe(0);
    } finally {
      await limited.close();
    }
  }, 180_000);
});

describe("graph, insights, substitution and purge jobs", () => {
  it("jobs: kg.sync after a household dish change set puts the dish into the graph; kg.nightly recomputes the library", async () => {
    const rt = await worker(null);
    try {
      // The worker's start-up sync puts the catalogue and the seed library into the graph.
      const queued = await syncCatalogueGraph(rt);
      expect(queued).toHaveLength(2);
      const startup = await rt.db.execute<{ payload: Json }>(
        sql`SELECT payload FROM job WHERE id IN (${sql.join(
          queued.map((q) => sql`${q}`),
          sql`, `,
        )})`,
      );
      for (const row of startup.rows) {
        const sync = await runKind(rt, "kg.sync", row.payload, null);
        expect(sync.status, JSON.stringify(sync.error)).toBe("succeeded");
      }
      const [edges] = await app.rt.db
        .execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM kg_edge WHERE type = 'SUBSTITUTES_FOR'`,
        )
        .then((r) => r.rows);
      expect(edges?.n ?? 0).toBeGreaterThan(0);
      const [aiDish] = await aiDishes(admin.householdId);
      if (aiDish === undefined) throw new Error("no ai dish");
      const [cs] = await app.rt.db
        .select({ id: changeSet.id })
        .from(changeSet)
        .where(eq(changeSet.householdId, admin.householdId))
        .orderBy(desc(changeSet.appliedAt))
        .limit(1);
      const sync = await runKind(
        rt,
        "kg.sync",
        { request: { kind: "dish", householdId: admin.householdId, dishIds: [aiDish.id] } },
        admin.householdId,
      );
      const [node] = await app.rt.db
        .execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM kg_node WHERE type = 'Dish' AND key = ${aiDish.id}`,
        )
        .then((r) => r.rows);
      const fromSet = await runKind(
        rt,
        "kg.sync",
        { changeSetId: cs?.id ?? "" },
        admin.householdId,
      );
      const nightly = await runKind(rt, "kg.nightly", {}, null);
      measure("G2", "kg", {
        sync: sync.status,
        dishNodes: node?.n,
        fromChangeSet: fromSet.status,
        nightly: nightly.status,
      });
      expect(sync.status, JSON.stringify(sync.error)).toBe("succeeded");
      expect(node?.n).toBe(1);
      expect(fromSet.status, JSON.stringify(fromSet.error)).toBe("succeeded");
      expect(nightly.status, JSON.stringify(nightly.error)).toBe("succeeded");
    } finally {
      await rt.close();
    }
  }, 180_000);

  it("jobs: insights.run stores the digest as the job result and reports synthesis as unavailable without a model", async () => {
    const rt = await worker(null);
    try {
      const r = await runKind(rt, "insights.run", { trigger: "on_demand" }, admin.householdId);
      const result = r.result as {
        runAt?: string;
        synthesis?: { status?: string; reason?: string };
      } | null;
      measure("G2", "insights", { status: r.status, synthesis: result?.synthesis ?? null });
      expect(r.status, JSON.stringify(r.error)).toBe("succeeded");
      expect(result?.runAt).toBeTruthy();
      expect(JSON.stringify(result?.synthesis ?? {})).toMatch(/unavailable|disabled|credential/i);
    } finally {
      await rt.close();
    }
  }, 120_000);

  it("jobs: plates.substitute replaces an unavailable ingredient in future meals with a graph substitute outside the household's exclusions", async () => {
    const rt = await worker(null);
    try {
      await generatePlan(
        app.rt.db,
        { householdId: admin.householdId, userId: admin.userId, role: "admin" },
        {
          dates: ["2026-11-25", "2026-11-26"],
          seed: 7,
          by: { actor: "user", source: "ui" },
        },
      );
      // The most used ingredient of those days that has a catalogue substitute.
      const used = await app.rt.db.execute<{ id: string; slug: string; n: number }>(
        sql`SELECT i.id, i.slug, count(*)::int AS n FROM plan_meal pm JOIN plan_day pd ON pd.id = pm.plan_day_id
            JOIN plate p ON p.plan_meal_id = pm.id JOIN plate_item pi ON pi.plate_id = p.id
            JOIN variant_ingredient vi ON vi.variant_id = pi.variant_id JOIN ingredient i ON i.id = vi.ingredient_id
            WHERE pd.household_id = ${admin.householdId} AND pd.date >= '2026-11-25'
              AND EXISTS (SELECT 1 FROM kg_edge e JOIN kg_node s ON s.id = e.src_id WHERE e.type = 'SUBSTITUTES_FOR' AND s.key = i.id::text)
            GROUP BY i.id, i.slug ORDER BY n DESC, i.slug LIMIT 1`,
      );
      const target = used.rows[0];
      if (target === undefined) throw new Error("no planned ingredient has a substitute");
      const r = await runKind(
        rt,
        "plates.substitute",
        { date: "2026-11-25", ingredientId: target.id },
        admin.householdId,
      );
      const result = r.result as {
        changeSetId?: string | null;
        substituteId?: string | null;
      } | null;
      const still = await app.rt.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM plan_meal pm JOIN plan_day pd ON pd.id = pm.plan_day_id
            JOIN plate p ON p.plan_meal_id = pm.id JOIN plate_item pi ON pi.plate_id = p.id
            JOIN variant_ingredient vi ON vi.variant_id = pi.variant_id
            WHERE pd.household_id = ${admin.householdId} AND pd.date >= '2026-11-25' AND vi.ingredient_id = ${target.id}`,
      );
      const excluded = await app.rt.db
        .select()
        .from(exclusion)
        .where(eq(exclusion.householdId, admin.householdId));
      measure("G2", "substitute", {
        status: r.status,
        ingredient: target.slug,
        remaining: still.rows[0]?.n,
        changeSet: result?.changeSetId ?? null,
      });
      expect(r.status, JSON.stringify(r.error)).toBe("succeeded");
      expect(result?.changeSetId).toBeTruthy();
      expect(still.rows[0]?.n).toBe(0);
      expect(excluded.every((e) => e.key !== result?.substituteId)).toBe(true);
    } finally {
      await rt.close();
    }
  }, 240_000);

  it("jobs: household.purge deletes a household whose grace has passed, and nothing of another household", async () => {
    const doomed = await signupAdmin("Doomed");
    await addMembers(doomed);
    const past = new Date(Date.now() - 15 * 86_400_000);
    await app.rt.db
      .update(household)
      .set({
        deletionRequestedAt: past,
        deletionRequestedByUserId: doomed.userId,
        deletionConfirmedAt: past,
        deletionConfirmedByUserId: doomed.userId,
      })
      .where(eq(household.id, doomed.householdId));
    const membersBefore = await app.rt.db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.householdId, admin.householdId));
    const rt = await worker(null);
    try {
      const r = await runKind(rt, "household.purge", { trigger: "daily" }, null);
      const [gone] = await app.rt.db
        .select({ id: household.id })
        .from(household)
        .where(eq(household.id, doomed.householdId));
      const membersAfter = await app.rt.db
        .select({ id: member.id })
        .from(member)
        .where(eq(member.householdId, admin.householdId));
      const signIn = await callJson(c.me, {}, doomed);
      measure("G2", "purge", {
        status: r.status,
        purged: (r.result as { purged?: string[] } | null)?.purged ?? [],
        householdGone: gone === undefined,
        otherMembers: membersAfter.length === membersBefore.length,
      });
      expect(r.status, JSON.stringify(r.error)).toBe("succeeded");
      expect(gone).toBeUndefined();
      expect(membersAfter.length).toBe(membersBefore.length);
      expect(signIn.status).toBe(401);
    } finally {
      await rt.close();
    }
  }, 120_000);
});

describe("runner, scheduler and queue semantics", () => {
  it("jobs: an idempotent job kind that fails once is retried in the run and succeeds; other kinds fail at once", async () => {
    const rt = await worker(null);
    try {
      let calls = 0;
      const flaky = () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("transient"));
        return Promise.resolve({ ok: true });
      };
      const retried = await createJob(rt.db, { kind: "kg.sync", householdId: null, payload: {} });
      await runJob(rt, retried.id, flaky);
      const once = await createJob(rt.db, {
        kind: "plan.generate",
        householdId: admin.householdId,
        payload: {},
      });
      let planCalls = 0;
      await runJob(rt, once.id, () => {
        planCalls += 1;
        return Promise.reject(new Error("no"));
      });
      const types = async (id: string) =>
        (
          await rt.db.execute<{ type: string }>(
            sql`SELECT type FROM job_event WHERE job_id = ${id} ORDER BY seq`,
          )
        ).rows.map((r) => r.type);
      const [a1, b1] = [await types(retried.id), await types(once.id)];
      measure("G2", "retry", { retriedEvents: a1, onceEvents: b1, calls, planCalls });
      expect(a1).toEqual(["started", "retrying", "done"]);
      expect(calls).toBe(2);
      expect(b1).toEqual(["started", "failed"]);
      expect(planCalls).toBe(1);
    } finally {
      await rt.close();
    }
  }, 60_000);

  it("jobs: a job left running by a lost worker is failed by the scheduler tick with a terminal event", async () => {
    const rt = await worker(null);
    try {
      const j = await createJob(rt.db, {
        kind: "plan.generate",
        householdId: admin.householdId,
        payload: {},
      });
      await claimJob(rt.db, j.id, new Date(Date.now() - 3 * 3600_000));
      const fresh = await createJob(rt.db, {
        kind: "plan.generate",
        householdId: admin.householdId,
        payload: {},
      });
      await claimJob(rt.db, fresh.id);
      const r = await tick(rt, new Date());
      const [row] = await rt.db
        .execute<{ status: string }>(sql`SELECT status FROM job WHERE id = ${j.id}`)
        .then((x) => x.rows);
      const [freshRow] = await rt.db
        .execute<{ status: string }>(sql`SELECT status FROM job WHERE id = ${fresh.id}`)
        .then((x) => x.rows);
      const events = await rt.db.execute<{ type: string }>(
        sql`SELECT type FROM job_event WHERE job_id = ${j.id} ORDER BY seq`,
      );
      measure("G2", "reaper", {
        reaped: r.reaped.includes(j.id),
        status: row?.status,
        freshStatus: freshRow?.status,
      });
      expect(r.reaped).toContain(j.id);
      expect(row?.status).toBe("failed");
      expect(events.rows.at(-1)?.type).toBe("failed");
      expect(freshRow?.status).toBe("running");
      await rt.db.execute(sql`UPDATE job SET status = 'cancelled' WHERE id = ${fresh.id}`);
    } finally {
      await rt.close();
    }
  }, 60_000);

  it("jobs: the scheduler queues each daily job once per window, and one household's invalid time zone does not stop the others", async () => {
    const bad = await signupAdmin("Bad zone");
    await app.rt.db
      .update(household)
      .set({ timezone: "Foo/Bar" })
      .where(eq(household.id, bad.householdId));
    await app.rt.db
      .update(household)
      .set({ timezone: "Asia/Dubai", insightFrequency: "nightly" })
      .where(eq(household.id, admin.householdId));
    const rt = await worker(null);
    try {
      // 01:20 UTC = 05:20 in Dubai: kg.nightly (from 01:00 UTC) and Dubai's insights (02:00–06:00).
      const at = new Date("2030-03-04T01:20:00Z");
      const first = await tick(rt, at);
      const second = await tick(rt, new Date(at.getTime() + 60_000));
      const kinds = async (ids: string[]) =>
        ids.length === 0
          ? []
          : (
              await rt.db.execute<{ kind: string; household_id: string | null }>(
                sql`SELECT kind, household_id FROM job WHERE id IN (${sql.join(
                  ids.map((i) => sql`${i}`),
                  sql`, `,
                )})`,
              )
            ).rows;
      const q1 = await kinds(first.enqueued);
      measure("G2", "scheduler", {
        firstKinds: q1.map((k) => k.kind),
        secondEnqueued: second.enqueued.length,
        errors: first.errors.length,
      });
      expect(q1.some((k) => k.kind === "kg.nightly")).toBe(true);
      expect(
        q1.some((k) => k.kind === "insights.run" && k.household_id === admin.householdId),
      ).toBe(true);
      expect(first.errors.some((e) => e.startsWith(bad.householdId))).toBe(true);
      expect(second.enqueued).toEqual([]);
    } finally {
      await rt.close();
    }
  }, 60_000);

  it("jobs: the daily AI dish limit counts every generation requested today, revisions included, and an undo does not reset it", async () => {
    const used = await aiDishesToday(
      app.rt.db,
      { householdId: admin.householdId, userId: null, role: "system" },
      "Asia/Dubai",
    );
    const [addSet] = await app.rt.db
      .select({ id: changeSet.id })
      .from(changeSet)
      .where(
        and(
          eq(changeSet.householdId, admin.householdId),
          sql`${changeSet.summary} like 'Add % AI recipe%'`,
        ),
      )
      .limit(1);
    if (addSet !== undefined)
      await callJson(c.changeSetsUndo, { params: { id: addSet.id } }, admin);
    const afterUndo = await aiDishesToday(
      app.rt.db,
      { householdId: admin.householdId, userId: null, role: "system" },
      "Asia/Dubai",
    );
    const { model, calls } = recordedModel([message(validBatch)]);
    const rt = await worker(model, { aiRecipeDailyLimit: used });
    try {
      const r = await runKind(
        rt,
        "recipe.revise",
        {
          dishId: (await aiDishes(admin.householdId))[0]?.id ?? "",
          variantId: null,
          notes: ["bland"],
        },
        admin.householdId,
      );
      measure("G2", "ai-limit-counting", {
        used,
        afterUndo,
        reviseStatus: r.status,
        calls: calls(),
      });
      // 3 dishes from recipe.generate plus 1 per revision.
      expect(used).toBeGreaterThanOrEqual(4);
      expect(afterUndo).toBe(used);
      expect(r.status).toBe("failed");
      expect(calls()).toBe(0);
    } finally {
      await rt.close();
    }
  }, 60_000);

  it("jobs: a job row is sent to its queue once while outstanding, and again after its pg-boss job finished (a redo)", async () => {
    const rt = await worker(null);
    try {
      // A queue of its own, with the job queues' options (no other job is fetched from it).
      const queue = "test.send-semantics";
      await rt.boss.createQueue(queue, QUEUE_OPTIONS);
      const id = newId();
      const first = await rt.boss.send(queue, { jobId: id }, sendOptions(id));
      const duplicate = await rt.boss.send(queue, { jobId: id }, sendOptions(id));
      const [fetched] = await rt.boss.fetch<{ jobId: string }>(queue);
      if (fetched !== undefined) await rt.boss.complete(queue, fetched.id);
      const redo = await rt.boss.send(queue, { jobId: id }, sendOptions(id));
      measure("G2", "send-semantics", {
        first: first !== null,
        duplicate: duplicate !== null,
        redo: redo !== null,
      });
      expect(first).not.toBeNull();
      expect(duplicate).toBeNull();
      expect(fetched?.data.jobId).toBe(id);
      expect(redo).not.toBeNull();
    } finally {
      await rt.close();
    }
  }, 60_000);
});
