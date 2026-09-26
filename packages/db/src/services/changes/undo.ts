// undoChangeSet (AGT-6 undo semantics, SC-4, R2-ADM-7): applies a change set's stored inverse as a
// new change set, linked by undone_by_change_set_id, and refuses with a conflict when a later
// change set touched the same entities.
import { and, asc, eq, gt } from "drizzle-orm";
import {
  RestorePayloadSchema,
  imageId,
  type ChangeDescription,
  type ParsedChangeOp,
  type RowImage,
} from "@mealplanner/core/changes";
import type { ChangeActor, ChangeSource, HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../repos/index.js";
import { changeSet } from "../../schema/index.js";
import { newId } from "../../schema/ids.js";
import { inHouseholdTransaction, insertChangeSet, runOps } from "./apply.js";
import {
  AlreadyUndoneError,
  ChangeConflictError,
  ChangeSetNotFoundError,
  type UndoConflict,
} from "./errors.js";
import { assertHasActiveAdmin } from "./invariants.js";
import { DbChangeTx } from "./tx.js";

type ChangeSetRow = typeof changeSet.$inferSelect;

/** The stored inverse of a change set as validated `rows.restore` ops. */
export function inverseOps(row: Pick<ChangeSetRow, "id" | "inverse">): ParsedChangeOp[] {
  if (!Array.isArray(row.inverse)) throw new Error(`change set ${row.id} has a malformed inverse`);
  return row.inverse.map((op) => {
    const parsed = RestorePayloadSchema.safeParse((op as { payload?: unknown } | null)?.payload);
    if ((op as { kind?: unknown } | null)?.kind !== "rows.restore" || !parsed.success)
      throw new Error(`change set ${row.id} has a malformed inverse op`);
    return { kind: "rows.restore", payload: parsed.data } as unknown as ParsedChangeOp;
  });
}

/** `entity:key` ids of every row a change set wrote (from its before-images). */
export function touchedEntities(row: Pick<ChangeSetRow, "id" | "inverse">): Set<string> {
  const ids = new Set<string>();
  for (const op of inverseOps(row)) {
    for (const image of (op.payload as { images: RowImage[] }).images) ids.add(imageId(image));
  }
  return ids;
}

/** Later change sets of the household that touched any entity the given one touched. */
export async function findConflicts(db: Executor, target: ChangeSetRow): Promise<UndoConflict[]> {
  const mine = touchedEntities(target);
  const later = await db
    .select()
    .from(changeSet)
    .where(
      and(eq(changeSet.householdId, target.householdId), gt(changeSet.appliedAt, target.appliedAt)),
    )
    .orderBy(asc(changeSet.appliedAt));
  const conflicts: UndoConflict[] = [];
  for (const row of later) {
    const shared = [...touchedEntities(row)].filter((id) => mine.has(id));
    if (shared.length > 0)
      conflicts.push({
        changeSetId: row.id,
        summary: row.summary,
        appliedAt: row.appliedAt,
        entities: shared,
      });
  }
  return conflicts;
}

export interface UndoInput {
  actor: ChangeActor;
  source: ChangeSource;
}

export interface UndoResult {
  undoneChangeSetId: string;
  /** The new change set that applied the inverse (itself undoable). */
  changeSetId: string;
  appliedAt: Date;
  descriptions: ChangeDescription[];
}

async function loadChangeSet(
  db: Executor,
  ctx: HouseholdContext,
  changeSetId: string,
): Promise<ChangeSetRow> {
  const row = await createRepos(db, ctx).change_set.get({ id: changeSetId });
  if (row === null) throw new ChangeSetNotFoundError(changeSetId);
  return row;
}

export async function undoChangeSet(
  db: Executor,
  ctx: HouseholdContext,
  changeSetId: string,
  input: UndoInput,
): Promise<UndoResult> {
  return inHouseholdTransaction(db, ctx, async (trx, timestamp) => {
    const target = await loadChangeSet(trx, ctx, changeSetId);
    if (target.undoneAt !== null)
      throw new AlreadyUndoneError(target.id, target.undoneByChangeSetId);
    const conflicts = await findConflicts(trx, target);
    if (conflicts.length > 0) throw new ChangeConflictError(target.id, conflicts);

    const tx = new DbChangeTx(trx, ctx, timestamp);
    const { descriptions, inverse } = await runOps(tx, inverseOps(target), true);
    await assertHasActiveAdmin(trx, ctx.householdId);
    const undoId = newId();
    await insertChangeSet(trx, ctx, {
      id: undoId,
      actor: input.actor,
      source: input.source,
      summary: `Undo: ${target.summary}`,
      forward: target.inverse as unknown[],
      inverse,
      appliedAt: timestamp,
    });
    await trx
      .update(changeSet)
      .set({ undoneAt: timestamp, undoneByChangeSetId: undoId })
      .where(and(eq(changeSet.householdId, ctx.householdId), eq(changeSet.id, target.id)));
    return {
      undoneChangeSetId: target.id,
      changeSetId: undoId,
      appliedAt: timestamp,
      descriptions,
    };
  });
}
