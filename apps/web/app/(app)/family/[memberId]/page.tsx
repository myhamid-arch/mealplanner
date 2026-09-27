import type { Metadata } from "next";
import { AdminOnly } from "../../../../components/config/admin-gate";
import { FamilyScreen } from "../../../../components/config/family-screen";

export const metadata: Metadata = { title: "Family member" };
export const dynamic = "force-dynamic";

/** One member (MemberSimple / MemberDetailed.dc.html). */
export default async function MemberPage({
  params,
}: {
  readonly params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  return (
    <AdminOnly what="A family member's settings">
      <FamilyScreen selectedId={memberId} />
    </AdminOnly>
  );
}
