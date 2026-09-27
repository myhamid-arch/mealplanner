import type { Metadata } from "next";
import { AuthSplit } from "../../../components/admin/auth-shell";
import { safeNext } from "../../../components/admin/format";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Readonly<Record<string, string>> = {
  "password-set": "Your password is set. Sign in with it.",
  "signed-out": "You are signed out.",
  deleted: "Your account is deleted.",
};

/** SignIn.dc.html (R2-ADM-1): password, the two-step step, an email link, or an invite code. */
export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v : null;
  };
  const notice = NOTICES[one("notice") ?? ""] ?? null;
  return (
    <AuthSplit>
      <SignInForm next={safeNext(one("next"))} notice={notice} />
    </AuthSplit>
  );
}
