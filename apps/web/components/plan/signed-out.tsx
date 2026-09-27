// Screens of this leaf need a household session; without one they explain and link to sign-in
// (UX-7). Kitchen users are sent to the cook sheet by the screens themselves (UX-3).
import type { ReactNode } from "react";
import { EmptyState, LinkButton } from "../ui";
import { getShellViewer } from "../../app/(shell)/_shell/viewer";

export async function SignedOut({
  children,
  what,
}: {
  readonly children: ReactNode;
  readonly what: string;
}) {
  const viewer = await getShellViewer();
  if (viewer === null)
    return (
      <EmptyState
        headingLevel={1}
        icon="me"
        title="Sign in to continue"
        description={`${what} needs you to be signed in to your household.`}
        action={<LinkButton href="/sign-in">Sign in</LinkButton>}
      />
    );
  return <>{children}</>;
}
