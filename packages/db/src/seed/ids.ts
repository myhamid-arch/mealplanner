// Deterministic ids for seed-library rows (BLD-8 R-17 idempotence): the same slug and keys always
// give the same uuid, so re-loading updates rows in place and graph/plan references stay valid.
// Format: RFC 9562 UUIDv8 (custom) over SHA-256 of the name.
import { createHash } from "node:crypto";

export function seedId(...parts: string[]): string {
  const bytes = createHash("sha256")
    .update(`mealplanner-seed\u0000${parts.join("\u0000")}`)
    .digest();
  bytes[6] = 0x80 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
