// UUIDv7 (RFC 9562 §5.7), generated in the app (02 preamble). IDs created in one process are
// strictly increasing: within one millisecond the 12-bit rand_a field is a counter.
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
    counter = randomBits(10); // leave headroom for increments within the millisecond
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

function randomBits(bits: number): number {
  const buffer = new Uint16Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) & ((1 << bits) - 1);
}
