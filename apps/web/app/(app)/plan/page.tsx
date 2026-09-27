import type { Metadata } from "next";
import { WeekPlanScreen } from "../../../components/plan/week-plan";
import { isIsoDate } from "../../../components/plan/logic";
import { SignedOut } from "../../../components/plan/signed-out";

export const metadata: Metadata = { title: "Plan" };
export const dynamic = "force-dynamic";

/** Week plan (UX-4; WeekPlan.dc.html, SwapDialog.dc.html). `?week=` is any date in the week. */
export default async function PlanPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { week, meal } = await searchParams;
  return (
    <SignedOut what="The plan">
      <WeekPlanScreen
        week={typeof week === "string" && isIsoDate(week) ? week : null}
        meal={typeof meal === "string" && meal !== "" ? meal : null}
      />
    </SignedOut>
  );
}
