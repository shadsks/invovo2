// liclib.mjs — the ONE shared definition of the serial-key format.
// Imported by scripts/genkeys.mjs (Node) and mirrored byte-for-byte inside _worker.js
// (Cloudflare Worker). Node and the Worker must produce identical HMACs, so both sides
// use plain HMAC-SHA256 over the UTF-8 body string and the same Crockford base32.
import { createHmac, randomBytes } from 'node:crypto';

// Crockford base32: 32 symbols, excludes I L O U so keys can't be misread.
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const BODY_BYTES = 10;   // 80 bits of entropy -> 16 base32 chars, no remainder
export const MAC_CHARS = 6;     // truncated checksum length

// bytes -> base32 string (5 bits per symbol, big-endian)
export function b32(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(val << (5 - bits)) & 31];
  return out;
}

// HMAC-SHA256(secret, msg) -> Uint8Array (Node side)
function macBytes(secret, msg) {
  return new Uint8Array(createHmac('sha256', secret).update(msg, 'utf8').digest());
}

// Canonical checksum for a 16-char body under a secret.
export function checksum(secret, body) {
  return b32(macBytes(secret, body)).slice(0, MAC_CHARS);
}

// Normalize any human input to the 22-char canonical form (body16 + mac6), or '' if wrong length.
// Forgiving: drops the cosmetic "IS-" prefix, spaces and dashes, and folds Crockford confusables.
export function normalize(input) {
  let s = String(input || '').toUpperCase().replace(/^IS[-\s]*/, '');
  s = s.replace(/[^0-9A-Z]/g, '');
  s = s.replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  return s.length === (16 + MAC_CHARS) ? s : '';
}

// Pretty display form: IS-XXXX-XXXX-XXXX-XXXX-XXXX-XX
export function pretty(raw) {
  return 'IS-' + raw.match(/.{1,4}/g).join('-');
}

// Constant-time string compare (avoids leaking mac via timing).
export function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Validate a key against the secret. Returns the canonical body (16 chars) or null.
export function validate(secret, input) {
  const norm = normalize(input);
  if (!norm) return null;
  const body = norm.slice(0, 16), mac = norm.slice(16);
  return timingSafeEq(mac, checksum(secret, body)) ? body : null;
}

// Generate one fresh key: { raw, pretty, body }
export function generate(secret) {
  const body = b32(randomBytes(BODY_BYTES));           // 16 chars
  const raw = body + checksum(secret, body);           // 22 chars
  return { raw, pretty: pretty(raw), body };
}
