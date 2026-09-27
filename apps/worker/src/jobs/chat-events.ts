// Proactive chat messages (AGT-7; leaf-1.3.5 SPEC-Q-9, R-46): the insights digest goes to every
// active admin's most recent conversation (or a new "Updates" conversation), and a job the agent
// started posts its completion into the conversation that started it. Event rows are display only
// (they are not replayed to the model; SPEC-Q-3).
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  digestHasNews,
  insightDigestEvent,
  jobCompletionEvent,
  type Json,
} from "@mealplanner/ai/agent";
import { chatMessage, conversation, householdUser, newId } from "@mealplanner/db/schema";
import type { InsightDigest } from "@mealplanner/db/services/proposals";
import type { JobRow } from "@mealplanner/db/services/plans";
import type { WorkerRuntime } from "../runtime.js";

export const UPDATES_TITLE = "Updates";

async function insertEvent(
  rt: WorkerRuntime,
  householdId: string,
  conversationId: string,
  content: Json,
): Promise<string> {
  const id = newId();
  await rt.db.insert(chatMessage).values({
    id,
    householdId,
    conversationId,
    role: "event",
    content,
    createdAt: new Date(),
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

/**
 * Posts an insights digest: into the conversation that asked for the run (the agent's
 * `run_insights`), else to every active admin when the run found something.
 */
export async function postInsightDigest(
  rt: WorkerRuntime,
  job: JobRow,
  digest: InsightDigest,
): Promise<string[]> {
  const householdId = job.householdId;
  if (householdId === null) return [];
  const content = insightDigestEvent(digest);
  // The admin asked in chat: answer there, even when there is nothing new.
  const asked = await startingConversation(rt, job);
  if (asked !== null) return [await insertEvent(rt, householdId, asked, content)];
  if (!digestHasNews(digest)) return [];
  const admins = await rt.db
    .select({ userId: householdUser.userId })
    .from(householdUser)
    .where(
      and(
        eq(householdUser.householdId, householdId),
        eq(householdUser.role, "admin"),
        eq(householdUser.status, "active"),
      ),
    );
  const ids: string[] = [];
  for (const a of admins)
    ids.push(
      await insertEvent(rt, householdId, await conversationFor(rt, householdId, a.userId), content),
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

/**
 * Posts the completion of a job the agent started; other jobs post nothing. A successful insights
 * run has already posted its digest there.
 */
export async function postJobCompletion(
  rt: WorkerRuntime,
  job: JobRow,
  outcome: JobOutcome,
): Promise<string | null> {
  if (job.kind === "insights.run" && outcome.ok) return null;
  const conversationId = await startingConversation(rt, job);
  if (conversationId === null || job.householdId === null) return null;
  const content = jobCompletionEvent({
    id: job.id,
    kind: job.kind,
    status: outcome.ok ? "succeeded" : "failed",
    result: outcome.ok ? outcome.result : outcome.error,
  });
  return insertEvent(rt, job.householdId, conversationId, content);
}
