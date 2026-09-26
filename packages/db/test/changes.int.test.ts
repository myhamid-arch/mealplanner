// G3 (AGT-6, DM-6, SC-4, AGT-5, BLD-8 R-7/R-10): for every op in the registry, apply then inverse
// restores the exact prior state on F1 and F3; protected ops are flagged and enforced.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ChangeOpSchema,
  PUBLIC_OPS,
  getOp,
  isProtected,
  type ChangeOp,
  type ChangeOpKind,
} from "@mealplanner/core/changes";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../src/repos/index.js";
import {
  applyChangeSet,
  ChangeOpError,
  ChangeValidationError,
  ProtectedOperationError,
  undoChangeSet,
} from "../src/services/changes/index.js";
import { inHouseholdTransaction } from "../src/services/changes/apply.js";
import { DbChangeTx } from "../src/services/changes/tx.js";
import {
  catalogDatabase,
  F1,
  F3,
  fixtureHousehold,
  type FixtureHousehold,
} from "./support/fixtures.js";
import { opGenerators, prng } from "./support/op-samples.js";
import { diffSnapshots, snapshotDatabase } from "./support/snapshot.js";
import type { TestDatabase } from "./support/db.js";
import { must } from "./support/must.js";

const SAMPLES_PER_OP = 3;
const PUBLIC_KINDS = PUBLIC_OPS.map((op) => op.kind);

/** AGT-5 plus BLD-8 R-10: ops that are always protected. */
const ALWAYS_PROTECTED: ReadonlySet<string> = new Set([
  "member.archive",
  "role.set",
  "access.block",
  "access.remove",
  "access.link_member",
  "support.grant",
]);
/** AGT-5 conditionally protected ops (SPEC-Q-7), tested on both branches below. */
const CONDITIONALLY_PROTECTED: ReadonlySet<string> = new Set([
  "tolerance.set",
  "exclusion.remove",
  "exclusion.add",
  "dish.retire",
]);

/**
 * Applies a change set and undoes it; returns the differences between the state before the change
 * and after the undo (empty = exact restore), plus whether the change did anything at all.
 */
async function applyUndoDiff(
  database: TestDatabase,
  ctx: HouseholdContext,
  apply: () => Promise<string>,
): Promise<{ restoreDiff: string[]; changed: boolean; redoDiff: string[] }> {
  const before = await snapshotDatabase(database.pool);
  const changeSetId = await apply();
  const after = await snapshotDatabase(database.pool);
  const undo = await undoChangeSet(database.db, ctx, changeSetId, { actor: "user", source: "ui" });
  const restored = await snapshotDatabase(database.pool);
  // The inverse of the inverse re-applies the change exactly; undoing that returns to the start.
  const redo = await undoChangeSet(database.db, ctx, undo.changeSetId, {
    actor: "user",
    source: "ui",
  });
  const redone = await snapshotDatabase(database.pool);
  await undoChangeSet(database.db, ctx, redo.changeSetId, { actor: "user", source: "ui" });
  const final = await snapshotDatabase(database.pool);
  return {
    restoreDiff: [...diffSnapshots(before, restored), ...diffSnapshots(before, final)],
    changed: diffSnapshots(before, after).length > 0,
    redoDiff: diffSnapshots(after, redone),
  };
}

async function protectedFlag(db: Executor, ctx: HouseholdContext, op: ChangeOp): Promise<boolean> {
  const parsed = ChangeOpSchema.parse(op);
  return inHouseholdTransaction(db, ctx, async (trx, timestamp) =>
    isProtected(parsed, new DbChangeTx(trx, ctx, timestamp)),
  );
}

/** Protected-flag mismatches of sample ops against the spec table (empty = all correct). */
async function protectedMismatches(
  samples: ChangeOp[],
  flag: (op: ChangeOp) => Promise<boolean>,
): Promise<string[]> {
  const mismatches: string[] = [];
  for (const op of samples) {
    if (CONDITIONALLY_PROTECTED.has(op.kind)) continue;
    const expected = ALWAYS_PROTECTED.has(op.kind);
    if ((await flag(op)) !== expected)
      mismatches.push(`${op.kind}: expected protected=${String(expected)}`);
  }
  return mismatches;
}

