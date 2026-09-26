// FBK-2 reviews service: targets, on-behalf-of rules (SPEC-Q-12), replies, reactions, author-only
// 24 h edits kept as review_revision rows (R-26), relearning on edit (SPEC-Q-11), and isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveScore } from "@mealplanner/core/learning/preferences";
import { createRepos } from "../../src/repos/index.js";
import { CrossHouseholdError } from "../../src/repos/index.js";
import { applyChangeSet } from "../../src/services/changes/index.js";
import {
  REVIEW_EDIT_WINDOW_MS,
  ReviewEditWindowError,
  ReviewPermissionError,
  ReviewTargetError,
  ReviewValidationError,
  createReview,
  editReview,
  reactToReview,
  replyToReview,
  reviewRevisions,
} from "../../src/services/reviews/index.js";
import type { TestDatabase } from "../support/db.js";
import { must } from "../support/must.js";
import { f1WithDish, reviewDatabase, reviewHousehold, type ReviewHousehold } from "./support.js";

let database: TestDatabase;
let h: ReviewHousehold;
let other: ReviewHousehold;
beforeAll(async () => {
  database = await reviewDatabase();
  h = await reviewHousehold(database);
  other = await reviewHousehold(database, f1WithDish({ id: "F1-other" }));
}, 120_000);
afterAll(async () => {
  await database.drop();
});

const dishReview = (user: string, extra: Record<string, unknown> = {}) =>
  createReview(database.db, h.as(user), {
    targetType: "dish",
    targetId: h.dishId,
    rating: 4,
    ...extra,
  });

