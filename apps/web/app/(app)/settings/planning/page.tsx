import type { Metadata } from "next";
import { AdminOnly } from "../../../../components/config/admin-gate";
import { PlanningScreen } from "../../../../components/config/planning-screen";
import { SETTINGS_TABS } from "../../../(shell)/_shell/nav";

export const metadata: Metadata = { title: "Planning balance" };
export const dynamic = "force-dynamic";

/** Planning balance (PlanningBalance.dc.html; R-45 settings tab). */
export default function PlanningPage() {
  return (
    <AdminOnly what="The planning balance">
      <PlanningScreen tabs={SETTINGS_TABS} />
    </AdminOnly>
  );
}
