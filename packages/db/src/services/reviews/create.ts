// Reviews (FBK-2): create, reply, react and edit. Review rows are written directly: review creation
// is a DM-6 exception. What a review teaches is applied in the same transaction as a `learning`
// change set (SPEC-Q-13).
import type { HouseholdContext, ReactionKind, ReviewTargetType } from "@mealplanner/core/types";
import { REACTION_KINDS, REVIEW_TARGET_TYPES } from "@mealplanner/core/types";
import {
  createWriteRepos,
  type Executor,
  type TableRows,
  type WriteRepos,
} from "../../repos/index.js";
import { newId } from "../../schema/ids.js";
import {
  ReviewEditWindowError,
  ReviewNotFoundError,
  ReviewPermissionError,
  ReviewTargetError,
  ReviewValidationError,
} from "./errors.js";
import { learnFromReview } from "./learn.js";

type ReviewRow = TableRows["review"];
type ReviewRevisionRow = TableRows["review_revision"];

/** FBK-2: an author may edit a review for 24 h. */
export const REVIEW_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_COMMENT_LENGTH = 4000;

export interface CreateReviewInput {
  targetType: ReviewTargetType;
  /** A uuid for dish, component, variant, ingredient, plan_meal, plate, plan_day; a key for cuisine, method. */
  targetId: string;
  /** Omitted: the author's linked member. Admins may choose any member (FBK-2, SPEC-Q-12). */
  onBehalfOfMemberId?: string | null;
  /** The meal it was eaten at. Implied by plan_meal and plate targets. */
  planMealId?: string | null;
  rating?: number | null;
  tags?: readonly string[];
  comment?: string | null;
}

export interface ReviewEdit {
  rating?: number | null;
  tags?: readonly string[];
  comment?: string | null;
}

export interface ReviewResult {
  review: ReviewRow;
  /** The `learning` change set this review applied, or null when it taught nothing. */
  learningChangeSetId: string | null;
}

export interface ClockOptions {
  /** The current time; defaults to the system clock. */
  now?: Date;
}

// Validation -----------------------------------------------------------------------------------

function validRating(rating: number | null | undefined): number | null {
  if (rating === undefined || rating === null) return null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new ReviewValidationError(`rating must be an integer 1–5, got ${String(rating)}`);
  return rating;
}

function validTags(tags: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim();
    if (tag === "" || tag.length > MAX_TAG_LENGTH)
      throw new ReviewValidationError(`a tag must be 1–${String(MAX_TAG_LENGTH)} characters`);
    if (!out.includes(tag)) out.push(tag);
  }
  if (out.length > MAX_TAGS)
    throw new ReviewValidationError(`a review has at most ${String(MAX_TAGS)} tags`);
  return out;
}

function validComment(comment: string | null | undefined): string | null {
  if (comment === undefined || comment === null) return null;
  const trimmed = comment.trim();
  if (trimmed.length > MAX_COMMENT_LENGTH)
    throw new ReviewValidationError(
      `a comment has at most ${String(MAX_COMMENT_LENGTH)} characters`,
    );
  return trimmed === "" ? null : trimmed;
}

function requireContent(rating: number | null, tags: string[], comment: string | null): void {
  if (rating === null && tags.length === 0 && comment === null)
    throw new ReviewValidationError("a review needs a rating, a tag or a comment");
}

// Actors ---------------------------------------------------------------------------------------

async function actingLogin(repos: WriteRepos, ctx: HouseholdContext) {
  if (ctx.userId === null) throw new ReviewPermissionError("a review needs a signed-in author");
  const login = await repos.household_user.get({
    householdId: ctx.householdId,
    userId: ctx.userId,
  });
  if (login === null || login.status !== "active")
    throw new ReviewPermissionError("the author is not an active login of this household");
  return login;
}

/** FBK-2 and R2-ADM-6 on-behalf-of rules (SPEC-Q-12). */
async function onBehalfOf(
  repos: WriteRepos,
  ctx: HouseholdContext,
  login: TableRows["household_user"],
  requested: string | null | undefined,
): Promise<string | null> {
  const memberId = requested === undefined ? login.memberId : requested;
  if (memberId === null) return null;
  const member = await repos.member.get({ id: memberId });
  if (member === null) throw new ReviewTargetError(`member ${memberId} not found`);
  if (member.archivedAt !== null)
    throw new ReviewValidationError(`member ${member.displayName} is archived`);
  if (memberId === login.memberId || login.role === "admin") return memberId;
  if (login.role === "member" && login.memberId !== null) {
    const household = await repos.household.get({ id: ctx.householdId });
    const self = await repos.member.get({ id: login.memberId });
    const younger =
      self?.birthYear != null && member.birthYear !== null && member.birthYear > self.birthYear;
    if (household?.membersReviewForSiblings === true && younger) return memberId;
  }
  throw new ReviewPermissionError(`this login may not review on behalf of ${member.displayName}`);
}

