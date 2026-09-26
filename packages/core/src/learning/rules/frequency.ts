// FBK-6 frequency rules: more_often / less_often after 2 signals in 30 days, never_again at once,
// and the observed-frequency flag (a dish served > 2× in 7 days with a mean rating below 3).
// Frequency rules are household-level (SPEC-Q-13).
import type { FrequencyRuleRow } from "../../types/index.js";
import {
  FREQUENCY_MIN_SIGNALS,
  LESS_OFTEN_MIN_GAP_DAYS,
  MORE_OFTEN_MIN_GAP_DAYS,
  OBSERVED_MAX_MEAN_RATING,
  OBSERVED_MAX_SERVINGS,
  OBSERVED_WINDOW_DAYS,
  PRIORITY,
  REVIEW_WINDOW_DAYS,
} from "./config.js";
import { addDays, groupBy, mean, reviewIds, round3, type RuleContext } from "./context.js";
import type { InsightDish, InsightReview, ProposalDraft, RuleId } from "./types.js";

function householdRule(ctx: RuleContext, dishId: string): FrequencyRuleRow | undefined {
  return ctx.input.config.frequencyRules.find(
    (r) => r.memberId === null && r.entityType === "dish" && r.entityKey === dishId,
  );
}

function frequencyDraft(
  ctx: RuleContext,
  rule: RuleId,
  dish: InsightDish,
  minGapDays: number,
  title: string,
  rationale: string,
  evidence: ProposalDraft["evidence"],
): ProposalDraft | undefined {
  const existing = householdRule(ctx, dish.id);
  // A locked rule is the admin's; the engine does not propose over it.
  if (existing?.locked === true) return undefined;
  return {
    origin: "rule",
    rule,
    title,
    rationale,
    ops: [
      {
        kind: "frequency.set",
        payload: {
          memberId: null,
          entityType: "dish",
          entityKey: dish.id,
          minGapDays,
          maxPerWeek: existing?.maxPerWeek ?? null,
          source: "proposal",
          locked: false,
        },
      },
    ],
    evidence,
    priority: PRIORITY.frequency,
  };
}

function tagged(ctx: RuleContext, tag: string): Map<string, InsightReview[]> {
  const reviews = ctx.reviewsWithin(REVIEW_WINDOW_DAYS).filter((r) => r.tags.includes(tag));
  return groupBy(reviews, (r) => ctx.dishOf(r)?.id);
}

/** FBK-6 more_often and less_often. When both reach the threshold, neither is proposed. */
export function moreOrLessOften(ctx: RuleContext): ProposalDraft[] {
  const more = tagged(ctx, "more_often");
  const less = tagged(ctx, "less_often");
  const out: ProposalDraft[] = [];
  const enough = (m: Map<string, InsightReview[]>, dishId: string) =>
    (m.get(dishId)?.length ?? 0) >= FREQUENCY_MIN_SIGNALS;
  for (const dishId of new Set([...more.keys(), ...less.keys()])) {
    const wantMore = enough(more, dishId);
    const wantLess = enough(less, dishId);
    if (wantMore === wantLess) continue;
    const dish = ctx.dishes.get(dishId);
    if (dish === undefined) continue;
    const reviews = (wantMore ? more : less).get(dishId) ?? [];
    const gap = wantMore ? MORE_OFTEN_MIN_GAP_DAYS : LESS_OFTEN_MIN_GAP_DAYS;
    const draft = frequencyDraft(
      ctx,
      wantMore ? "more_often" : "less_often",
      dish,
      gap,
      wantMore ? `Serve ${dish.name} more often` : `Serve ${dish.name} less often`,
      `${reviews.length.toString()} reviews asked for ${dish.name} ${wantMore ? "more" : "less"} often. Allow it every ${gap.toString()} days${wantMore ? " instead of every 6" : " at most"}.`,
      { reviewIds: reviewIds(reviews), count: reviews.length, metrics: {} },
    );
    if (draft !== undefined) out.push(draft);
  }
  return out;
}

/** FBK-6 never_again: an immediate proposal to set `hard = never` for that member on that dish. */
export function neverAgain(ctx: RuleContext): ProposalDraft[] {
  const reviews = ctx
    .reviewsWithin(REVIEW_WINDOW_DAYS)
    .filter((r) => r.tags.includes("never_again"));
  const out: ProposalDraft[] = [];
  for (const group of groupBy(reviews, (r) => {
    const dish = ctx.dishOf(r);
    return dish === undefined ? undefined : `${r.memberId}|${dish.id}`;
  }).values()) {
    const [first] = group;
    const dish = first === undefined ? undefined : ctx.dishOf(first);
    if (first === undefined || dish === undefined || !ctx.isActiveMember(first.memberId)) continue;
    const name = ctx.memberName(first.memberId);
    out.push({
      origin: "rule",
      rule: "never_again",
      title: `Never serve ${dish.name} to ${name}`,
      rationale: `${name} said "never again" about ${dish.name}. Stop planning it for ${name}.`,
      ops: [
        {
          kind: "preference.set",
          payload: {
            memberId: first.memberId,
            entityType: "dish",
            entityKey: dish.id,
            score: -1,
            hard: "never",
            locked: true,
            source: "proposal",
          },
        },
      ],
      evidence: { reviewIds: reviewIds(group), count: group.length, metrics: {} },
      priority: PRIORITY.neverAgain,
    });
  }
  return out;
}

/**
 * FBK-6 observed frequency: a dish served more than 2× in the last 7 days whose reviews in that
 * window have a mean rating below 3 → allow it every 14 days at most.
 */
export function observedFrequency(ctx: RuleContext): ProposalDraft[] {
  const from = addDays(ctx.input.today, -(OBSERVED_WINDOW_DAYS - 1));
  const meals = ctx.input.meals.filter(
    (m) => m.date >= from && m.date <= ctx.input.today && m.status !== "skipped",
  );
  const recent = ctx
    .reviewsWithin(OBSERVED_WINDOW_DAYS)
    .filter((r): r is InsightReview & { rating: number } => r.rating !== null);
  const out: ProposalDraft[] = [];
  for (const [dishId, served] of groupBy(meals, (m) => m.dishId)) {
    if (served.length <= OBSERVED_MAX_SERVINGS) continue;
    const ratings = recent.filter((r) => ctx.dishOf(r)?.id === dishId);
    if (ratings.length === 0) continue;
    const average = mean(ratings.map((r) => r.rating));
    const dish = ctx.dishes.get(dishId);
    if (average >= OBSERVED_MAX_MEAN_RATING || dish === undefined) continue;
    const draft = frequencyDraft(
      ctx,
      "observed_frequency",
      dish,
      LESS_OFTEN_MIN_GAP_DAYS,
      `Serve ${dish.name} less often`,
      `${dish.name} was served ${served.length.toString()} times in the last ${OBSERVED_WINDOW_DAYS.toString()} days and rated ${round3(average).toString()} on average. Allow it every ${LESS_OFTEN_MIN_GAP_DAYS.toString()} days at most.`,
      {
        reviewIds: reviewIds(ratings),
        count: served.length,
        metrics: { servings: served.length, meanRating: round3(average) },
      },
    );
    if (draft !== undefined) out.push(draft);
  }
  return out;
}
