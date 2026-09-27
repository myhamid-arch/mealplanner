// leaf-1.4.9 G1 (W-9a, FBK-5, AGT-7): the insights digest lists, as "Done automatically", the
// portion moves review learning applied since the household's previous digest (SPEC-Q-1, -3).
// Everything goes through the API and the built worker process: reviews write the `learning`
// change sets, `POST /insights/run` queues the run, the worker's `insights.run` posts the digest.
// In the same window a user (`ui`) change set and an accepted proposal, both with a
// `portion_bias.set` op, and a preference-only learning change set must not be listed.
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import { changeSet, chatMessage, conversation } from "@mealplanner/db/schema";
import { createProposals } from "@mealplanner/db/services/proposals";
import { callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { startWorkerProcess, type WorkerProcess } from "./support/worker";
import { addMembers, applyOps, ok, signupAdmin, type Login } from "./support/world";

let db: TestDatabase;
let app: TestApp;
let worker: WorkerProcess;
let admin: Login & { householdId: string };
let childId: string;
let adultId: string;
let dishId: string;

interface Automatic {
  changeSetId: string;
  title: string;
  detail: string;
  appliedAt: string;
  undone: boolean;
}
interface DigestRow {
  id: string;
  createdAt: Date;
  conversationTitle: string | null;
  text: string;
  automatic: Automatic[] | undefined;
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  worker = await startWorkerProcess(db.url);
  admin = await signupAdmin("Digest household");
  ({ adultId, childId } = await addMembers(admin));
  const dishes = ok<{ dishes: { id: string }[] }>(
    await callJson(c.dishesList, { query: {} }, admin),
    "dishes",
  );
  const first = dishes.dishes[0];
  if (first === undefined) throw new Error("the seeded library has no dish");
  dishId = first.id;
}, 300_000);

afterAll(async () => {
  await worker.stop();
  await app.close();
  await db.drop();
}, 60_000);

async function review(memberId: string, body: { rating?: number; tags?: string[] }) {
  ok(
    await callJson(
      c.reviewsCreate,
      { body: { targetType: "dish", targetId: dishId, onBehalfOfMemberId: memberId, ...body } },
      admin,
    ),
    "review",
  );
}

async function newest(source: "learning" | "ui" | "proposal_accept"): Promise<string> {
  const [row] = await app.rt.db
    .select({ id: changeSet.id })
    .from(changeSet)
    .where(and(eq(changeSet.householdId, admin.householdId), eq(changeSet.source, source)))
    .orderBy(sql`${changeSet.appliedAt} desc`)
    .limit(1);
  if (row === undefined) throw new Error(`no ${source} change set`);
  return row.id;
}

