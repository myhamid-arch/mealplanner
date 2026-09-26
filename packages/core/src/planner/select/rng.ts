// Seeded randomness for plan search (PLN-11 "deterministic for a fixed seed", ADR-1 §6).

/** mulberry32: a 32-bit state PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, for keyed streams that do not depend on call order. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A value in [0, 1) fixed by the seed and the key. Keyed rather than sequential, so the jitter of a
 * candidate does not depend on how many other candidates were drawn before it.
 */
export function seededUnit(seed: number, key: string): number {
  return mulberry32((fnv1a(key) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0)();
}