// Targets --------------------------------------------------------------------------------------

async function dishOfComponent(repos: WriteRepos, componentId: string): Promise<string> {
  const component = await repos.component.get({ id: componentId });
  if (component === null) throw new ReviewTargetError(`component ${componentId} not found`);
  return component.dishId;
}

/** Checks the target exists for this household and returns the meal context it implies. */
async function checkTarget(
  repos: WriteRepos,
  targetType: ReviewTargetType,
  targetId: string,
  planMealId: string | null,
): Promise<string | null> {
  if (!REVIEW_TARGET_TYPES.includes(targetType))
    throw new ReviewValidationError(`unknown review target type ${targetType}`);
  const meal = planMealId === null ? null : await repos.plan_meal.get({ id: planMealId });
  if (planMealId !== null && meal === null)
    throw new ReviewTargetError(`plan_meal ${planMealId} not found`);
  const sameDish = (dishId: string) => {
    if (meal !== null && meal.dishId !== dishId)
      throw new ReviewTargetError("the reviewed dish was not served at that meal");
  };
  const missing = () => new ReviewTargetError(`${targetType} ${targetId} not found`);
  switch (targetType) {
    case "dish":
      if ((await repos.dish.get({ id: targetId })) === null) throw missing();
      sameDish(targetId);
      return planMealId;
    case "component":
      sameDish(await dishOfComponent(repos, targetId));
      return planMealId;
    case "variant": {
      const variant = await repos.variant.get({ id: targetId });
      if (variant === null) throw missing();
      sameDish(await dishOfComponent(repos, variant.componentId));
      return planMealId;
    }
    case "plan_meal":
      if ((await repos.plan_meal.get({ id: targetId })) === null) throw missing();
      if (planMealId !== null && planMealId !== targetId)
        throw new ReviewTargetError("a plan_meal review's meal context is that meal");
      return targetId;
    case "plate": {
      const plate = await repos.plate.get({ id: targetId });
      if (plate === null) throw missing();
      if (planMealId !== null && planMealId !== plate.planMealId)
        throw new ReviewTargetError("a plate review's meal context is the plate's meal");
      return plate.planMealId;
    }
    case "plan_day":
      if ((await repos.plan_day.get({ id: targetId })) === null) throw missing();
      return planMealId;
    case "ingredient":
      if ((await repos.ingredient.get({ id: targetId })) === null) throw missing();
      return planMealId;
    case "cuisine":
      if ((await repos.cuisine.list({ key: targetId })).length === 0) throw missing();
      return planMealId;
    case "method":
      if ((await repos.preparation_method.list({ key: targetId })).length === 0) throw missing();
      return planMealId;
  }
}

async function requireReview(repos: WriteRepos, reviewId: string): Promise<ReviewRow> {
  const review = await repos.review.get({ id: reviewId });
  if (review === null) throw new ReviewNotFoundError(reviewId);
  return review;
}

// Service --------------------------------------------------------------------------------------

/** Posts a review and applies what it teaches (FBK-4, FBK-5) in one transaction. */
export async function createReview(
  db: Executor,
  ctx: HouseholdContext,
  input: CreateReviewInput,
  options: ClockOptions = {},
): Promise<ReviewResult> {
  const rating = validRating(input.rating);
  const tags = validTags(input.tags);
  const comment = validComment(input.comment);
  requireContent(rating, tags, comment);
  return db.transaction(async (trx) => {
    const repos = createWriteRepos(trx, ctx);
    const login = await actingLogin(repos, ctx);
    const memberId = await onBehalfOf(repos, ctx, login, input.onBehalfOfMemberId);
    const planMealId = await checkTarget(
      repos,
      input.targetType,
      input.targetId,
      input.planMealId ?? null,
    );
    const review = await repos.review.insert({
      id: newId(),
      householdId: ctx.householdId,
      authorUserId: login.userId,
      onBehalfOfMemberId: memberId,
      targetType: input.targetType,
      targetId: input.targetId,
      planMealId,
      rating,
      tags,
      comment,
      parentReviewId: null,
      createdAt: options.now ?? new Date(),
      editedAt: null,
      processedAt: null,
    });
    return { review, learningChangeSetId: await learnFromReview(trx, ctx, review) };
  });
}

