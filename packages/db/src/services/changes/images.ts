// Row ⇄ JSON before-image conversion. Timestamps become ISO strings in the stored inverse and are
// revived from the column type, so a restored row is identical to the original (ADR-3).
import type { Json } from "@mealplanner/core/types";
import type { PgColumn } from "drizzle-orm/pg-core";
import { TABLES, columnsOf, type TableName } from "../../repos/index.js";
import type { Row } from "../../repos/scoped.js";

export function rowToJson(row: Row): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : (v as Json)]),
  );
}

export function jsonToRow(entity: TableName, json: Record<string, Json>): Row {
  const columns: Record<string, PgColumn> = columnsOf(TABLES[entity]);
  const row: Row = {};
  for (const [k, v] of Object.entries(json)) {
    const column = columns[k];
    if (column === undefined) throw new Error(`${entity} has no column ${k}`);
    row[k] = column.dataType === "date" && typeof v === "string" ? new Date(v) : v;
  }
  for (const k of Object.keys(columns)) {
    if (!(k in row)) throw new Error(`${entity} image is missing column ${k}`);
  }
  return row;
}
