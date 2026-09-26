// Who the shell is drawn for. This leaf has no auth (1.4.1 / 1.4.6), so the lookup returns
// null and the shell shows the member navigation with no assistant and no account card
// (least privilege). Ownership of this file passes to 1.4.1 when 1.4.2 merges; 1.4.1 replaces
// the body with the session lookup (BLD-8 R-21 Q-5).
import type { Role } from "./nav";

export interface ShellViewer {
  readonly name: string;
  readonly role: Role;
  readonly householdName: string;
  /** Stable key (member id) for the avatar colour. */
  readonly memberKey: string;
  /** Pending assistant proposals, shown as the badge on the Assistant button. */
  readonly pendingProposals: number;
}

export function getShellViewer(): Promise<ShellViewer | null> {
  return Promise.resolve(null);
}
