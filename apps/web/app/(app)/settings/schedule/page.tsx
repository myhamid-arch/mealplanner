import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminOnly } from "../../../../components/config/admin-gate";
import { LoadingBlock } from "../../../../components/config/parts";
import { ScheduleScreen } from "../../../../components/config/schedule-screen";
import { SETTINGS_TABS } from "../../../(shell)/_shell/nav";

export const metadata: Metadata = { title: "Meals & schedule" };
export const dynamic = "force-dynamic";

/** Meals & schedule (ScheduleGrid.dc.html; R-45 settings tab). */
export default function SchedulePage() {
  return (
    <AdminOnly what="Meals and schedule">
      <Suspense fallback={<LoadingBlock label="Loading meals and schedule" />}>
        <ScheduleScreen tabs={SETTINGS_TABS} />
      </Suspense>
    </AdminOnly>
  );
}
