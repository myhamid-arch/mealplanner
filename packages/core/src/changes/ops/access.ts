// role.set* (AGT-6), access.block*, access.unblock, access.remove*, access.link_member*
// (R2-ADM-3/4), support.grant*, support.revoke (R2-ADM-8); BLD-8 R-10. (* = protected)
// The last-admin rule (R2-ADM-4) is enforced by the change-set service on every change set.
import { z } from "zod";
import { HOUSEHOLD_ROLES } from "../../types/index.js";
import { defineOp, requireRow } from "../define.js";
import { ChangeOpError, type ChangeTx } from "../tx.js";
import { id } from "./common.js";

const reason = z.string().trim().min(1).max(500);

async function requireLogin(kind: string, tx: ChangeTx, userId: string) {
  return requireRow(
    kind,
    `login ${userId}`,
    tx.get("household_user", { householdId: tx.householdId, userId }),
  );
}

export const roleSet = defineOp({
  kind: "role.set",
  area: "access",
  schema: z.object({ userId: id, role: z.enum(HOUSEHOLD_ROLES) }).strict(),
  protected: true,
  title: (p) => `Change role to ${p.role}`,
  apply: async (tx, { userId, role }) => {
    const login = await requireLogin("role.set", tx, userId);
    if (login.role === role) throw new ChangeOpError("role.set", `the login is already ${role}`);
    await tx.update("household_user", { householdId: tx.householdId, userId }, { role });
  },
});

/** Block: sign-in is prevented (sessions are revoked by the auth layer); reversible. */
export const accessBlock = defineOp({
  kind: "access.block",
  area: "access",
  schema: z.object({ userId: id, reason: reason.optional() }).strict(),
  protected: true,
  title: () => "Block login",
  apply: async (tx, { userId, reason: why }) => {
    const login = await requireLogin("access.block", tx, userId);
    if (login.status === "blocked")
      throw new ChangeOpError("access.block", "the login is already blocked");
    await tx.update(
      "household_user",
      { householdId: tx.householdId, userId },
      { status: "blocked", blockedReason: why ?? null },
    );
  },
});

export const accessUnblock = defineOp({
  kind: "access.unblock",
  area: "access",
  schema: z.object({ userId: id }).strict(),
  title: () => "Unblock login",
  apply: async (tx, { userId }) => {
    const login = await requireLogin("access.unblock", tx, userId);
    if (login.status !== "blocked")
      throw new ChangeOpError("access.unblock", "the login is not blocked");
    await tx.update(
      "household_user",
      { householdId: tx.householdId, userId },
      { status: "active", blockedReason: null },
    );
  },
});

/** Remove deletes the household_user link and optionally archives the linked member. */
export const accessRemove = defineOp({
  kind: "access.remove",
  area: "access",
  schema: z
    .object({ userId: id, reason: reason.optional(), archiveMember: z.boolean().default(false) })
    .strict(),
  protected: true,
  title: (p) => (p.archiveMember ? "Remove login and archive member" : "Remove login"),
  apply: async (tx, { userId, archiveMember }) => {
    const login = await requireLogin("access.remove", tx, userId);
    await tx.remove("household_user", { householdId: tx.householdId, userId });
    if (archiveMember) {
      if (login.memberId === null)
        throw new ChangeOpError("access.remove", "the login is not linked to a member");
      const member = await requireRow(
        "access.remove",
        `member ${login.memberId}`,
        tx.get("member", { id: login.memberId }),
      );
      if (member.archivedAt === null)
        await tx.update("member", { id: member.id }, { archivedAt: tx.now() });
    }
  },
});

/** Links a login to the member it eats as (null unlinks). A member has at most one login. */
export const accessLinkMember = defineOp({
  kind: "access.link_member",
  area: "access",
  schema: z.object({ userId: id, memberId: id.nullable() }).strict(),
  protected: true,
  title: (p) => (p.memberId === null ? "Unlink login from member" : "Link login to member"),
  apply: async (tx, { userId, memberId }) => {
    const login = await requireLogin("access.link_member", tx, userId);
    if (login.memberId === memberId) throw new ChangeOpError("access.link_member", "no change");
    if (memberId !== null) {
      await requireRow(
        "access.link_member",
        `member ${memberId}`,
        tx.get("member", { id: memberId }),
      );
      const other = (await tx.find("household_user", { memberId })).find(
        (row) => row.userId !== userId,
      );
      if (other !== undefined)
        throw new ChangeOpError("access.link_member", "the member is linked to another login");
    }
    await tx.update("household_user", { householdId: tx.householdId, userId }, { memberId });
  },
});

/** R2-ADM-8: time-limited operator access; granted by a household admin. */
export const supportGrant = defineOp({
  kind: "support.grant",
  area: "access",
  schema: z.object({ operatorUserId: id, expiresAt: z.iso.datetime({ offset: true }) }).strict(),
  protected: true,
  title: (p) => `Grant support access until ${p.expiresAt}`,
  apply: async (tx, { operatorUserId, expiresAt }) => {
    if (tx.actorUserId === null)
      throw new ChangeOpError("support.grant", "support access is granted by an admin");
    const now = tx.now();
    const expires = new Date(expiresAt);
    if (expires.getTime() <= now.getTime())
      throw new ChangeOpError("support.grant", "expiry must be in the future");
    await tx.insert("support_grant", {
      id: tx.newId(),
      householdId: tx.householdId,
      operatorUserId,
      grantedByUserId: tx.actorUserId,
      createdAt: now,
      expiresAt: expires,
      revokedAt: null,
    });
  },
});

export const supportRevoke = defineOp({
  kind: "support.revoke",
  area: "access",
  schema: z.object({ grantId: id }).strict(),
  title: () => "Revoke support access",
  apply: async (tx, { grantId }) => {
    const grant = await requireRow(
      "support.revoke",
      `support grant ${grantId}`,
      tx.get("support_grant", { id: grantId }),
    );
    if (grant.revokedAt !== null) throw new ChangeOpError("support.revoke", "already revoked");
    await tx.update("support_grant", { id: grantId }, { revokedAt: tx.now() });
  },
});
