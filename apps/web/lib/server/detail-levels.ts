// Detail levels (R2-DL-1): the Basic · Detailed · Expert choice per (member, section). A UI
// preference written directly through its repository, outside DM-6 (BLD-8 R-24, R-47).
import type { z } from "zod";
import type { DetailLevelSetBody } from "@mealplanner/api-contract/contract";
import { createRepos, createWriteRepos } from "@mealplanner/db/repos";
import { newId } from "@mealplanner/db/schema";
import type { CallerContext } from "../auth/context";
import { forbidden, notFound, unprocessable } from "./problem";
import type { Runtime } from "./runtime";

/** Sections with a level per member, and household-level sections (member null). */
export const MEMBER_SECTIONS = ["targets", "meal_split", "taste"] as const;
export const HOUSEHOLD_SECTIONS = ["slots", "planning", "taste"] as const;

const dto = (row: {
  memberId: string | null;
  section: string;
  level: "basic" | "detailed" | "expert";
}) => ({
  memberId: row.memberId,
  section: row.section,
  level: row.level,
});

export async function listDetailLevels(rt: Runtime, caller: CallerContext) {
  const rows = await createRepos(rt.db, caller.ctx).detail_level.list();
  const visible =
    caller.ctx.role === "admin"
      ? rows
      : rows.filter((r) => r.memberId !== null && r.memberId === caller.memberId);
  return {
    levels: visible
      .map(dto)
      .sort((a, b) =>
        `${a.memberId ?? ""}${a.section}`.localeCompare(`${b.memberId ?? ""}${b.section}`),
      ),
  };
}

export async function setDetailLevel(
  rt: Runtime,
  caller: CallerContext,
  body: z.output<typeof DetailLevelSetBody>,
) {
  const sections: readonly string[] = body.memberId === null ? HOUSEHOLD_SECTIONS : MEMBER_SECTIONS;
  if (!sections.includes(body.section))
    throw unprocessable(
      "invalid_section",
      `"${body.section}" is not a ${body.memberId === null ? "household" : "member"} section`,
    );
  if (
    caller.ctx.role !== "admin" &&
    (body.memberId === null || body.memberId !== caller.memberId || body.section !== "taste")
  )
    throw forbidden("forbidden_member", "members may set only their own taste level");
  return rt.db.transaction(async (tx) => {
    const repos = createWriteRepos(tx, caller.ctx);
    if (body.memberId !== null && (await repos.member.get({ id: body.memberId })) === null)
      throw notFound("member");
    const [existing] = await repos.detail_level.list({
      memberId: body.memberId,
      section: body.section,
    });
    const row =
      existing === undefined
        ? await repos.detail_level.insert({
            id: newId(),
            householdId: caller.ctx.householdId,
            memberId: body.memberId,
            section: body.section,
            level: body.level,
          })
        : await repos.detail_level.update({ id: existing.id }, { level: body.level });
    return dto(row);
  });
}
