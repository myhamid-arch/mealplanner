"use client";

// Where a person goes after signing in (leaf-1.4.6 SPEC-Q-13): a safe `next` path, else a
// platform operator without a household to the console, else the role's home (UX-3).
import { homePathFor, ROUTES } from "../../app/(shell)/_shell/nav";
import { api } from "./api";
import { safeNext } from "./format";
import { me } from "@mealplanner/api-contract/contract";

export const PLATFORM_HOME = "/platform";

export async function destinationAfterSignIn(next: string | null): Promise<string> {
  const safe = safeNext(next);
  if (safe !== null) return safe;
  try {
    const who = await api.call(me, {});
    const usable = who.memberships.filter((m) => m.status !== "blocked");
    if (usable.length === 0 && who.platformOperator) return PLATFORM_HOME;
    return usable.length === 1 ? homePathFor(usable[0]?.role ?? null) : ROUTES.today;
  } catch {
    return ROUTES.today;
  }
}
