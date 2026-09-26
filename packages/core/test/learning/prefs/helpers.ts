// Test helpers for the preference-model tests: preference rows and an independent FBK-4 table.
import type { PreferenceRow } from "../../../src/types/index.js";

let counter = 0;

export function pref(
  partial: Partial<PreferenceRow> & Pick<PreferenceRow, "entityType" | "entityKey" | "score">,
): PreferenceRow {
  counter += 1;
  return {
    id: `pref-${String(counter)}`,
    householdId: "h1",
    memberId: null,
    evidenceWeight: 0,
    source: "explicit",
    locked: false,
    hard: "none",
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...partial,
  };
}

/** The FBK-4 propagation table, written out from 06 §3 independently of `config.ts`. */
export const FBK4_TABLE = {
  dish: { dish: 1.0, cuisine: 0.3, method: 0.3, ingredientBase: 0.15 },
  variant: { variant: 1.0, method: 0.5, dish: 0.3 },
  component: { variant: 0.8, ingredientBase: 0.2 },
  direct: 1.0,
};

export const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/** Applies `preference.set` ops to in-memory rows the way the op does (insert or update). */
export function applyPreferenceSets(
  rows: readonly PreferenceRow[],
  ops: readonly {
    kind: "preference.set";
    payload: {
      memberId: string | null;
      entityType: PreferenceRow["entityType"];
      entityKey: string;
      score: number;
      source?: PreferenceRow["source"];
      evidenceWeight?: number;
    };
  }[],
): PreferenceRow[] {
  const out = rows.map((r) => ({ ...r }));
  for (const { payload: p } of ops) {
    const source = p.source ?? "explicit";
    const row = out.find(
      (r) =>
        r.memberId === p.memberId &&
        r.entityType === p.entityType &&
        r.entityKey === p.entityKey &&
        r.source === source,
    );
    if (row === undefined)
      out.push(
        pref({
          memberId: p.memberId,
          entityType: p.entityType,
          entityKey: p.entityKey,
          score: p.score,
          source,
          evidenceWeight: p.evidenceWeight ?? 0,
        }),
      );
    else {
      if (row.locked && source === "learned")
        throw new Error("locked preferences are never changed by learning");
      row.score = p.score;
      if (p.evidenceWeight !== undefined) row.evidenceWeight = p.evidenceWeight;
    }
  }
  return out;
}
