// Leaf 1.3.7 G3 (REC-6, R-82; SPEC-Q-2): the admin-initiated recipe job past queueing. An agent
// turn (stubbed, as in conversations-messages.int.test.ts) calls `create_recipe` for a named day
// and slot; the real worker runs `recipe.draft` against a local recorded Messages API server over
// ANTHROPIC_BASE_URL (no credential, no request leaves this machine), so the production generator,
// validation and solver run unchanged. The draft lives in the job result and the chat's recipe
// card, not in the database: no dish row is written until Save applies the card's `dish.create`
// ops through POST /change-sets, which makes the dish active. Negative control: a recorded response
// that fails the DishBatch schema fails the job, with no card and no dish row.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import type { AgentModel, AgentRequest, AgentStreamEvent } from "@mealplanner/ai/agent";
import { component, dish, ingredient, job, variant } from "@mealplanner/db/schema";
import { conversationRows, useAgentModel } from "../../lib/server/agent";
import {
  recordedModelEnv,
  startRecordedModel,
  type Block,
  type RecordedModel,
  type Recording,
} from "../node/recorded-model";
import { startWorker, type Child } from "../node/support";
import { call, callJson, startTestApp, type Caller, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { addMembers, ok, signupAdmin } from "./support/world";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const FIXTURES = join(ROOT, "packages/ai/test/recipes/fixtures");
/** A Monday: both members attend dinner (sign-up's default slots). */
const DATE = "2026-11-02";
const SLOT = "dinner";
const REQUEST = "a lemony chicken dinner with rice";
const BAD_REQUEST = "a prawn pasta dinner";

// The recorded model responses -------------------------------------------------------------------

type Batch = { dishes: { name: string; components: { name: string }[] }[]; newIngredients: [] };

/** One dish of 1.3.1's valid recorded batch (it passes REC-5 for a targeted adult and a child). */
function validBatch(): Batch {
  const batch = JSON.parse(readFileSync(join(FIXTURES, "valid-batch.json"), "utf8")) as Batch;
  const first = batch.dishes[0];
  if (first === undefined) throw new Error("valid-batch.json has no dish");
  return { dishes: [first], newIngredients: [] };
}

/** The text block of 1.3.1's schema-mismatch wire response (a dish without its components). */
function schemaFailingText(): string {
  const wire = JSON.parse(
    readFileSync(join(FIXTURES, "responses/schema-mismatch.json"), "utf8"),
  ) as { body: { content: { type: string; text?: string }[] } };
  const text = wire.body.content.find((b) => b.type === "text")?.text;
  if (text === undefined) throw new Error("schema-mismatch.json has no text block");
  return text;
}

function structured(name: string, request: string, text: string): Recording {
  const content: Block[] = [{ type: "text", text }];
  return {
    name,
    expect: { stream: false, lastUserText: [request] },
    response: { content, stop_reason: "end_turn" },
  };
}

// A scripted agent turn --------------------------------------------------------------------------

type BetaMessage = Awaited<ReturnType<AgentModel["stream"]>>;
let seq = 0;

function msg(content: unknown[], stop: "tool_use" | "end_turn"): BetaMessage {
  seq += 1;
  return {
    id: `msg_${String(seq)}`,
    type: "message",
    role: "assistant",
    model: "claude-stub",
    content: content as BetaMessage["content"],
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as BetaMessage;
}

class Stub implements AgentModel {
  readonly model = "claude-stub";
  readonly effort = "high" as const;
  constructor(private readonly steps: BetaMessage[]) {}
  stream(_req: AgentRequest, onEvent: (e: AgentStreamEvent) => void): Promise<BetaMessage> {
    const m = this.steps.shift();
    if (m === undefined) return Promise.reject(new Error("stub ran out of steps"));
    m.content.forEach((block, index) => {
      onEvent({ type: "content_block_start", index, content_block: block });
    });
    return Promise.resolve(m);
  }
}

/** create_recipe for the day and slot, then a closing line. */
function createRecipeTurn(request: string): Stub {
  seq += 1;
  return new Stub([
    msg(
      [
        {
          type: "tool_use",
          id: `toolu_${String(seq)}`,
          name: "create_recipe",
          input: { request, slot: SLOT, date: DATE, count: 1 },
        },
      ],
      "tool_use",
    ),
    msg([{ type: "text", text: "Started.", citations: null }], "end_turn"),
  ]);
}

// Harness ----------------------------------------------------------------------------------------

let db: TestDatabase;
let app: TestApp;
let admin: Caller;
let householdId: string;
/** The targeted attendees of the slot on DATE (addMembers: Sara targeted, Zayd not). */
let targetedNames: string[];
let model: RecordedModel;
let worker: Child;

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  const signed = await signupAdmin("Draft household");
  admin = signed;
  householdId = signed.householdId;
  await addMembers(admin);
  targetedNames = ["Sara"];
  model = await startRecordedModel([
    structured("recipe.draft: one valid dish", REQUEST, JSON.stringify(validBatch())),
  ]);
  worker = await startWorker(db.url, recordedModelEnv(model));
}, 300_000);

