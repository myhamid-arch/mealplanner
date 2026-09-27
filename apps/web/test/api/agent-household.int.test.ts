// get_household carries the logins (leaf 1.3.6, R-67): the real route, PostgreSQL 16 and a scripted
// stub model. role.set takes the login's userId, which the model can only learn from get_household.
// - An admin's get_household returns every login of the household (userId, name, role, status,
//   member), equal to People & access minus the emails, and no email reaches the model.
// - With that userId, role.set through apply_change becomes a pending proposal (AGT-5), end to end.
// - Non-admins cannot reach it: the chat route refuses them before any model call, and another
//   household's admin sees only their own logins (negative controls).
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import type { AgentModel, AgentRequest, AgentStreamEvent } from "@mealplanner/ai/agent";
import { proposal } from "@mealplanner/db/schema";
import { useAgentModel } from "../../lib/server/agent";
import { call, callJson, startTestApp, type Caller, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { ok, buildWorld, type World } from "./support/world";

type BetaMessage = Awaited<ReturnType<AgentModel["stream"]>>;
type BetaStopReason = NonNullable<BetaMessage["stop_reason"]>;
type Step = BetaMessage | ((req: AgentRequest) => BetaMessage);

let seq = 0;

function msg(content: unknown[], stop: BetaStopReason): BetaMessage {
  seq += 1;
  return {
    id: `msg_h${String(seq)}`,
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

function tool(name: string, input: unknown) {
  seq += 1;
  return { type: "tool_use" as const, id: `toolu_h${String(seq)}`, name, input };
}

class Stub implements AgentModel {
  readonly model = "claude-stub";
  readonly effort = "high" as const;
  readonly requests: AgentRequest[] = [];
  constructor(private readonly steps: Step[]) {}
  stream(req: AgentRequest, onEvent: (e: AgentStreamEvent) => void): Promise<BetaMessage> {
    this.requests.push(req);
    const step = this.steps.shift();
    if (step === undefined) return Promise.reject(new Error("stub ran out of steps"));
    const m = typeof step === "function" ? step(req) : step;
    m.content.forEach((block, index) => {
      onEvent({ type: "content_block_start", index, content_block: block });
    });
    return Promise.resolve(m);
  }
}

/** The tool_result contents of the last user message of a request, by tool_use id. */
function results(req: AgentRequest | undefined): Map<string, string> {
  const last = req?.messages.at(-1);
  if (last === undefined || typeof last.content === "string") return new Map();
  return new Map(
    (last.content as { type: string; tool_use_id?: string; content?: unknown }[])
      .filter((b) => b.type === "tool_result")
      .map((b) => [b.tool_use_id ?? "", String(b.content)]),
  );
}

let db: TestDatabase;
let app: TestApp;
let w: World;

async function newConversation(caller: Caller): Promise<string> {
  const r = await callJson(c.conversationsCreate, { body: { title: "Household test" } }, caller);
  return ok<{ id: string }>(r, "conversation").id;
}

async function send(caller: Caller, conversationId: string, text: string, model: AgentModel) {
  useAgentModel(model);
  const res = await call(
    c.conversationsSend,
    { params: { id: conversationId }, body: { text } },
    caller,
  );
  return { status: res.status, body: await res.text() };
}

interface AgentLogin {
  userId: string;
  name: string;
  role: string;
  status: string;
  memberId: string | null;
  memberName: string | null;
}

/** One admin turn that calls get_household and returns its parsed result. */
async function householdAs(caller: Caller): Promise<{ raw: string; logins: AgentLogin[] }> {
  const id = await newConversation(caller);
  const read = tool("get_household", {});
  const stub = new Stub([
    msg([read], "tool_use"),
    msg([{ type: "text", text: "Read.", citations: null }], "end_turn"),
  ]);
  const r = await send(caller, id, "Who has a login?", stub);
  expect(r.status).toBe(200);
  const raw = results(stub.requests[1]).get(read.id) ?? "";
  return { raw, logins: (JSON.parse(raw) as { logins: AgentLogin[] }).logins };
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  w = await buildWorld(app);
}, 300_000);

afterAll(async () => {
  useAgentModel(undefined);
  await app.close();
  await db.drop();
});

describe("get_household logins (R-67)", () => {
  it("an admin's get_household returns every login, equal to People & access without emails", async () => {
    const { raw, logins } = await householdAs(w.a.admin);
    const access = ok<{
      logins: (AgentLogin & { email: string })[];
    }>(await callJson(c.accessList, {}, w.a.admin), "access").logins;
    expect(access.length).toBeGreaterThanOrEqual(5);
    expect(logins).toEqual(
      access.map((l) => ({
        userId: l.userId,
        name: l.name,
        role: l.role,
        status: l.status,
        memberId: l.memberId,
        memberName: l.memberName,
      })),
    );
    const member = logins.find((l) => l.userId === w.a.member.userId);
    expect(member).toMatchObject({ role: "member", memberId: w.a.adultId });
    expect(logins.find((l) => l.userId === w.a.blocked.userId)?.status).toBe("blocked");
    // No email reaches the model.
    expect(raw).not.toMatch(/"email"/);
    for (const l of access) expect(raw).not.toContain(l.email);
  });

  it("with that userId, role.set through apply_change becomes a pending proposal (AGT-5)", async () => {
    const id = await newConversation(w.a.admin);
    const read = tool("get_household", {});
    let setId = "";
    const stub = new Stub([
      msg([read], "tool_use"),
      (req) => {
        const logins = (JSON.parse(results(req).get(read.id) ?? "{}") as { logins: AgentLogin[] })
          .logins;
        const target = logins.find((l) => l.memberId === w.a.adultId);
        const set = tool("apply_change", {
          summary: "Make the linked member an admin",
          ops: [{ kind: "role.set", payload: { userId: target?.userId, role: "admin" } }],
        });
        setId = set.id;
        return msg([set], "tool_use");
      },
      msg([{ type: "text", text: "Waiting for you.", citations: null }], "end_turn"),
    ]);
    const r = await send(w.a.admin, id, "Make the linked member an admin too", stub);
    expect(r.status).toBe(200);
    const outcome = JSON.parse(results(stub.requests[2]).get(setId) ?? "{}") as {
      status?: string;
      protectedKinds?: string[];
      proposalId?: string;
    };
    expect(outcome).toMatchObject({ status: "proposed", protectedKinds: ["role.set"] });
    const [row] = await app.rt.db
      .select()
      .from(proposal)
      .where(and(eq(proposal.householdId, w.a.id), eq(proposal.id, outcome.proposalId ?? "")));
    expect(row?.status).toBe("pending");
    expect(JSON.stringify(row?.payload)).toContain(w.a.member.userId);
    // Not applied: the member is still a member.
    const after = ok<{ logins: { userId: string; role: string }[] }>(
      await callJson(c.accessList, {}, w.a.admin),
      "access",
    ).logins;
    expect(after.find((l) => l.userId === w.a.member.userId)?.role).toBe("member");
  });

  it("negative control: non-admins cannot reach get_household, and another household's admin sees only theirs", async () => {
    const conversationId = await newConversation(w.a.admin);
    for (const who of [w.a.member, w.a.kitchen]) {
      const stub = new Stub([msg([tool("get_household", {})], "tool_use")]);
      const r = await send(who, conversationId, "Who has a login?", stub);
      expect(r.status).toBe(403);
      expect(stub.requests).toHaveLength(0);
    }
    const b = await householdAs(w.b.admin);
    expect(b.logins.map((l) => l.userId)).toEqual([w.b.admin.userId]);
    const aIds = new Set(
      [w.a.admin, w.a.admin2, w.a.member, w.a.kitchen, w.a.blocked].map((l) => l.userId),
    );
    expect(b.logins.some((l) => aIds.has(l.userId))).toBe(false);
  });
});
