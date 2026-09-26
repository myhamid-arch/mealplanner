// The change log and its undo (R2-ADM-7, SC-4), the configuration write path `POST /change-sets`
// (DM-6; leaf-1.4.1 SPEC-Q-1), proposals (FBK-9), the insights trigger, conversations (reads;
// the streaming POST is 1.3.5's, R-40), jobs and diagnostics (ARC-12, R-40).
import { and, asc, desc, eq } from "drizzle-orm";
import type { ChangeArea } from "@mealplanner/core/changes";
import { createRepos } from "@mealplanner/db/repos";
import {
  aiGeneration,
  chatMessage,
  conversation,
  newId,
  supportAccess,
  user,
} from "@mealplanner/db/schema";
import {
  applyChangeSet,
  listChangeSets,
  previewChangeSet,
  undoChangeSet,
  type UndoAvailability,
} from "@mealplanner/db/services/changes";
import { failedJobs, jobOf } from "@mealplanner/db/services/plans";
import { acceptProposal, listProposals, rejectProposal } from "@mealplanner/db/services/proposals";
import type { HouseholdContext } from "@mealplanner/core/types";
import type { CallerContext } from "../auth/context";
import { afterChangeSet } from "./followups";
import { enqueueJob } from "./jobs";
import { notFound } from "./problem";
import type { Runtime } from "./runtime";
import { iso, plain } from "./serialize";

function undoDto(u: UndoAvailability) {
  if (u.ok) return { available: true, reason: null };
  if (u.reason === "already_undone") return { available: false, reason: "Already undone" };
  return {
    available: false,
    reason: `A later change touched the same settings: ${u.conflicts.map((c) => `"${c.summary}"`).join(", ")}`,
  };
}

export const SUPPORT_VIEW_UNDO = "a support view changes nothing";

/** The change log, newest first, with support views merged in (R2-ADM-7, R2-ADM-8; SPEC-Q-7). */
export async function changeLog(
  rt: Runtime,
  ctx: HouseholdContext,
  q: { area?: string | undefined; limit: number },
) {
  const entries = await listChangeSets(rt.db, ctx, {
    ...(q.area === undefined || q.area === "support" ? {} : { area: q.area as ChangeArea }),
    limit: q.limit,
  });
  const changes =
    q.area === "support"
      ? []
      : entries.map((e) => ({
          type: "change_set" as const,
          id: e.changeSet.id,
          actor: e.changeSet.actor,
          actorUserId: e.changeSet.actorUserId,
          source: e.changeSet.source,
          summary: e.changeSet.summary,
          areas: e.areas,
          appliedAt: e.changeSet.appliedAt.toISOString(),
          undoneAt: iso(e.changeSet.undoneAt),
          undoneByChangeSetId: e.changeSet.undoneByChangeSetId,
          undo: undoDto(e.undo),
          at: e.changeSet.appliedAt,
        }));
  const views =
    q.area === undefined || q.area === "support"
      ? await rt.db
          .select({ access: supportAccess, email: user.email })
          .from(supportAccess)
          .innerJoin(user, eq(user.id, supportAccess.operatorUserId))
          .where(eq(supportAccess.householdId, ctx.householdId))
          .orderBy(desc(supportAccess.createdAt))
          .limit(q.limit)
      : [];
  const support = views.map((v) => ({
    type: "support_view" as const,
    id: v.access.id,
    operatorUserId: v.access.operatorUserId,
    operatorEmail: v.email,
    method: v.access.method,
    path: v.access.path,
    at: v.access.createdAt,
    undo: { available: false as const, reason: SUPPORT_VIEW_UNDO },
  }));
  const merged = [...changes, ...support]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, q.limit);
  return {
    entries: merged.map(({ at, ...e }) =>
      e.type === "support_view" ? { ...e, at: at.toISOString() } : e,
    ),
  };
}

export async function changeSetOne(rt: Runtime, caller: CallerContext, id: string) {
  const row = await createRepos(rt.db, caller.ctx).change_set.get({ id });
  if (row === null) throw notFound("change set");
  return plain(row);
}

export async function applyOps(
  rt: Runtime,
  caller: CallerContext,
  body: { summary: string; ops: unknown[] },
) {
  const applied = await applyChangeSet(rt.db, caller.ctx, {
    actor: "user",
    source: "ui",
    summary: body.summary,
    ops: body.ops,
  });
  await afterChangeSet(rt, caller.ctx.householdId, applied.changeSetId, caller.ctx.userId);
  return { changeSetId: applied.changeSetId, descriptions: applied.descriptions };
}

