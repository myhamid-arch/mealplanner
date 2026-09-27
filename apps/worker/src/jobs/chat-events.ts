// Proactive chat messages (AGT-7; leaf-1.3.5 SPEC-Q-9, R-46): the insights digest goes to every
// active admin's most recent conversation (or a new "Updates" conversation), and a job the agent
// started posts its completion into the conversation that started it. Event rows are display only
// (they are not replayed to the model; SPEC-Q-3).
// Leaf 1.4.9 (W-9, R-61): the digest lists the FBK-5 portion moves learning applied since the
// household's previous digest ("Done automatically", with Undo), and a plan job no agent turn
// started is announced to the admins the same way as the digest ("Monday's plan is ready").
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  digestHasNews,
  insightDigestEvent,
  jobCompletionEvent,
  type Json,
} from "@mealplanner/ai/agent";
import type { PlanResult } from "@mealplanner/core/planner";
import {
  changeSet,
  chatMessage,
  conversation,
  householdUser,
  member,
  newId,
  slotType,
} from "@mealplanner/db/schema";
import type { InsightDigest } from "@mealplanner/db/services/proposals";
import type { JobRow } from "@mealplanner/db/services/plans";
import type { WorkerRuntime } from "../runtime.js";

export const UPDATES_TITLE = "Updates";

async function insertEvent(
  rt: WorkerRuntime,
  householdId: string,
  conversationId: string,
  content: Json,
  createdAt: Date = new Date(),
): Promise<string> {
  const id = newId();
  await rt.db.insert(chatMessage).values({
    id,
    householdId,
    conversationId,
    role: "event",
    content,
    createdAt,
  });
  return id;
}

/** The admin's most recently active open conversation, or a new "Updates" conversation. */
async function conversationFor(
  rt: WorkerRuntime,
  householdId: string,
  userId: string,
): Promise<string> {
  const lastActive = sql<Date>`coalesce(max(${chatMessage.createdAt}), ${conversation.createdAt})`;
  const [latest] = await rt.db
    .select({ id: conversation.id, lastActive })
    .from(conversation)
    .leftJoin(
      chatMessage,
      and(
        eq(chatMessage.householdId, conversation.householdId),
        eq(chatMessage.conversationId, conversation.id),
      ),
    )
    .where(
      and(
        eq(conversation.householdId, householdId),
        eq(conversation.userId, userId),
        isNull(conversation.archivedAt),
      ),
    )
    .groupBy(conversation.id, conversation.createdAt)
    .orderBy(desc(lastActive))
    .limit(1);
  if (latest !== undefined) return latest.id;
  const id = newId();
  await rt.db.insert(conversation).values({
    id,
    householdId,
    userId,
    title: UPDATES_TITLE,
    createdAt: new Date(),
    archivedAt: null,
  });
  return id;
}

/** Each active admin of the household. */
async function activeAdmins(rt: WorkerRuntime, householdId: string): Promise<string[]> {
  const rows = await rt.db
    .select({ userId: householdUser.userId })
    .from(householdUser)
    .where(
      and(
        eq(householdUser.householdId, householdId),
        eq(householdUser.role, "admin"),
        eq(householdUser.status, "active"),
      ),
    );
  return rows.map((r) => r.userId);
}

/** When the household's latest digest was posted (any conversation), or null (SPEC-Q-3). */
export async function previousDigestAt(
  rt: WorkerRuntime,
  householdId: string,
): Promise<Date | null> {
  const [row] = await rt.db
    .select({ at: sql<Date | string | null>`max(${chatMessage.createdAt})` })
    .from(chatMessage)
    .where(
      and(
        eq(chatMessage.householdId, householdId),
        eq(chatMessage.role, "event"),
        sql`${chatMessage.content} -> 'cards' @> '[{"type":"insight_digest"}]'::jsonb`,
      ),
    );
  const at = row?.at ?? null;
  return at === null ? null : new Date(at);
}

type AutomaticChanges = NonNullable<Parameters<typeof insightDigestEvent>[1]>;
type Move = AutomaticChanges[number]["moves"][number];

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    : [];
}

/**
 * The FBK-5 portion moves review learning applied after `since` and up to `until` (SPEC-Q-1):
 * `learning` change sets by the system actor whose ops include `portion_bias.set`, oldest first,
 * with the member's name and the bias before (from the stored before-image; 1.0 when the row was
 * new) and after.
 */
