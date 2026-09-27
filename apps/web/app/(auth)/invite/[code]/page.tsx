import type { Metadata } from "next";
import { AuthCentered } from "../../../../components/admin/auth-shell";
import { normaliseCode } from "../../../../components/admin/format";
import { AcceptInvite } from "./accept-form";

export const metadata: Metadata = { title: "Accept invite" };

/** InviteAccept.dc.html (R2-ADM-2): the invite link `${APP_URL}/invite/<code>` lands here. */
export default async function InvitePage({
  params,
}: {
  readonly params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <AuthCentered width={520}>
      <AcceptInvite code={normaliseCode(decodeURIComponent(code))} />
    </AuthCentered>
  );
}