async function runInsights(): Promise<void> {
  const { jobId } = ok<{ jobId: string }>(await callJson(c.insightsRun, {}, admin), "insights");
  const deadline = Date.now() + 120_000;
  for (;;) {
    const j = ok<{ status: string }>(
      await callJson(c.jobsGet, { params: { id: jobId } }, admin),
      "job",
    );
    if (j.status === "succeeded") return;
    if (j.status === "failed" || j.status === "cancelled")
      throw new Error(`insights.run ${j.status}:\n${worker.output().slice(-3000)}`);
    if (Date.now() > deadline) throw new Error(`insights.run still ${j.status}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function digests(): Promise<DigestRow[]> {
  const rows = await app.rt.db
    .select({
      id: chatMessage.id,
      createdAt: chatMessage.createdAt,
      content: chatMessage.content,
      conversationTitle: conversation.title,
    })
    .from(chatMessage)
    .innerJoin(
      conversation,
      and(
        eq(conversation.householdId, chatMessage.householdId),
        eq(conversation.id, chatMessage.conversationId),
      ),
    )
    .where(
      and(
        eq(chatMessage.householdId, admin.householdId),
        eq(chatMessage.role, "event"),
        sql`${chatMessage.content} -> 'cards' @> '[{"type":"insight_digest"}]'::jsonb`,
      ),
    )
    .orderBy(asc(chatMessage.createdAt));
  return rows.map((r) => {
    const content = r.content as unknown as {
      text: string;
      cards: { type: string; automatic?: Automatic[] }[];
    };
    return {
      id: r.id,
      createdAt: r.createdAt,
      conversationTitle: r.conversationTitle,
      text: content.text,
      automatic: content.cards.find((x) => x.type === "insight_digest")?.automatic,
    };
  });
}

/**
 * SPEC-Q-1/-3, computed here from the rows: the learning change sets by the system actor with a
 * `portion_bias.set` op, applied after `since`, oldest first.
 */
async function expectedSince(since: Date | null): Promise<string[]> {
  const rows = await app.rt.db
    .select({ id: changeSet.id, forward: changeSet.forward })
    .from(changeSet)
    .where(
      and(
        eq(changeSet.householdId, admin.householdId),
        eq(changeSet.source, "learning"),
        eq(changeSet.actor, "system"),
        ...(since === null ? [] : [gt(changeSet.appliedAt, since)]),
      ),
    )
    .orderBy(asc(changeSet.appliedAt), asc(changeSet.id));
  return rows
    .filter((r) => (r.forward as { kind?: string }[]).some((op) => op.kind === "portion_bias.set"))
    .map((r) => r.id);
}

/** The G1 check: the listing is exactly the expected ids and names none of the forbidden ones. */
function exactListing(
  listed: readonly string[],
  expected: readonly string[],
  forbidden: readonly string[],
): boolean {
  return (
    listed.length === expected.length &&
    listed.every((id, i) => id === expected[i]) &&
    !listed.some((id) => forbidden.includes(id))
  );
}

const ids = { first: "", second: "", preferenceOnly: "", user: "", accepted: "" };
const forbidden = () => [ids.preferenceOnly, ids.user, ids.accepted];

describe("G1 done automatically (W-9a)", () => {
  it("G1 set-up: a too-much review for Zayd, a preference-only review, a user and an accepted-proposal portion change", async () => {
    await review(childId, { rating: 3, tags: ["too_much"] });
    ids.first = await newest("learning");
    await review(adultId, { rating: 5 });
    ids.preferenceOnly = await newest("learning");
    ids.user = await applyOps(admin, [
      {
        kind: "portion_bias.set",
        payload: { memberId: childId, componentRole: "protein", bias: 1.2 },
      },
    ]);
    const ctx = { householdId: admin.householdId, userId: admin.userId, role: "admin" as const };
    const stored = await createProposals(app.rt.db, ctx, [
      {
        origin: "rule",
        title: "Bigger vegetable portions for Zayd",
        rationale: "test proposal",
        ops: [
          {
            kind: "portion_bias.set",
            payload: { memberId: childId, componentRole: "vegetable", bias: 1.1 },
          },
        ],
        evidence: { reviewIds: [], count: 1, metrics: {} },
        priority: 3,
      },
    ]);
    const proposalId = stored.stored[0]?.id;
    if (proposalId === undefined) throw new Error("no proposal stored");
    ids.accepted = ok<{ changeSetId: string }>(
      await callJson(c.proposalsAccept, { params: { id: proposalId } }, admin),
      "accept",
    ).changeSetId;
    const [pref] = await app.rt.db
      .select()
      .from(changeSet)
      .where(eq(changeSet.id, ids.preferenceOnly));
    expect(
      (pref?.forward as { kind: string }[]).every((op) => op.kind !== "portion_bias.set"),
      "the rating-only review wrote no portion move",
    ).toBe(true);
    expect(ids.first).not.toBe(ids.preferenceOnly);
  }, 300_000);

  it("G1 the first digest lists the portion move, with its title, and none of the others", async () => {
    expect(await digests()).toEqual([]);
    await runInsights();
    const posted = await digests();
    expect(posted).toHaveLength(1);
    const digest = posted[0];
    if (digest === undefined) throw new Error("no digest");
    expect(digest.conversationTitle).toBe("Updates");
    const listed = (digest.automatic ?? []).map((a) => a.changeSetId);
    expect(listed).toEqual([ids.first]);
    expect(exactListing(listed, await expectedSince(null), forbidden())).toBe(true);
    const item = digest.automatic?.[0];
    expect(item?.title).toMatch(/^Zayd's .+ portions? (is|are) 10% smaller$/);
    expect(item?.detail).toMatch(/^Learned from Zayd's review of /);
    expect(item?.undone).toBe(false);
    expect(digest.text).toContain("One change was made automatically; you can undo it.");
  }, 300_000);

  it("G1 Undo is the change-set undo, and the next digest lists only what came after the previous one", async () => {
    ok(await callJson(c.changeSetsUndo, { params: { id: ids.first } }, admin), "undo");
    await review(childId, { rating: 2, tags: ["too_much"] });
    ids.second = await newest("learning");
    const before = await digests();
    const previous = before[before.length - 1];
    if (previous === undefined) throw new Error("no previous digest");
    await runInsights();
    const posted = await digests();
    expect(posted).toHaveLength(2);
    const listed = (posted[1]?.automatic ?? []).map((a) => a.changeSetId);
    expect(listed).toEqual([ids.second]);
    expect(exactListing(listed, await expectedSince(previous.createdAt), forbidden())).toBe(true);
    expect(listed).not.toContain(ids.first);
  }, 300_000);

  it("G1 negative control: the listing check fails on the user, accepted-proposal and preference-only change sets, and on a missing move", () => {
    const expected = [ids.first];
    expect(exactListing([ids.first], expected, forbidden())).toBe(true);
    expect(exactListing([ids.first, ids.user], [ids.first, ids.user], forbidden())).toBe(false);
    expect(exactListing([ids.first, ids.accepted], [ids.first, ids.accepted], forbidden())).toBe(
      false,
    );
    expect(
      exactListing([ids.first, ids.preferenceOnly], [ids.first, ids.preferenceOnly], forbidden()),
    ).toBe(false);
    expect(exactListing([], expected, forbidden())).toBe(false);
  });
});
