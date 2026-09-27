// POST /api/v1/conversations/{id}/messages (leaf 1.3.5): the real route, PostgreSQL 16 and a
// scripted stub model (no credential exists here; the live model is G4's handoff).
// - G1 end to end: parallel tool calls answered in one user message, SSE events on the contract.
// - G2 (AGT-5): each protected op sent through apply_change becomes a pending agent proposal and
//   writes no change set, because the change-set service refuses it; the same op through a UI
//   change set applies (negative control: the check fails on the bypass).
// - G3 (AGT-8): across turns, every request replays the stored rows byte-for-byte; an edited row
//   breaks the check (negative control).
// - SPEC-Q-11 (R-46): an aborted turn releases its lock; a concurrent turn gets 409.
import { and, count, eq } from "drizzle-orm";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { ChatStreamEventDto } from "@mealplanner/api-contract/contract";
import {
  AgentAbortedError,
  replay,
  type AgentModel,
  type AgentRequest,
  type AgentStreamEvent,
} from "@mealplanner/ai/agent";
import {
  aiGeneration,
  changeSet,
  chatMessage,
  conversation,
  exclusion,
  job,
  jobEvent,
  member,
  newId,
  proposal,
  review,
} from "@mealplanner/db/schema";
import { applyChangeSet } from "@mealplanner/db/services/changes";
import { conversationRows, useAgentModel } from "../../lib/server/agent";
import { call, callJson, startTestApp, type Caller, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { measure } from "./support/measure";
import { startWorkerProcess, type WorkerProcess } from "./support/worker";
import { applyOps, buildWorld, ok, PLAN_DATE, type World } from "./support/world";

// A scripted stub model ---------------------------------------------------------------------------

// The SDK's types, through the agent package (apps/web does not depend on the SDK itself).
type BetaMessage = Awaited<ReturnType<AgentModel["stream"]>>;
type BetaMessageParam = AgentRequest["messages"][number];
type BetaStopReason = NonNullable<BetaMessage["stop_reason"]>;

type Step =
  BetaMessage | Error | ((req: AgentRequest, signal: AbortSignal) => Promise<BetaMessage>);
let seq = 0;

function msg(content: unknown[], stop: BetaStopReason): BetaMessage {
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

function tool(
  name: string,
  input: unknown,
): { type: "tool_use"; id: string; name: string; input: unknown } {
  seq += 1;
  return { type: "tool_use", id: `toolu_${String(seq)}`, name, input };
}

const say = (text: string) => ({ type: "text", text, citations: null });

class Stub implements AgentModel {
  readonly model = "claude-stub";
  readonly effort = "high" as const;
  readonly wire: string[] = [];
  readonly requests: AgentRequest[] = [];
  constructor(private readonly steps: Step[]) {}
  async stream(req: AgentRequest, onEvent: (e: AgentStreamEvent) => void, signal: AbortSignal) {
    this.requests.push(req);
    this.wire.push(JSON.stringify(req.messages));
    const step = this.steps.shift();
    if (step === undefined) throw new Error("stub ran out of steps");
    const m = typeof step === "function" ? await step(req, signal) : step;
    if (m instanceof Error) throw m;
    m.content.forEach((block, index) => {
      onEvent({ type: "content_block_start", index, content_block: block });
    });
    return m;
  }
}

// Helpers -----------------------------------------------------------------------------------------

let db: TestDatabase;
let w: World;
let rt: TestApp["rt"];
let app: TestApp;

interface Sse {
  status: number;
  events: { event: string; data: unknown }[];
  text: string;
}

async function send(
  caller: Caller,
  conversationId: string,
  text: string,
  model: AgentModel | null,
): Promise<Sse> {
  useAgentModel(model);
  const res = await call(
    c.conversationsSend,
    { params: { id: conversationId }, body: { text } },
    caller,
  );
  const body = await res.text();
  const events = body
    .split("\n\n")
    .filter((f) => f.includes("data:"))
    .map((f) => {
      const event = /^event: (.*)$/m.exec(f)?.[1] ?? "";
      const data = JSON.parse(/^data: (.*)$/m.exec(f)?.[1] ?? "null") as unknown;
      return { event, data };
    });
  return { status: res.status, events, text: body };
}

async function newConversation(caller: Caller): Promise<string> {
  const r = await callJson(c.conversationsCreate, { body: { title: "Agent test" } }, caller);
  return ok<{ id: string }>(r, "conversation").id;
}

function userMessageResults(
  m: BetaMessageParam | undefined,
): { tool_use_id: string; is_error?: boolean; content: string }[] {
  if (m === undefined || typeof m.content === "string") return [];
  return m.content.filter((b) => b.type === "tool_result") as never;
}

/** JSON with sorted keys (jsonb stores objects in its own key order). */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(value));
}