export async function previewOps(rt: Runtime, caller: CallerContext, ops: unknown[]) {
  return { descriptions: await previewChangeSet(rt.db, caller.ctx, ops) };
}

export async function undo(rt: Runtime, caller: CallerContext, id: string) {
  const result = await undoChangeSet(rt.db, caller.ctx, id, { actor: "user", source: "ui" });
  await afterChangeSet(rt, caller.ctx.householdId, result.changeSetId, caller.ctx.userId);
  return { changeSetId: result.changeSetId };
}

// Proposals --------------------------------------------------------------------------------------

export async function proposals(rt: Runtime, caller: CallerContext, status: string | undefined) {
  const rows = await listProposals(
    rt.db,
    caller.ctx,
    status === undefined ? {} : { status: status as never },
  );
  return { proposals: plain(rows) };
}

export async function accept(rt: Runtime, caller: CallerContext, id: string) {
  const result = await acceptProposal(rt.db, caller.ctx, id);
  await afterChangeSet(rt, caller.ctx.householdId, result.changeSet.changeSetId, caller.ctx.userId);
  return { proposal: plain(result.proposal), changeSetId: result.changeSet.changeSetId };
}

export async function reject(
  rt: Runtime,
  caller: CallerContext,
  id: string,
  note: string | undefined,
) {
  return { proposal: plain(await rejectProposal(rt.db, caller.ctx, id, note ?? null)) };
}

export async function runInsightsNow(rt: Runtime, caller: CallerContext) {
  const jobId = await enqueueJob(rt.db, rt.queue, {
    kind: "insights.run",
    householdId: caller.ctx.householdId,
    payload: { trigger: "on_demand" },
    createdByUserId: caller.ctx.userId,
  });
  return { jobId };
}

// Conversations (reads) --------------------------------------------------------------------------

/** An admin sees their own conversations (07 §5: the admin's conversation list). */
async function ownConversation(rt: Runtime, caller: CallerContext, id: string) {
  const row = await createRepos(rt.db, caller.ctx).conversation.get({ id });
  if (row === null || row.userId !== caller.ctx.userId) throw notFound("conversation");
  return row;
}

export async function conversations(rt: Runtime, caller: CallerContext) {
  const rows = await rt.db
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.householdId, caller.ctx.householdId),
        eq(conversation.userId, caller.ctx.userId),
      ),
    )
    .orderBy(desc(conversation.createdAt));
  return { conversations: plain(rows) };
}

export async function createConversation(rt: Runtime, caller: CallerContext, title: string) {
  const row = {
    id: newId(),
    householdId: caller.ctx.householdId,
    userId: caller.ctx.userId,
    title,
    createdAt: new Date(),
    archivedAt: null,
  };
  await rt.db.insert(conversation).values(row);
  return plain(row);
}

export async function conversationOne(rt: Runtime, caller: CallerContext, id: string) {
  return plain(await ownConversation(rt, caller, id));
}

export async function messages(rt: Runtime, caller: CallerContext, id: string) {
  await ownConversation(rt, caller, id);
  const rows = await rt.db
    .select()
    .from(chatMessage)
    .where(
      and(eq(chatMessage.householdId, caller.ctx.householdId), eq(chatMessage.conversationId, id)),
    )
    .orderBy(asc(chatMessage.createdAt), asc(chatMessage.id));
  return { messages: plain(rows) };
}

// Jobs and diagnostics ---------------------------------------------------------------------------

export async function jobStatus(rt: Runtime, caller: CallerContext, id: string) {
  const row = await jobOf(rt.db, caller.ctx, id);
  if (row === null) throw notFound("job");
  return plain(row);
}

/** ARC-12 (R-40): the household's last 50 AI calls and its failed jobs. */
export async function diagnostics(rt: Runtime, caller: CallerContext) {
  const calls = await rt.db
    .select()
    .from(aiGeneration)
    .where(eq(aiGeneration.householdId, caller.ctx.householdId))
    .orderBy(desc(aiGeneration.createdAt))
    .limit(50);
  const failed = await failedJobs(rt.db, { householdId: caller.ctx.householdId }, 50);
  return {
    aiCalls: calls.map((c) => ({
      id: c.id,
      purpose: c.purpose,
      model: c.model,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      cacheReadTokens: c.cacheReadTokens,
      stopReason: c.stopReason,
      hasValidationErrors: c.validationErrors !== null,
      createdAt: c.createdAt.toISOString(),
    })),
    failedJobs: plain(failed),
  };
}
