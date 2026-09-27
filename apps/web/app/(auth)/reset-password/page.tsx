import type { Metadata } from "next";
import Link from "next/link";
import { AuthSplit } from "../../../components/admin/auth-shell";
import { FormError } from "../../../components/admin/field";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * The emailed reset link lands here with `?token=` (R2-ADM-1). It also sets a first password for
 * an account whose password was removed by an email-link sign-in (BLD-8 R-42, SPEC-Q-5).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  const failed = typeof params.error === "string";
  return (
    <AuthSplit>
      {token === null || failed ? (
        <div className="flex flex-col gap-[18px]">
          <h1 className="text-[32px] lg:text-4xl">Choose a new password</h1>
          <FormError>This link has expired or was already used. Ask for a new one.</FormError>
          <Link href="/sign-in" className="font-extrabold">
            Back to sign in
          </Link>
        </div>
      ) : (
        <ResetForm token={token} />
      )}
    </AuthSplit>
  );
}
