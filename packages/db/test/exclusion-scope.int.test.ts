// Slot-scoped exclusions in the database (OQ-9, 02 §6, DM-5; leaf-1.2.6 SPEC-Q-4, R-10):
// - `exclusion.slot_keys` (migration 0007): null = every slot;
// - the database refuses a scoped allergy and an empty scope;
// - the unique key allows the same exclusion once per scope;
// - `exclusion.add` writes the canonical scope, and the change log (forward ops, inverse images,
//   descriptions) carries it; undo restores the rows exactly.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { HouseholdContext } from "@mealplanner/core/types";
import { changeSet, exclusion } from "../src/schema/index.js";
import { newId } from "../src/schema/ids.js";
import {
  applyChangeSet,
  ChangeValidationError,
  undoChangeSet,
} from "../src/services/changes/index.js";
import { loadHouseholdConfig } from "../src/services/config/index.js";
import { catalogDatabase, F1, fixtureOnly } from "./support/fixtures.js";
import type { TestDatabase } from "./support/db.js";

const SCHOOL = "packed_school_lunch";

let database: TestDatabase;
let ctx: HouseholdContext;
let child: string;

beforeAll(async () => {
  database = await catalogDatabase();
  const loaded = await fixtureOnly(database, F1);
  ctx = loaded.adminContext;
  const c1 = loaded.members.c1;
  if (c1 === undefined) throw new Error("F1 has no member c1");
  child = c1;
}, 120_000);

afterAll(async () => {
  await database.drop();
});

/** Postgres error code of a raw insert, or null when it succeeds. */
async function insertCode(row: {
  reason: string;
  hard?: boolean;
  slotKeys: string[] | null;
  key?: string;
}): Promise<string | null> {
  // A Postgres array literal ("{a,b}", "{}" for empty): a JS array would bind as a value list.
  const keys = row.slotKeys === null ? sql`NULL` : sql`${`{${row.slotKeys.join(",")}}`}::text[]`;
  try {
    await database.db.execute(
      sql`INSERT INTO exclusion (id, household_id, member_id, kind, key, reason, hard, slot_keys)
          VALUES (${newId()}, ${ctx.householdId}, ${child}, 'dietary_flag', ${row.key ?? "contains_nuts"},
                  ${row.reason}, ${row.hard ?? true}, ${keys})`,
    );
    return null;
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause;
    return cause?.code ?? (e as { code?: string }).code ?? "unknown";
  }
}

const nutRows = () =>
  database.db
    .select()
    .from(exclusion)
    .where(
      and(
        eq(exclusion.householdId, ctx.householdId),
        eq(exclusion.memberId, child),
        eq(exclusion.key, "contains_nuts"),
      ),
    );

describe("database checks (02 §6, DM-5)", () => {
  it("refuses a slot-scoped allergy (check exclusion_allergy_unscoped)", async () => {
    expect(await insertCode({ reason: "allergy", slotKeys: [SCHOOL], key: "db_allergy" })).toBe(
      "23514",
    );
    expect(await insertCode({ reason: "allergy", slotKeys: null, key: "db_allergy" })).toBeNull();
  });
  it("refuses an empty scope (check exclusion_slot_keys_not_empty)", async () => {
    expect(await insertCode({ reason: "other", slotKeys: [], key: "db_empty" })).toBe("23514");
  });
  it("allows the same exclusion once per scope (unique key with slot_keys, nulls not distinct)", async () => {
    expect(await insertCode({ reason: "other", slotKeys: null, key: "db_scope" })).toBeNull();
    expect(await insertCode({ reason: "other", slotKeys: [SCHOOL], key: "db_scope" })).toBeNull();
    expect(await insertCode({ reason: "other", slotKeys: null, key: "db_scope" })).toBe("23505");
    expect(await insertCode({ reason: "other", slotKeys: [SCHOOL], key: "db_scope" })).toBe(
      "23505",
    );
  });
});

describe("exclusion.add through the change-set service (AGT-6)", () => {
  const add = (payload: Record<string, unknown>) =>
    applyChangeSet(database.db, ctx, {
      actor: "user",
      source: "ui",
      summary: "Nut-free lunch box",
      ops: [
        {
          kind: "exclusion.add",
          payload: {
            memberId: child,
            kind: "dietary_flag",
            key: "contains_nuts",
            reason: "other",
            ...payload,
          },
        },
      ],
    });

  it("writes the canonical scope; the change log carries it; undo restores", async () => {
    const applied = await add({ slotKeys: [SCHOOL, "snack", SCHOOL] });
    const rows = await nutRows();
    expect(rows.map((r) => r.slotKeys)).toEqual([[SCHOOL, "snack"]]);

    const [cs] = await database.db
      .select()
      .from(changeSet)
      .where(eq(changeSet.id, applied.changeSetId));
    const forward = JSON.stringify(cs?.forward);
    expect(forward).toContain(`"slotKeys":["${SCHOOL}","snack"]`);
    const description = applied.descriptions[0];
    expect(description?.title).toBe(
      `Exclude dietary flag "contains_nuts" (other) in ${SCHOOL}, snack only`,
    );
    expect(
      description?.changes.find((c) => c.entity === "exclusion" && c.field === "slotKeys")?.after,
    ).toEqual([SCHOOL, "snack"]);

    // The planner's configuration reads the scope back.
    const config = await loadHouseholdConfig(database.db, ctx);
    expect(
      config.exclusions.find((e) => e.memberId === child && e.key === "contains_nuts")?.slotKeys,
    ).toEqual([SCHOOL, "snack"]);

    await undoChangeSet(database.db, ctx, applied.changeSetId, { actor: "user", source: "ui" });
    expect(await nutRows()).toEqual([]);
  });

  it("adds an unscoped row beside a scoped one, and updates only the row of the same scope", async () => {
    await add({ slotKeys: [SCHOOL] });
    await add({});
    expect((await nutRows()).map((r) => JSON.stringify(r.slotKeys)).sort()).toEqual(
      [JSON.stringify([SCHOOL]), "null"].sort(),
    );
    const relabel = await add({ slotKeys: [SCHOOL], reason: "dislike", hard: false });
    const rows = await nutRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.slotKeys !== null)?.reason).toBe("dislike");
    expect(rows.find((r) => r.slotKeys === null)?.reason).toBe("other");
    // Undo restores the relabelled row's scope and reason from its before-image.
    await undoChangeSet(database.db, ctx, relabel.changeSetId, { actor: "user", source: "ui" });
    expect((await nutRows()).find((r) => r.slotKeys !== null)).toMatchObject({
      slotKeys: [SCHOOL],
      reason: "other",
      hard: true,
    });
    await database.db
      .delete(exclusion)
      .where(and(eq(exclusion.householdId, ctx.householdId), eq(exclusion.key, "contains_nuts")));
  });

  it("refuses a scoped allergy before writing anything", async () => {
    await expect(add({ reason: "allergy", slotKeys: [SCHOOL] })).rejects.toBeInstanceOf(
      ChangeValidationError,
    );
    expect(await nutRows()).toEqual([]);
  });

  it("refuses a slot the household does not have", async () => {
    await expect(add({ slotKeys: ["elevenses"] })).rejects.toThrow(/no slot elevenses/);
    expect(await nutRows()).toEqual([]);
  });
});
