// Reviews and taste preferences (FBK-2, FBK-9, ARC-6; leaf-1.4.1 SPEC-Q-17):
// - kitchen users write kitchen tags only (no rating, no comment);
// - members review for their own member, or a younger sibling when the household allows it (the
//   reviews service enforces who may be reviewed for);
// - members set and reset only their own member's preferences.
// A new review triggers the insights run once 10 are unprocessed (FBK-7), and a review that
// taught something (a `learning` change set) triggers its follow-ups.
import { inArray } from "drizzle-orm";
import type { z } from "zod";
import type {
  PreferenceResetBody,
  PreferenceSetBody,
  ReviewCreateBody,
} from "@mealplanner/api-contract/contract";
import { createRepos } from "@mealplanner/db/repos";
import { review, reviewReaction, user } from "@mealplanner/db/schema";
import { applyChangeSet } from "@mealplanner/db/services/changes";
import { insightsDue } from "@mealplanner/db/services/proposals";
import {
  createReview,
  editReview,
  reactToReview,
  replyToReview,
  reviewRevisions,
} from "@mealplanner/db/services/reviews";
import type { CallerContext } from "../auth/context";
import { afterChangeSet } from "./followups";
import { enqueueJob } from "./jobs";
import { ProblemError, forbidden, notFound } from "./problem";
import type { Runtime } from "./runtime";
import { plain } from "./serialize";

/** FBK-3 kitchen group. */
export const KITCHEN_TAGS: ReadonlySet<string> = new Set([
  "ingredient_unavailable",
  "recipe_unclear",
  "quantity_wrong",
]);

type ReviewRow = typeof review.$inferSelect;

async function reviewDtos(rt: Runtime, rows: readonly ReviewRow[]) {
  if (rows.length === 0) return [];
  const authors = new Map(
    (
      await rt.db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, [...new Set(rows.map((r) => r.authorUserId))]))
    ).map((u) => [u.id, u.name]),
  );
  const reactions = await rt.db
    .select()
    .from(reviewReaction)
    .where(
      inArray(
        reviewReaction.reviewId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => {
    const mine = reactions.filter((x) => x.reviewId === r.id);
    return {
      ...plain(r),
      authorName: authors.get(r.authorUserId) ?? "",
      reactions: {
        agree: mine.filter((x) => x.kind === "agree").length,
        disagree: mine.filter((x) => x.kind === "disagree").length,
        helpful: mine.filter((x) => x.kind === "helpful").length,
      },
    };
  });
}

export async function listReviews(
  rt: Runtime,
  caller: CallerContext,
  q: {
    targetType?: string | undefined;
    targetId?: string | undefined;
    memberId?: string | undefined;
    parentId?: string | undefined;
    limit: number;
  },
) {
  const rows = await createRepos(rt.db, caller.ctx).review.list();
  const picked = rows
    .filter(
      (r) =>
        (q.targetType === undefined || r.targetType === q.targetType) &&
        (q.targetId === undefined || r.targetId === q.targetId) &&
        (q.memberId === undefined || r.onBehalfOfMemberId === q.memberId) &&
        (q.parentId === undefined ? true : r.parentReviewId === q.parentId),
    )
    .filter((r) => caller.ctx.role !== "kitchen" || r.tags.some((t) => KITCHEN_TAGS.has(t)))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
    .slice(0, q.limit);
  const dtos = await reviewDtos(rt, picked);
  if (caller.ctx.role !== "kitchen") return { reviews: dtos };
  // SPEC-Q-17: the kitchen works with kitchen tags only; no ratings or comments, and no author
  // names unless the household shows names to the kitchen (ARC-6).
  const hideNames = !caller.household.kitchenSeesNames;
  return {
    reviews: dtos.map((d) => ({
      ...d,
      rating: null,
      comment: null,
      tags: d.tags.filter((t) => KITCHEN_TAGS.has(t)),
      authorName: hideNames && d.authorUserId !== caller.ctx.userId ? "" : d.authorName,
    })),
  };
}

async function one(rt: Runtime, row: ReviewRow) {
  const [dto] = await reviewDtos(rt, [row]);
  if (dto === undefined) throw new Error("review vanished");
  return dto;
}

async function afterReview(rt: Runtime, caller: CallerContext, learningChangeSetId: string | null) {
  if (learningChangeSetId !== null)
    await afterChangeSet(rt, caller.ctx.householdId, learningChangeSetId, null);
  if (await insightsDue(rt.db, caller.ctx))
    await enqueueJob(rt.db, rt.queue, {
      kind: "insights.run",
      householdId: caller.ctx.householdId,
      payload: { trigger: "reviews" },
      createdByUserId: null,
    });
}

