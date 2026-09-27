import type { Metadata } from "next";
import { AdminOnly } from "../../../components/config/admin-gate";
import { FirstDays } from "../../../components/setup/first-days";
import { getShellViewer } from "../../(shell)/_shell/viewer";

export const metadata: Metadata = { title: "Getting set up" };
export const dynamic = "force-dynamic";

/** First days (FirstDaysPhone.dc.html; R2-ONB-6): one quick question a day and the checklist. */
export default async function GettingStartedPage() {
  const viewer = await getShellViewer();
  return (
    <AdminOnly what="Getting set up">
      <FirstDays name={viewer?.name ?? ""} />
    </AdminOnly>
  );
}
