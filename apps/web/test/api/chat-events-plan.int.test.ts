// leaf-1.4.9 G2 (W-9b, AGT-7 proactive messages): a `plan.generate` job no agent turn started
// posts, when it finishes, a plan-ready row ("Monday's plan is ready", its facts, "Look, then send
// to kitchen") to every active admin: into their most recent conversation, or a new "Updates" one
// (SPEC-Q-4). A job an agent turn started still posts only into that conversation, with 1.3.5's
// content (R-46). The household is the mockup's, set up through `inferSetup` as onboarding saves
// it (school lunches Mon–Fri, Omar training Mon/Wed/Fri), so every fact kind is exercised.
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as c from "@mealplanner/api-contract/contract";
import {
  inferSetup,
  parsePeople,
  parseTargets,
  type OnboardingAnswers,
} from "@mealplanner/core/onboarding";
import { chatMessage, conversation, job, newId } from "@mealplanner/db/schema";
import { enqueueJob } from "../../lib/server/jobs";
import { callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { startWorkerProcess, type WorkerProcess } from "./support/worker";
import { acceptWithSignup, invite, ok, signupAdmin, type Login } from "./support/world";

/** A Monday and the Tuesday after it. */
const MONDAY = "2026-11-02";
const TUESDAY = "2026-11-03";

let db: TestDatabase;
let app: TestApp;
let worker: WorkerProcess;
let omar: Login & { householdId: string };
let sara: Login;
let omarChat: string;

interface EventRow {
  conversationId: string;
  userId: string;
  title: string | null;
  content: { text: string; cards: Record<string, unknown>[] };
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = startTestApp(db.url);
  worker = await startWorkerProcess(db.url);
  omar = await signupAdmin("Plan ready household");
  await setUpMockupFamily(omar);
  sara = await acceptWithSignup(await invite(omar, "admin", null), "Sara");
  // Omar has talked to the assistant before: his most recent conversation gets the row.
  omarChat = ok<{ id: string }>(
    await callJson(c.conversationsCreate, { body: { title: "Dinner ideas" } }, omar),
    "conversation",
  ).id;
}, 300_000);

afterAll(async () => {
  await worker.stop();
  await app.close();
  await db.drop();
}, 60_000);

async function setUpMockupFamily(admin: Login): Promise<void> {
  const omarTargets = parseTargets("2150 cal, 180p 200c 70f");
  const saraTargets = parseTargets("1655 / 130 / 160 / 55");
  if (!omarTargets.ok || !saraTargets.ok) throw new Error("targets did not parse");
  const answers: OnboardingAnswers = {
    people: parsePeople(
      "me (41), my wife Sara 39 and our three kids Layla 18 F, Adam 15 M and Zayd 10 M",
    ),
    targets: [
      { person: "me", numbers: omarTargets.value },
      { person: "Sara", numbers: saraTargets.value },
    ],
    week: {
      school: { people: ["Layla", "Adam", "Zayd"], weekdays: [0, 1, 2, 3, 4] },
      work: null,
      training: [{ person: "me", weekdays: [0, 2, 4], time: "evening" }],
      snacks: false,
    },
    cuisines: ["levantine", "italian"],
    neverEat: null,
  };
  const [slots, cuisines, ingredients, household] = await Promise.all([
    callJson(c.slotsList, {}, admin),
    callJson(c.cuisinesList, {}, admin),
    callJson(c.ingredientsList, { query: { limit: 500 } }, admin),
    callJson(c.householdGet, {}, admin),
  ]);
  const setup = inferSetup(answers, {
    referenceYear: 2026,
    adminName: "Omar",
    slots: ok<{ slots: never[] }>(slots, "slots").slots,
    cuisines: ok<{ cuisines: never[] }>(cuisines, "cuisines").cuisines,
    ingredients: ok<{ ingredients: never[] }>(ingredients, "ingredients").ingredients,
    satFatDefaultPct: ok<{ satFatDefaultPct: number }>(household, "household").satFatDefaultPct,
    newId,
  });
  ok(
    await callJson(
      c.changeSetsApply,
      { body: { summary: "Household set up from onboarding", ops: setup.changeOps } },
      admin,
    ),
    "setup",
  );
}