afterAll(async () => {
  useAgentModel(undefined);
  await worker.stop();
  await model.close();
  await app.close();
  await db.drop();
}, 60_000);

async function draftJob(request: string): Promise<{ conversationId: string; jobId: string }> {
  const conv = ok<{ id: string }>(
    await callJson(c.conversationsCreate, { body: { title: "Recipes" } }, admin),
    "conversation",
  );
  useAgentModel(createRecipeTurn(request));
  const res = await call(
    c.conversationsSend,
    { params: { id: conv.id }, body: { text: `New recipe please: ${request}` } },
    admin,
  );
  const body = await res.text();
  expect(res.status).toBe(200);
  const done = body
    .split("\n\n")
    .map((f) => /^data: (.*)$/m.exec(f)?.[1])
    .filter((d): d is string => d !== undefined)
    .map((d) => JSON.parse(d) as { type: string; cards?: { type: string; jobId: string }[] })
    .find((e) => e.type === "tool_done");
  const card = done?.cards?.[0];
  if (card?.type !== "job_progress") throw new Error(`no job card:\n${body.slice(0, 2000)}`);
  return { conversationId: conv.id, jobId: card.jobId };
}

async function finished(jobId: string): Promise<typeof job.$inferSelect> {
  for (let i = 0; i < 1200; i += 1) {
    const [row] = await app.rt.db.select().from(job).where(eq(job.id, jobId));
    if (row !== undefined && (row.status === "succeeded" || row.status === "failed")) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`job ${jobId} did not finish:\n${worker.output().slice(-3000)}`);
}

