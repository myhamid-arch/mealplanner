// FBK-7 rules 1 and 2, and the dish-level twin of rule 1 that SC-3 needs (SPEC-Q-11, 12, 15).
import { NEGATIVE_TASTE_TAGS } from "../preferences/config.js";
import { variantKey } from "../preferences/keys.js";
import {
  DISH_DISLIKE_MIN_REVIEWS,
  DISLIKE_MAX_MEAN_RATING,
  DISLIKE_SCORE,
  INGREDIENT_DISLIKE_MIN_REVIEWS,
  NEGATIVE_RATING_MAX,
  PRIORITY,
  REVIEW_WINDOW_DAYS,
  SIBLING_MIN_MEAN_RATING,
  VARIANT_DISLIKE_MIN_REVIEWS,
} from "./config.js";
import { groupBy, mean, reviewIds, round3, type RuleContext } from "./context.js";
import type { InsightReview, ProposalDraft } from "./types.js";

const NEGATIVE_TAGS: ReadonlySet<string> = new Set(NEGATIVE_TASTE_TAGS);

function rated(reviews: readonly InsightReview[]): (InsightReview & { rating: number })[] {
  return reviews.filter((r): r is InsightReview & { rating: number } => r.rating !== null);
}

function ratingMean(reviews: readonly { rating: number }[]): number {
  return mean(reviews.map((r) => r.rating));
}

/**
 * FBK-7 rule 1: a variant with a mean rating ≤ 2.5 over ≥ 3 of one member's variant reviews →
 * a locked −0.8 member preference on the variant key. A sibling variant the member rates ≥ 3.5 is
 * named in the rationale (SPEC-Q-15).
 */
export function variantDislike(ctx: RuleContext): ProposalDraft[] {
  const reviews = rated(ctx.reviewsWithin(REVIEW_WINDOW_DAYS)).filter(
    (r) => r.targetType === "variant" && ctx.variants.has(r.targetId),
  );
  const out: ProposalDraft[] = [];
  const groups = groupBy(reviews, (r) => `${r.memberId}|${r.targetId}`);
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined || group.length < VARIANT_DISLIKE_MIN_REVIEWS) continue;
    const average = ratingMean(group);
    if (average > DISLIKE_MAX_MEAN_RATING) continue;
    const found = ctx.variants.get(first.targetId);
    if (found === undefined || !ctx.isActiveMember(first.memberId)) continue;
    const { dish, component, variant } = found;
    const name = ctx.memberName(first.memberId);
    let sibling = "";
    for (const other of component.variants) {
      if (other.id === variant.id) continue;
      const ratings = reviews.filter(
        (r) => r.memberId === first.memberId && r.targetId === other.id,
      );
      if (ratings.length > 0 && ratingMean(ratings) >= SIBLING_MIN_MEAN_RATING) {
        sibling = ` ${name} rates the ${other.label} version ${round3(ratingMean(ratings)).toString()} on average, so the planner will prefer it.`;
        break;
      }
    }
    out.push({
      origin: "rule",
      rule: "variant_dislike",
      title: `${name} dislikes ${dish.name} (${variant.label})`,
      rationale: `${name} rated ${dish.name} — ${component.name}, ${variant.label} ${group.length.toString()} times with a mean of ${round3(average).toString()}. Lock a strong dislike for this preparation.${sibling}`,
      ops: [
        {
          kind: "preference.set",
          payload: {
            memberId: first.memberId,
            entityType: "dish",
            entityKey: variantKey(dish.id, variant.id),
            score: DISLIKE_SCORE,
            locked: true,
            source: "proposal",
          },
        },
      ],
      evidence: {
        reviewIds: reviewIds(group),
        count: group.length,
        metrics: { meanRating: round3(average) },
      },
      priority: PRIORITY.variantDislike,
    });
  }
  return out;
}

/**
 * SPEC-Q-12 (SC-3): a dish with a mean rating ≤ 2.5 over ≥ 2 of one member's whole-dish reviews
 * (dish, plan_meal or plate targets) → a locked −0.8 member preference on the dish.
 */