async function finished(jobId: string): Promise<void> {
  const deadline = Date.now() + 240_000;
  for (;;) {
    const [row] = await app.rt.db.select({ status: job.status }).from(job).where(eq(job.id, jobId));
    if (row?.status === "succeeded") break;
    if (row?.status === "failed" || row?.status === "cancelled")
      throw new Error(`plan.generate ${row.status}:\n${worker.output().slice(-3000)}`);
    if (Date.now() > deadline) throw new Error(`plan.generate still ${String(row?.status)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  // The completion message is posted before the job is marked succeeded (runner.ts).
}

async function eventsFor(jobId: string): Promise<EventRow[]> {
  const rows = await app.rt.db
    .select({
      conversationId: chatMessage.conversationId,
      userId: conversation.userId,
      title: conversation.title,
      content: chatMessage.content,
      createdAt: chatMessage.createdAt,
    })
    .from(chatMessage)
    .innerJoin(
      conversation,
      and(
        eq(conversation.householdId, chatMessage.householdId),
        eq(conversation.id, chatMessage.conversationId),
      ),
    )
    .where(and(eq(chatMessage.householdId, omar.householdId), eq(chatMessage.role, "event")))
    .orderBy(asc(chatMessage.createdAt));
  return rows
    .map((r) => ({ ...r, content: r.content as EventRow["content"] }))
    .filter((r) => r.content.cards.some((card) => card.jobId === jobId));
}

/** What the plan-ready row must say, worked out from the stored plan through the API. */
async function expectedReady(): Promise<{
  title: string;
  facts: string[];
  href: string;
  action: string;
}> {
  const plans = ok<{
    days: {
      date: string;
      meals: {
        slotLabel: string;
        slotTypeId: string;
        attendees: string[];
        plates: { memberId: string; fitStatus: string | null }[];
      }[];
    }[];
  }>(await callJson(c.plansList, { query: { from: MONDAY, to: TUESDAY } }, omar), "plans");
  const slots = ok<{
    slots: { id: string; label: string; isPacked: boolean; isTrainingSlot: boolean }[];
  }>(await callJson(c.slotsList, {}, omar), "slots").slots;
  const members = ok<{ members: { id: string; displayName: string; isTargeted: boolean }[] }>(
    await callJson(c.membersList, {}, omar),
    "members",
  ).members;
  const targeted = new Set(members.filter((m) => m.isTargeted).map((m) => m.id));
  const meals = plans.days.flatMap((d) => d.meals);
  const withTargets = meals.filter((m) => m.plates.some((p) => targeted.has(p.memberId)));
  const off = withTargets.filter((m) =>
    m.plates.some((p) => targeted.has(p.memberId) && p.fitStatus !== "in_tolerance"),
  ).length;
  const facts = [
    off === 0 ? "All meals on target" : `${String(off)} meal${off === 1 ? "" : "s"} off target`,
  ];
  const packed = new Map<string, number>();
  for (const m of meals) {
    const slot = slots.find((s) => s.id === m.slotTypeId);
    if (slot?.isPacked === true)
      packed.set(slot.label, (packed.get(slot.label) ?? 0) + Math.max(1, m.attendees.length));
  }
  for (const [label, n] of packed)
    facts.push(`${String(n)} ${label.toLowerCase()}${n === 1 ? "" : "es"}`);
  const trainees = new Set(
    meals
      .filter((m) => slots.find((s) => s.id === m.slotTypeId)?.isTrainingSlot === true)
      .flatMap((m) => m.attendees),
  );
  const names = members.filter((m) => trainees.has(m.id)).map((m) => `${m.displayName}'s`);
  if (names.length > 0) facts.push(`${names.join(" and ")} training-day meals included`);
  return {
    title: "The plan from Monday to Tuesday is ready",
    facts,
    href: `/plan?week=${MONDAY}`,
    action: "Look, then send to kitchen",
  };
}

let uiJob = "";
let agentJob = "";

describe("G2 plan ready in Updates (W-9b)", () => {
  it("G2 a plan the admin generated from the plan screen is announced to every admin", async () => {
    uiJob = ok<{ jobId: string }>(
      await callJson(c.plansGenerate, { body: { dates: [MONDAY, TUESDAY], seed: 2 } }, omar),
      "generate",
    ).jobId;
    await finished(uiJob);
    const rows = await eventsFor(uiJob);
    expect(rows.map((r) => r.userId).sort()).toEqual([omar.userId, sara.userId].sort());
    const toOmar = rows.find((r) => r.userId === omar.userId);
    const toSara = rows.find((r) => r.userId === sara.userId);
    // Omar's most recent conversation; Sara has none, so a new "Updates" one (AGT-7).
    expect(toOmar?.conversationId).toBe(omarChat);
    expect(toSara?.title).toBe("Updates");
    const expected = await expectedReady();
    for (const r of rows) {
      expect(r.content.text).toBe("");
      expect(r.content.cards).toEqual([
        {
          type: "job_progress",
          jobId: uiJob,
          kind: "plan.generate",
          status: "succeeded",
          ready: expected,
        },
      ]);
    }
    expect(expected.facts.some((f) => f.includes("school lunch"))).toBe(true);
    expect(expected.facts).toContain("Omar's training-day meals included");
  }, 300_000);

  it("G2 a plan an agent turn started posts only into that conversation, as before", async () => {
    agentJob = await enqueueJob(app.rt.db, app.rt.queue, {
      kind: "plan.generate",
      householdId: omar.householdId,
      // The agent adapter's payload (lib/server/agent.ts `generatePlan`).
      payload: { dates: [MONDAY], seed: 1, source: "agent", conversationId: omarChat },
      createdByUserId: omar.userId,
    });
    await finished(agentJob);
    const rows = await eventsFor(agentJob);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.conversationId).toBe(omarChat);
    expect(rows[0]?.content).toEqual({
      text: "The plan is ready.",
      cards: [
        { type: "job_progress", jobId: agentJob, kind: "plan.generate", status: "succeeded" },
      ],
    });
  }, 300_000);

  it("G2 negative control: the routing check fails when an agent-started job also reaches Updates, or a plan job reaches no admin", async () => {
    const onlyStarting = (rows: EventRow[]) =>
      rows.length === 1 &&
      rows[0]?.conversationId === omarChat &&
      rows[0].content.cards.every((card) => card.ready === undefined);
    const everyAdmin = (rows: EventRow[]) =>
      new Set(rows.map((r) => r.userId)).size === 2 &&
      rows.every((r) => r.content.cards.some((card) => card.ready !== undefined));
    const agentRows = await eventsFor(agentJob);
    const uiRows = await eventsFor(uiJob);
    expect(onlyStarting(agentRows)).toBe(true);
    expect(everyAdmin(uiRows)).toBe(true);
    // An agent job that also posted its row to Sara's Updates, and a UI job that posted nowhere.
    const leaked = uiRows.find((r) => r.userId === sara.userId);
    if (leaked === undefined) throw new Error("no Updates row");
    expect(onlyStarting([...agentRows, leaked])).toBe(false);
    expect(everyAdmin([])).toBe(false);
    expect(everyAdmin(uiRows.slice(0, 1))).toBe(false);
  }, 300_000);
});
