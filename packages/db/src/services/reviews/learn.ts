// Automatic learning from one review (FBK-4, FBK-5): the preference and portion-bias ops it teaches,
// applied as one `learning` change set by the system actor through the change-set service (DM-6,
// BLD-8 R-7, R-24). Runs inside the transaction that writes the review (SPEC-Q-13).
import {
  learningPreferenceOps,
  propagateReview,
  retract,
  reviewSignal,
  type Contribution,
} from "@mealplanner/core/learning/preferences";
import { portionBiasOpsForFactor, portionFactor } from "@mealplanner/core/learning/portions";
import type { ParsedChangeOp } from "@mealplanner/core/changes";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor, type TableRows } from "../../repos/index.js";
import { applyChangeSet } from "../changes/index.js";
import { loadLearningInput } from "./context.js";

type ReviewRow = TableRows["review"];

/** The rating and tags a review had before an edit. */
export type ReviewSignals = Pick<ReviewRow, "rating" | "tags">;

export interface LearningPlan {
  memberId: string;
  summary: string;
  ops: ParsedChangeOp[];
}

function contributions(
  target: Parameters<typeof propagateReview>[0] | null,
  signals: ReviewSignals,
): Contribution[] {
  if (target === null) return [];
  const signal = reviewSignal(signals.rating, signals.tags);
  return signal === null ? [] : propagateReview(target, signal);
}

/**
 * What a review teaches: nothing (null) for replies and reviews without a member (SPEC-Q-4).
 * With `previous`, the ops move the learned state from the previous signals to the current ones
 * (a review edit, SPEC-Q-11).
 */
export async function planLearning(
  db: Executor,
  ctx: HouseholdContext,
  review: ReviewRow,
  previous?: ReviewSignals,
): Promise<LearningPlan | null> {
  const input = await loadLearningInput(db, ctx, review);
  if (input === null) return null;
  const repos = createRepos(db, ctx);

  const added = contributions(input.target, review);
  const removed = previous === undefined ? [] : retract(contributions(input.target, previous));
  const preferences = await repos.preference.list({ memberId: input.memberId });
  const preferenceOps = learningPreferenceOps(input.memberId, [...removed, ...added], preferences);

  const now = portionFactor(review.tags) ?? 1;
  const before = previous === undefined ? 1 : (portionFactor(previous.tags) ?? 1);
  const biases = await repos.portion_bias.list({ memberId: input.memberId });
  const portionOps = portionBiasOpsForFactor(
    { id: input.memberId, isTargeted: input.isTargeted },
    input.roles,
    now / before,
    biases,
  );

  const verb = previous === undefined ? "Learned from" : "Relearned from the edit of";
  return {
    memberId: input.memberId,
    summary: `${verb} ${input.memberName}'s review of ${input.targetLabel}`,
    ops: [...preferenceOps, ...portionOps],
  };
}

/** Applies what a review teaches as one `learning` change set; returns its id, or null if nothing. */
export async function learnFromReview(
  db: Executor,
  ctx: HouseholdContext,
  review: ReviewRow,
  previous?: ReviewSignals,
): Promise<string | null> {
  const plan = await planLearning(db, ctx, review, previous);
  if (plan === null || plan.ops.length === 0) return null;
  const applied = await applyChangeSet(
    db,
    { householdId: ctx.householdId, userId: null, role: "system" },
    { actor: "system", source: "learning", summary: plan.summary, ops: plan.ops },
  );
  return applied.changeSetId;
}