async function changeSetCount(): Promise<number> {
  const [row] = await rt.db
    .select({ n: count() })
    .from(changeSet)
    .where(eq(changeSet.householdId, w.a.id));
  return row?.n ?? 0;
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  rt = app.rt;
  w = await buildWorld(app);
}, 300_000);

afterAll(async () => {
  useAgentModel(undefined);
  await app.close();
  await db.drop();
});

// G1 ----------------------------------------------------------------------------------------------

describe("G1 end to end", () => {
  it("G1 parallel tool calls through the route: results in one user message, events on the contract, audit rows", async () => {
    const id = await newConversation(w.a.admin);
    const calls = [tool("get_household", {}), tool("get_plan", { from: PLAN_DATE, to: PLAN_DATE })];
    const stub = new Stub([
      msg([say("Checking."), ...calls], "tool_use"),
      msg([say("All set.")], "end_turn"),
    ]);
    const r = await send(w.a.admin, id, "What is planned?", stub);
    expect(r.status).toBe(200);
    for (const e of r.events) expect(ChatStreamEventDto.safeParse(e.data).success).toBe(true);
    expect(r.events.at(-1)?.data).toEqual({ type: "done", stopReason: "end_turn", modelCalls: 2 });
    const last = stub.requests[1]?.messages.at(-1);
    const results = userMessageResults(last);
    expect(results.map((x) => x.tool_use_id)).toEqual(calls.map((x) => x.id));
    expect(results.every((x) => x.is_error !== true)).toBe(true);
    const plan = JSON.parse(results[1]?.content ?? "{}") as { days: { date: string }[] };
    expect(plan.days.map((d) => d.date)).toEqual([PLAN_DATE]);
    const rows = await conversationRows(rt, w.a.id, id);
    expect(rows.map((x) => x.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    const audit = await rt.db
      .select()
      .from(aiGeneration)
      .where(and(eq(aiGeneration.householdId, w.a.id), eq(aiGeneration.purpose, "chat")));
    expect(audit.filter((a) => JSON.stringify(a.requestSummary).includes(id))).toHaveLength(2);
    measure("G1", "route-parallel", { events: r.events.length, rows: rows.length });
  });

  it("G1 invalid tool input through the route: is_error INVALID_JSON, nothing runs, the turn continues", async () => {
    const id = await newConversation(w.a.admin);
    const bad = tool("apply_change", { summary: "x", ops: "not an array" });
    const stub = new Stub([msg([bad], "tool_use"), msg([say("Sorry.")], "end_turn")]);
    const before = await changeSetCount();
    const r = await send(w.a.admin, id, "Change something", stub);
    expect(r.status).toBe(200);
    const results = userMessageResults(stub.requests[1]?.messages.at(-1));
    expect(results[0]?.is_error).toBe(true);
    expect(results[0]?.content).toContain("INVALID_JSON");
    expect(await changeSetCount()).toBe(before);
  });
});

// G2 ----------------------------------------------------------------------------------------------

describe("G2 protected ops become proposals (server-enforced)", () => {
  let allergyId: string;

  beforeAll(async () => {
    await applyOps(w.a.admin, [
      {
        kind: "exclusion.add",
        payload: {
          memberId: w.a.childId,
          kind: "ingredient",
          key: "sesame-seeds",
          reason: "allergy",
          hard: true,
        },
      },
      {
        kind: "tolerance.set",
        payload: {
          memberId: w.a.adultId,
          proteinG: 5,
          carbsG: 5,
          fatG: 2,
          kcal: 50,
          mode: "strict",
        },
      },
    ]);
    const [ex] = await rt.db
      .select()
      .from(exclusion)
      .where(
        and(
          eq(exclusion.householdId, w.a.id),
          eq(exclusion.memberId, w.a.childId),
          eq(exclusion.reason, "allergy"),
        ),
      );
    if (ex === undefined) throw new Error("no allergy exclusion");
    allergyId = ex.id;
    // A review of the household's own dish, so retiring it is protected.
    const rev = await callJson(
      c.reviewsCreate,
      {
        body: {
          targetType: "dish",
          targetId: w.a.ownDishId,
          rating: 4,
          tags: [],
          onBehalfOfMemberId: w.a.adultId,
        },
      },
      w.a.admin,
    );
    expect(rev.status).toBe(201);
  }, 60_000);

  const protectedOps = () => [
    {
      name: "removing an allergy exclusion",
      op: { kind: "exclusion.remove", payload: { exclusionId: allergyId } },
    },
    {
      name: "relaxing an allergy exclusion to a dislike",
      op: {
        kind: "exclusion.add",
        payload: {
          memberId: w.a.childId,
          kind: "ingredient",
          key: "sesame-seeds",
          reason: "dislike",
          hard: false,
        },
      },
    },
    {
      name: "loosening a tolerance",
      op: { kind: "tolerance.set", payload: { memberId: w.a.adultId, proteinG: 20 } },
    },
    {
      name: "archiving a member",
      op: { kind: "member.archive", payload: { memberId: w.a.childId } },
    },
    {
      name: "retiring a dish with reviews",
      op: { kind: "dish.retire", payload: { dishId: w.a.ownDishId } },
    },
    {
      name: "changing a role",
      op: { kind: "role.set", payload: { userId: w.a.member.userId, role: "kitchen" } },
    },
  ];

  /** The G2 outcome: one pending agent proposal with the ops, and no change set written. */
  function assertBecameProposal(o: {
    changeSetsBefore: number;
    changeSetsAfter: number;
    proposals: { origin: string; status: string; payload: unknown }[];
    op: unknown;
  }) {
    if (o.changeSetsAfter !== o.changeSetsBefore)
      throw new Error(
        `a change set was written (${String(o.changeSetsBefore)} → ${String(o.changeSetsAfter)})`,
      );
    const p = o.proposals[0];
    if (o.proposals.length !== 1 || p === undefined)
      throw new Error(`${String(o.proposals.length)} proposals`);
    if (p.origin !== "agent_chat" || p.status !== "pending")
      throw new Error(`proposal ${p.origin}/${p.status}`);
    if (canonical((p.payload as { ops: unknown }).ops) !== canonical([o.op]))
      throw new Error("proposal ops differ");
  }

  it("G2 every AGT-5 protected op sent through apply_change becomes a pending agent proposal", async () => {
    const seen: string[] = [];
    for (const { name, op } of protectedOps()) {
      const id = await newConversation(w.a.admin);
      const call1 = tool("apply_change", { summary: `Please: ${name}`, ops: [op] });
      const stub = new Stub([
        msg([call1], "tool_use"),
        msg([say("It needs your confirmation.")], "end_turn"),
      ]);
      const before = await changeSetCount();
      const r = await send(w.a.admin, id, `Please do this: ${name}`, stub);
      expect(r.status, name).toBe(200);
      const after = await changeSetCount();
      const rows = await rt.db
        .select()
        .from(proposal)
        .where(and(eq(proposal.householdId, w.a.id), eq(proposal.conversationId, id)));
      assertBecameProposal({
        changeSetsBefore: before,
        changeSetsAfter: after,
        proposals: rows,
        op,
      });
      const result = JSON.parse(
        userMessageResults(stub.requests[1]?.messages.at(-1))[0]?.content ?? "{}",
      ) as { status: string };
      expect(result.status, name).toBe("proposed");
      const assistant = (await conversationRows(rt, w.a.id, id)).find(
        (x) => x.role === "assistant",
      );
      expect(rows[0]?.messageId, name).toBe(assistant?.id);
      const card = r.events.find((e) => (e.data as { type: string }).type === "tool_done")
        ?.data as { cards: { type: string }[] };
      expect(card.cards[0]?.type, name).toBe("proposal");
      seen.push(name);
    }
    measure("G2", "protected", { kinds: seen.length, names: seen });
    expect(seen).toHaveLength(6);
  }, 120_000);

  it("G2 an unprotected op the admin asked for is applied as an agent change set", async () => {
    const id = await newConversation(w.a.admin);
    const stub = new Stub([
      msg(
        [
          tool("apply_change", {
            summary: "More appeal",
            ops: [{ kind: "weights.set", payload: { appeal: 0.7 } }],
          }),
        ],
        "tool_use",
      ),
      msg([say("Done.")], "end_turn"),
    ]);
    const before = await changeSetCount();
    await send(w.a.admin, id, "Make appeal 0.7", stub);
    expect(await changeSetCount()).toBe(before + 1);
    const latest = (
      await rt.db.select().from(changeSet).where(eq(changeSet.householdId, w.a.id))
    ).sort((a, b) => b.appliedAt.getTime() - a.appliedAt.getTime())[0];
    expect(latest?.source).toBe("agent_apply");
    expect(latest?.actor).toBe("agent");
  });

  it("G2 with 'assistant may apply' off, an unprotected op also becomes a proposal", async () => {
    await applyOps(w.a.admin, [{ kind: "household.update", payload: { agentMayApply: false } }]);
    try {
      const id = await newConversation(w.a.admin);
      // Not a weights change: the world already has a pending weights proposal (FBK-8 duplicate).
      const op = { kind: "member.update", payload: { memberId: w.a.childId, notes: "Loves rice" } };
      const stub = new Stub([
        msg([tool("apply_change", { summary: "Note for the child", ops: [op] })], "tool_use"),
        msg([say("ok")], "end_turn"),
      ]);
      const before = await changeSetCount();
      await send(w.a.admin, id, "Note that the child loves rice", stub);
      const rows = await rt.db
        .select()
        .from(proposal)
        .where(and(eq(proposal.householdId, w.a.id), eq(proposal.conversationId, id)));
      assertBecameProposal({
        changeSetsBefore: before,
        changeSetsAfter: await changeSetCount(),
        proposals: rows,
        op,
      });
    } finally {
      await applyOps(w.a.admin, [{ kind: "household.update", payload: { agentMayApply: true } }]);
    }
  });

  it("G2 negative control: the same protected op without the server's agent enforcement is applied, and the check fails", async () => {
    const op = { kind: "tolerance.set", payload: { memberId: w.a.adultId, proteinG: 25 } };
    const before = await changeSetCount();
    // The bypass: the op applied as a UI change set (no agent_apply enforcement).
    await applyChangeSet(
      rt.db,
      { householdId: w.a.id, userId: w.a.admin.userId, role: "admin" },
      {
        actor: "agent",
        source: "ui",
        summary: "bypass",
        ops: [op],
      },
    );
    expect(() => {
      assertBecameProposal({
        changeSetsBefore: before,
        changeSetsAfter: before + 1,
        proposals: [],
        op,
      });
    }).toThrow(/change set was written/);
    expect(await changeSetCount()).toBe(before + 1);
  });

  it("G2 an ingredient exclusion keyed by id is refused with the slug (R-36); access ops are refused", async () => {
    const id = await newConversation(w.a.admin);
    const byId = tool("apply_change", {
      summary: "No sesame for the child",
      ops: [
        {
          kind: "exclusion.add",
          payload: {
            memberId: w.a.childId,
            kind: "ingredient",
            key: w.a.ingredientId,
            reason: "dislike",
            hard: true,
          },
        },
      ],
    });
    const access = tool("apply_change", {
      summary: "Block",
      ops: [{ kind: "access.block", payload: { userId: w.a.member.userId } }],
    });
    const stub = new Stub([msg([byId, access], "tool_use"), msg([say("ok")], "end_turn")]);
    const before = await changeSetCount();
    await send(w.a.admin, id, "x", stub);
    const results = userMessageResults(stub.requests[1]?.messages.at(-1));
    expect(results.map((x) => x.is_error)).toEqual([true, true]);
    expect(results[0]?.content).toContain("slug");
    expect(results[1]?.content).toContain("People & access");
    expect(await changeSetCount()).toBe(before);
  });
});

// G3 ----------------------------------------------------------------------------------------------

/** Every request is the previous one plus appended messages, byte-for-byte (AGT-8). */
function assertReplayed(wire: readonly string[]): void {
  for (let i = 1; i < wire.length; i += 1) {
    const prev = wire[i - 1] ?? "";
    const next = JSON.parse(wire[i] ?? "[]") as unknown[];
    const prefix = JSON.stringify(next.slice(0, (JSON.parse(prev) as unknown[]).length));
    if (prefix !== prev)
      throw new Error(
        `request ${String(i)} is not an append-only extension of request ${String(i - 1)}`,
      );
  }
}

describe("G3 history is append-only and replayed verbatim", () => {
  it("G3 three turns: each request replays the stored rows byte-for-byte; GET returns the stored blocks", async () => {
    const id = await newConversation(w.a.admin);
    const thinking = { type: "thinking", thinking: "", signature: "c2lnbmF0dXJlLTE=" };
    const stub = new Stub([
      msg([thinking, say("Let me check."), tool("get_proposals", {})], "tool_use"),
      msg([say("One pending.")], "end_turn"),
      msg([thinking, say("Sure: "), tool("get_change_log", { limit: 3 })], "tool_use"),
      msg([say("Here are the last changes.")], "end_turn"),
      msg([say("Anytime.")], "end_turn"),
    ]);
    useAgentModel(stub);
    for (const text of ["Any proposals?", "What changed lately?", "Thanks"]) {
      const res = await call(c.conversationsSend, { params: { id }, body: { text } }, w.a.admin);
      expect(res.status).toBe(200);
      await res.text();
    }
    expect(stub.wire).toHaveLength(5);
    assertReplayed(stub.wire);
    const rows = await conversationRows(rt, w.a.id, id);
    // The next request would be exactly the replay of the stored rows; it extends the last one.
    const next = JSON.stringify(replay(rows));
    assertReplayed([...stub.wire, next]);
    // The stored assistant blocks are the response blocks (thinking signature kept).
    const firstAssistant = rows.find((x) => x.role === "assistant");
    expect(firstAssistant?.content).toEqual([
      thinking,
      say("Let me check."),
      expect.objectContaining({ type: "tool_use", name: "get_proposals" }),
    ]);
    const got = ok<{ messages: { id: string; content: unknown }[] }>(
      await callJson(c.conversationMessages, { params: { id } }, w.a.admin),
      "messages",
    );
    expect(got.messages.map((m) => JSON.stringify(m.content))).toEqual(
      rows.map((x) => JSON.stringify(x.content)),
    );
    measure("G3", "replay", { requests: stub.wire.length, rows: rows.length });
  });

  it("G3 negative control: an edited stored row no longer replays the bytes that were sent", async () => {
    const id = await newConversation(w.a.admin);
    const stub = new Stub([msg([say("Hello.")], "end_turn")]);
    await send(w.a.admin, id, "Hi", stub);
    const rows = await conversationRows(rt, w.a.id, id);
    const first = rows[0];
    if (first === undefined) throw new Error("no rows");
    await rt.db
      .update(chatMessage)
      .set({ content: [{ type: "text", text: "Hi (edited)" }] })
      .where(eq(chatMessage.id, first.id));
    const edited = JSON.stringify(replay(await conversationRows(rt, w.a.id, id)));
    expect(() => {
      assertReplayed([...stub.wire, edited]);
    }).toThrow(/not an append-only extension/);
  });
});

// Turn control ------------------------------------------------------------------------------------

describe("G1 turn control (SPEC-Q-11, ARC-6)", () => {
  it("G1 an aborted turn releases its lock: a concurrent POST gets 409, the next one succeeds", async () => {
    const id = await newConversation(w.a.admin);
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    const hang: Step = (_req, signal) =>
      new Promise<BetaMessage>((_resolve, reject) => {
        started();
        signal.addEventListener("abort", () => {
          reject(new AgentAbortedError());
        });
      });
    useAgentModel(new Stub([hang]));
    const res = await call(
      c.conversationsSend,
      { params: { id }, body: { text: "slow" } },
      w.a.admin,
    );
    const reader = res.body?.getReader();
    const reading = (async () => {
      if (reader === undefined) return;
      for (;;) {
        const chunk = await reader.read().catch(() => ({ done: true }));
        if (chunk.done) return;
      }
    })();
    await running;
    // While the turn runs, a second message to the same conversation is refused.
    const second = await send(w.a.admin, id, "again", new Stub([msg([say("x")], "end_turn")]));
    expect(second.status).toBe(409);
    // The client goes away mid-stream.
    await reader?.cancel();
    await reading;
    // The lock is released in finally: the next turn runs.
    let status = 0;
    for (let i = 0; i < 50 && status !== 200; i += 1) {
      const next = await send(w.a.admin, id, "after", new Stub([msg([say("Back.")], "end_turn")]));
      status = next.status;
      if (status !== 200) await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe(200);
    const rows = await conversationRows(rt, w.a.id, id);
    expect(rows.map((x) => x.role)).toEqual(["user", "user", "assistant"]);
  });

  it("G1 refusals before anything is stored: 503 without a model, 429 over the hourly limit, 404 and 403", async () => {
    const id = await newConversation(w.a.admin);
    const none = await send(w.a.admin, id, "hi", null);
    expect(none.status).toBe(503);
    expect(none.text).toContain("assistant_unavailable");
    const [n] = await rt.db
      .select({ n: count() })
      .from(chatMessage)
      .where(eq(chatMessage.conversationId, id));
    expect(n?.n).toBe(0);
    const saved = rt.config.chatTurnsPerHour;
    try {
      const [used] = await rt.db
        .select({ n: count() })
        .from(chatMessage)
        .where(and(eq(chatMessage.householdId, w.a.id), eq(chatMessage.role, "user")));
      rt.config.chatTurnsPerHour = used?.n ?? 0;
      const limited = await send(w.a.admin, id, "hi", new Stub([msg([say("x")], "end_turn")]));
      expect(limited.status).toBe(429);
    } finally {
      rt.config.chatTurnsPerHour = saved;
    }
    // Another admin's conversation reads as absent; members cannot chat.
    const foreign = await send(w.a.admin2, id, "hi", new Stub([msg([say("x")], "end_turn")]));
    expect(foreign.status).toBe(404);
    const member = await send(w.a.member, id, "hi", new Stub([msg([say("x")], "end_turn")]));
    expect(member.status).toBe(403);
    const archivedId = newId();
    await rt.db.insert(conversation).values({
      id: archivedId,
      householdId: w.a.id,
      userId: w.a.admin.userId,
      title: "old",
      createdAt: new Date(),
      archivedAt: new Date(),
    });
    const archived = await send(
      w.a.admin,
      archivedId,
      "hi",
      new Stub([msg([say("x")], "end_turn")]),
    );
    expect(archived.status).toBe(409);
  });
});

// Worker: proactive messages (SPEC-Q-9, R-46) -----------------------------------------------------

describe("worker: jobs started from chat report back (SPEC-Q-9, R-46)", () => {
  let worker: WorkerProcess;

  beforeAll(async () => {
    worker = await startWorkerProcess(db.url);
  }, 120_000);

  afterAll(async () => {
    await worker.stop();
  }, 60_000);

  async function finished(jobId: string): Promise<typeof job.$inferSelect> {
    for (let i = 0; i < 600; i += 1) {
      const [row] = await rt.db.select().from(job).where(eq(job.id, jobId));
      if (row !== undefined && (row.status === "succeeded" || row.status === "failed")) return row;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`job ${jobId} did not finish:\n${worker.output().slice(-2000)}`);
  }

  async function eventRows(conversationId: string) {
    for (let i = 0; i < 100; i += 1) {
      const rows = (await conversationRows(rt, w.a.id, conversationId)).filter(
        (r) => r.role === "event",
      );
      if (rows.length > 0) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  }

  function jobIdOf(r: Sse): string {
    const done = r.events.find((e) => (e.data as { type: string }).type === "tool_done")?.data as {
      cards: { type: string; jobId: string }[];
    };
    const card = done.cards[0];
    if (card?.type !== "job_progress") throw new Error("no job card");
    return card.jobId;
  }

  it("create_recipe queues recipe.draft; without a credential its failure and reason come back as an event", async () => {
    const id = await newConversation(w.a.admin);
    const stub = new Stub([
      msg(
        [tool("create_recipe", { request: "a high-protein breakfast", slot: "breakfast" })],
        "tool_use",
      ),
      msg([say("Started.")], "end_turn"),
    ]);
    const r = await send(w.a.admin, id, "New breakfast recipe please", stub);
    const row = await finished(jobIdOf(r));
    expect(row.kind).toBe("recipe.draft");
    expect(row.status).toBe("failed");
    const events = await eventRows(id);
    expect(events).toHaveLength(1);
    const content = events[0]?.content as {
      text: string;
      cards: { type: string; status: string; error?: string }[];
    };
    expect(content.cards[0]).toMatchObject({ type: "job_progress", status: "failed" });
    expect(content.cards[0]?.error).toMatch(/credential|disabled/i);
  }, 120_000);

  it("generate_plan from chat is logged as the assistant's change (R-49) and reports back", async () => {
    const id = await newConversation(w.a.admin);
    const stub = new Stub([
      msg([tool("generate_plan", { from: "2026-12-20", to: "2026-12-20" })], "tool_use"),
      msg([say("Planning.")], "end_turn"),
    ]);
    const r = await send(w.a.admin, id, "Plan the 20th of December", stub);
    const row = await finished(jobIdOf(r));
    expect(row.status, worker.output().slice(-2000)).toBe("succeeded");
    const [done] = await rt.db
      .select()
      .from(jobEvent)
      .where(and(eq(jobEvent.jobId, row.id), eq(jobEvent.type, "done")));
    const changeSetId = (done?.payload as { changeSetId?: string } | undefined)?.changeSetId;
    const [cs] = await rt.db
      .select()
      .from(changeSet)
      .where(eq(changeSet.id, changeSetId ?? ""));
    expect(cs).toMatchObject({
      actor: "agent",
      source: "agent_apply",
      actorUserId: w.a.admin.userId,
    });
    const events = await eventRows(id);
    expect(
      (events[0]?.content as { cards: { type: string; status: string }[] }).cards[0],
    ).toMatchObject({
      type: "job_progress",
      status: "succeeded",
    });
  }, 180_000);

  it("POST /plans/generate refuses a client-set source (only the agent adapter sets it; R-49)", async () => {
    const res = await callJson(
      c.plansGenerate,
      { body: { dates: ["2026-12-21"], source: "agent" } },
      w.a.admin,
    );
    expect(res.status).toBe(400);
  });

  it("run_insights posts its digest into the conversation that asked", async () => {
    const id = await newConversation(w.a.admin);
    const stub = new Stub([
      msg([tool("run_insights", {})], "tool_use"),
      msg([say("Running.")], "end_turn"),
    ]);
    const r = await send(w.a.admin, id, "What have you learned this week?", stub);
    const row = await finished(jobIdOf(r));
    expect(row.status).toBe("succeeded");
    const events = await eventRows(id);
    expect(events).toHaveLength(1);
    const content = events[0]?.content as { cards: { type: string }[] };
    expect(content.cards.map((x) => x.type)).toEqual(["insight_digest"]);
  }, 120_000);

  it("a new review with a comment queues reviews.extract; without a credential it reports disabled and leaves the review unmarked", async () => {
    const rev = await callJson(
      c.reviewsCreate,
      {
        body: {
          targetType: "dish",
          targetId: w.a.ownDishId,
          rating: 3,
          tags: [],
          comment: "Too salty, make it less often",
          onBehalfOfMemberId: w.a.adultId,
        },
      },
      w.a.admin,
    );
    const reviewId = ok<{ id: string }>(rev, "review").id;
    let extractJob: typeof job.$inferSelect | undefined;
    for (let i = 0; i < 100 && extractJob === undefined; i += 1) {
      [extractJob] = (
        await rt.db
          .select()
          .from(job)
          .where(and(eq(job.householdId, w.a.id), eq(job.kind, "reviews.extract")))
      ).filter((j) => (j.payload as { reviewId?: string }).reviewId === reviewId);
      if (extractJob === undefined) await new Promise((r) => setTimeout(r, 50));
    }
    if (extractJob === undefined) throw new Error("no reviews.extract job");
    const done = await finished(extractJob.id);
    expect(done.status).toBe("succeeded");
    const [result] = await rt.db
      .select()
      .from(jobEvent)
      .where(and(eq(jobEvent.jobId, done.id), eq(jobEvent.type, "done")));
    expect(result?.payload).toMatchObject({ status: "disabled" });
    const [r] = await rt.db.select().from(review).where(eq(review.id, reviewId));
    expect(r?.extractedAt).toBeNull();
    expect(r?.processedAt).toBeNull();
  }, 120_000);
});

// reviews.extract with a model: the worker's client is pointed at a local server that answers
// with a recorded extraction (no credential; the token is a placeholder the server ignores).
describe("worker: reviews.extract with a recorded model response (R-46)", () => {
  let worker: WorkerProcess;
  let server: Server;
  const requests: Record<string, unknown>[] = [];
  const saved = { base: process.env.ANTHROPIC_BASE_URL, token: process.env.ANTHROPIC_AUTH_TOKEN };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        requests.push(JSON.parse(body) as Record<string, unknown>);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_recorded",
            type: "message",
            role: "assistant",
            model: "claude-recorded",
            content: [{ type: "text", text: '{"tags":["too_salty","more_often"]}' }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 120, output_tokens: 12 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${String(port)}`;
    process.env.ANTHROPIC_AUTH_TOKEN = "recorded-response-placeholder";
    worker = await startWorkerProcess(db.url);
  }, 120_000);

  afterAll(async () => {
    await worker.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved.base;
    if (saved.token === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  }, 60_000);

  it("stores the new tags once, applies their learning, audits the call, and never touches processed_at", async () => {
    const before = await changeSetCount();
    const [adult] = await rt.db.select().from(member).where(eq(member.id, w.a.adultId));
    const name = adult?.displayName ?? "";
    expect(name.length).toBeGreaterThan(1);
    const rev = await callJson(
      c.reviewsCreate,
      {
        body: {
          targetType: "dish",
          targetId: w.a.ownDishId,
          rating: 4,
          tags: ["tasty"],
          comment: `${name} found it way too salty, but please make it more often`,
          onBehalfOfMemberId: w.a.adultId,
        },
      },
      w.a.admin,
    );
    const reviewId = ok<{ id: string }>(rev, "review").id;
    let extracted: typeof review.$inferSelect | undefined;
    for (let i = 0; i < 600 && extracted?.extractedAt == null; i += 1) {
      [extracted] = await rt.db.select().from(review).where(eq(review.id, reviewId));
      if (extracted?.extractedAt == null) await new Promise((r) => setTimeout(r, 100));
    }
    expect(extracted?.extractedTags, worker.output().slice(-2000)).toEqual([
      "more_often",
      "too_salty",
    ]);
    expect(extracted?.tags).toEqual(["tasty"]);
    expect(extracted?.processedAt).toBeNull();
    // The comment went out with the member's name scrubbed, at effort low.
    const sent = JSON.stringify(requests.at(-1));
    expect(sent).not.toContain(name);
    expect(requests.at(-1)?.output_config).toMatchObject({ effort: "low" });
    const audit = await rt.db
      .select()
      .from(aiGeneration)
      .where(
        and(eq(aiGeneration.householdId, w.a.id), eq(aiGeneration.purpose, "comment_extraction")),
      );
    expect(audit).toHaveLength(1);
    // Learning from the added tags: one more learning change set than the review's own.
    const learning = (
      await rt.db.select().from(changeSet).where(eq(changeSet.householdId, w.a.id))
    ).filter((x) => x.source === "learning");
    expect(learning.length).toBeGreaterThanOrEqual(2);
    expect(await changeSetCount()).toBeGreaterThan(before + 1);
  }, 120_000);
});
