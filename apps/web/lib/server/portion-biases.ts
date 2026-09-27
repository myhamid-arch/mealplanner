// Portion biases (FBK-5, FBK-9; BLD-8 R-53): the learned role biases of members' portions, read for
// the Insights screen. Admins read every member's (or one member's); a member reads only their own
// member's. Rows are household-scoped through the repositories (DM-1).
import { createRepos } from "@mealplanner/db/repos";
import type { CallerContext } from "../auth/context";
import { forbidden } from "./problem";
import type { Runtime } from "./runtime";

export async function listPortionBiases(
  rt: Runtime,
  caller: CallerContext,
  memberId: string | undefined,
) {
  const admin = caller.ctx.role === "admin";
  if (!admin && memberId !== undefined && memberId !== caller.memberId)
    throw forbidden("forbidden_member", "members may read only their own portion biases");
  // A member without a linked member has no portions of their own.
  const only = admin ? memberId : (caller.memberId ?? null);
  if (only === null) return { biases: [] };
  const rows = await createRepos(rt.db, caller.ctx).portion_bias.list(
    only === undefined ? {} : { memberId: only },
  );
  return {
    biases: rows
      .map((r) => ({ memberId: r.memberId, componentRole: r.componentRole, factor: r.bias }))
      .sort((a, b) =>
        `${a.memberId}${a.componentRole}`.localeCompare(`${b.memberId}${b.componentRole}`),
      ),
  };
}
