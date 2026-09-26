// ARC-4 household context and the errors of the household-scoped repository layer (DM-1).
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";

export type { HouseholdContext } from "@mealplanner/core/types";

/** A Drizzle database or transaction on node-postgres. */
export type Executor = PgDatabase<NodePgQueryResultHKT>;

/** DM-1: an attempt to read or write a row of another household through a household context. */
export class CrossHouseholdError extends Error {
  constructor(
    readonly entity: string,
    readonly detail: string,
  ) {
    super(`cross-household access to ${entity}: ${detail}`);
    this.name = "CrossHouseholdError";
  }
}

/** A write to a global catalogue row (seed dish, catalogue ingredient) through a household context. */
export class GlobalRowReadOnlyError extends Error {
  constructor(readonly entity: string) {
    super(`${entity}: global catalogue rows are read-only for a household`);
    this.name = "GlobalRowReadOnlyError";
  }
}
