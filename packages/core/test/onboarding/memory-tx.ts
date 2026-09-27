// An in-memory ChangeTx (the interface packages/db implements in a transaction), so the golden
// tests apply inferred ops with the real registry without a database.
import {
  ChangeOpSchema,
  getOp,
  type ChangeOp,
  type ChangeTx,
  type RowImage,
} from "../../src/changes/index.js";
import {
  DEFAULT_SLOTS,
  ENTITY_KEYS,
  type EntityKey,
  type EntityName,
  type EntityRows,
  type MutableEntityName,
} from "../../src/types/index.js";

type Row = Record<string, unknown>;

export function idFactory(prefix = 0): () => string {
  let n = 0;
  return () => {
    n += 1;
    const hex = (prefix * 1_000_000 + n).toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  };
}

export class MemoryTx implements ChangeTx {
  readonly householdId = "00000000-0000-4000-8000-ffffffffffff";
  readonly actorUserId = null;
  private readonly tables = new Map<string, Row[]>();

  constructor(readonly newId: () => string) {}

  now(): Date {
    return new Date("2026-09-26T12:00:00Z");
  }

  rows<E extends EntityName>(entity: E): EntityRows[E][] {
    return (this.tables.get(entity) ?? []) as unknown as EntityRows[E][];
  }

  private table(entity: string): Row[] {
    let t = this.tables.get(entity);
    if (t === undefined) {
      t = [];
      this.tables.set(entity, t);
    }
    return t;
  }

  private matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(
      ([k, v]) => v === undefined || (v === null ? row[k] === null : row[k] === v),
    );
  }

  private keyOf(entity: EntityName, row: Row): Row {
    return Object.fromEntries((ENTITY_KEYS[entity] as readonly string[]).map((k) => [k, row[k]]));
  }

  get<E extends EntityName>(entity: E, key: EntityKey<E>): Promise<EntityRows[E] | null> {
    const found = this.table(entity).find((r) => this.matches(r, key as Row));
    return Promise.resolve((found ?? null) as EntityRows[E] | null);
  }

  find<E extends EntityName>(entity: E, where: Partial<EntityRows[E]>): Promise<EntityRows[E][]> {
    return Promise.resolve(
      this.table(entity).filter((r) => this.matches(r, where as Row)) as unknown as EntityRows[E][],
    );
  }

  insert<E extends MutableEntityName>(entity: E, row: EntityRows[E]): Promise<EntityRows[E]> {
    const key = this.keyOf(entity, row as unknown as Row);
    if (this.table(entity).some((r) => this.matches(r, key)))
      throw new Error(`${entity}: duplicate key ${JSON.stringify(key)}`);
    this.table(entity).push({ ...(row as unknown as Row) });
    return Promise.resolve(row);
  }

  update<E extends MutableEntityName>(
    entity: E,
    key: EntityKey<E>,
    patch: Partial<EntityRows[E]>,
  ): Promise<EntityRows[E]> {
    const row = this.table(entity).find((r) => this.matches(r, key as Row));
    if (row === undefined) throw new Error(`${entity}: no row ${JSON.stringify(key)}`);
    Object.assign(row, patch);
    return Promise.resolve(row as unknown as EntityRows[E]);
  }

  remove<E extends MutableEntityName>(entity: E, key: EntityKey<E>): Promise<void> {
    const t = this.table(entity);
    const i = t.findIndex((r) => this.matches(r, key));
    if (i === -1) throw new Error(`${entity}: no row ${JSON.stringify(key)}`);
    t.splice(i, 1);
    return Promise.resolve();
  }

  restore(image: RowImage): Promise<void> {
    return Promise.reject(new Error(`restore is not used by these tests (${image.entity})`));
  }

  /** Parses every op with the public schema, then applies it with the registry. */
  async applyAll(ops: readonly ChangeOp[]): Promise<void> {
    for (const op of ops) {
      const parsed = ChangeOpSchema.parse(op);
      const def = getOp(parsed.kind);
      if (def === undefined) throw new Error(`unknown op ${parsed.kind}`);
      await def.apply(this, parsed.payload);
    }
  }
}

/** A household as sign-up leaves it: the PLN-2 slots (1.1.2 `defaultSetupOps`). */
export async function newHousehold(tx: MemoryTx): Promise<Record<string, string>> {
  const slotIds: Record<string, string> = {};
  const ops: ChangeOp[] = DEFAULT_SLOTS.map((slot) => {
    const id = tx.newId();
    slotIds[slot.key] = id;
    return {
      kind: "slot.create",
      payload: {
        id,
        key: slot.key,
        label: slot.label,
        icon: slot.icon,
        sortOrder: slot.sortOrder,
        defaultTime: slot.defaultTime,
        isShared: slot.isShared,
        isPacked: slot.isPacked,
        reheatAvailable: slot.reheatAvailable,
        isTrainingSlot: slot.isTrainingSlot,
        constraintsNote: null,
        active: slot.active,
      },
    };
  });
  await tx.applyAll(ops);
  return slotIds;
}
