import type { Metadata } from "next";
import { OnboardingFlow } from "../../../components/config/onboarding/onboarding-flow";
import { LinkButton } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { getShellViewer } from "../../(shell)/_shell/viewer";

export const metadata: Metadata = { title: "Set up your household" };
export const dynamic = "force-dynamic";

/**
 * Onboarding (R2-ONB; Onboarding.dc.html), outside the app shell (R-47): the page checks the
 * session and the admin role on the server itself.
 */
export default async function OnboardingPage() {
  const viewer = await getShellViewer();
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-[1280px] flex-col px-4 py-6 sm:px-8 lg:px-12 lg:py-8"
    >
      {viewer === null ? (
        <EmptyState
          headingLevel={1}
          icon="me"
          title="Sign in to set up your household"
          description="Setting up takes five quick questions once you are signed in."
          action={<LinkButton href="/sign-in">Sign in</LinkButton>}
        />
      ) : viewer.role !== "admin" ? (
        <EmptyState
          headingLevel={1}
          icon="family"
          title="An admin sets up the household"
          description="Your household's admin answers these questions. You can set your own tastes."
          action={<LinkButton href="/family/me">My tastes</LinkButton>}
        />
      ) : (
        <OnboardingFlow adminName={viewer.name} />
      )}
    </main>
  );
}
