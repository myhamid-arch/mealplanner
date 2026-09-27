import type { Metadata } from "next";
import { MyTastes } from "../../../../components/config/my-tastes";

export const metadata: Metadata = { title: "My tastes" };
export const dynamic = "force-dynamic";

/** The Me tab (R-21 Q-3): My tastes (TastePhone.dc.html). Every role with a member. */
export default function MePage() {
  return <MyTastes />;
}
