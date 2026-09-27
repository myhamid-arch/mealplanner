// First-days follow-up questions and the "Getting set up" checklist (R2-ONB-6; FirstDaysPhone;
// BLD-8 R-55, R-56; leaf-1.4.7 SPEC-Q-8 … 11). The engine (@mealplanner/core/onboarding/followups)
// reads the saved configuration; answers and dismissals are UI state in `setup_followup`, written
// outside DM-6 like `detail_level` (R-24). An answer that changes the configuration applies its ops
// as one change set (actor user, source ui) in the same transaction as the answer row. Only today's
// card can be answered or dismissed, so the server keeps "at most one per day" too.
import { and, count, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  checklist,
  FollowupError,
  followupOps,
  followupQueue,
  proposeFollowups,
  setupDay,
  type Followup,
  type FollowupState,
} from "@mealplanner/core/onboarding/followups";
import type { FollowupAnswerBody } from "@mealplanner/api-contract/contract";
import {
  householdUser,
  invite,
  planDay,
  review,
  setupFollowup,
  newId,
} from "@mealplanner/db/schema";
import { applyChangeSet } from "@mealplanner/db/services/changes";
import { loadHouseholdConfig } from "@mealplanner/db/services/config";
import { localDate } from "@mealplanner/db/services/proposals";
import type { CallerContext } from "../auth/context";
import { afterChangeSet } from "./followups";
import { ProblemError, conflict, notFound } from "./problem";
import type { Runtime } from "./runtime";

