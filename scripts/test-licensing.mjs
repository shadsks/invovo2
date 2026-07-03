// test-licensing.mjs — end-to-end proof of the serial-key enforcement in _worker.js.
//   node scripts/genkeys.mjs 100      (first, if you haven't)
//   node scripts/test-licensing.mjs
//
// Runs the REAL Worker code in memory against a D1-shaped shim backed by Node's built-in
// node:sqlite (same SQLite engine family/dialect D1 uses), so the exact SQL the Worker sends
// to production D1 is what gets exercised here — no parallel reimplementation of the logic.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// _worker.js is ESM but lives in a CommonJS package scope — import via a temp .mjs copy.
const tmp = mkdtempSync(join(tmpdir(), 'is-lic-'));
const workerSrc = readFileSync(join(ROOT, '_worker.js'), 'utf8');
writeFileSync(join(tmp, 'worker.mjs'), workerSrc);
const { default: worker } = await import(pathToFileURL(join(tmp, 'worker.mjs')).href);

const secret = readFileSync(join(ROOT, 'keys', 'LICENSE_SECRET.txt'), 'utf8').trim();
const keys = readFileSync(join(ROOT, 'keys', 'serial-keys.txt'), 'utf8')
  .split('\n').map(l => l.trim().split(/\s+/).pop()).filter(k => /^IS-/.test(k));
const schema = readFileSync(join(ROOT, 'scripts', 'schema.sql'), 'utf8');

// ---- Minimal D1 shim over node:sqlite: same surface the Worker calls (prepare/bind/run/first/all/batch).
function makeD1(sqliteDb) {
  function boundStatement(sql, params) {
    return {
      async run() {
        const info = sqliteDb.prepare(sql).run(...params);
        return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid }, results: [] };
      },
      async first() {
        const row = sqliteDb.prepare(sql).get(...params);
        return row === undefined ? null : row;
      },
      async all() {
        const rows = sqliteDb.prepare(sql).all(...params);
        return { success: true, results: rows, meta: {} };
      },
    };
  }
  return {
    prepare(sql) { return { bind(...params) { return boundStatement(sql, params); } }; },
    async batch(stmts) {
      // D1 batches run as a single transaction; mirror that with an explicit BEGIN/COMMIT so a
      // failure mid-batch can't leave a partial write (parity with D1's documented semantics).
      sqliteDb.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        sqliteDb.exec('COMMIT');
        return out;
      } catch (e) { sqliteDb.exec('ROLLBACK'); throw e; }
    },
  };
}
function freshEnv() {
  const sqliteDb = new DatabaseSync(':memory:');
  sqliteDb.exec(schema);
  return { LICENSE_SECRET: secret, DB: makeD1(sqliteDb) };
}