/** Kitchen users: no rating, no comment, and tags (when given) only from the kitchen group. */
function kitchenOnly(
  caller: CallerContext,
  input: {
    rating?: number | null | undefined;
    comment?: string | null | undefined;
    tags?: readonly string[] | undefined;
  },
  tagsRequired: boolean,
) {
  if (caller.ctx.role !== "kitchen") return;
  const tags = input.tags;
  const badTags =
    tags !== undefined && (tags.length === 0 || tags.some((t) => !KITCHEN_TAGS.has(t)));
  if (
    (input.rating ?? null) !== null ||
    (input.comment ?? null) !== null ||
    badTags ||
    (tagsRequired && tags === undefined)
  )
    throw forbidden(
      "kitchen_tags_only",
      "kitchen users write kitchen tags only (ingredient unavailable, recipe unclear, quantity wrong)",
    );
}

export async function writeReview(
  rt: Runtime,
  caller: CallerContext,
  body: z.output<typeof ReviewCreateBody>,
) {
  kitchenOnly(caller, body, true);
  const result = await createReview(rt.db, caller.ctx, {
    targetType: body.targetType,
    targetId: body.targetId,
    ...(body.onBehalfOfMemberId === undefined
      ? {}
      : { onBehalfOfMemberId: body.onBehalfOfMemberId }),
    ...(body.planMealId === undefined ? {} : { planMealId: body.planMealId }),
    rating: body.rating ?? null,
    tags: body.tags,
    comment: body.comment ?? null,
  });
  await afterReview(rt, caller, result.learningChangeSetId);
  return one(rt, result.review);
}

export async function changeReview(
  rt: Runtime,
  caller: CallerContext,
  id: string,
  edit: {
    rating?: number | null | undefined;
    tags?: string[] | undefined;
    comment?: string | null | undefined;
  },
) {
  kitchenOnly(caller, edit, false);
  const result = await editReview(rt.db, caller.ctx, id, {
    ...(edit.rating === undefined ? {} : { rating: edit.rating }),
    ...(edit.tags === undefined ? {} : { tags: edit.tags }),
    ...(edit.comment === undefined ? {} : { comment: edit.comment }),
  });
  await afterReview(rt, caller, result.learningChangeSetId);
  return one(rt, result.review);
}

export async function reply(rt: Runtime, caller: CallerContext, parentId: string, comment: string) {
  return one(rt, await replyToReview(rt.db, caller.ctx, parentId, { comment }));
}

export async function react(
  rt: Runtime,
  caller: CallerContext,
  id: string,
  kind: "agree" | "disagree" | "helpful",
) {
  await reactToReview(rt.db, caller.ctx, id, kind, true);
  return { ok: true as const };
}

export async function revisions(rt: Runtime, caller: CallerContext, id: string) {
  return { revisions: plain(await reviewRevisions(rt.db, caller.ctx, id)) };
}

// Preferences ------------------------------------------------------------------------------------

function ownPreference(caller: CallerContext, memberId: string | null) {
  if (caller.ctx.role === "admin") return;
  if (memberId === null || memberId !== caller.memberId)
    throw forbidden("forbidden_member", "members may change only their own taste preferences");
}

export async function setPreference(
  rt: Runtime,
  caller: CallerContext,
  body: z.output<typeof PreferenceSetBody>,
) {
  ownPreference(caller, body.memberId);
  if (
    body.memberId !== null &&
    (await createRepos(rt.db, caller.ctx).member.get({ id: body.memberId })) === null
  )
    throw notFound("member");
  const applied = await applyChangeSet(rt.db, caller.ctx, {
    actor: "user",
    source: "ui",
    summary: "Set a taste preference",
    ops: [
      {
        kind: "preference.set",
        payload: {
          memberId: body.memberId,
          entityType: body.entityType,
          entityKey: body.entityKey,
          score: body.score,
          source: "explicit",
          locked: body.locked,
          hard: body.hard,
        },
      },
    ],
  });
  await afterChangeSet(rt, caller.ctx.householdId, applied.changeSetId, caller.ctx.userId);
  return { changeSetId: applied.changeSetId };
}

export async function resetPreference(
  rt: Runtime,
  caller: CallerContext,
  body: z.output<typeof PreferenceResetBody>,
) {
  ownPreference(caller, body.memberId);
  const existing = await createRepos(rt.db, caller.ctx).preference.list({
    memberId: body.memberId,
    entityType: body.entityType,
    entityKey: body.entityKey,
  });
  if (existing.length === 0)
    throw new ProblemError(422, "no_preference", "there is no such preference to reset");
  const applied = await applyChangeSet(rt.db, caller.ctx, {
    actor: "user",
    source: "ui",
    summary: "Reset a taste preference",
    ops: [
      {
        kind: "preference.reset",
        payload: {
          memberId: body.memberId,
          entityType: body.entityType,
          entityKey: body.entityKey,
        },
      },
    ],
  });
  await afterChangeSet(rt, caller.ctx.householdId, applied.changeSetId, caller.ctx.userId);
  return { changeSetId: applied.changeSetId };
}