describe.each([
  ["F1", F1],
  ["F3", F3],
] as const)("G3 on %s", { timeout: 120_000 }, (fixtureId, fixture) => {
  let database: TestDatabase;
  let household: FixtureHousehold;
  let ctx: HouseholdContext;
  const samples: ChangeOp[] = [];

  beforeAll(async () => {
    database = await catalogDatabase();
    household = await fixtureHousehold(database, fixture);
    ctx = household.loaded.adminContext;
  }, 120_000);

  afterAll(async () => {
    await database.drop();
  });

  it("the registry is exactly the AGT-6 v1 ops plus the BLD-8 R-10 and R-24 ops", () => {
    expect([...PUBLIC_KINDS].sort()).toEqual(
      [
        "household.update",
        "member.create",
        "member.update",
        "member.archive",
        "target.set",
        "tolerance.set",
        "training.set",
        "day_override.set",
        "slot.create",
        "slot.update",
        "slot_schedule.set",
        "distribution.set",
        "slot_target.set",
        "weights.set",
        "preset.upsert",
        "preset.delete",
        "preference.set",
        "preference.reset",
        "exclusion.add",
        "exclusion.remove",
        "frequency.set",
        "adjusters.set",
        "dish.create",
        "dish.update",
        "dish.retire",
        "ingredient.create",
        "ingredient.verify",
        "plan.lock",
        "plan.unlock",
        "plan.swap_dish",
        "plate.override",
        "role.set",
        "access.block",
        "access.unblock",
        "access.remove",
        "access.link_member",
        "meal_override.set",
        "meal_override.remove",
        "support.grant",
        "support.revoke",
        "plan.save_days",
        "portion_bias.set",
      ].sort(),
    );
    const generators = opGenerators(database.db, household);
    expect(Object.keys(generators).sort()).toEqual([...PUBLIC_KINDS].sort());
  });

  it.each(PUBLIC_KINDS)(
    `${fixtureId}: %s — apply then inverse restores the exact prior state`,
    async (kind) => {
      const generate = opGenerators(database.db, household)[kind];
      const random = prng(
        fixtureId === "F1" ? 101 + PUBLIC_KINDS.indexOf(kind) : 303 + PUBLIC_KINDS.indexOf(kind),
      );
      for (let i = 0; i < SAMPLES_PER_OP; i += 1) {
        const op = await generate(random);
        samples.push(op);
        const result = await applyUndoDiff(
          database,
          ctx,
          async () =>
            (
              await applyChangeSet(database.db, ctx, {
                actor: "user",
                source: "ui",
                summary: `${kind} #${String(i)}`,
                ops: [op],
              })
            ).changeSetId,
        );
        expect(
          result.changed,
          `${kind} sample ${String(i)} changed nothing: ${JSON.stringify(op.payload)}`,
        ).toBe(true);
        expect(result.restoreDiff, `${kind} sample ${String(i)}`).toEqual([]);
        expect(result.redoDiff, `${kind} sample ${String(i)} redo`).toEqual([]);
      }
    },
  );

  it(`${fixtureId}: a multi-op change set (every op kind once) is restored exactly`, async () => {
    const generators = opGenerators(database.db, household);
    const random = prng(fixtureId === "F1" ? 7 : 9);
    // Ops that consume state other ops rely on are left out of the combined set.
    const combinable: ChangeOpKind[] = [
      "household.update",
      "member.create",
      "member.update",
      "target.set",
      "training.set",
      "slot.create",
      "weights.set",
      "preset.upsert",
      "preference.set",
      "exclusion.add",
      "frequency.set",
      "dish.create",
      "ingredient.create",
      "plan.lock",
      "meal_override.set",
      "support.grant",
      "plan.save_days",
      "portion_bias.set",
    ];
    const ops: ChangeOp[] = [];
    for (const kind of combinable) ops.push(await generators[kind](random));
    const result = await applyUndoDiff(
      database,
      ctx,
      async () =>
        (
          await applyChangeSet(database.db, ctx, {
            actor: "user",
            source: "ui",
            summary: "combined",
            ops,
          })
        ).changeSetId,
    );
    expect(result.changed).toBe(true);
    expect(result.restoreDiff).toEqual([]);
    expect(result.redoDiff).toEqual([]);
  });

  it(`${fixtureId}: every sampled op is flagged protected exactly when AGT-5 / R-10 says so`, async () => {
    expect(new Set(samples.map((s) => s.kind)).size).toBe(PUBLIC_KINDS.length);
    expect(await protectedMismatches(samples, (op) => protectedFlag(database.db, ctx, op))).toEqual(
      [],
    );
    for (const kind of ALWAYS_PROTECTED) expect(getOp(kind)?.protected, kind).toBe(true);
  });

  it(`${fixtureId}: conditionally protected ops are flagged on the relaxing branch only`, async () => {
    const memberId = must(Object.values(household.loaded.members)[0]);
    const check = (op: ChangeOp) => protectedFlag(database.db, ctx, op);
    // tolerance.set: wider (or strict → flexible) is protected; tighter is not.
    expect(await check({ kind: "tolerance.set", payload: { memberId, proteinG: 9 } })).toBe(true);
    expect(await check({ kind: "tolerance.set", payload: { memberId, mode: "flexible" } })).toBe(
      true,
    );
    expect(
      await check({ kind: "tolerance.set", payload: { memberId, proteinG: 3, kcal: 30 } }),
    ).toBe(false);
    // exclusion.remove / exclusion.add: removing or relaxing an allergy is protected; a dislike is not.
    const allergy = await applyChangeSet(database.db, ctx, {
      actor: "user",
      source: "ui",
      summary: "allergy",
      ops: [
        {
          kind: "exclusion.add",
          payload: { memberId, kind: "ingredient", key: "g3_allergen", reason: "allergy" },
        },
        {
          kind: "exclusion.add",
          payload: { memberId, kind: "ingredient", key: "g3_dislike", reason: "dislike" },
        },
      ],
    });
    const rows = await database.db.execute<{ id: string; key: string }>(
      sql`SELECT id, key FROM exclusion WHERE household_id = ${ctx.householdId} AND key IN ('g3_allergen', 'g3_dislike')`,
    );
    const idOf = (key: string) => must(rows.rows.find((row) => row.key === key)).id;
    expect(
      await check({ kind: "exclusion.remove", payload: { exclusionId: idOf("g3_allergen") } }),
    ).toBe(true);
    expect(
      await check({ kind: "exclusion.remove", payload: { exclusionId: idOf("g3_dislike") } }),
    ).toBe(false);
    expect(
      await check({
        kind: "exclusion.add",
        payload: {
          memberId,
          kind: "ingredient",
          key: "g3_allergen",
          reason: "dislike",
          hard: false,
        },
      }),
    ).toBe(true);
    expect(
      await check({
        kind: "exclusion.add",
        payload: { memberId, kind: "ingredient", key: "g3_dislike", reason: "allergy" },
      }),
    ).toBe(false);
    // An allergy is always hard (DM-5): the schema rejects a soft allergy.
    expect(
      ChangeOpSchema.safeParse({
        kind: "exclusion.add",
        payload: { memberId, kind: "ingredient", key: "x", reason: "allergy", hard: false },
      }).success,
    ).toBe(false);
    // dish.retire: protected once the dish has a review.
    const dishId = household.populated.dishId;
    expect(await check({ kind: "dish.retire", payload: { dishId } })).toBe(false);
    await database.db.execute(
      sql`INSERT INTO review (id, household_id, author_user_id, target_type, target_id, rating, tags, created_at) VALUES (gen_random_uuid(), ${ctx.householdId}, ${ctx.userId}, 'dish', ${dishId}, 2, '{}', now())`,
    );
    expect(await check({ kind: "dish.retire", payload: { dishId } })).toBe(true);
    await database.db.execute(
      sql`DELETE FROM review WHERE target_type = 'dish' AND target_id = ${dishId}`,
    );
    await undoChangeSet(database.db, ctx, allergy.changeSetId, { actor: "user", source: "ui" });
  });

  it(`${fixtureId}: the server turns protected agent_apply ops into a refusal and writes nothing (AGT-5)`, async () => {
    const generators = opGenerators(database.db, household);
    const random = prng(55);
    for (const kind of ALWAYS_PROTECTED) {
      const op = await generators[kind as ChangeOpKind](random);
      const before = await snapshotDatabase(database.pool, new Set());
      await expect(
        applyChangeSet(database.db, ctx, {
          actor: "agent",
          source: "agent_apply",
          summary: "agent",
          ops: [op],
        }),
      ).rejects.toBeInstanceOf(ProtectedOperationError);
      expect(diffSnapshots(before, await snapshotDatabase(database.pool, new Set()))).toEqual([]);
      // The same op from the UI applies.
      const applied = await applyChangeSet(database.db, ctx, {
        actor: "user",
        source: "ui",
        summary: "ui",
        ops: [op],
      });
      await undoChangeSet(database.db, ctx, applied.changeSetId, { actor: "user", source: "ui" });
    }
    const unprotected = await generators["weights.set"](random);
    const applied = await applyChangeSet(database.db, ctx, {
      actor: "agent",
      source: "agent_apply",
      summary: "agent ok",
      ops: [unprotected],
    });
    await undoChangeSet(database.db, ctx, applied.changeSetId, { actor: "user", source: "ui" });
    // With "Let the assistant apply changes I ask for" off, every agent op is refused.
    const off = await applyChangeSet(database.db, ctx, {
      actor: "user",
      source: "ui",
      summary: "off",
      ops: [{ kind: "household.update", payload: { agentMayApply: false } }],
    });
    await expect(
      applyChangeSet(database.db, ctx, {
        actor: "agent",
        source: "agent_apply",
        summary: "agent",
        ops: [unprotected],
      }),
    ).rejects.toMatchObject({ reason: "agent_may_apply_off" });
    await undoChangeSet(database.db, ctx, off.changeSetId, { actor: "user", source: "ui" });
  });

  it(`${fixtureId}: portion_bias.set refuses a targeted member (FBK-5, BLD-8 R-24)`, async () => {
    const targeted = must(
      (await createRepos(database.db, ctx).member.list()).find((m) => m.isTargeted),
      "targeted member",
    );
    await expect(
      applyChangeSet(database.db, ctx, {
        actor: "system",
        source: "learning",
        summary: "bias",
        ops: [
          {
            kind: "portion_bias.set",
            payload: { memberId: targeted.id, componentRole: "carb", bias: 1.2 },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ChangeOpError);
    expect(getOp("portion_bias.set")?.protected).toBe(false);
  });

  it(`${fixtureId}: rows.restore is internal and rejected as a public op (BLD-8 R-7)`, async () => {
    const restore = {
      kind: "rows.restore",
      payload: {
        images: [
          {
            entity: "member",
            key: { id: must(Object.values(household.loaded.members)[0]) },
            before: null,
          },
        ],
      },
    };
    expect(ChangeOpSchema.safeParse(restore).success).toBe(false);
    expect(getOp("rows.restore")).toBeUndefined();
    expect(getOp("rows.restore", { internal: true })?.public).toBe(false);
    const before = await snapshotDatabase(database.pool, new Set());
    await expect(
      applyChangeSet(database.db, ctx, {
        actor: "agent",
        source: "agent_apply",
        summary: "restore",
        ops: [restore],
      }),
    ).rejects.toBeInstanceOf(ChangeValidationError);
    await expect(
      applyChangeSet(database.db, ctx, {
        actor: "user",
        source: "ui",
        summary: "restore",
        ops: [restore],
      }),
    ).rejects.toBeInstanceOf(ChangeValidationError);
    expect(diffSnapshots(before, await snapshotDatabase(database.pool, new Set()))).toEqual([]);
  });

  it(`${fixtureId}: negative control — a write that bypasses ChangeTx is not restored, and the check catches it`, async () => {
    const memberId = must(Object.values(household.loaded.members)[0]);
    const result = await applyUndoDiff(database, ctx, async () => {
      const applied = await applyChangeSet(database.db, ctx, {
        actor: "user",
        source: "ui",
        summary: "bypass",
        ops: [{ kind: "member.update", payload: { memberId, notes: "via op" } }],
      });
      // A rogue op writing outside ChangeTx: no before-image is recorded for this row.
      await database.db.execute(
        sql`UPDATE tolerance SET protein_g = 7.5 WHERE member_id = ${memberId}`,
      );
      return applied.changeSetId;
    });
    expect(result.restoreDiff.some((line) => line.startsWith("tolerance"))).toBe(true);
    await database.db.execute(
      sql`UPDATE tolerance SET protein_g = 5 WHERE member_id = ${memberId}`,
    );
  });

  it(`${fixtureId}: negative control — an unflagged protected op is reported by the flag check`, async () => {
    const lying = async (op: ChangeOp) =>
      op.kind === "member.archive" ? false : protectedFlag(database.db, ctx, op);
    expect(await protectedMismatches(samples, lying)).toContain(
      "member.archive: expected protected=true",
    );
  });
});
