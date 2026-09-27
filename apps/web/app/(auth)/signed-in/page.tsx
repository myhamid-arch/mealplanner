import type { Metadata } from "next";
import Link from "next/link";
import { PASSWORD_REMOVED } from "@mealplanner/api-contract/contract";
import { AuthSplit } from "../../../components/admin/auth-shell";
import { FormError } from "../../../components/admin/field";
import { PASSWORD_REMOVED_TEXT, safeNext } from "../../../components/admin/format";
import { LinkButton } from "../../../components/ui/button";
import { Icon } from "../../../components/ui/icon";
import { Forward } from "./forward";

export const metadata: Metadata = { title: "Signed in" };

/**
 * Where an emailed sign-in link lands (leaf-1.4.6 SPEC-Q-4). The verify step appends
 * `passwordRemoved=1` when the library removed an unverified account's password (R-42); the
 * person is told so and sent to Account to set a new one. Otherwise they go straight on.
 */
export default async function SignedInPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  if (typeof params.error === "string")
    return (
      <AuthSplit>
        <div className="flex flex-col gap-[18px]">
          <h1 className="text-[32px] lg:text-4xl">That link didn&rsquo;t work</h1>
          <FormError>
            Sign-in links work once, for 15 minutes. Ask for a new one on the sign-in page.
          </FormError>
          <Link href="/sign-in" className="font-extrabold">
            Back to sign in
          </Link>
        </div>
      </AuthSplit>
    );
  if (params[PASSWORD_REMOVED.query] === "1")
    return (
      <AuthSplit>
        <div className="flex flex-col gap-[18px]">
          <h1 className="text-[32px] lg:text-4xl">You&rsquo;re signed in</h1>
          <p
            role="alert"
            data-testid="password-removed"
            className="m-0 flex items-start gap-2.5 rounded-[14px] bg-saffron-tint px-4 py-3.5 font-bold text-saffron-text"
          >
            <Icon name="lock" size={20} className="mt-0.5 shrink-0" />
            <span>{PASSWORD_REMOVED_TEXT}.</span>
          </p>
          <LinkButton href="/account?passwordRemoved=1#password" size="lg">
            Set a new password in Account
          </LinkButton>
          <Forward next={next} auto={false} />
        </div>
      </AuthSplit>
    );
  return (
    <AuthSplit>
      <Forward next={next} auto />
    </AuthSplit>
  );
}