const call = (env, op, body) => worker.fetch(new Request('https://x/api/auth/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);

let pass = 0, fail = 0;
async function check(name, fn) { try { const r = await fn(); if (r) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } } catch (e) { fail++; console.log('  FAIL', name, e.stack || e.message); } }

console.log('Licensing end-to-end (D1-backed):');
let env = freshEnv();
const KEY = keys[0], KEY2 = keys[1];
let tokenA;
await check('valid key activates device A (1/2)', async () => { const r = await call(env, 'activate', { key: KEY, deviceId: 'A', label: 'A' }); const d = await r.json(); tokenA = d.token; return r.status === 200 && d.ok && d.used === 1 && !!d.token; });
await check('token from A verifies', async () => { const r = await call(env, 'verify', { token: tokenA, deviceId: 'A' }); return r.status === 200 && (await r.json()).ok; });
await check('same device A re-activates, still 1/2', async () => { const r = await call(env, 'activate', { key: KEY, deviceId: 'A', label: 'A' }); return r.status === 200 && (await r.json()).used === 1; });
await check('device B activates (2/2)', async () => { const r = await call(env, 'activate', { key: KEY, deviceId: 'B', label: 'B' }); return r.status === 200 && (await r.json()).used === 2; });
await check('device C REJECTED — limit reached', async () => { const r = await call(env, 'activate', { key: KEY, deviceId: 'C', label: 'C' }); const d = await r.json(); return r.status === 409 && d.limit && d.devices.length === 2; });
await check('device C activates after evicting A', async () => { const r = await call(env, 'activate', { key: KEY, deviceId: 'C', label: 'C', evict: 'A' }); return r.status === 200 && (await r.json()).used === 2; });
await check("evicted A's token no longer verifies", async () => { const r = await call(env, 'verify', { token: tokenA, deviceId: 'A' }); return r.status === 401; });
await check('forged key rejected (400)', async () => { const r = await call(env, 'activate', { key: 'IS-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZ', deviceId: 'X' }); return r.status === 400; });
await check('tampered token rejected (401)', async () => { const r = await call(env, 'verify', { token: tokenA + 'x', deviceId: 'A' }); return r.status === 401; });
await check('a DIFFERENT key is independent (its own 2 slots)', async () => { const r = await call(env, 'activate', { key: KEY2, deviceId: 'Z', label: 'Z' }); return r.status === 200 && (await r.json()).used === 1; });
await check('release OTHER device keeps the caller bound', async () => {
  const K = keys[2];
  const a = await (await call(env, 'activate', { key: K, deviceId: 'm1', label: 'M1' })).json();
  const b = await (await call(env, 'activate', { key: K, deviceId: 'm2', label: 'M2' })).json();
  const shortM2 = b.devices.find(d => d.label === 'M2').id;
  const rel = await (await call(env, 'release', { token: a.token, deviceId: 'm1', removeId: shortM2 })).json();
  const stillMe = await call(env, 'verify', { token: a.token, deviceId: 'm1' });
  return rel.removed === 1 && rel.used === 1 && stillMe.status === 200;
});
await check('sign-out (release self) frees the slot for a 3rd device', async () => {
  const K = keys[3];
  const a = await (await call(env, 'activate', { key: K, deviceId: 's1', label: 'S1' })).json();
  await call(env, 'activate', { key: K, deviceId: 's2', label: 'S2' });
  const blocked = await call(env, 'activate', { key: K, deviceId: 's3', label: 'S3' });
  await call(env, 'release', { token: a.token, deviceId: 's1' });
  const now = await call(env, 'activate', { key: K, deviceId: 's3', label: 'S3' });
  const meGone = await call(env, 'verify', { token: a.token, deviceId: 's1' });
  return blocked.status === 409 && now.status === 200 && (await now.json()).used === 2 && meGone.status === 401;
});
await check('revoked key blocks activate + verify (direct SQL revoke, e.g. dashboard console)', async () => {
  const sqliteDb = new DatabaseSync(':memory:');
  sqliteDb.exec(schema);
  const testEnv = { LICENSE_SECRET: secret, DB: makeD1(sqliteDb) };
  const K = keys[6];
  const a = await (await call(testEnv, 'activate', { key: K, deviceId: 'v1', label: 'V1' })).json();
  // Find this key's hash the same way the Worker does, by reading it straight out of the devices table.
  const row = sqliteDb.prepare('SELECT key_hash FROM devices LIMIT 1').get();
  sqliteDb.prepare('INSERT INTO revoked (key_hash, revoked_at) VALUES (?, ?)').run(row.key_hash, Date.now());
  const verifyAfterRevoke = await call(testEnv, 'verify', { token: a.token, deviceId: 'v1' });
  const activateAfterRevoke = await call(testEnv, 'activate', { key: K, deviceId: 'v2', label: 'V2' });
  return verifyAfterRevoke.status === 403 && activateAfterRevoke.status === 403;
});

// Exhaustive order-independence proof: since node:sqlite is synchronous/single-connection there is
// no literal "simultaneous" request, but the atomicity claim is about a SINGLE STATEMENT being
// indivisible, not about thread scheduling. So the strongest available proof is to run the same
// 4-device race across every one of the 4! = 24 possible arrival orders (fresh DB each time) and
// assert the cap holds for ALL of them — proving the SQL's outcome is order-independent, which is
// exactly the invariant D1's single-writer model relies on.
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}
await check('cap holds under all 24 possible arrival orders of a 4-device race', async () => {
  const K = keys[7];
  for (const order of permutations(['p', 'q', 'r', 's'])) {
    const sqliteDb = new DatabaseSync(':memory:');
    sqliteDb.exec(schema);
    const testEnv = { LICENSE_SECRET: secret, DB: makeD1(sqliteDb) };
    let anyToken = null;
    for (const id of order) {
      const r = await call(testEnv, 'activate', { key: K, deviceId: id, label: id });
      if (r.status === 200) anyToken = (await r.json()).token;
    }
    const view = await (await call(testEnv, 'status', { token: anyToken, deviceId: order[0] })).json();
    if (view.used !== 2) { console.log('    order', order, 'settled at', view.used); return false; }
  }
  return true;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
