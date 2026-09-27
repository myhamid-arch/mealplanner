// Screens that change household configuration are for admins (ARC-6); others get a plain
// explanation and the way to what they can use.
import type { ReactNode } from "react";
import { LinkButton } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { getShellViewer } from "../../app/(shell)/_shell/viewer";

export async function AdminOnly({
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
  if (viewer.role !== "admin")
    return (
      <EmptyState
        headingLevel={1}
        icon="family"
        title="For the household's admins"
        description={`${what} is changed by an admin. You can set your own tastes.`}
        action={<LinkButton href="/family/me">My tastes</LinkButton>}
      />
    );
  return <>{children}</>;
}
