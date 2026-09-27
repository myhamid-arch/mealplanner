"use client";

// Names for ids and slugs the change descriptions and cards mention: members, dishes (by id and
// by `dish:<slug>`) and catalogue ingredients (by `ingredient:<slug>`).
import { dishesList, ingredientsList, membersList } from "@mealplanner/api-contract/contract";
import { api } from "../admin/api";

export type Names = ReadonlyMap<string, string>;

export async function loadNames(): Promise<Names> {
  const [members, dishes, ingredients] = await Promise.all([
    api.call(membersList, {}).catch(() => ({ members: [] })),
    api.call(dishesList, { query: {} }).catch(() => ({ dishes: [] })),
    api.call(ingredientsList, { query: { limit: 500 } }).catch(() => ({ ingredients: [] })),
  ]);
  const out = new Map<string, string>();
  for (const i of ingredients.ingredients) out.set(`ingredient:${i.slug}`, i.name);
  for (const d of dishes.dishes) {
    out.set(d.id, d.name);
    out.set(`dish:${d.slug}`, d.name);
  }
  for (const m of members.members) out.set(m.id, m.displayName);
  return out;
}