/** A threaded reply (FBK-2). It keeps the parent's target and teaches nothing. */
export async function replyToReview(
  db: Executor,
  ctx: HouseholdContext,
  parentReviewId: string,
  input: { comment: string },
  options: ClockOptions = {},
): Promise<ReviewRow> {
  const comment = validComment(input.comment);
  if (comment === null) throw new ReviewValidationError("a reply needs a comment");
  return db.transaction(async (trx) => {
    const repos = createWriteRepos(trx, ctx);
    const login = await actingLogin(repos, ctx);
    const parent = await requireReview(repos, parentReviewId);
    return repos.review.insert({
      id: newId(),
      householdId: ctx.householdId,
      authorUserId: login.userId,
      onBehalfOfMemberId: login.memberId,
      targetType: parent.targetType,
      targetId: parent.targetId,
      planMealId: parent.planMealId,
      rating: null,
      tags: [],
      comment,
      parentReviewId: parent.id,
      createdAt: options.now ?? new Date(),
      editedAt: null,
      processedAt: null,
    });
  });
}

/** Adds (`on`) or removes a reaction of the acting login (FBK-2). Idempotent. */
export async function reactToReview(
  db: Executor,
  ctx: HouseholdContext,
  reviewId: string,
  kind: ReactionKind,
  on: boolean,
): Promise<void> {
  if (!REACTION_KINDS.includes(kind)) throw new ReviewValidationError(`unknown reaction ${kind}`);
  await db.transaction(async (trx) => {
    const repos = createWriteRepos(trx, ctx);
    const login = await actingLogin(repos, ctx);
    await requireReview(repos, reviewId);
    const key = { reviewId, userId: login.userId, kind };
    const existing = await repos.review_reaction.get(key);
    if (on && existing === null)
      await repos.review_reaction.insert({ householdId: ctx.householdId, ...key });
    else if (!on && existing !== null) await repos.review_reaction.remove(key);
  });
}

/**
 * Edits a review: author only, within 24 h (FBK-2). The replaced values are kept as a
 * `review_revision` row (R-26), and the learned state moves from the old signals to the new ones in
 * one `learning` change set (SPEC-Q-11). An edit that changes nothing writes nothing.
 */
export async function editReview(
  db: Executor,
  ctx: HouseholdContext,
  reviewId: string,
  edit: ReviewEdit,
  options: ClockOptions = {},
): Promise<ReviewResult> {
  return db.transaction(async (trx) => {
    const repos = createWriteRepos(trx, ctx);
    const login = await actingLogin(repos, ctx);
    const review = await requireReview(repos, reviewId);
    if (review.authorUserId !== login.userId)
      throw new ReviewPermissionError("only the author may edit a review");
    const now = options.now ?? new Date();
    if (now.getTime() - review.createdAt.getTime() > REVIEW_EDIT_WINDOW_MS)
      throw new ReviewEditWindowError(reviewId);

    const isReply = review.parentReviewId !== null;
    const rating = edit.rating === undefined ? review.rating : validRating(edit.rating);
    const tags = edit.tags === undefined ? review.tags : validTags(edit.tags);
    const comment = edit.comment === undefined ? review.comment : validComment(edit.comment);
    if (isReply && (rating !== null || tags.length > 0))
      throw new ReviewValidationError("a reply carries a comment only");
    if (isReply && comment === null) throw new ReviewValidationError("a reply needs a comment");
    requireContent(rating, tags, comment);
    const unchanged =
      rating === review.rating &&
      comment === review.comment &&
      JSON.stringify(tags) === JSON.stringify(review.tags);
    if (unchanged) return { review, learningChangeSetId: null };

    const revision: ReviewRevisionRow = {
      id: newId(),
      householdId: ctx.householdId,
      reviewId,
      rating: review.rating,
      tags: review.tags,
      comment: review.comment,
      replacedAt: now,
      editedByUserId: login.userId,
    };
    await repos.review_revision.insert(revision);
    const updated = await repos.review.update(
      { id: reviewId },
      { rating, tags, comment, editedAt: now },
    );
    const learningChangeSetId = await learnFromReview(trx, ctx, updated, review);
    return { review: updated, learningChangeSetId };
  });
}

/** Every earlier version of a review, oldest first (FBK-2 "edits are kept"). */
export async function reviewRevisions(
  db: Executor,
  ctx: HouseholdContext,
  reviewId: string,
): Promise<ReviewRevisionRow[]> {
  const repos = createWriteRepos(db, ctx);
  await requireReview(repos, reviewId);
  const rows = await repos.review_revision.list({ reviewId });
  return [...rows].sort((a, b) => a.replacedAt.getTime() - b.replacedAt.getTime());
}
