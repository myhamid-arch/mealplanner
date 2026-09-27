import type { Metadata } from "next";
import { AdminOnly } from "../../../../components/config/admin-gate";
import { DetailLevelsScreen } from "../../../../components/config/detail-levels-screen";

export const metadata: Metadata = { title: "How detail levels work" };
export const dynamic = "force-dynamic";

/** How detail levels work (DetailLevels.dc.html; R2-DL). */
export default function DetailLevelsPage() {
  return (
    <AdminOnly what="Detail levels">
      <DetailLevelsScreen />
    </AdminOnly>
  );
}
