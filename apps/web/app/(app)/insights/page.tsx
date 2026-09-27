import type { Metadata } from "next";
import { requirePageSession } from "../../../components/admin/session-guard";
import { InsightsScreen } from "./insights-screen";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

/** Insights.dc.html (FBK-9, UX-4 Insights): what the app has learned, and what waits for a decision. */
export default async function InsightsPage() {
  await requirePageSession("/insights");
  return <InsightsScreen />;
}
