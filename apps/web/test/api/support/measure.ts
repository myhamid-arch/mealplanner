// Figures a gate's tests measured, appended as JSON lines to API_MEASURE_FILE (when set) for the
// verify script to re-check independently of the test assertions.
import { appendFileSync } from "node:fs";

export function measure(gate: string, check: string, data: Record<string, unknown>): void {
  const file = process.env.API_MEASURE_FILE;
  if (file === undefined || file === "") return;
  appendFileSync(file, `${JSON.stringify({ gate, check, ...data })}\n`);
}
