import type { ReactNode } from "react";
import { TOOL_LABELS } from "@mealplanner/ai/agent";
import { ChatPanel } from "../../components/chat";
import { AppShell } from "./_shell/app-shell-client";
import { hasAssistant } from "./_shell/nav";
import { getShellViewer } from "./_shell/viewer";

/** The signed-in app's layout: every screen under (shell) and (app) renders inside the shell. */
export default async function ShellLayout({ children }: { readonly children: ReactNode }) {
  const viewer = await getShellViewer();
  return (
    <AppShell
      viewer={viewer}
      // AGT-7: the assistant beside every admin page on desktop (leaf 1.4.5, R-53).
      panel={
        viewer !== null && hasAssistant(viewer.role) ? (
          <ChatPanel labels={TOOL_LABELS} />
        ) : undefined
      }
    >
      {children}
    </AppShell>
  );
}
