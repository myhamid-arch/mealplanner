import type { Metadata } from "next";
import { AdminOnly } from "../../../components/config/admin-gate";
import { FamilyScreen } from "../../../components/config/family-screen";

export const metadata: Metadata = { title: "Family" };
export const dynamic = "force-dynamic";

/** Family (UX-4; MemberSimple.dc.html): the members, and on desktop the first one's settings. */
export default function FamilyPage() {
  return (
    <AdminOnly what="The family's settings">
      <FamilyScreen selectedId={null} />
    </AdminOnly>
  );
}
