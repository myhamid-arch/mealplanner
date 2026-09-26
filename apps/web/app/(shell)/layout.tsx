import type { ReactNode } from "react";
import { AppShell } from "./_shell/app-shell-client";
import { getShellViewer } from "./_shell/viewer";

/** The signed-in app's layout: every screen under (shell) and (app) renders inside the shell. */
export default async function ShellLayout({ children }: { readonly children: ReactNode }) {
  const viewer = await getShellViewer();
  return <AppShell viewer={viewer}>{children}</AppShell>;
}
