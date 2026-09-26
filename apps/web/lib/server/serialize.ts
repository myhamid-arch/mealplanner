// Rows to JSON-ready values: Dates become ISO strings, recursively. Response schemas then drop any
// field the contract does not list (route.ts), so a row can be returned as its DTO.
export type Plain<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Plain<U>[]
    : T extends object
      ? { [K in keyof T]: Plain<T[K]> }
      : T;

export function plain<T>(value: T): Plain<T> {
  if (value instanceof Date) return value.toISOString() as Plain<T>;
  if (Array.isArray(value)) return value.map((v: unknown) => plain(v)) as Plain<T>;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out as Plain<T>;
  }
  return value as Plain<T>;
}

export const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
