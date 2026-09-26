// SQL plumbing for the PostgreSQL graph store (leaf-1.3.4 ADR-1): the structural client type, row
// mappers and canonical JSON.
import type { Json, KgEdgeSource } from "@mealplanner/core/types";
import type { KgNode, KgNodeType } from "../types/index.js";

/** Satisfied by `pg.Pool`, `pg.PoolClient` and `pg.Client`. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** A pool: a client can be checked out for a transaction. */
export interface Connectable extends Queryable {
  connect(): Promise<Queryable & { release(err?: Error | boolean): void }>;
}

export function isConnectable(db: Queryable): db is Connectable {
  return typeof (db as Partial<Connectable>).connect === "function";
}

export async function rows<T>(db: Queryable, text: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query(text, values)).rows as T[];
}

export interface NodeRecord {
  id: string;
  household_id: string | null;
  type: string;
  key: string;
  label: string;
  props: Json;
}

export function toNode(r: NodeRecord): KgNode {
  return {
    id: r.id,
    householdId: r.household_id,
    type: r.type as KgNodeType,
    key: r.key,
    label: r.label,
    props: r.props,
  };
}

/** `numeric` arrives as a string from `pg`. */
export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${String(value)}`);
  return n;
}

export function toSource(value: unknown): KgEdgeSource {
  if (value === "seed" || value === "derived" || value === "learned" || value === "ai")
    return value;
  throw new Error(`unknown kg_edge source ${String(value)}`);
}

/** JSON with object keys sorted, so equal values print equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** The visibility predicate of KG-2 for one table alias; `$n` is the household parameter. */
export function visible(alias: string, param: string): string {
  return `(${alias}.household_id IS NULL OR ${alias}.household_id = ${param}::uuid)`;
}
