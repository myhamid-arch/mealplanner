import type { Metadata } from "next";
import { requirePageSession } from "../../../../components/admin/session-guard";
import { DiagnosticsScreen } from "./diagnostics-screen";

export const metadata: Metadata = { title: "Diagnostics" };
export const dynamic = "force-dynamic";

/** ARC-12 (BLD-8 R-40): the admin diagnostics page, reading `GET /api/v1/diagnostics`. */
export default async function DiagnosticsPage() {
  await requirePageSession("/account/diagnostics");
  return <DiagnosticsScreen />;
}
