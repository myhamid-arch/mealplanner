// `reviews.extract` (ARC-7; R-40, R-46; leaf-1.3.5 SPEC-Q-15): the FBK-3 tags implied by a new
// review's comment. Extraction never touches `processed_at` (the insights run's marker); it stores
// `extracted_tags` / `extracted_at` once, and applies what the added tags teach as one `learning`
// change set, exactly as an edit that added them would (1.3.2's relearn with the author's tags as
// the previous signals). Without a credential the job reports extraction disabled (REC-2).
import { and, eq, isNull } from "drizzle-orm";
import { extractReviewTags } from "@mealplanner/ai/reviews";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos } from "@mealplanner/db/repos";
import { dish, review } from "@mealplanner/db/schema";
import { recordAiGeneration } from "@mealplanner/db/services/plans";
import { learnFromReview } from "@mealplanner/db/services/reviews";
import { toJson, type JobHandler } from "../runner.js";
import { followUpsOf } from "./handlers.js";

function systemCtx(householdId: string): HouseholdContext {
  return { householdId, userId: null, role: "system" };
}

export const reviewsExtract: JobHandler = async (ctx) => {
  const { reviewId } = ctx.job.payload as { reviewId: string };
  const hh = systemCtx(ctx.household().householdId);
  const repos = createRepos(ctx.rt.db, hh);
  const row = await repos.review.get({ id: reviewId });
  if (row === null) return toJson({ status: "skipped", reason: "review not found" });
  const comment = row.comment?.trim() ?? "";
  if (row.parentReviewId !== null) return toJson({ status: "skipped", reason: "a reply" });
  if (comment === "") return toJson({ status: "skipped", reason: "no comment" });
  if (row.extractedAt !== null) return toJson({ status: "skipped", reason: "already extracted" });

  const names = (await repos.member.list()).map((m) => m.displayName);
  let about: string = row.targetType;
  if (row.targetType === "dish") {
    const [d] = await ctx.rt.db
      .select({ name: dish.name })
      .from(dish)
      .where(eq(dish.id, row.targetId));
    if (d !== undefined) about = `dish: ${d.name}`;
  }
  const result = await extractReviewTags(
    {
      model: ctx.rt.model,
      ...(ctx.rt.modelDisabledReason === null
        ? {}
        : { disabledReason: ctx.rt.modelDisabledReason }),
      recordGeneration: (record) => recordAiGeneration(ctx.rt.db, hh, record),
    },
    { comment, authorTags: row.tags, about, names },
  );
  if (result.status === "disabled") return toJson({ status: "disabled", reason: result.reason });
  if (result.status === "failed")
    throw new Error(`extraction failed (${result.code}): ${result.message}`);

  // Once only: a concurrent run or an earlier success leaves the row as it is.
  const [updated] = await ctx.rt.db
    .update(review)
    .set({ extractedTags: result.tags, extractedAt: new Date() })
    .where(
      and(
        eq(review.householdId, hh.householdId),
        eq(review.id, row.id),
        isNull(review.extractedAt),
      ),
    )
    .returning();
  if (updated === undefined) return toJson({ status: "skipped", reason: "already extracted" });

  let learningChangeSetId: string | null = null;
  if (result.tags.length > 0)
    learningChangeSetId = await learnFromReview(
      ctx.rt.db,
      hh,
      { ...updated, tags: [...updated.tags, ...result.tags] },
      { rating: updated.rating, tags: updated.tags },
    );
  const followUps = await followUpsOf(ctx.rt, hh.householdId, learningChangeSetId);
  return toJson({
    status: "extracted",
    tags: result.tags,
    generationId: result.generationId,
    learningChangeSetId,
    followUps,
  });
};