export async function automaticChangesSince(
  rt: WorkerRuntime,
  householdId: string,
  since: Date | null,
  until: Date,
): Promise<AutomaticChanges> {
  const rows = await rt.db
    .select()
    .from(changeSet)
    .where(
      and(
        eq(changeSet.householdId, householdId),
        eq(changeSet.source, "learning"),
        eq(changeSet.actor, "system"),
        sql`${changeSet.forward} @> '[{"kind":"portion_bias.set"}]'::jsonb`,
        lte(changeSet.appliedAt, until),
        ...(since === null ? [] : [gt(changeSet.appliedAt, since)]),
      ),
    )
    .orderBy(asc(changeSet.appliedAt), asc(changeSet.id));
  if (rows.length === 0) return [];
  const names = new Map(
    (
      await rt.db
        .select({ id: member.id, name: member.displayName })
        .from(member)
        .where(eq(member.householdId, householdId))
    ).map((m) => [m.id, m.name]),
  );
  return rows.map((row) => {
    const before = new Map<string, number>();
    for (const op of records(row.inverse))
      for (const image of records((op.payload as { images?: unknown } | undefined)?.images)) {
        const key = image.key as { memberId?: unknown; componentRole?: unknown } | undefined;
        if (image.entity !== "portion_bias" || key === undefined) continue;
        const b = (image.before as { bias?: unknown } | null | undefined)?.bias;
        before.set(
          `${String(key.memberId)}/${String(key.componentRole)}`,
          b == null ? 1 : Number(b),
        );
      }
    const moves: Move[] = [];
    for (const op of records(row.forward)) {
      if (op.kind !== "portion_bias.set") continue;
      const p = (op.payload ?? {}) as {
        memberId?: unknown;
        componentRole?: unknown;
        bias?: unknown;
      };
      if (typeof p.memberId !== "string" || typeof p.componentRole !== "string") continue;
      moves.push({
        memberName: names.get(p.memberId) ?? "Someone",
        role: p.componentRole,
        before: before.get(`${p.memberId}/${p.componentRole}`) ?? 1,
        after: Number(p.bias),
      });
    }
    return {
      changeSetId: row.id,
      summary: row.summary,
      appliedAt: row.appliedAt,
      undone: row.undoneAt !== null,
      moves,
    };
  });
}

/**
 * Posts an insights digest: into the conversation that asked for the run (the agent's
 * `run_insights`), else to every active admin when the run found something. It lists the portion
 * moves learning made since the household's previous digest (W-9a).
 */
export async function postInsightDigest(
  rt: WorkerRuntime,
  job: JobRow,
  digest: InsightDigest,
): Promise<string[]> {
  const householdId = job.householdId;
  if (householdId === null) return [];
  // The digest is stored as of `now`: a change applied while it is being posted falls in the next
  // digest's window instead of neither.
  const now = new Date();
  const automatic = await automaticChangesSince(
    rt,
    householdId,
    await previousDigestAt(rt, householdId),
    now,
  );
  const content = insightDigestEvent(digest, automatic);
  // The admin asked in chat: answer there, even when there is nothing new.
  const asked = await startingConversation(rt, job);
  if (asked !== null) return [await insertEvent(rt, householdId, asked, content, now)];
  if (!digestHasNews(digest, automatic)) return [];
  const ids: string[] = [];
  for (const userId of await activeAdmins(rt, householdId))
    ids.push(
      await insertEvent(
        rt,
        householdId,
        await conversationFor(rt, householdId, userId),
        content,
        now,
      ),
    );
  return ids;
}

/** The conversation that started a job (agent jobs carry `conversationId`), in its household. */
async function startingConversation(rt: WorkerRuntime, job: JobRow): Promise<string | null> {
  const id = (job.payload as { conversationId?: unknown } | null)?.conversationId;
  if (typeof id !== "string" || job.householdId === null) return null;
  const [row] = await rt.db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.householdId, job.householdId), eq(conversation.id, id)));
  return row?.id ?? null;
}

export type JobOutcome = { ok: true; result: Json } | { ok: false; error: Json };

/** What the plan-ready row needs from a plan, stored in the job result as `ready` (R-1). */
export function planReadySummary(plan: PlanResult): Json {
  return {
    dates: plan.dates,
    meals: plan.days.flatMap((d) =>
      d.meals.map((m) => ({
        slotTypeId: m.slotTypeId,
        slotLabel: m.slotLabel,
        isPacked: m.isPacked,
        attendees: m.attendees,
        targeted: m.plates.some((p) => p.targeted),
        offTarget: m.plates.some((p) => p.targeted && p.fitStatus !== "in_tolerance"),
      })),
    ),
  };
}

type PlanReadyInput = NonNullable<Parameters<typeof jobCompletionEvent>[1]>;

