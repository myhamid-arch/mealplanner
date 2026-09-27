import type { Metadata } from "next";
import { requirePageSession } from "../../../components/admin/session-guard";
import { ChangeLogScreen } from "./change-log-screen";

export const metadata: Metadata = { title: "Change log" };
export const dynamic = "force-dynamic";

/** ChangeLog.dc.html (R2-ADM-7, PRD-15): every change, who or what made it, and Undo. */
export default async function ChangeLogPage() {
  const session = await requirePageSession("/changelog");
  return <ChangeLogScreen viewerUserId={session.user.id} />;
}
