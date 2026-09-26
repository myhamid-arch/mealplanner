// UUIDv7 (RFC 9562 §5.7) for new graph rows, generated in the app (02 preamble). `graph` cannot
// import db's helper (ARC-3, R-2), so it carries its own. Within one millisecond rand_a counts up.
let lastMs = -1;
let counter = 0;

export function newId(): string {
  let ms = Date.now();
  if (ms <= lastMs) {
    counter += 1;
    if (counter > 0xfff) {
      lastMs += 1;
      counter = 0;
    }
    ms = lastMs;
  } else {
    lastMs = ms;
    const seed = new Uint16Array(1);
    crypto.getRandomValues(seed);
    counter = (seed[0] ?? 0) & 0x3ff;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let t = ms;
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
