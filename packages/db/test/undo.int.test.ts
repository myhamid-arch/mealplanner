// G4 (AGT-6 undo semantics, R2-ADM-7): undo refuses with a conflict when a later change set
// touched the same entity.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos } from "../src/repos/index.js";
import {
  AlreadyUndoneError,
  ChangeConflictError,
  ChangeSetNotFoundError,
  applyChangeSet,
  canUndo,
  listChangeSets,
  undoChangeSet,
} from "../src/services/changes/index.js";
import { inHouseholdTransaction, insertChangeSet, runOps } from "../src/services/changes/apply.js";
import { inverseOps } from "../src/services/changes/undo.js";
import { DbChangeTx } from "../src/services/changes/tx.js";
import { newId } from "../src/schema/ids.js";
import type { TestDatabase } from "./support/db.js";
import {
  catalogDatabase,
  F1,
  fixtureHousehold,
  type FixtureHousehold,
} from "./support/fixtures.js";
import { must } from "./support/must.js";

let database: TestDatabase;
let household: FixtureHousehold;
let ctx: HouseholdContext;
let memberA: string;
let memberB: string;

beforeAll(async () => {
  database = await catalogDatabase();
  household = await fixtureHousehold(database, F1);
  ctx = household.loaded.adminContext;
  [memberA, memberB] = Object.values(household.loaded.members) as [string, string];
}, 120_000);

afterAll(async () => {
  await database.drop();
});

const apply = async (summary: string, ops: unknown[]) =>
  (await applyChangeSet(database.db, ctx, { actor: "user", source: "ui", summary, ops }))
    .changeSetId;
const member = async (id: string) => must(await createRepos(database.db, ctx).member.get({ id }));

type Undo = (changeSetId: string) => Promise<unknown>;
const serviceUndo: Undo = (id) =>
  undoChangeSet(database.db, ctx, id, { actor: "user", source: "ui" });

/** Undo without the conflict check: the negative control (inverse applied blindly). */
const blindUndo: Undo = (id) =>
  inHouseholdTransaction(database.db, ctx, async (trx, timestamp) => {
    const row = must(await createRepos(trx, ctx).change_set.get({ id }));
    const tx = new DbChangeTx(trx, ctx, timestamp);
    const { inverse } = await runOps(tx, inverseOps(row), true);
    await insertChangeSet(trx, ctx, {
      id: newId(),
      actor: "user",
      source: "ui",
      summary: "blind undo",
      forward: row.inverse as unknown[],
      inverse,
      appliedAt: timestamp,
    });
  });

/**
 * The G4 property: after a later change to the same member, undoing the earlier change must not
 * lose the later change. Returns a description of what went wrong, or null when it held.
 */
async function laterChangeSurvives(undo: Undo): Promise<string | null> {
  const first = await apply("first: rename", [
    { kind: "member.update", payload: { memberId: memberA, displayName: "Renamed once" } },
  ]);
  const second = await apply("second: recolour", [
    { kind: "member.update", payload: { memberId: memberA, color: "olive" } },
  ]);
  let refused: unknown = null;
  try {
    await undo(first);
  } catch (error) {
    refused = error;
  }
  const after = await member(memberA);
  const problem =
    after.color !== "olive"
      ? `the later change was lost (colour is ${after.color})`
      : !(refused instanceof ChangeConflictError)
        ? "undo was not refused with a conflict"
        : !refused.conflicts.some((c) => c.changeSetId === second)
          ? "the conflict does not name the later change set"
          : null;
  // The negative control stops here (the last test in this file; its state is not reused).
  if (problem !== null) return problem;
  await serviceUndo(second);
  // After undoing the later change, the earlier change is still blocked: the undo of `second` is
  // itself a later change set touching the member.
  await expect(serviceUndo(first)).rejects.toBeInstanceOf(ChangeConflictError);
  return null;
}

