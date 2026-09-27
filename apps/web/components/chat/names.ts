"use client";

// Names for ids the change descriptions and cards mention: members and dishes of the household.
import { dishesList, membersList } from "@mealplanner/api-contract/contract";
import { api } from "../admin/api";

export type Names = ReadonlyMap<string, string>;

export async function loadNames(): Promise<Names> {
  const [members, dishes] = await Promise.all([
    api.call(membersList, {}).catch(() => ({ members: [] })),
    api.call(dishesList, { query: {} }).catch(() => ({ dishes: [] })),
  ]);
  const out = new Map<string, string>();
  for (const d of dishes.dishes) out.set(d.id, d.name);
  for (const m of members.members) out.set(m.id, m.displayName);
  return out;
}
