// RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits), computed independently of the auth library so the
// tests act as an authenticator app would.
import { createHmac } from "node:crypto";

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 character ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The secret of an `otpauth://totp/...?secret=...` URI. */
export function secretOf(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (secret === null) throw new Error("the TOTP URI has no secret");
  return secret;
}

export function totpCode(secretBase32: string, at = Date.now(), period = 30, digits = 6): string {
  const counter = Math.floor(at / 1000 / period);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(msg).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const code =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(code % 10 ** digits).padStart(digits, "0");
}
