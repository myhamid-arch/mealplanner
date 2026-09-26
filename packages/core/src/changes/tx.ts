// The write interface change ops run against (BLD-8 R-7, leaf-1.1.2 ADR-3). Core declares it and
// packages/db implements it inside one transaction, scoped to one household. Every write through
// it is recorded as a before-image, which is what the inverse of a change set restores.
import type { EntityKey, EntityName, EntityRows, MutableEntityName } from "../types/index.js";
import type { RowImage } from "./define.js";

export interface ChangeTx {
  /** The household every read and write is scoped to. */
  readonly householdId: string;
  /** The acting login, or null for system change sets. */
  readonly actorUserId: string | null;
  newId(): string;
  /** The change set's timestamp; the same value for every op in one change set. */
  now(): Date;
  /** One row by primary key, or null. A row of another household is an error, never null. */
  get<E extends EntityName>(entity: E, key: EntityKey<E>): Promise<EntityRows[E] | null>;
  /** Rows matching every given column (null matches IS NULL), in primary-key order. */
  find<E extends EntityName>(entity: E, where: Partial<EntityRows[E]>): Promise<EntityRows[E][]>;
  insert<E extends MutableEntityName>(entity: E, row: EntityRows[E]): Promise<EntityRows[E]>;
  update<E extends MutableEntityName>(
    entity: E,
    key: EntityKey<E>,
    patch: Partial<EntityRows[E]>,
  ): Promise<EntityRows[E]>;
  remove<E extends MutableEntityName>(entity: E, key: EntityKey<E>): Promise<void>;
  /** Puts one row back to a before-image (inserts, overwrites or deletes). Used by `rows.restore`. */
  restore(image: RowImage): Promise<void>;
}

/** A precondition of an op does not hold (missing row, invalid combination). */
export class ChangeOpError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(`${kind}: ${message}`);
    this.name = "ChangeOpError";
  }
}
