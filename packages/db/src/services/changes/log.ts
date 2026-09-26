// Change log reads (R2-ADM-7): entries with actor, areas and whether Undo is available, with the
// reason when it is not.
import { desc, eq } from "drizzle-orm";
import { ENTITY_AREAS, areaOf, type ChangeArea, type RowImage } from "@mealplanner/core/changes";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../repos/index.js";
import { changeSet } from "../../schema/index.js";
import { ChangeSetNotFoundError, type UndoConflict } from "./errors.js";
import { findConflicts, touchedEntities } from "./undo.js";

type ChangeSetRow = typeof changeSet.$inferSelect;

export type UndoAvailability =
  | { ok: true }
  | { ok: false; reason: "already_undone"; undoneByChangeSetId: string | null }
  | { ok: false; reason: "conflict"; conflicts: UndoConflict[] };

export interface ChangeLogEntry {
  changeSet: ChangeSetRow;
  /** Areas of the forward ops (the log's filter). */
  areas: ChangeArea[];
  undo: UndoAvailability;
}

/**
 * Areas of a change set's forward ops. An undo's forward ops are `rows.restore`; their area is
 * that of the entities they restore.
 */
export function areasOf(row: Pick<ChangeSetRow, "forward">): ChangeArea[] {
  const ops = Array.isArray(row.forward) ? row.forward : [];
  const areas = new Set<ChangeArea>();
  for (const op of ops) {
    const { kind, payload } = (op ?? {}) as { kind?: unknown; payload?: { images?: RowImage[] } };
    if (kind === "rows.restore") {
      for (const image of payload?.images ?? []) {
        const area = (ENTITY_AREAS as Record<string, ChangeArea | undefined>)[image.entity];
        if (area !== undefined) areas.add(area);
      }
    } else if (typeof kind === "string") {
      const area = areaOf(kind);
      if (area !== undefined) areas.add(area);
    }
  }
  return [...areas];
}

export async function canUndo(
  db: Executor,
  ctx: HouseholdContext,
  changeSetId: string,
): Promise<UndoAvailability> {
  const row = await createRepos(db, ctx).change_set.get({ id: changeSetId });
  if (row === null) throw new ChangeSetNotFoundError(changeSetId);
  if (row.undoneAt !== null)
    return { ok: false, reason: "already_undone", undoneByChangeSetId: row.undoneByChangeSetId };
  const conflicts = await findConflicts(db, row);
  return conflicts.length > 0 ? { ok: false, reason: "conflict", conflicts } : { ok: true };
}

/**
 * The newest change sets first. Undo availability is computed in one pass over the household's
 * change sets, newest first: an entry conflicts with the newer entries that touched the same
 * entities (the same rule as undoChangeSet). `before` pages back without changing that answer.
 */
export async function listChangeSets(
  db: Executor,
  ctx: HouseholdContext,
  options: { area?: ChangeArea; limit?: number; before?: Date } = {},
): Promise<ChangeLogEntry[]> {
  const rows = await db
    .select()
    .from(changeSet)
    .where(eq(changeSet.householdId, ctx.householdId))
    .orderBy(desc(changeSet.appliedAt));
  const limit = options.limit ?? 50;
  const newer: { row: ChangeSetRow; touched: Set<string> }[] = [];
  const entries: ChangeLogEntry[] = [];
  for (const row of rows) {
    const touched = touchedEntities(row);
    const listed = options.before === undefined || row.appliedAt < options.before;
    if (listed) {
      const areas = areasOf(row);
      if (options.area === undefined || areas.includes(options.area))
        entries.push({ changeSet: row, areas, undo: undoAvailability(row, touched, newer) });
      if (entries.length >= limit) break;
    }
    newer.push({ row, touched });
  }
  return entries;
}

function undoAvailability(
  row: ChangeSetRow,
  touched: Set<string>,
  newer: readonly { row: ChangeSetRow; touched: Set<string> }[],
): UndoAvailability {
  if (row.undoneAt !== null)
    return { ok: false, reason: "already_undone", undoneByChangeSetId: row.undoneByChangeSetId };
  const conflicts = newer
    .map(({ row: later, touched: laterTouched }) => ({
      changeSetId: later.id,
      summary: later.summary,
      appliedAt: later.appliedAt,
      entities: [...laterTouched].filter((id) => touched.has(id)),
    }))
    .filter((c) => c.entities.length > 0)
    .reverse(); // oldest first, as findConflicts returns them
  return conflicts.length > 0 ? { ok: false, reason: "conflict", conflicts } : { ok: true };
}
