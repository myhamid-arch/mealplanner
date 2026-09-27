// Groups the feed (ReviewsFeed): replies under their review, and the part reviews a detailed review
// wrote (one `component` review per tagged part, SPEC-Q-6) under that meal's review, so one posting
// is one card ("Fried fish · crispy", "Rice · too much"). Pure.
import type { ReviewGroup } from "./review-card";
import type { Review } from "./targets";

/** Part reviews written within this long of the meal review belong to the same posting. */
export const SAME_POSTING_MS = 5 * 60_000;

const isPart = (r: Review) => r.targetType === "component" || r.targetType === "variant";

export function groupReviews(
  reviews: readonly Review[],
  partName: (r: Review) => string,
): ReviewGroup[] {
  const replies = new Map<string, Review[]>();
  const top: Review[] = [];
  for (const r of reviews) {
    if (r.parentReviewId === null) top.push(r);
    else replies.set(r.parentReviewId, [...(replies.get(r.parentReviewId) ?? []), r]);
  }
  const groups = new Map<string, ReviewGroup>();
  const mealReviews = top.filter((r) => r.targetType === "plan_meal");
  const attached = new Set<string>();
  for (const part of top.filter(isPart)) {
    if (part.planMealId === null) continue;
    const owner = mealReviews.find(
      (m) =>
        m.targetId === part.planMealId &&
        m.authorUserId === part.authorUserId &&
        m.onBehalfOfMemberId === part.onBehalfOfMemberId &&
        Math.abs(Date.parse(m.createdAt) - Date.parse(part.createdAt)) <= SAME_POSTING_MS,
    );
    if (owner === undefined) continue;
    attached.add(part.id);
    const g = groups.get(owner.id) ?? { main: owner, parts: [], replies: [] };
    g.parts.push({ name: partName(part), review: part });
    groups.set(owner.id, g);
  }
  const byTime = (a: Review, b: Review) =>
    Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
  return top
    .filter((r) => !attached.has(r.id))
    .map((r) => {
      const g = groups.get(r.id) ?? { main: r, parts: [], replies: [] };
      g.parts.sort((a, b) => byTime(a.review, b.review));
      return { ...g, replies: [...(replies.get(r.id) ?? [])].sort(byTime) };
    });
}
