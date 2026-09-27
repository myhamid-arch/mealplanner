"use client";

// Who is looking, for the review, insights and chat screens: the login's role and member, the
// household's review rules, and the household's members (names, colours, ages).
import type { z } from "zod";
import {
  householdGet,
  me,
  membersList,
  type HouseholdDto,
  type MemberDto,
} from "@mealplanner/api-contract/contract";
import type { HouseholdRole } from "@mealplanner/core/types";
import { api } from "../admin/api";

export type Member = z.output<typeof MemberDto>;
export type Household = z.output<typeof HouseholdDto>;

export interface Viewer {
  userId: string;
  name: string;
  role: HouseholdRole;
  /** The member this login eats as, or null. */
  memberId: string | null;
  household: Household;
  /** Active (not archived) members, oldest first. */
  members: Member[];
}

/** Oldest first; members without a birth year after those with one, then by name. */
function byAge(a: Member, b: Member): number {
  const ay = a.birthYear ?? Number.MAX_SAFE_INTEGER;
  const by = b.birthYear ?? Number.MAX_SAFE_INTEGER;
  return ay - by || a.displayName.localeCompare(b.displayName);
}

export async function loadViewer(): Promise<Viewer> {
  const [who, household, members] = await Promise.all([
    api.call(me, {}),
    api.call(householdGet, {}),
    api.call(membersList, {}),
  ]);
  const membership =
    who.memberships.find((m) => m.householdId === household.id) ?? who.memberships[0];
  if (membership === undefined) throw new Error("This login belongs to no household.");
  return {
    userId: who.user.id,
    name: who.user.name,
    role: membership.role,
    memberId: membership.memberId,
    household,
    members: (members.members ?? []).filter((m) => m.archivedAt === null).sort(byAge),
  };
}

/**
 * Who a review may be written for (FBK-2, SPEC-Q-15): admins, anyone; a member, their own member
 * and, when the household allows it, members younger than them. The server enforces it too.
 */
export function reviewableMembers(viewer: Viewer): Member[] {
  if (viewer.role === "admin") return viewer.members;
  const self = viewer.members.find((m) => m.id === viewer.memberId);
  if (self === undefined) return [];
  if (!viewer.household.membersReviewForSiblings) return [self];
  return viewer.members.filter(
    (m) =>
      m.id === self.id ||
      (self.birthYear !== null && m.birthYear !== null && m.birthYear > self.birthYear),
  );
}

/** A member's name, or "Someone" for a member this viewer cannot see. */
export function memberName(viewer: Viewer, id: string | null | undefined): string {
  if (id === null || id === undefined) return "Household";
  return viewer.members.find((m) => m.id === id)?.displayName ?? "Someone";
}
