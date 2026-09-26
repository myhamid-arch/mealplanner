// G5 (R2-ADM-4): the service refuses to block, remove or demote the final admin.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HouseholdContext } from "@mealplanner/core/types";
import {
  LastAdminError,
  activeAdminCount,
  applyChangeSet,
  undoChangeSet,
} from "../src/services/changes/index.js";
import { inHouseholdTransaction, parseOps, runOps } from "../src/services/changes/apply.js";
import { DbChangeTx } from "../src/services/changes/tx.js";
import type { TestDatabase } from "./support/db.js";
import type { LoadedFixture } from "../src/services/config/index.js";
import { catalogDatabase, F2, F3, fixtureOnly } from "./support/fixtures.js";
import { diffSnapshots, snapshotDatabase } from "./support/snapshot.js";
import { must } from "./support/must.js";

let database: TestDatabase;
let solo: LoadedFixture; // F2: one admin
let pair: LoadedFixture; // F3: two admins (t1, t2)

beforeAll(async () => {
  database = await catalogDatabase();
  solo = await fixtureOnly(database, F2);
  pair = await fixtureOnly(database, F3);
}, 120_000);

afterAll(async () => {
  await database.drop();
});

type Apply = (ctx: HouseholdContext, ops: unknown[]) => Promise<unknown>;
const service: Apply = (ctx, ops) =>
  applyChangeSet(database.db, ctx, { actor: "user", source: "ui", summary: "access", ops });
/** Applies ops through the same ChangeTx but without the invariant: the negative control. */
const unguarded: Apply = (ctx, ops) =>
  inHouseholdTransaction(database.db, ctx, async (trx, timestamp) =>
    runOps(new DbChangeTx(trx, ctx, timestamp), parseOps(ops)),
  );

const LAST_ADMIN_OPS = (userId: string) => [
  { name: "demote", ops: [{ kind: "role.set", payload: { userId, role: "member" } }] },
  { name: "demote to kitchen", ops: [{ kind: "role.set", payload: { userId, role: "kitchen" } }] },
  { name: "block", ops: [{ kind: "access.block", payload: { userId, reason: "test" } }] },
  { name: "remove", ops: [{ kind: "access.remove", payload: { userId } }] },
  {
    name: "remove and archive",
    ops: [{ kind: "access.remove", payload: { userId, archiveMember: true } }],
  },
];

/**
 * The G5 property for one household: every way of taking away the last active admin is refused,
 * with nothing written. Returns the list of attempts that were not refused.
 */
async function lastAdminBreaches(
  apply: Apply,
  ctx: HouseholdContext,
  userId: string,
): Promise<string[]> {
  const breaches: string[] = [];
  for (const attempt of LAST_ADMIN_OPS(userId)) {
    const before = await snapshotDatabase(database.pool, new Set());
    let error: unknown = null;
    try {
      await apply(ctx, attempt.ops);
    } catch (e) {
      error = e;
    }
    if (!(error instanceof LastAdminError)) breaches.push(`${attempt.name}: not refused`);
    if (diffSnapshots(before, await snapshotDatabase(database.pool, new Set())).length > 0) {
      breaches.push(`${attempt.name}: state changed`);
      break; // the household may have lost its admin; later attempts would be meaningless
    }
  }
  return breaches;
}

