// @mealplanner/db/repos: household-scoped repositories (DM-1, ARC-4).
// createRepos() is read-only. Writes to configuration, preferences, recipes and plans go through
// the change-set service (DM-6); createWriteRepos() exists for that service and for the DM-6
// exceptions (review creation, auth/session tables).
import type { HouseholdContext } from "@mealplanner/core/types";
import type { Executor } from "./context.js";
import { ScopedTable, type Row } from "./scoped.js";
import { HOUSEHOLD_TABLES, TABLES, type TableName, type TableRows } from "./tables.js";

export {
  CrossHouseholdError,
  GlobalRowReadOnlyError,
  type Executor,
  type HouseholdContext,
} from "./context.js";
export { RowNotFoundError, ScopedTable, isVisible } from "./scoped.js";
export {
  HOUSEHOLD_TABLES,
  TABLES,
  columnsOf,
  type Scope,
  type TableName,
  type TableRows,
  type TableSpec,
} from "./tables.js";

export interface ReadRepo<T> {
  /** One row by primary key; null when absent; CrossHouseholdError for another household's row. */
  get(key: Partial<T>): Promise<T | null>;
  /** Visible rows matching every given column (null matches IS NULL), in primary-key order. */
  list(where?: Partial<T>): Promise<T[]>;
}

export interface WriteRepo<T> extends ReadRepo<T> {
  insert(row: T): Promise<T>;
  update(key: Partial<T>, patch: Partial<T>): Promise<T>;
  remove(key: Partial<T>): Promise<void>;
}

export type Repos = { [N in TableName]: ReadRepo<TableRows[N]> };
export type WriteRepos = { [N in TableName]: WriteRepo<TableRows[N]> };

function build<R>(
  db: Executor,
  ctx: HouseholdContext,
  pick: (table: ScopedTable) => R,
): Record<TableName, R> {
  return Object.fromEntries(
    (Object.keys(TABLES) as TableName[]).map((name) => [
      name,
      pick(new ScopedTable(db, ctx, name)),
    ]),
  ) as Record<TableName, R>;
}

/** Read-only repositories for every table a household can see. */
export function createRepos(db: Executor, ctx: HouseholdContext): Repos {
  return build(db, ctx, (t) => ({
    get: (key: Row) => t.get(key),
    list: (where?: Row) => t.list(where),
  })) as unknown as Repos;
}

/** Read-write repositories. Only for the change-set service and the DM-6 exceptions. */
export function createWriteRepos(db: Executor, ctx: HouseholdContext): WriteRepos {
  return build(db, ctx, (t) => ({
    get: (key: Row) => t.get(key),
    list: (where?: Row) => t.list(where),
    insert: (row: Row) => t.insert(row),
    update: (key: Row, patch: Row) => t.update(key, patch),
    remove: (key: Row) => t.remove(key),
  })) as unknown as WriteRepos;
}

/** Names of all household-owned tables, each of which has a repository (G2 enumerates these). */
export const REPOSITORY_NAMES: readonly TableName[] = HOUSEHOLD_TABLES;
