import type { ReactNode } from "react";
import { AssistantButton } from "./assistant-button";
import { hasAssistant } from "./nav";
import { Rail } from "./rail";
import { TabBar } from "./tab-bar";
import type { ShellViewer } from "./viewer";

export interface AppShellProps {
  readonly viewer: ShellViewer | null;
  /** The current path, for the active navigation item. */
  readonly pathname: string;
  readonly children: ReactNode;
  /** Right-hand panel on desktop (the chat side panel, 1.4.5). */
  readonly panel?: ReactNode;
}

/**
 * App shell (UX-3): a left rail at ≥ 1024 px; below that, a bottom tab bar and, for admins, a
 * floating assistant button. Role-aware parts take the viewer; nothing here fetches data.
 * Pure; `AppShell` in app-shell-client.tsx supplies the path from the router.
 */
export function AppShellFrame({ viewer, pathname, children, panel }: AppShellProps) {
  const assistant = viewer !== null && hasAssistant(viewer.role);
  return (
    <div className="flex min-h-dvh bg-paper">
      <a
        href="#main"
        className="sr-only-focusable fixed top-2 left-2 z-50 rounded-md bg-card px-4 py-3 font-extrabold text-action shadow-card"
      >
        Skip to content
      </a>
      <div className="hidden lg:block">
        <Rail viewer={viewer} pathname={pathname} />
      </div>
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 grow px-4 pt-5 pb-[calc(100px+env(safe-area-inset-bottom))] outline-none lg:px-8 lg:py-7"
      >
        {children}
      </main>
      {panel !== undefined && <aside className="hidden shrink-0 lg:block">{panel}</aside>}
      <div className="lg:hidden">
        <TabBar viewer={viewer} pathname={pathname} />
        {assistant && <AssistantButton pending={viewer.pendingProposals} />}
      </div>
    </div>
  );
}
