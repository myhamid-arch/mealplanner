import type { Metadata } from "next";
import { TodayScreen } from "../../../components/plan/today";
import { isIsoDate } from "../../../components/plan/logic";
import { SignedOut } from "../../../components/plan/signed-out";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/** Today (UX-4; TodayPhone.dc.html, TodayDesktop.dc.html). `?date=` shows another day. */
export default async function TodayPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { date } = await searchParams;
  return (
    <SignedOut what="Today">
      <TodayScreen date={typeof date === "string" && isIsoDate(date) ? date : null} />
    </SignedOut>
  );
}
