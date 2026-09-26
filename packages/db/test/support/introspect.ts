// Introspection of a live database: the spec-column check and a schema fingerprint (G1).
import type pg from "pg";
import {
  SPEC_ABSENT_COLUMNS,
  SPEC_COLUMNS,
  SPEC_ENUM_VALUES,
  SPEC_INDEXES,
  SPEC_TABLES_WITHOUT_COLUMN_LIST,
  SPEC_UNIQUE,
} from "../spec-columns.js";
import { must } from "./must.js";

async function rows<T extends pg.QueryResultRow>(pool: pg.Pool, text: string): Promise<T[]> {
  return (await pool.query<T>(text)).rows;
}

/** Everything the spec names that the database lacks or has wrong (empty = matches). */
export async function specProblems(pool: pg.Pool): Promise<string[]> {
  const problems: string[] = [];
  const columns = await rows<{ table_name: string; column_name: string; udt_name: string }>(
    pool,
    "SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public'",
  );
  const byTable = new Map<string, Map<string, string>>();
  for (const c of columns) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Map());
    must(byTable.get(c.table_name)).set(c.column_name, c.udt_name);
  }
  for (const table of SPEC_TABLES_WITHOUT_COLUMN_LIST)
    if (!byTable.has(table)) problems.push(`missing table ${table}`);
  for (const [table, expected] of Object.entries(SPEC_COLUMNS)) {
    const actual = byTable.get(table);
    if (actual === undefined) {
      problems.push(`missing table ${table}`);
      continue;
    }
    for (const column of expected)
      if (!actual.has(column)) problems.push(`missing column ${table}.${column}`);
  }
  for (const [table, absent] of Object.entries(SPEC_ABSENT_COLUMNS)) {
    for (const column of absent)
      if (byTable.get(table)?.has(column) === true)
        problems.push(`column ${table}.${column} must not exist`);
  }
  // 02 preamble: ids are uuid, timestamps timestamptz, nutrient quantities numeric(10,3), email citext.
  for (const [table, cols] of byTable) {
    for (const [column, type] of cols) {
      // Exceptions: the auth library's provider ids (ADR-4) and review.target_id ("uuid or key", 02 §6).
      const textIds =
        (table === "account" && (column === "account_id" || column === "provider_id")) ||
        (table === "review" && column === "target_id");
      if ((column === "id" || column.endsWith("_id")) && type !== "uuid" && !textIds)
        problems.push(`${table}.${column} is ${type}, not uuid`);
      if (column.endsWith("_at") && type !== "timestamptz")
        problems.push(`${table}.${column} is ${type}, not timestamptz`);
    }
  }
  if (byTable.get("user")?.get("email") !== "citext") problems.push("user.email is not citext");
  const nutrients = await rows<{
    column_name: string;
    numeric_precision: number;
    numeric_scale: number;
  }>(
    pool,
    "SELECT column_name, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ingredient' AND column_name IN ('kcal','protein_g','carbs_g','fat_g','sat_fat_g','fibre_g','soluble_fibre_g','sugar_g','sodium_mg')",
  );
  if (
    nutrients.length !== 9 ||
    nutrients.some((n) => n.numeric_precision !== 10 || n.numeric_scale !== 3)
  )
    problems.push("ingredient nutrients are not all numeric(10,3)");
  // Enumerations.
  const enums = await rows<{ typname: string; labels: string[] }>(
    pool,
    "SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname",
  );
  for (const [name, values] of Object.entries(SPEC_ENUM_VALUES)) {
    const actual = enums.find((e) => e.typname === name)?.labels;
    if (JSON.stringify(actual) !== JSON.stringify(values))
      problems.push(
        `enum ${name} is ${JSON.stringify(actual)}, expected ${JSON.stringify(values)}`,
      );
  }
  // Uniqueness (unique constraint, unique index or primary key over exactly these columns).
  const uniques = await rows<{ table: string; cols: string[] }>(
    pool,
    `SELECT c.relname AS table, array_agg(a.attname ORDER BY a.attname)::text[] AS cols
       FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE n.nspname = 'public' AND i.indisunique GROUP BY c.relname, i.indexrelid`,
  );
  for (const [table, cols] of SPEC_UNIQUE) {
    const want = [...cols].sort().join(",");
    if (!uniques.some((u) => u.table === table && [...u.cols].sort().join(",") === want))
      problems.push(`no uniqueness on ${table}(${cols.join(", ")})`);
  }
  // Indexes: kg_edge, and household_id leading an index on every table that has it (DM-1).
  const indexes = await rows<{ table: string; cols: string[] }>(
    pool,
    `SELECT c.relname AS table, array_agg(a.attname ORDER BY k.ord)::text[] AS cols
       FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public' GROUP BY c.relname, i.indexrelid`,
  );
  for (const [table, cols] of SPEC_INDEXES) {
    if (!indexes.some((i) => i.table === table && i.cols.join(",") === cols.join(",")))
      problems.push(`no index on ${table}(${cols.join(", ")})`);
  }
  for (const [table, cols] of byTable) {
    const key = cols.has("household_id")
      ? "household_id"
      : cols.has("created_by_household_id")
        ? "created_by_household_id"
        : null;
    if (key !== null && !indexes.some((i) => i.table === table && i.cols[0] === key))
      problems.push(`${table}.${key} has no index (DM-1)`);
  }
  return problems;
}

/** A canonical description of the public schema: columns, constraints, indexes, enums. */
export async function schemaFingerprint(pool: pg.Pool): Promise<string[]> {
  const parts = [
    ...(await rows<{ x: string }>(
      pool,
      "SELECT concat_ws('|', 'col', table_name, column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale, datetime_precision, is_nullable, column_default) AS x FROM information_schema.columns WHERE table_schema = 'public'",
    )),
    ...(await rows<{ x: string }>(
      pool,
      "SELECT concat_ws('|', 'con', c.conrelid::regclass::text, c.conname, pg_get_constraintdef(c.oid)) AS x FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'",
    )),
    ...(await rows<{ x: string }>(
      pool,
      "SELECT concat_ws('|', 'idx', tablename, indexname, indexdef) AS x FROM pg_indexes WHERE schemaname = 'public'",
    )),
    ...(await rows<{ x: string }>(
      pool,
      "SELECT concat_ws('|', 'enum', t.typname, e.enumsortorder::text, e.enumlabel) AS x FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid",
    )),
  ];
  return parts.map((p) => p.x).sort();
}
