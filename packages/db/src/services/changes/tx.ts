// ChangeTx over the household-scoped repositories (BLD-8 R-7, ADR-3). Every write records the
// row's before-image first; the images are the change set's inverse.
import type { ChangeTx, RowImage } from "@mealplanner/core/changes";
import type {
  EntityKey,
  EntityName,
  EntityRows,
  HouseholdContext,
  Json,
  MutableEntityName,
} from "@mealplanner/core/types";
import { ScopedTable, type Executor, type TableName } from "../../repos/index.js";
import type { Row } from "../../repos/scoped.js";
import { newId } from "../../schema/ids.js";
import { jsonToRow, rowToJson } from "./images.js";

export class DbChangeTx implements ChangeTx {
  readonly householdId: string;
  readonly actorUserId: string | null;
  /** Before-images of every write, in write order. */
  readonly images: RowImage[] = [];
  private readonly tables = new Map<string, ScopedTable>();

  constructor(
    private readonly db: Executor,
    private readonly ctx: HouseholdContext,
    private readonly timestamp: Date,
  ) {
    this.householdId = ctx.householdId;
    this.actorUserId = ctx.userId;
  }

  newId(): string {
    return newId();
  }

  now(): Date {
    return new Date(this.timestamp.getTime());
  }

  async get<E extends EntityName>(entity: E, key: EntityKey<E>): Promise<EntityRows[E] | null> {
    return (await this.table(entity).get(key)) as unknown as EntityRows[E] | null;
  }

  async find<E extends EntityName>(
    entity: E,
    where: Partial<EntityRows[E]>,
  ): Promise<EntityRows[E][]> {
    return (await this.table(entity).list(where)) as unknown as EntityRows[E][];
  }

  async insert<E extends MutableEntityName>(entity: E, row: EntityRows[E]): Promise<EntityRows[E]> {
    const table = this.table(entity);
    const values = row as unknown as Row;
    const existing = await table.get(table.keyOf(values));
    this.record(entity, table.keyOf(values), existing);
    return (await table.insert(values)) as unknown as EntityRows[E];
  }

  async update<E extends MutableEntityName>(
    entity: E,
    key: EntityKey<E>,
    patch: Partial<EntityRows[E]>,
  ): Promise<EntityRows[E]> {
    const table = this.table(entity);
    const before = await table.get(key);
    if (before !== null) this.record(entity, table.keyOf(before), before);
    return (await table.update(key, patch)) as unknown as EntityRows[E];
  }

  async remove<E extends MutableEntityName>(entity: E, key: EntityKey<E>): Promise<void> {
    const table = this.table(entity);
    const before = await table.get(key);
    if (before !== null) this.record(entity, table.keyOf(before), before);
    await table.remove(key);
  }

  async restore(image: RowImage): Promise<void> {
    const table = this.table(image.entity);
    const key = jsonToKey(image.key);
    const current = await table.get(key);
    this.record(image.entity, key, current);
    if (image.before === null) {
      if (current !== null) await table.remove(key);
      return;
    }
    const row = jsonToRow(image.entity, image.before);
    if (current === null) await table.insert(row);
    else await table.update(key, row);
  }

  /** Current images of the given keys (the "after" side of a description). */
  async imagesOf(keys: readonly Pick<RowImage, "entity" | "key">[]): Promise<RowImage[]> {
    const result: RowImage[] = [];
    for (const { entity, key } of keys) {
      const row = await this.table(entity).get(jsonToKey(key));
      result.push({ entity, key, before: row === null ? null : rowToJson(row) });
    }
    return result;
  }

  private record(entity: MutableEntityName, key: Row, before: Row | null): void {
    this.images.push({
      entity,
      key: rowToJson(key),
      before: before === null ? null : rowToJson(before),
    });
  }

  private table(entity: string): ScopedTable {
    let table = this.tables.get(entity);
    if (table === undefined) {
      table = new ScopedTable(this.db, this.ctx, entity as TableName);
      this.tables.set(entity, table);
    }
    return table;
  }
}

/** Primary-key columns are uuid, integer, enum or text; none needs reviving. */
function jsonToKey(key: Record<string, Json>): Row {
  return { ...key };
}
