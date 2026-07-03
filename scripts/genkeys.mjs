// genkeys.mjs — generate the LICENSE_SECRET (once) and a batch of serial keys.
//
//   node scripts/genkeys.mjs            -> 100 keys, reuse existing secret if present
//   node scripts/genkeys.mjs 250        -> 250 keys
//   node scripts/genkeys.mjs 100 --new  -> force a brand-new secret (invalidates old keys)
//
// Outputs into ./keys :
//   LICENSE_SECRET.txt   the HMAC secret — set it as a Worker secret, never commit it
//   serial-keys.txt      the human-handout list of keys
//   serial-keys.csv      key,issuedAt for record-keeping
//
// Security model: a key is valid iff its checksum verifies under LICENSE_SECRET.
// The server needs NO database of keys to reject fakes — forging one requires the secret.
import { generate, validate } from './liclib.mjs';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(HERE, '..', 'keys');
const SECRET_FILE = join(KEYS_DIR, 'LICENSE_SECRET.txt');

const count = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 100;
const forceNew = process.argv.includes('--new');

mkdirSync(KEYS_DIR, { recursive: true });

let secret;
if (existsSync(SECRET_FILE) && !forceNew) {
  secret = readFileSync(SECRET_FILE, 'utf8').trim();
  console.log('Reusing existing LICENSE_SECRET (pass --new to rotate).');
} else {
  secret = randomBytes(32).toString('base64url');
  writeFileSync(SECRET_FILE, secret + '\n');
  console.log('Wrote a NEW LICENSE_SECRET to keys/LICENSE_SECRET.txt');
}

const now = new Date().toISOString();
const keys = [];
const seen = new Set();
while (keys.length < count) {
  const k = generate(secret);
  if (seen.has(k.raw)) continue;   // astronomically unlikely, but be safe
  seen.add(k.raw);
  keys.push(k.pretty);
}

// Self-test: every generated key must validate; a tampered one must not.
let ok = 0;
for (const k of keys) if (validate(secret, k)) ok++;
const tampered = keys[0].slice(0, -1) + (keys[0].slice(-1) === 'Z' ? 'Y' : 'Z');
const tamperRejected = validate(secret, tampered) === null;
if (ok !== keys.length || !tamperRejected) {
  console.error(`SELF-TEST FAILED: ${ok}/${keys.length} valid, tamperRejected=${tamperRejected}`);
  process.exit(1);
}

writeFileSync(join(KEYS_DIR, 'serial-keys.txt'),
  `Invoice Studio — ${keys.length} serial keys\nGenerated ${now}\nEach key allows activation on up to 2 devices.\n\n` +
  keys.map((k, i) => `${String(i + 1).padStart(3, '0')}  ${k}`).join('\n') + '\n');
writeFileSync(join(KEYS_DIR, 'serial-keys.csv'),
  'index,key,issuedAt\n' + keys.map((k, i) => `${i + 1},${k},${now}`).join('\n') + '\n');

console.log(`Generated ${keys.length} keys. Self-test PASSED (${ok} valid, forged key rejected).`);
console.log(`  keys/serial-keys.txt   handout list`);
console.log(`  keys/serial-keys.csv   records`);
console.log(`\nNext: set the secret on your Worker:`);
console.log(`  npx wrangler secret put LICENSE_SECRET   (paste the value from keys/LICENSE_SECRET.txt)`);
