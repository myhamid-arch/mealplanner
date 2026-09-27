import type { Metadata } from "next";
import { PlateScreen } from "../../../../../components/plan/plate-detail";
import { SignedOut } from "../../../../../components/plan/signed-out";

export const metadata: Metadata = { title: "Plate" };
export const dynamic = "force-dynamic";

/** Plate detail (UX-4; PlatePhone.dc.html). */
export default async function PlatePage({
  params,
}: {
  readonly params: Promise<{ plateId: string }>;
}) {
  const { plateId } = await params;
  return (
    <SignedOut what="This plate">
      <PlateScreen id={plateId} />
    </SignedOut>
  );
}