describe(
  "G4 undo refuses with a conflict when a later change set touched the same entity",
  { timeout: 120_000 },
  () => {
    it("refuses, names the later change set, and keeps the later change", async () => {
      expect(await laterChangeSurvives(serviceUndo)).toBeNull();
    });

    it("an unrelated later change does not block the undo", async () => {
      const first = await apply("rename A", [
        { kind: "member.update", payload: { memberId: memberA, notes: "note A" } },
      ]);
      await apply("rename B", [
        { kind: "member.update", payload: { memberId: memberB, notes: "note B" } },
      ]);
      expect(await canUndo(database.db, ctx, first)).toEqual({ ok: true });
      await serviceUndo(first);
      expect((await member(memberA)).notes).toBeNull();
      expect((await member(memberB)).notes).toBe("note B");
    });

    it("conflicts are found through child rows too (a lock after a saved plan)", async () => {
      const saved = await apply("save plan", [
        {
          kind: "plan.save_days",
          payload: {
            days: [
              {
                date: "2027-03-01",
                weightsSnapshot: {},
                generatedAt: new Date().toISOString(),
                generatorVersion: "g4",
                meals: [
                  {
                    slotTypeId: must(household.loaded.slots.dinner),
                    dishId: household.populated.dishId,
                    memberScope: "shared",
                    scoreBreakdown: {},
                    plates: [],
                  },
                ],
              },
            ],
          },
        },
      ]);
      const meals = await createRepos(database.db, ctx).plan_meal.list();
      const newMeal = must(
        meals.find(
          (m) =>
            m.scoreBreakdown !== null &&
            m.dishId === household.populated.dishId &&
            !m.locked &&
            m.id !== household.populated.planMealId,
        ),
      );
      const locked = await apply("lock", [
        { kind: "plan.lock", payload: { planMealId: newMeal.id } },
      ]);
      await expect(serviceUndo(saved)).rejects.toBeInstanceOf(ChangeConflictError);
      await serviceUndo(locked);
    });

    it("the change log shows Undo disabled with the conflicting change (R2-ADM-7)", async () => {
      const first = await apply("log: first", [{ kind: "weights.set", payload: { appeal: 0.11 } }]);
      const second = await apply("log: second", [
        { kind: "weights.set", payload: { variety: 0.22 } },
      ]);
      const entries = await listChangeSets(database.db, ctx, { limit: 10 });
      const entry = (id: string) => must(entries.find((e) => e.changeSet.id === id));
      expect(entry(second).undo).toEqual({ ok: true });
      expect(entry(first).undo).toMatchObject({
        ok: false,
        reason: "conflict",
        conflicts: [{ changeSetId: second, summary: "log: second" }],
      });
      expect(await canUndo(database.db, ctx, first)).toMatchObject({
        ok: false,
        reason: "conflict",
      });
      expect(entry(first).areas).toEqual(["planning"]);
      // Paging back with `before` gives the same answer for the older entry.
      const page = await listChangeSets(database.db, ctx, {
        before: entry(second).changeSet.appliedAt,
        limit: 1,
      });
      expect(page.map((e) => e.changeSet.id)).toEqual([first]);
      expect(must(page[0]).undo).toMatchObject({ ok: false, reason: "conflict" });
      // Area filter.
      const planning = await listChangeSets(database.db, ctx, { area: "planning", limit: 50 });
      expect(planning.every((e) => e.areas.includes("planning"))).toBe(true);
      await serviceUndo(second);
      expect(
        must(
          (await listChangeSets(database.db, ctx, { limit: 10 })).find(
            (e) => e.changeSet.id === second,
          ),
        ).undo,
      ).toMatchObject({ ok: false, reason: "already_undone" });
      // The undo is logged under the same area as the change it undid.
      const latest = must((await listChangeSets(database.db, ctx, { limit: 1 }))[0]);
      expect(latest.changeSet.summary).toBe("Undo: log: second");
      expect(latest.areas).toEqual(["planning"]);
      await expect(canUndo(database.db, ctx, newId())).rejects.toBeInstanceOf(
        ChangeSetNotFoundError,
      );
    });

    it("an undone change set cannot be undone again; the undo is linked by undone_by_change_set_id", async () => {
      const id = await apply("once", [
        { kind: "member.update", payload: { memberId: memberB, appetite: "small" } },
      ]);
      const undo = await undoChangeSet(database.db, ctx, id, { actor: "user", source: "ui" });
      const row = must(await createRepos(database.db, ctx).change_set.get({ id }));
      expect(row.undoneByChangeSetId).toBe(undo.changeSetId);
      expect(row.undoneAt).not.toBeNull();
      await expect(serviceUndo(id)).rejects.toBeInstanceOf(AlreadyUndoneError);
    });

    it("negative control: without the conflict check, the later change is lost and the property check fails", async () => {
      expect(await laterChangeSurvives(blindUndo)).toMatch(/later change was lost/);
    });
  },
);
