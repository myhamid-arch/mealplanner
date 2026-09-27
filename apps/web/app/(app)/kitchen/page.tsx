import type { Metadata } from "next";
import { CookSheetScreen } from "../../../components/plan/cook-sheet";
import { isIsoDate } from "../../../components/plan/logic";
import { SignedOut } from "../../../components/plan/signed-out";

export const metadata: Metadata = { title: "Kitchen" };
export const dynamic = "force-dynamic";

/** Kitchen cook sheet (UX-4; CookSheet.dc.html; PLN-14). `?date=` and `?meal=` pick the sheet. */
export default async function KitchenPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { date, meal } = await searchParams;
  return (
    <SignedOut what="The cook sheet">
      <CookSheetScreen
        date={typeof date === "string" && isIsoDate(date) ? date : null}
        mealId={typeof meal === "string" && meal !== "" ? meal : null}
      />
    </SignedOut>
  );
}
