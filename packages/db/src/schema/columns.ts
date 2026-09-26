// Column helpers for the conventions in 02's preamble (ADR-1).
import { customType, numeric, timestamp } from "drizzle-orm/pg-core";

/**
 * `timestamptz(3)`: millisecond precision, so a value read into a JS Date and written back is
 * byte-identical (the change-set inverse restores rows exactly, ADR-3).
 */
export const tstz = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3, mode: "date" });

/** `numeric(10,3)` mapped to `number` (02: nutrient quantities). */
export const num = (name: string) => numeric(name, { precision: 10, scale: 3, mode: "number" });

/** `citext` (02 §1 user.email); the extension is created by migration 0000. */
export const citext = customType<{ data: string }>({ dataType: () => "citext" });
