import type { Metadata } from "next";
import { requirePageSession } from "../../../../components/admin/session-guard";
import { HouseholdSettingsScreen } from "./household-settings-screen";

export const metadata: Metadata = { title: "Household settings" };
export const dynamic = "force-dynamic";

/**
 * HouseholdSettings.dc.html (R2-ADM-6), the General tab of Settings (BLD-8 R-45): household,
 * who sees what, assistant and AI, default precision, data export, support access (R2-ADM-8),
 * delete household.
 */
export default async function HouseholdSettingsPage() {
  const session = await requirePageSession("/settings/household");
  return <HouseholdSettingsScreen viewerUserId={session.user.id} />;
}
