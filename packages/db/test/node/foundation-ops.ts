// The node-1.1 N3 change set (R-69): one op or more for each of members, targets, exclusions and
// settings, built from the F1 household's current state. The service test and the HTTP test apply
// the same set.
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../src/repos/index.js";

export interface FoundationOps {
  summary: string;
  ops: { kind: string; payload: Record<string, unknown> }[];
  /** Tables the set must change (so "equal after undo" is not vacuous). */
  expectChanged: string[];
}

export async function foundationOps(
  db: Executor,
  ctx: HouseholdContext,
  tag: string,
): Promise<FoundationOps> {
  const repos = createRepos(db, ctx);
  const members = (await repos.member.list()).filter((m) => m.archivedAt === null);
  const targeted = members.find((m) => m.isTargeted);
  const child = members.find((m) => !m.isTargeted);
  if (targeted === undefined || child === undefined)
    throw new Error("F1 has a targeted and an untargeted member");
  return {
    summary: `node-1.1 N3 ${tag}`,
    ops: [
      {
        kind: "member.create",
        payload: {
          displayName: `Guest ${tag}`,
          color: "basil",
          isTargeted: false,
          birthYear: 1990,
          appetite: "medium",
        },
      },
      {
        kind: "member.update",
        payload: {
          memberId: child.id,
          displayName: `${child.displayName} ${tag}`,
          appetite: "small",
        },
      },
      {
        kind: "target.set",
        payload: {
          memberId: targeted.id,
          kind: "default",
          profile: { kcal: 2050, proteinG: 170, carbsG: 190, fatG: 66, satFatMaxG: 20 },
        },
      },
      {
        kind: "exclusion.add",
        payload: {
          memberId: child.id,
          kind: "ingredient",
          key: `ingredient_${tag}`,
          reason: "dislike",
        },
      },
      {
        kind: "household.update",
        payload: { name: `Household F1 ${tag}`, satFatDefaultPct: 9 },
      },
      { kind: "weights.set", payload: { appeal: 0.55, variety: 0.35 } },
    ],
    expectChanged: ["exclusion", "household", "member", "planning_weights", "target_profile"],
  };
}
