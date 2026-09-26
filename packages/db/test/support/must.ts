/** Test helper: the value, or a thrown error naming what was missing (instead of `x!`). */
export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}