function safeLocalDate(at: Date, timezone: string): string {
  try {
    return localDate(at, timezone);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

const followupDto = (f: Followup) => ({
  key: f.key,
  kind: f.kind,
  question: f.question,
  choices: f.choices.map((c) => ({ id: c.id, label: c.label, then: c.then ?? null })),
  more: f.more,
});

async function countOf(query: Promise<{ n: number }[]>): Promise<number> {
  const [row] = await query;
  return Number(row?.n ?? 0);
}

/** Whether a login of `role` exists, or an open invite for one (not used, revoked or expired). */
async function invited(rt: Runtime, householdId: string, role: "kitchen" | "member", now: Date) {
  const logins = await countOf(
    rt.db
      .select({ n: count() })
      .from(householdUser)
      .where(and(eq(householdUser.householdId, householdId), eq(householdUser.role, role))),
  );
  if (logins > 0) return true;
  const open = await countOf(
    rt.db
      .select({ n: count() })
      .from(invite)
      .where(
        and(
          eq(invite.householdId, householdId),
          eq(invite.role, role),
          isNull(invite.usedAt),
          isNull(invite.revokedAt),
          gt(invite.expiresAt, now),
        ),
      ),
  );
  return open > 0;
}

interface Loaded {
  proposed: Followup[];
  states: FollowupState[];
  today: string;
  config: Awaited<ReturnType<typeof loadHouseholdConfig>>;
}

async function load(rt: Runtime, caller: CallerContext, now: Date): Promise<Loaded> {
  const tz = caller.household.timezone;
  const config = await loadHouseholdConfig(rt.db, caller.ctx);
  const rows = await rt.db
    .select()
    .from(setupFollowup)
    .where(eq(setupFollowup.householdId, caller.ctx.householdId));
  return {
    proposed: proposeFollowups(config, { viewerMemberId: caller.memberId }),
    states: rows.map((r) => ({
      key: r.key,
      status: r.status,
      choice: r.choice,
      resolvedAt: r.resolvedAt,
      resolvedOn: safeLocalDate(r.resolvedAt, tz),
    })),
    today: safeLocalDate(now, tz),
    config,
  };
}

async function view(rt: Runtime, caller: CallerContext, loaded: Loaded, now: Date) {
  const householdId = caller.ctx.householdId;
  const queue = followupQueue(loaded.proposed, loaded.states, loaded.today);
  const [planDays, reviews, kitchenInvited, familyInvited] = await Promise.all([
    countOf(rt.db.select({ n: count() }).from(planDay).where(eq(planDay.householdId, householdId))),
    countOf(rt.db.select({ n: count() }).from(review).where(eq(review.householdId, householdId))),
    invited(rt, householdId, "kitchen", now),
    invited(rt, householdId, "member", now),
  ]);
  const list = checklist(
    {
      activeMembers: loaded.config.members.filter((m) => m.archivedAt === null).length,
      planDays,
      kitchenInvited,
      reviews,
      familyInvited,
    },
    { answered: queue.answered, total: queue.total },
  );
  return {
    today: loaded.today,
    day: setupDay(safeLocalDate(caller.household.createdAt, caller.household.timezone), loaded.today),
    card: queue.card === null ? null : followupDto(queue.card),
    position: queue.position,
    total: queue.total,
    upcoming: queue.upcoming.map(followupDto),
    checklist: list,
  };
}

export async function getFollowups(rt: Runtime, caller: CallerContext, now = new Date()) {
  return view(rt, caller, await load(rt, caller, now), now);
}

/** Today's card, or the reason the follow-up cannot be resolved now. */
function todaysCard(loaded: Loaded, key: string): Followup {
  const state = loaded.states.find((s) => s.key === key);
  if (state?.status === "answered") throw conflict("already_answered", "this question was already answered");
  const item = loaded.proposed.find((f) => f.key === key);
  if (item === undefined) throw notFound("open follow-up");
  const card = followupQueue(loaded.proposed, loaded.states, loaded.today).card;
  if (card?.key !== key)
    throw conflict("not_todays_question", "only today's question can be answered (one a day)");
  return item;
}

/** Writes the answer or dismissal row unless the follow-up was answered meanwhile. */
async function writeState(
  db: Parameters<Parameters<Runtime["db"]["transaction"]>[0]>[0],
  caller: CallerContext,
  key: string,
  values: { status: "answered" | "dismissed"; choice: string | null; changeSetId: string | null },
  now: Date,
): Promise<void> {
  const written = await db
    .insert(setupFollowup)
    .values({
      id: newId(),
      householdId: caller.ctx.householdId,
      key,
      ...values,
      resolvedByUserId: caller.ctx.userId,
      resolvedAt: now,
    })
    .onConflictDoUpdate({
      target: [setupFollowup.householdId, setupFollowup.key],
      set: { ...values, resolvedByUserId: caller.ctx.userId, resolvedAt: now },
      setWhere: ne(setupFollowup.status, sql`'answered'`),
    })
    .returning({ id: setupFollowup.id });
  if (written.length === 0) throw conflict("already_answered", "this question was already answered");
}

export async function answerFollowup(
  rt: Runtime,
  caller: CallerContext,
  key: string,
  body: z.output<typeof FollowupAnswerBody>,
  now = new Date(),
) {
  const loaded = await load(rt, caller, now);
  const item = todaysCard(loaded, key);
  let change: { ops: Parameters<typeof applyChangeSet>[2]["ops"]; summary: string };
  try {
    change = followupOps(item, body.choice, loaded.config);
  } catch (error) {
    if (error instanceof FollowupError) throw new ProblemError(422, "invalid_choice", error.message);
    throw error;
  }
  const changeSetId = await rt.db.transaction(async (tx) => {
    let id: string | null = null;
    if (change.ops.length > 0)
      id = (
        await applyChangeSet(tx, caller.ctx, {
          actor: "user",
          source: "ui",
          summary: change.summary,
          ops: change.ops,
        })
      ).changeSetId;
    await writeState(tx, caller, key, { status: "answered", choice: body.choice, changeSetId: id }, now);
    return id;
  });
  if (changeSetId !== null)
    await afterChangeSet(rt, caller.ctx.householdId, changeSetId, caller.ctx.userId);
  const then = item.choices.find((c) => c.id === body.choice)?.then ?? null;
  return { changeSetId, then, followups: await getFollowups(rt, caller, now) };
}

export async function dismissFollowup(
  rt: Runtime,
  caller: CallerContext,
  key: string,
  now = new Date(),
) {
  const loaded = await load(rt, caller, now);
  todaysCard(loaded, key);
  await rt.db.transaction((tx) =>
    writeState(tx, caller, key, { status: "dismissed", choice: null, changeSetId: null }, now),
  );
  return getFollowups(rt, caller, now);
}
