// Invariants checked on the post-state of every change set, before it commits.
import { and, count, eq } from "drizzle-orm";
import type { Executor } from "../../repos/index.js";
import { householdUser } from "../../schema/index.js";
import { LastAdminError } from "./errors.js";

/** Number of active admins of a household. */
export async function activeAdminCount(db: Executor, householdId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(householdUser)
    .where(
      and(
        eq(householdUser.householdId, householdId),
        eq(householdUser.role, "admin"),
        eq(householdUser.status, "active"),
      ),
    );
  return row?.n ?? 0;
}

/**
 * R2-ADM-4: the last admin can never be blocked, removed or demoted. Checked on the result of the
 * whole change set (so a promote-then-demote in one set passes), including undos.
 */
export async function assertHasActiveAdmin(db: Executor, householdId: string): Promise<void> {
  if ((await activeAdminCount(db, householdId)) < 1) throw new LastAdminError();
}
