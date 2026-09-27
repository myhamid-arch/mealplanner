import type { Metadata } from "next";
import { requirePageSession } from "../../../components/admin/session-guard";
import { PeopleAccessScreen } from "./people-access-screen";

export const metadata: Metadata = { title: "People & access" };
export const dynamic = "force-dynamic";

/** PeopleAccess.dc.html (R2-ADM-2 … 4): logins, invites, members without a login, security. */
export default async function PeopleAccessPage() {
  const session = await requirePageSession("/access");
  return <PeopleAccessScreen viewerUserId={session.user.id} />;
}
