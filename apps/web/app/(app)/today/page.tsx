import type { Metadata } from "next";
import { TodayScreen } from "../../../components/plan/today";
import { isIsoDate } from "../../../components/plan/logic";
import { SignedOut } from "../../../components/plan/signed-out";
import { TodayFollowup } from "../../../components/setup/today-followup";
import { getShellViewer } from "../../(shell)/_shell/viewer";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/** Today (UX-4; TodayPhone.dc.html, TodayDesktop.dc.html). `?date=` shows another day. */
export default async function TodayPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { date } = await searchParams;
  // W-5 (leaf 1.4.7, R-57): the admin's first-days question of the day (R2-ONB-6).
  const admin = (await getShellViewer())?.role === "admin";
  return (
    <SignedOut what="Today">
      {admin && <TodayFollowup />}
      <TodayScreen date={typeof date === "string" && isIsoDate(date) ? date : null} />
    </SignedOut>
  );
}
