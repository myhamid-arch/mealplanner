import type { Metadata } from "next";
import { AdminOnly } from "../../../../components/config/admin-gate";
import { TastesScreen } from "../../../../components/config/tastes-screen";

export const metadata: Metadata = { title: "Family tastes" };
export const dynamic = "force-dynamic";

/** Family tastes (TastesDesktop.dc.html). */
export default function FamilyTastesPage() {
  return (
    <AdminOnly what="The family's tastes">
      <TastesScreen />
    </AdminOnly>
  );
}