describe("FBK-2 reviews service (PostgreSQL)", { timeout: 120_000 }, () => {
  it("creates a review on behalf of the author's linked member by default, with its meal context", async () => {
    const { review } = await dishReview("adult_b", {
      planMealId: h.planMealId,
      tags: [" tasty ", "tasty"],
      comment: "  Good  ",
    });
    expect(review).toMatchObject({
      onBehalfOfMemberId: h.member("adult_b"),
      planMealId: h.planMealId,
      tags: ["tasty"],
      comment: "Good",
      parentReviewId: null,
      editedAt: null,
      processedAt: null,
    });
    const plate = must(
      (await createRepos(database.db, h.as("adult_a")).plate.list({ planMealId: h.planMealId }))[0],
      "plate",
    );
    const byPlate = await createReview(database.db, h.as("adult_a"), {
      targetType: "plate",
      targetId: plate.id,
      rating: 3,
    });
    expect(byPlate.review.planMealId).toBe(h.planMealId);
  });

  it("validates the rating, the content and the target", async () => {
    await expect(dishReview("adult_a", { rating: 6 })).rejects.toBeInstanceOf(
      ReviewValidationError,
    );
    await expect(dishReview("adult_a", { rating: null })).rejects.toBeInstanceOf(
      ReviewValidationError,
    );
    await expect(dishReview("adult_a", { tags: [""] })).rejects.toBeInstanceOf(
      ReviewValidationError,
    );
    await expect(
      createReview(database.db, h.as("adult_a"), {
        targetType: "cuisine",
        targetId: "martian",
        rating: 3,
      }),
    ).rejects.toBeInstanceOf(ReviewTargetError);
    await expect(
      createReview(database.db, h.as("adult_a"), {
        targetType: "plan_meal",
        targetId: h.planMealId,
        planMealId: other.planMealId,
        rating: 3,
      }),
    ).rejects.toThrow();
    const noReview = (await createRepos(database.db, h.as("adult_a")).review.list({ rating: 6 }))
      .length;
    expect(noReview).toBe(0);
  });

  it("on-behalf-of: admins choose any member; members themselves or a younger sibling; kitchen nobody (SPEC-Q-12)", async () => {
    await expect(
      dishReview("adult_a", { onBehalfOfMemberId: h.member("c3") }),
    ).resolves.toBeDefined();
    await expect(dishReview("c1", { onBehalfOfMemberId: h.member("c3") })).resolves.toBeDefined();
    await expect(
      dishReview("c1", { onBehalfOfMemberId: h.member("adult_b") }),
    ).rejects.toBeInstanceOf(ReviewPermissionError);
    await expect(
      dishReview("kitchen", { onBehalfOfMemberId: h.member("c3") }),
    ).rejects.toBeInstanceOf(ReviewPermissionError);
    const kitchen = await dishReview("kitchen", { rating: 1 });
    expect(kitchen.review.onBehalfOfMemberId).toBeNull();
    expect(kitchen.learningChangeSetId).toBeNull();
    // With the household setting off, a member may not review for a sibling.
    await applyChangeSet(database.db, h.as("adult_a"), {
      actor: "user",
      source: "ui",
      summary: "Siblings off",
      ops: [{ kind: "household.update", payload: { membersReviewForSiblings: false } }],
    });
    await expect(dishReview("c1", { onBehalfOfMemberId: h.member("c3") })).rejects.toBeInstanceOf(
      ReviewPermissionError,
    );
    await applyChangeSet(database.db, h.as("adult_a"), {
      actor: "user",
      source: "ui",
      summary: "Siblings on",
      ops: [{ kind: "household.update", payload: { membersReviewForSiblings: true } }],
    });
  });

  it("replies keep the parent's target and teach nothing; reactions toggle idempotently", async () => {
    const { review } = await dishReview("adult_b");
    const prefsBefore = JSON.stringify(
      await createRepos(database.db, h.as("adult_a")).preference.list(),
    );
    const reply = await replyToReview(database.db, h.as("adult_a"), review.id, {
      comment: "Agreed",
    });
    expect(reply).toMatchObject({
      parentReviewId: review.id,
      targetType: "dish",
      targetId: h.dishId,
      rating: null,
      tags: [],
    });
    expect(JSON.stringify(await createRepos(database.db, h.as("adult_a")).preference.list())).toBe(
      prefsBefore,
    );
    await expect(
      replyToReview(database.db, h.as("adult_a"), review.id, { comment: "  " }),
    ).rejects.toBeInstanceOf(ReviewValidationError);

    const reactions = () =>
      createRepos(database.db, h.as("adult_a")).review_reaction.list({ reviewId: review.id });
    await reactToReview(database.db, h.as("adult_a"), review.id, "agree", true);
    await reactToReview(database.db, h.as("adult_a"), review.id, "agree", true);
    await reactToReview(database.db, h.as("c1"), review.id, "helpful", true);
    expect((await reactions()).map((r) => r.kind).sort()).toEqual(["agree", "helpful"]);
    await reactToReview(database.db, h.as("adult_a"), review.id, "agree", false);
    await reactToReview(database.db, h.as("adult_a"), review.id, "agree", false);
    expect((await reactions()).map((r) => r.kind)).toEqual(["helpful"]);
  });

  it("edits are author-only within 24 h; each edit keeps the replaced values as a review_revision (R-26)", async () => {
    const posted = new Date("2026-09-25T18:00:00Z");
    const own = await createReview(
      database.db,
      h.as("adult_b"),
      { targetType: "dish", targetId: h.dishId, rating: 2, tags: ["dry"], comment: "Dry" },
      { now: posted },
    );
    await expect(
      editReview(database.db, h.as("adult_a"), own.review.id, { rating: 3 }, { now: posted }),
    ).rejects.toBeInstanceOf(ReviewPermissionError);
    const later = new Date(posted.getTime() + 60_000);
    const first = await editReview(
      database.db,
      h.as("adult_b"),
      own.review.id,
      { rating: 4, tags: ["tasty"] },
      { now: later },
    );
    expect(first.review).toMatchObject({
      rating: 4,
      tags: ["tasty"],
      comment: "Dry",
      editedAt: later,
    });
    const second = await editReview(
      database.db,
      h.as("adult_b"),
      own.review.id,
      { comment: "Better second time" },
      { now: new Date(later.getTime() + 1000) },
    );
    expect(second.learningChangeSetId).toBeNull(); // comment-only edit teaches nothing new
    const revisions = await reviewRevisions(database.db, h.as("adult_a"), own.review.id);
    expect(revisions.map((r) => [r.rating, r.tags, r.comment, r.editedByUserId])).toEqual([
      [2, ["dry"], "Dry", h.loaded.users.adult_b],
      [4, ["tasty"], "Dry", h.loaded.users.adult_b],
    ]);
    const unchanged = await editReview(
      database.db,
      h.as("adult_b"),
      own.review.id,
      { comment: "Better second time" },
      { now: later },
    );
    expect(unchanged.learningChangeSetId).toBeNull();
    expect(await reviewRevisions(database.db, h.as("adult_a"), own.review.id)).toHaveLength(2);
    const tooLate = new Date(posted.getTime() + REVIEW_EDIT_WINDOW_MS + 1);
    await expect(
      editReview(database.db, h.as("adult_b"), own.review.id, { rating: 5 }, { now: tooLate }),
    ).rejects.toBeInstanceOf(ReviewEditWindowError);
  });

  it("an edit moves the learned state from the old signal to the new one (SPEC-Q-11)", async () => {
    const fresh = await reviewHousehold(database, f1WithDish({ id: "F1-edit" }));
    const ctx = fresh.as("adult_a");
    const c2 = fresh.member("c2");
    const score = async () =>
      resolveScore(await createRepos(database.db, ctx).preference.list(), c2, "dish", fresh.dishId);
    const { review } = await createReview(database.db, ctx, {
      targetType: "dish",
      targetId: fresh.dishId,
      onBehalfOfMemberId: c2,
      rating: 1,
    });
    expect(await score()).toBe(-0.333);
    const edited = await editReview(database.db, ctx, review.id, { rating: 5 });
    expect(edited.learningChangeSetId).not.toBeNull();
    // Exactly 1/3 in real numbers; the 3-decimal stored score (−0.333) carries ≤ 0.001 (ADR-1).
    expect(Math.abs((await score()) - 1 / 3)).toBeLessThanOrEqual(0.001);
    const learned = await createRepos(database.db, ctx).preference.list({
      memberId: c2,
      entityType: "dish",
      entityKey: fresh.dishId,
    });
    expect(learned.map((p) => p.evidenceWeight)).toEqual([1]);
  });

  it("another household's reviews cannot be read, replied to, reacted to or edited", async () => {
    const { review } = await createReview(database.db, other.as("adult_b"), {
      targetType: "dish",
      targetId: other.dishId,
      rating: 5,
    });
    await expect(
      replyToReview(database.db, h.as("adult_a"), review.id, { comment: "x" }),
    ).rejects.toBeInstanceOf(CrossHouseholdError);
    await expect(
      reactToReview(database.db, h.as("adult_a"), review.id, "agree", true),
    ).rejects.toBeInstanceOf(CrossHouseholdError);
    await expect(
      editReview(database.db, h.as("adult_b"), review.id, { rating: 1 }),
    ).rejects.toBeInstanceOf(CrossHouseholdError);
    await expect(reviewRevisions(database.db, h.as("adult_a"), review.id)).rejects.toBeInstanceOf(
      CrossHouseholdError,
    );
    await expect(
      createReview(database.db, h.as("adult_a"), {
        targetType: "plan_meal",
        targetId: other.planMealId,
        rating: 2,
      }),
    ).rejects.toBeInstanceOf(CrossHouseholdError);
  });
});
