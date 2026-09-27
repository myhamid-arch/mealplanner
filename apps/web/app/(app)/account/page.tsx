import type { Metadata } from "next";
import { PASSWORD_REMOVED } from "@mealplanner/api-contract/contract";
import { requirePageSession } from "../../../components/admin/session-guard";
import { AccountScreen } from "./account-screen";

export const metadata: Metadata = { title: "My account" };
export const dynamic = "force-dynamic";

/** AccountPhone.dc.html (R2-ADM-5): profile, password, two-step sign-in, sessions, notifications. */
export default async function AccountPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageSession("/account");
  const params = await searchParams;
  return <AccountScreen passwordRemoved={params[PASSWORD_REMOVED.query] === "1"} />;
}
