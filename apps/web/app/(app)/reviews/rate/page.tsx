import type { Metadata } from "next";
import { requirePageSession } from "../../../../components/admin/session-guard";
import { safeNext } from "../../../../components/admin/format";
import { QuickRateSheet } from "../../../../components/reviews/quick-rate-sheet";
import { EmptyState } from "../../../../components/ui/empty-state";

export const metadata: Metadata = { title: "Rate a meal" };
export const dynamic = "force-dynamic";

/** QuickRatePhone.dc.html (R2-UX-4): `/reviews/rate?planMealId=<id>` (SPEC-Q-9, fixed by R-52/R-53). */
export default async function QuickRatePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ planMealId?: string; next?: string }>;
}) {
  const { planMealId, next } = await searchParams;
  await requirePageSession(
    `/reviews/rate${planMealId === undefined ? "" : `?planMealId=${encodeURIComponent(planMealId)}`}`,
  );
  if (planMealId === undefined || planMealId === "")
    return (
      <EmptyState
        icon="reviews"
        headingLevel={1}
        title="Which meal?"
        description="Open the rating from a meal on Today or from a plate, and it will know which meal you mean."
      />
    );
  return <QuickRateSheet planMealId={planMealId} next={safeNext(next) ?? "/reviews"} />;
}
