import type { Metadata } from "next";
import { requirePageSession } from "../../../components/admin/session-guard";
import { ConsoleScreen } from "./console-screen";

export const metadata: Metadata = { title: "Platform console" };
export const dynamic = "force-dynamic";

/** PlatformConsole.dc.html (R2-ADM-8): households, users, AI usage and cost, failed jobs. */
export default async function PlatformPage() {
  await requirePageSession("/platform");
  return <ConsoleScreen />;
}