export function dishDislike(ctx: RuleContext): ProposalDraft[] {
  const reviews = rated(ctx.reviewsWithin(REVIEW_WINDOW_DAYS)).filter((r) =>
    ctx.isWholeDishReview(r),
  );
  const out: ProposalDraft[] = [];
  const groups = groupBy(reviews, (r) => {
    const dish = ctx.dishOf(r);
    return dish === undefined ? undefined : `${r.memberId}|${dish.id}`;
  });
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined || group.length < DISH_DISLIKE_MIN_REVIEWS) continue;
    const average = ratingMean(group);
    const dish = ctx.dishOf(first);
    if (average > DISLIKE_MAX_MEAN_RATING || dish === undefined) continue;
    if (!ctx.isActiveMember(first.memberId)) continue;
    const name = ctx.memberName(first.memberId);
    out.push({
      origin: "rule",
      rule: "dish_dislike",
      title: `${name} dislikes ${dish.name}`,
      rationale: `${name} rated ${dish.name} ${group.length.toString()} times with a mean of ${round3(average).toString()}. Lock a strong dislike so the planner serves it to ${name} far less.`,
      ops: [
        {
          kind: "preference.set",
          payload: {
            memberId: first.memberId,
            entityType: "dish",
            entityKey: dish.id,
            score: DISLIKE_SCORE,
            locked: true,
            source: "proposal",
          },
        },
      ],
      evidence: {
        reviewIds: reviewIds(group),
        count: group.length,
        metrics: { meanRating: round3(average) },
      },
      priority: PRIORITY.dishDislike,
    });
  }
  return out;
}

/** SPEC-Q-11: a component review with a rating ≤ 2 or a negative taste tag. */
export function isNegativeComponentReview(review: InsightReview): boolean {
  if (review.targetType !== "component") return false;
  if (review.rating !== null && review.rating <= NEGATIVE_RATING_MAX) return true;
  return review.tags.some((t) => NEGATIVE_TAGS.has(t));
}

/**
 * FBK-7 rule 2: an ingredient among the core ingredients of the eaten variant in ≥ 3 of one
 * member's negative component reviews → a soft dislike exclusion for that member.
 */
export function ingredientDislike(ctx: RuleContext): ProposalDraft[] {
  const negative = ctx.reviewsWithin(REVIEW_WINDOW_DAYS).filter(isNegativeComponentReview);
  const hits: { review: InsightReview; ingredientId: string }[] = [];
  for (const review of negative) {
    const variant = ctx.eatenVariant(review, review.targetId);
    for (const ingredientId of new Set(variant?.coreIngredientIds ?? []))
      hits.push({ review, ingredientId });
  }
  const ingredients = new Map(ctx.input.ingredients.map((i) => [i.id, i]));
  const out: ProposalDraft[] = [];
  for (const group of groupBy(hits, (h) => `${h.review.memberId}|${h.ingredientId}`).values()) {
    const [first] = group;
    if (first === undefined) continue;
    const reviews = [...new Map(group.map((h) => [h.review.id, h.review])).values()];
    if (reviews.length < INGREDIENT_DISLIKE_MIN_REVIEWS) continue;
    const ingredient = ingredients.get(first.ingredientId);
    const memberId = first.review.memberId;
    if (ingredient === undefined || !ctx.isActiveMember(memberId)) continue;
    const name = ctx.memberName(memberId);
    out.push({
      origin: "rule",
      rule: "ingredient_dislike",
      title: `${name} dislikes ${ingredient.name}`,
      rationale: `${ingredient.name} was in ${reviews.length.toString()} components ${name} reviewed negatively. Exclude it for ${name} as a dislike (not a hard rule).`,
      ops: [
        {
          kind: "exclusion.add",
          payload: {
            memberId,
            kind: "ingredient",
            key: ingredient.slug,
            reason: "dislike",
            hard: false,
          },
        },
      ],
      evidence: { reviewIds: reviewIds(reviews), count: reviews.length, metrics: {} },
      priority: PRIORITY.ingredientDislike,
    });
  }
  return out;
}
