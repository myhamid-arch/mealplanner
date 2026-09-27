import type { Metadata } from "next";
import { REVIEW_TARGET_TYPES, type ReviewTargetType } from "@mealplanner/core/types";
import { safeNext } from "../../../../components/admin/format";
import { requirePageSession } from "../../../../components/admin/session-guard";
import { ReviewCompose, type ComposeTarget } from "../../../../components/reviews/review-compose";
import { EmptyState } from "../../../../components/ui/empty-state";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

type Search = {
  planMealId?: string;
  targetType?: string;
  targetId?: string;
  for?: string;
  rating?: string;
  tags?: string;
  next?: string;
};

function targetOf(q: Search): ComposeTarget | null {
  if (q.planMealId !== undefined && q.planMealId !== "")
    return { kind: "meal", planMealId: q.planMealId };
  const t = q.targetType;
  if (
    t !== undefined &&
    (REVIEW_TARGET_TYPES as readonly string[]).includes(t) &&
    q.targetId !== undefined &&
    q.targetId !== ""
  )
    return { kind: "object", targetType: t as ReviewTargetType, targetId: q.targetId };
  return null;
}

/**
 * ReviewComposePhone.dc.html (R2-UX-4): `/reviews/new?planMealId=<id>[&for=<memberId>]`, or
 * `?targetType=<t>&targetId=<id>` for any reviewable object (FBK-2; SPEC-Q-9).
 */
export default async function ReviewComposePage({
  searchParams,
}: {
  readonly searchParams: Promise<Search>;
}) {
  const q = await searchParams;
  const here = new URLSearchParams(
    Object.entries(q).filter((e): e is [string, string] => typeof e[1] === "string"),
  ).toString();
  await requirePageSession(`/reviews/new${here === "" ? "" : `?${here}`}`);
  const target = targetOf(q);
  if (target === null)
    return (
      <EmptyState
        icon="reviews"
        headingLevel={1}
        title="What are you reviewing?"
        description="Open a review from a meal, a plate or a recipe, and it will know what it is about."
      />
    );
  const rating = Number(q.rating ?? "0");
  return (
    <ReviewCompose
      target={target}
      initial={{
        rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0,
        tags: (q.tags ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter((t) => /^[a-z0-9_]{1,40}$/.test(t))
          .slice(0, 20),
        memberId: q.for !== undefined && q.for !== "" ? q.for : null,
      }}
      next={safeNext(q.next) ?? "/reviews"}
    />
  );
}