/** The cards of the completion event the worker posts into the conversation. */
async function completionCards(conversationId: string): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < 200; i += 1) {
    const rows = (await conversationRows(app.rt, householdId, conversationId)).filter(
      (r) => r.role === "event",
    );
    const content = rows[0]?.content as { cards?: Record<string, unknown>[] } | undefined;
    if (content?.cards !== undefined && content.cards.length > 0) return content.cards;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no completion event:\n${worker.output().slice(-3000)}`);
}

async function householdDishCount(): Promise<number> {
  const [row] = await app.rt.db
    .select({ n: count() })
    .from(dish)
    .where(eq(dish.householdId, householdId));
  return row?.n ?? 0;
}

async function householdIngredientCount(): Promise<number> {
  const [row] = await app.rt.db
    .select({ n: count() })
    .from(ingredient)
    .where(eq(ingredient.createdByHouseholdId, householdId));
  return row?.n ?? 0;
}

interface DraftPlate {
  label: string;
  member: string;
  status: string;
  explain: string[];
}
interface DraftDish {
  summary: string;
  ops: { kind: string; payload: Record<string, unknown> }[];
  dish: { name: string; components: { name: string; variants: { label: string }[] }[] };
  plates: DraftPlate[];
}

describe("REC-6: recipe.draft with a recorded model response", () => {
  let dishesBefore: number;
  let ingredientsBefore: number;
  let row: typeof job.$inferSelect;
  let card: Record<string, unknown>;
  let cards: Record<string, unknown>[];

  beforeAll(async () => {
    dishesBefore = await householdDishCount();
    ingredientsBefore = await householdIngredientCount();
    const { conversationId, jobId } = await draftJob(REQUEST);
    row = await finished(jobId);
    cards = await completionCards(conversationId);
    card = cards.find((x) => x.type === "recipe") ?? {};
  }, 300_000);

  it("G3 the job succeeds on the recorded response, which answered the one generation request", () => {
    expect(row.kind).toBe("recipe.draft");
    expect(row.status, JSON.stringify(row.error)).toBe("succeeded");
    expect(model.failures).toEqual([]);
    expect(model.answered.get("recipe.draft: one valid dish")).toBe(1);
    expect(model.remaining()).toEqual([]);
    expect(row.payload).toMatchObject({ request: REQUEST, slot: SLOT, date: DATE, count: 1 });
  });

  it("G3 the draft is not saved: no dish or ingredient row is written by the job", async () => {
    expect(await householdDishCount()).toBe(dishesBefore);
    expect(await householdIngredientCount()).toBe(ingredientsBefore);
  });

  it("G3 the recipe card carries the draft with example plates for the requested day and slot", () => {
    expect(cards[0]).toMatchObject({
      type: "job_progress",
      kind: "recipe.draft",
      status: "succeeded",
    });
    expect(card.type).toBe("recipe");
    expect(card.use).toEqual({ date: DATE, slotKey: SLOT, slotLabel: "Dinner" });
    const dishes = card.dishes as DraftDish[];
    expect(dishes).toHaveLength(1);
    const draft = dishes[0];
    if (draft === undefined) throw new Error("no draft");
    expect(draft.dish.name).toBe(validBatch().dishes[0]?.name);
    // The example plates are the REC-5 step-7 solves for the slot's targeted attendees on the
    // requested day (SPEC-Q-6): named (the generator's pseudonyms mapped back), each within its
    // target's tolerance or a flexible miss, with the solver's explanation.
    expect(draft.plates.map((p) => p.member).sort()).toEqual(targetedNames);
    for (const plate of draft.plates) {
      expect(["in_tolerance", "flexible_miss"]).toContain(plate.status);
      expect(plate.explain.length).toBeGreaterThan(0);
    }
    const create = draft.ops.find((o) => o.kind === "dish.create");
    expect(create?.payload).toMatchObject({ name: draft.dish.name, status: "active" });
  });

  it("G3 Save applies the card's ops through POST /change-sets and the dish is active", async () => {
    const draft = (card.dishes as DraftDish[])[0];
    if (draft === undefined) throw new Error("no draft");
    const saved = ok<{ changeSetId: string }>(
      await callJson(
        c.changeSetsApply,
        { body: { summary: draft.summary, ops: draft.ops } },
        admin,
      ),
      "save",
    );
    expect(saved.changeSetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await householdDishCount()).toBe(dishesBefore + 1);
    const [stored] = await app.rt.db
      .select()
      .from(dish)
      .where(and(eq(dish.householdId, householdId), eq(dish.name, draft.dish.name)));
    expect(stored?.status).toBe("active");
    expect(stored?.source).toBe("ai");
    const comps = await app.rt.db
      .select({ name: component.name, variants: count(variant.id) })
      .from(component)
      .leftJoin(variant, eq(variant.componentId, component.id))
      .where(eq(component.dishId, stored?.id ?? ""))
      .groupBy(component.name);
    expect(comps.map((x) => x.name).sort()).toEqual(
      draft.dish.components.map((x) => x.name).sort(),
    );
    for (const comp of draft.dish.components)
      expect(comps.find((x) => x.name === comp.name)?.variants).toBe(comp.variants.length);
    // The saved dish is on the recipe list the planner and the admin see.
    const list = ok<{ dishes: { id: string; status: string }[] }>(
      await callJson(c.dishesList, { query: { status: "active" } }, admin),
      "dishes",
    );
    expect(list.dishes.some((d) => d.id === stored?.id)).toBe(true);
  });
});

describe("REC-6 negative control: a schema-failing recorded response", () => {
  it("G3 fails the job with no recipe card and saves nothing", async () => {
    model.add([structured("recipe.draft: schema mismatch", BAD_REQUEST, schemaFailingText())]);
    const dishesBefore = await householdDishCount();
    const ingredientsBefore = await householdIngredientCount();
    const { conversationId, jobId } = await draftJob(BAD_REQUEST);
    const row = await finished(jobId);
    expect(row.status).toBe("failed");
    expect(model.answered.get("recipe.draft: schema mismatch")).toBe(1);
    expect(model.failures).toEqual([]);
    const cards = await completionCards(conversationId);
    expect(cards).toEqual([
      expect.objectContaining({ type: "job_progress", kind: "recipe.draft", status: "failed" }),
    ]);
    expect(await householdDishCount()).toBe(dishesBefore);
    expect(await householdIngredientCount()).toBe(ingredientsBefore);
  }, 300_000);
});
