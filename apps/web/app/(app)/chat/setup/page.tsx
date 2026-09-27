import type { Metadata } from "next";
import { getShellViewer } from "../../../(shell)/_shell/viewer";
import { requirePageSession } from "../../../../components/admin/session-guard";
import { ChatOnboarding } from "../../../../components/chat/setup/chat-onboarding";
import { LinkButton } from "../../../../components/ui/button";
import { EmptyState } from "../../../../components/ui/empty-state";

export const metadata: Metadata = { title: "Set up with the assistant" };
export const dynamic = "force-dynamic";

/** ChatOnboarding.dc.html (R2-ONB-5; SPEC-Q-10, R-53): `/chat/setup`. */
export default async function ChatSetupPage() {
  await requirePageSession("/chat/setup");
  const viewer = await getShellViewer();
  if (viewer === null || viewer.role !== "admin")
    return (
      <EmptyState
        headingLevel={1}
        icon="family"
        title="An admin sets up the household"
        description="Your household's admin answers these questions. You can set your own tastes."
        action={<LinkButton href="/family/me">My tastes</LinkButton>}
      />
    );
  return <ChatOnboarding adminName={viewer.name} />;
}
