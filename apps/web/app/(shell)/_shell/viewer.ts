// Who the shell is drawn for (R-27): the signed-in login's name, role, household and member
// colour, and the pending-proposal badge for admins. Null when there is no usable session, a
// login is blocked, the household is suspended, or the user belongs to several households and
// has not picked one (least privilege: the shell then shows the member navigation), and when the
// process has no database configured.
import { headers } from "next/headers";
import { and, count, eq, gt } from "drizzle-orm";
import { isAvatarColor, type AvatarColor } from "@mealplanner/ui-tokens/tokens";
import { household, householdUser, member, proposal } from "@mealplanner/db/schema";
import { readSession } from "../../../lib/auth/context";
import { configuredRuntime } from "../../../lib/server/runtime";
import type { Role } from "./nav";

export interface ShellViewer {
  readonly name: string;
  readonly role: Role;
  readonly householdName: string;
  /** The member's id: the avatar's fallback colour key. */
  readonly memberKey: string;
  /** The member's stored colour (`member.color`), or null when none is set yet. */
  readonly memberColor: AvatarColor | null;
  /** Pending assistant proposals, shown as the badge on the Assistant button. */
  readonly pendingProposals: number;
}

export async function getShellViewer(): Promise<ShellViewer | null> {
  const rt = configuredRuntime();
  if (rt === null) return null;
  const h = await headers();
  const session = await readSession(rt, new Request("http://shell.invalid/", { headers: h }));
  if (session === null) return null;
  const logins = await rt.db
    .select({ login: householdUser, household })
    .from(householdUser)
    .innerJoin(household, eq(household.id, householdUser.householdId))
    .where(eq(householdUser.userId, session.user.id));
  const wanted = h.get("x-household-id");
  const usable = logins.filter(
    (l) => l.login.status !== "blocked" && l.household.suspendedAt === null,
  );
  const row =
    wanted === null
      ? usable.length === 1
        ? usable[0]
        : undefined
      : usable.find((l) => l.household.id === wanted);
  if (row === undefined) return null;
  let memberColor: AvatarColor | null = null;
  if (row.login.memberId !== null) {
    const [m] = await rt.db
      .select({ color: member.color })
      .from(member)
      .where(and(eq(member.householdId, row.household.id), eq(member.id, row.login.memberId)));
    memberColor = isAvatarColor(m?.color) ? m.color : null;
  }
  let pendingProposals = 0;
  if (row.login.role === "admin") {
    const [p] = await rt.db
      .select({ n: count() })
      .from(proposal)
      .where(
        and(
          eq(proposal.householdId, row.household.id),
          eq(proposal.status, "pending"),
          gt(proposal.expiresAt, new Date()),
        ),
      );
    pendingProposals = p?.n ?? 0;
  }
  return {
    name: session.user.name,
    role: row.login.role,
    householdName: row.household.name,
    memberKey: row.login.memberId ?? session.user.id,
    memberColor,
    pendingProposals,
  };
}