describe("G5 last-admin invariant (R2-ADM-4)", { timeout: 120_000 }, () => {
  it("a household with one admin: demote, block and remove are all refused and nothing is written", async () => {
    const ctx = solo.adminContext;
    expect(await activeAdminCount(database.db, ctx.householdId)).toBe(1);
    expect(await lastAdminBreaches(service, ctx, must(ctx.userId))).toEqual([]);
    expect(await activeAdminCount(database.db, ctx.householdId)).toBe(1);
  });

  it("with two admins one can be blocked; then the remaining admin is protected", async () => {
    const ctx = pair.adminContext; // t1
    const t2 = must(pair.users.t2);
    const change = (summary: string, ops: unknown[]) =>
      applyChangeSet(database.db, ctx, { actor: "user", source: "ui", summary, ops });
    expect(await activeAdminCount(database.db, ctx.householdId)).toBe(2);
    await change("block t2", [{ kind: "access.block", payload: { userId: t2 } }]);
    expect(await activeAdminCount(database.db, ctx.householdId)).toBe(1);
    // A blocked admin does not count: t1 is now the last active admin.
    expect(await lastAdminBreaches(service, ctx, must(ctx.userId))).toEqual([]);
    // Demoting the blocked admin is allowed; the invariant is about active admins.
    await change("demote t2", [{ kind: "role.set", payload: { userId: t2, role: "member" } }]);
    await change("restore t2", [
      { kind: "role.set", payload: { userId: t2, role: "admin" } },
      { kind: "access.unblock", payload: { userId: t2 } },
    ]);
    expect(await activeAdminCount(database.db, ctx.householdId)).toBe(2);
  });

  it("the rule applies to the change set's result: a hand-over in one set passes; an undo is guarded too", async () => {
    const t1 = pair.adminContext;
    const t2 = must(pair.users.t2);
    const t3 = must(pair.users.t3);
    const t3ctx: HouseholdContext = { householdId: t1.householdId, userId: t3, role: "admin" };
    const change = (ctx: HouseholdContext, summary: string, ops: unknown[]) =>
      applyChangeSet(database.db, ctx, { actor: "user", source: "ui", summary, ops });
    // Block t2 so that t1 is the only active admin; then hand over to t3 in one change set.
    await change(t1, "block t2", [{ kind: "access.block", payload: { userId: t2 } }]);
    await change(t1, "hand over", [
      { kind: "role.set", payload: { userId: t3, role: "admin" } },
      { kind: "role.set", payload: { userId: must(t1.userId), role: "member" } },
    ]);
    expect(await activeAdminCount(database.db, t1.householdId)).toBe(1);
    // Demoting t3 now (the last admin) is refused.
    expect(await lastAdminBreaches(service, t3ctx, t3)).toEqual([]);
    // Build a state where re-applying an earlier demotion would remove the last admin:
    // t3 promotes t1, then demotes t1 again; undoing that demotion makes t1 admin (2 admins);
    // t1 then demotes t3 (1 admin: t1). Undoing the undo would demote t1 again: 0 admins.
    await change(t3ctx, "promote t1", [
      { kind: "role.set", payload: { userId: must(t1.userId), role: "admin" } },
    ]);
    const demoteT1 = await change(t3ctx, "demote t1 again", [
      { kind: "role.set", payload: { userId: must(t1.userId), role: "member" } },
    ]);
    const undone = await undoChangeSet(database.db, t3ctx, demoteT1.changeSetId, {
      actor: "user",
      source: "ui",
    });
    expect(await activeAdminCount(database.db, t1.householdId)).toBe(2);
    await change(t1, "demote t3", [{ kind: "role.set", payload: { userId: t3, role: "member" } }]);
    expect(await activeAdminCount(database.db, t1.householdId)).toBe(1);
    const before = await snapshotDatabase(database.pool, new Set());
    await expect(
      undoChangeSet(database.db, t1, undone.changeSetId, { actor: "user", source: "ui" }),
    ).rejects.toBeInstanceOf(LastAdminError);
    expect(diffSnapshots(before, await snapshotDatabase(database.pool, new Set()))).toEqual([]);
  });

  it("negative control: the same attempts without the invariant take the last admin away, and the check reports it", async () => {
    // A fresh single-admin household, so the breach does not affect the other tests.
    const other = await fixtureOnly(database, {
      ...F2,
      id: "F2-negative",
      users: [
        {
          key: "solo",
          email: "solo-negative@f2.example",
          name: "Solo",
          role: "admin",
          member: "solo",
        },
      ],
    });
    const ctx = other.adminContext;
    const breaches = await lastAdminBreaches(unguarded, ctx, must(ctx.userId));
    expect(breaches).toContain("demote: not refused");
    expect(breaches).toContain("demote: state changed");
    expect(await activeAdminCount(database.db, ctx.householdId)).toBe(0);
  });
});
