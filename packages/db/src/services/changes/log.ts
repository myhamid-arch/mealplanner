// Change log reads (R2-ADM-7): entries with actor, areas and whether Undo is available, with the
// reason when it is not.
import { and, desc, eq, lt } from "drizzle-orm";
import { areaOf, type ChangeArea } from "@mealplanner/core/changes";
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../repos/index.js";
import { changeSet } from "../../schema/index.js";
import type { UndoConflict } from "./errors.js";
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

export function areasOf(row: Pick<ChangeSetRow, "forward">): ChangeArea[] {
  const kinds = Array.isArray(row.forward)
    ? row.forward
        .map((op) => (op as { kind?: unknown } | null)?.kind)
        .filter((k): k is string => typeof k === "string")
    : [];
  const areas = new Set<ChangeArea>();
  for (const kind of kinds) {
    const area = areaOf(kind);
    if (area !== undefined) areas.add(area);
  }
  return [...areas];
}

export async function canUndo(
  db: Executor,
  ctx: HouseholdContext,
  changeSetId: string,
): Promise<UndoAvailability> {
  const row = await createRepos(db, ctx).change_set.get({ id: changeSetId });
  if (row === null) throw new Error(`change set ${changeSetId} not found`);
  if (row.undoneAt !== null)
    return { ok: false, reason: "already_undone", undoneByChangeSetId: row.undoneByChangeSetId };
  const conflicts = await findConflicts(db, row);
  return conflicts.length > 0 ? { ok: false, reason: "conflict", conflicts } : { ok: true };
}

/**
 * The newest change sets first. Undo availability is computed in one pass: an entry conflicts
 * with the later entries that touched the same entities.
 */
export async function listChangeSets(
  db: Executor,
  ctx: HouseholdContext,
  options: { area?: ChangeArea; limit?: number; before?: Date } = {},
): Promise<ChangeLogEntry[]> {
  const rows = await db
    .select()
    .from(changeSet)
    .where(
      and(
        eq(changeSet.householdId, ctx.householdId),
        options.before === undefined ? undefined : lt(changeSet.appliedAt, options.before),
      ),
    )
    .orderBy(desc(changeSet.appliedAt));
  // Entities touched by change sets newer than the one being looked at; starts with every change
  // set newer than `before`, so a paged read agrees with canUndo().
  const newer: { row: ChangeSetRow; touched: Set<string> }[] = [];
  if (options.before !== undefined) {
    const newerRows = await db
      .select()
      .from(changeSet)
      .where(and(eq(changeSet.householdId, ctx.householdId)))
      .orderBy(desc(changeSet.appliedAt));
    for (const row of newerRows)
      if (row.appliedAt >= options.before) newer.push({ row, touched: touchedEntities(row) });
  }
  const entries: ChangeLogEntry[] = [];
  const limit = options.limit ?? 50;
  for (const row of rows) {
    const touched = touchedEntities(row);
    const areas = areasOf(row);
    let undo: UndoAvailability;
    if (row.undoneAt !== null) {
      undo = { ok: false, reason: "already_undone", undoneByChangeSetId: row.undoneByChangeSetId };
    } else {
      const conflicts = newer
        .map(({ row: later, touched: laterTouched }) => ({
          changeSetId: later.id,
          summary: later.summary,
          appliedAt: later.appliedAt,
          entities: [...laterTouched].filter((id) => touched.has(id)),
        }))
        .filter((c) => c.entities.length > 0)
        .reverse();
      undo = conflicts.length > 0 ? { ok: false, reason: "conflict", conflicts } : { ok: true };
    }
    newer.push({ row, touched });
    if (options.area === undefined || areas.includes(options.area))
      entries.push({ changeSet: row, areas, undo });
    if (entries.length >= limit) break;
  }
  return entries;
}
