// The generic household-scoped repository (DM-1). Every read is filtered to the context's
// household (plus global rows where a table has them); a key that names another household's row
// throws CrossHouseholdError instead of returning null, and every write checks the row and each
// row it references before touching the database.
import { and, asc, eq, isNull, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { HouseholdContext } from "@mealplanner/core/types";
import { CrossHouseholdError, GlobalRowReadOnlyError, type Executor } from "./context.js";
import { TABLES, columnsOf, type TableName, type TableSpec } from "./tables.js";

export type Row = Record<string, unknown>;

/** A key or filter names a row that does not exist. */
export class RowNotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly key: Row,
  ) {
    super(`${entity} ${JSON.stringify(key)} not found`);
    this.name = "RowNotFoundError";
  }
}

export class ScopedTable {
  private readonly spec: TableSpec;
  private readonly columns: Record<string, PgColumn>;

  constructor(
    private readonly db: Executor,
    private readonly ctx: HouseholdContext,
    readonly name: TableName,
  ) {
    this.spec = TABLES[name];
    this.columns = columnsOf(this.spec);
  }

  /** One row by primary key; null when absent; CrossHouseholdError when it is another household's. */
  async get(key: Row): Promise<Row | null> {
    const row = await this.getUnscoped(key);
    if (row !== null && !isVisible(this.spec, row, this.ctx))
      throw new CrossHouseholdError(
        this.name,
        `${JSON.stringify(key)} belongs to another household`,
      );
    return row;
  }

  /** Rows visible to the household that match every given column (null matches IS NULL). */
  async list(where: Row = {}): Promise<Row[]> {
    const conditions = [this.scopeCondition(), ...this.matchConditions(where)].filter(
      (c): c is SQL => c !== undefined,
    );
    const order = this.spec.key.map((k) => asc(this.column(k)));
    const rows = await this.db
      .select()
      .from(this.spec.table)
      .where(and(...conditions))
      .orderBy(...order);
    return rows;
  }

  async insert(row: Row): Promise<Row> {
    this.assertOwnValue(row);
    await this.checkRefs(row);
    const [inserted] = await this.db.insert(this.spec.table).values(row).returning();
    if (inserted === undefined) throw new Error(`${this.name}: insert returned no row`);
    return inserted;
  }

  async update(key: Row, patch: Row): Promise<Row> {
    const existing = await this.get(key);
    if (existing === null) throw new RowNotFoundError(this.name, key);
    this.assertWritable(existing);
    const householdKey = this.spec.householdKey;
    if (
      householdKey !== undefined &&
      householdKey in patch &&
      patch[householdKey] !== existing[householdKey]
    )
      throw new CrossHouseholdError(this.name, "a row cannot move to another household");
    for (const k of this.spec.key) {
      if (k in patch && patch[k] !== existing[k])
        throw new Error(`${this.name}: primary key ${k} cannot change`);
    }
    await this.checkRefs(patch);
    if (Object.values(patch).every((value) => value === undefined)) return existing;
    const [updated] = await this.db
      .update(this.spec.table)
      .set(patch)
      .where(this.keyCondition(key))
      .returning();
    if (updated === undefined) throw new RowNotFoundError(this.name, key);
    return updated;
  }

  async remove(key: Row): Promise<void> {
    const existing = await this.get(key);
    if (existing === null) throw new RowNotFoundError(this.name, key);
    this.assertWritable(existing);
    await this.db.delete(this.spec.table).where(this.keyCondition(key));
  }

  /** The primary-key subset of a row. */
  keyOf(row: Row): Row {
    return Object.fromEntries(this.spec.key.map((k) => [k, row[k]]));
  }

  private async getUnscoped(key: Row): Promise<Row | null> {
    const [row] = await this.db
      .select()
      .from(this.spec.table)
      .where(this.keyCondition(key))
      .limit(1);
    return row ?? null;
  }

  private column(key: string): PgColumn {
    const column = this.columns[key];
    if (column === undefined) throw new Error(`${this.name} has no column ${key}`);
    return column;
  }

  private keyCondition(key: Row): SQL {
    for (const k of this.spec.key) {
      if (key[k] === undefined || key[k] === null)
        throw new Error(`${this.name}: key column ${k} missing`);
    }
    const condition = and(...this.spec.key.map((k) => eq(this.column(k), key[k])));
    if (condition === undefined) throw new Error(`${this.name}: empty key`);
    return condition;
  }

  private matchConditions(where: Row): SQL[] {
    return Object.entries(where)
      .filter(([, value]) => value !== undefined)
      .map(([k, value]) => (value === null ? isNull(this.column(k)) : eq(this.column(k), value)));
  }

  private scopeCondition(): SQL | undefined {
    const { scope, householdKey } = this.spec;
    if (scope === "global" || householdKey === undefined) return undefined;
    const column = this.column(householdKey);
    if (scope === "shared") return or(isNull(column), eq(column, this.ctx.householdId));
    return eq(column, this.ctx.householdId);
  }

  /** A new row must belong to the context's household (never global, never another household). */
  private assertOwnValue(row: Row): void {
    const { scope, householdKey } = this.spec;
    if (scope === "global" || householdKey === undefined)
      throw new GlobalRowReadOnlyError(this.name);
    const value = row[householdKey];
    if (scope === "shared" && (value === null || value === undefined))
      throw new GlobalRowReadOnlyError(this.name);
    if (value !== this.ctx.householdId)
      throw new CrossHouseholdError(
        this.name,
        `row for household ${String(value)} written in household ${this.ctx.householdId}`,
      );
  }

  private assertWritable(existing: Row): void {
    const { scope, householdKey } = this.spec;
    if (scope === "global" || householdKey === undefined)
      throw new GlobalRowReadOnlyError(this.name);
    if (scope === "shared" && existing[householdKey] === null)
      throw new GlobalRowReadOnlyError(this.name);
  }

  /** Every referenced row must be visible to the household (FK existence is left to Postgres). */
  private async checkRefs(values: Row): Promise<void> {
    const targets: [string, string, unknown][] = [];
    for (const [column, entity] of Object.entries(this.spec.refs))
      targets.push([column, entity, values[column]]);
    for (const [column, entity] of Object.entries(this.spec.arrayRefs ?? {})) {
      const list = values[column];
      if (Array.isArray(list)) for (const item of list) targets.push([column, entity, item]);
    }
    for (const [column, entity, id] of targets) {
      if (id === null || id === undefined) continue;
      const target = new ScopedTable(this.db, this.ctx, entity as TableName);
      const row = await target.getUnscoped({ id });
      if (row !== null && !isVisible(TABLES[entity as TableName], row, this.ctx))
        throw new CrossHouseholdError(
          this.name,
          `${column} references another household's ${entity}`,
        );
    }
  }
}

export function isVisible(spec: TableSpec, row: Row, ctx: HouseholdContext): boolean {
  const { scope, householdKey } = spec;
  if (scope === "global" || householdKey === undefined) return true;
  const value = row[householdKey];
  if (scope === "shared") return value === null || value === ctx.householdId;
  return value === ctx.householdId;
}