/** The job result's `ready` summary with names and training slots, or null if it has none. */
async function planReadyInput(
  rt: WorkerRuntime,
  householdId: string,
  result: Json,
): Promise<PlanReadyInput | null> {
  const ready = (result as { ready?: unknown } | null)?.ready as
    { dates?: unknown; meals?: unknown } | undefined;
  if (ready === undefined || !Array.isArray(ready.dates) || !Array.isArray(ready.meals))
    return null;
  const meals = records(ready.meals);
  const names = new Map(
    (
      await rt.db
        .select({ id: member.id, name: member.displayName })
        .from(member)
        .where(eq(member.householdId, householdId))
    ).map((m) => [m.id, m.name]),
  );
  const slotIds = [
    ...new Set(meals.map((m) => m.slotTypeId).filter((id) => typeof id === "string")),
  ];
  const training = new Set(
    slotIds.length === 0
      ? []
      : (
          await rt.db
            .select({ id: slotType.id })
            .from(slotType)
            .where(
              and(
                eq(slotType.householdId, householdId),
                inArray(slotType.id, slotIds),
                eq(slotType.isTrainingSlot, true),
              ),
            )
        ).map((s) => s.id),
  );
  return {
    dates: ready.dates.filter((d): d is string => typeof d === "string"),
    meals: meals.map((m) => ({
      slotLabel: typeof m.slotLabel === "string" ? m.slotLabel : "",
      isPacked: m.isPacked === true,
      isTraining: typeof m.slotTypeId === "string" && training.has(m.slotTypeId),
      attendees: (Array.isArray(m.attendees) ? m.attendees : [])
        .map((id) => names.get(String(id)))
        .filter((n): n is string => n !== undefined),
      targeted: m.targeted === true,
      offTarget: m.offTarget === true,
    })),
  };
}

/**
 * The day and slot a `recipe.draft` request named, with the slot's label, when it named both and
 * the slot exists (leaf 1.4.9, R-61): the recipe card's "Use for <Day> <slot>" link.
 */
async function requestedUse(
  rt: WorkerRuntime,
  householdId: string,
  job: JobRow,
): Promise<{ date: string; slotKey: string; slotLabel: string } | undefined> {
  const p = (job.payload ?? {}) as { date?: unknown; slot?: unknown };
  if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return undefined;
  if (typeof p.slot !== "string" || p.slot === "") return undefined;
  const [slot] = await rt.db
    .select({ key: slotType.key, label: slotType.label })
    .from(slotType)
    .where(and(eq(slotType.householdId, householdId), eq(slotType.key, p.slot)));
  return slot === undefined
    ? undefined
    : { date: p.date, slotKey: slot.key, slotLabel: slot.label };
}

/** True when an agent turn started the job (its payload names the conversation; R-46, R-49). */
function agentStarted(job: JobRow): boolean {
  const p = (job.payload ?? {}) as { conversationId?: unknown; source?: unknown };
  return p.conversationId !== undefined || p.source === "agent";
}

/**
 * Posts the completion of a job the agent started into its conversation. A succeeded plan job no
 * agent turn started is announced to every active admin as the digest is (W-9b, SPEC-Q-4). Other
 * jobs post nothing. A successful insights run has already posted its digest.
 */
export async function postJobCompletion(
  rt: WorkerRuntime,
  job: JobRow,
  outcome: JobOutcome,
): Promise<string[]> {
  if (job.kind === "insights.run" && outcome.ok) return [];
  const householdId = job.householdId;
  if (householdId === null) return [];
  if (!agentStarted(job)) {
    if (job.kind !== "plan.generate" || !outcome.ok) return [];
    const plan = await planReadyInput(rt, householdId, outcome.result);
    if (plan === null) return [];
    const content = jobCompletionEvent(
      { id: job.id, kind: job.kind, status: "succeeded", result: outcome.result },
      plan,
    );
    const ids: string[] = [];
    for (const userId of await activeAdmins(rt, householdId))
      ids.push(
        await insertEvent(rt, householdId, await conversationFor(rt, householdId, userId), content),
      );
    return ids;
  }
  const conversationId = await startingConversation(rt, job);
  if (conversationId === null) return [];
  const use = job.kind === "recipe.draft" ? await requestedUse(rt, householdId, job) : undefined;
  const content = jobCompletionEvent({
    id: job.id,
    kind: job.kind,
    status: outcome.ok ? "succeeded" : "failed",
    result: outcome.ok ? outcome.result : outcome.error,
    ...(use === undefined ? {} : { use }),
  });
  return [await insertEvent(rt, householdId, conversationId, content)];
}
