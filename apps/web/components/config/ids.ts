// Time-ordered ids (UUIDv7, RFC 9562) for rows the client creates, like the server's own ids
// (02: "IDs are UUIDv7"). The API lists members by id, so people appear in the order they were added.
let last = 0;
let seq = 0;

export function newId(now: number = Date.now()): string {
  if (now <= last) {
    seq += 1;
  } else {
    last = now;
    seq = 0;
  }
  const ms = last;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i += 1) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  // 12-bit counter in rand_a keeps ids from the same millisecond in creation order.
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
  bytes[7] = seq & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
