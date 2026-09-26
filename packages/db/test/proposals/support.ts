// Shared setup for the proposals integration tests (leaf 1.3.3): 1.3.2's review household (F1 plus
// one dish and a dinner with plates for adult_a, c1 and c2), and helpers to post reviews and read
// proposals.
import type { ProposalDraft } from "@mealplanner/core/learning/rules";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../src/repos/index.js";
import { createReview } from "../../src/services/reviews/index.js";
import { reviewDatabase, reviewHousehold, type ReviewHousehold } from "../reviews/support.js";
import type { TestDatabase } from "../support/db.js";

export { reviewDatabase, reviewHousehold, type ReviewHousehold };

export const DAY = 86_400_000;

/** Posts `n` dish reviews by the admin on behalf of `memberKey` (default adult_a). */
export async function dishReviews(
  database: TestDatabase,
  h: ReviewHousehold,
  n: number,
  options: { rating?: number; tags?: string[]; memberKey?: string; now?: Date } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const result = await createReview(
      database.db,
      h.as("adult_a"),
      {
        targetType: "dish",
        targetId: h.dishId,
        planMealId: h.planMealId,
        onBehalfOfMemberId: h.member(options.memberKey ?? "adult_a"),
        rating: options.rating === undefined ? 1 : options.rating,
        tags: options.tags ?? [],
      },
      options.now === undefined ? {} : { now: options.now },
    );
    ids.push(result.review.id);
  }
  return ids;
}

export async function proposals(db: Executor, ctx: HouseholdContext) {
  return createRepos(db, ctx).proposal.list();
}

/** A preference proposal draft for a dish (for createProposals tests). */
export function preferenceDraft(
  memberId: string,
  dishId: string,
  score: number,
  options: { origin?: ProposalDraft["origin"]; count?: number; priority?: number } = {},
): ProposalDraft {
  return {
    origin: options.origin ?? "rule",
    title: `Preference ${score.toString()} on the dish`,
    rationale: "Test draft.",
    ops: [
      {
        kind: "preference.set",
        payload: {
          memberId,
          entityType: "dish",
          entityKey: dishId,
          score,
          locked: true,
          source: "proposal",
        },
      },
    ],
    evidence: { reviewIds: [], count: options.count ?? 2, metrics: {} },
    priority: options.priority ?? 3,
  };
}
