// Invoice Studio — Cloudflare Worker (static assets + AI proxy + serial-key licensing).
//
// Drag-and-drop deployable: create a D1 database + bind it + set secrets, all via the
// Cloudflare dashboard, no CLI required. See AUTH.md for the click-by-click steps.
// Secrets (Pages project -> Settings -> Variables and Secrets):
//   NVIDIA_API_KEY   — powers the /api/v1/chat/completions proxy (optional; smart features)
//   LICENSE_SECRET   — HMAC secret that both mints and verifies serial keys (REQUIRED for login)
// Bindings (Pages project -> Settings -> Functions -> Bindings):
//   ASSETS           — the static site (index.html, css, js) — set up automatically
//   DB               — D1 database binding (schema in scripts/schema.sql); device binding lives here
//
// The NVIDIA key and the license secret live ONLY in Worker secrets, never in the browser.

const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_DEVICES = 2;                 // strict rule: 1 key = at most 2 devices
const SESSION_DAYS = 30;               // client re-verifies against the server each load

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', ...cors } });
const preflight = () => new Response(null, { status: 204, headers: cors });

/* ---------------- shared key crypto (mirror of scripts/liclib.mjs) ---------------- */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAC_CHARS = 6;
const enc = new TextEncoder();

function b32(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(val << (5 - bits)) & 31];
  return out;
}
async function hmacBytes(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function normalizeKey(input) {
  let s = String(input || '').toUpperCase().replace(/^IS[-\s]*/, '');
  s = s.replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  return s.length === (16 + MAC_CHARS) ? s : '';
}
// Returns the canonical body (16 chars) if the key's checksum verifies, else null.
async function validateKey(secret, input) {
  const norm = normalizeKey(input);
  if (!norm) return null;
  const body = norm.slice(0, 16), mac = norm.slice(16);
  const good = b32(await hmacBytes(secret, body)).slice(0, MAC_CHARS);
  return timingSafeEq(mac, good) ? body : null;
}
// Opaque, stable per-key handle used as the Durable Object name + token subject (never the raw key).
async function keyHash(secret, body) {
  return b32(await hmacBytes(secret, 'kh:' + body)).slice(0, 16);
}

/* ---------------- session tokens (stateless, HMAC-signed) ---------------- */
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = (s) => b64u(enc.encode(s));
async function signSession(secret, kh, deviceId) {
  const payload = b64uStr(JSON.stringify({ kh, d: deviceId, exp: Date.now() + SESSION_DAYS * 864e5 }));
  const sig = b64u(await hmacBytes(secret, 'sess.' + payload));
  return 'sess.' + payload + '.' + sig;
}
async function readSession(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'sess') return null;
  const sig = b64u(await hmacBytes(secret, 'sess.' + parts[1]));
  if (!timingSafeEq(sig, parts[2])) return null;
  try {
    const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!p || typeof p.exp !== 'number' || Date.now() > p.exp) return null;
    return p; // {kh, d, exp}
  } catch { return null; }
}

/* ---------------- device binding: D1 (Cloudflare's SQLite-backed database) ---------------- */
// Schema in scripts/schema.sql. A single atomic SQL statement enforces the 2-device cap:
// D1/SQLite evaluates the whole INSERT...SELECT...WHERE (including the correlated subquery
// that counts existing devices) against one consistent snapshot before writing a row, and no
// other writer can interleave mid-statement. So two devices activating the same key at the
// same instant cannot both slip past the cap — this holds for every possible arrival order,
// not just one interleaving (verified in scripts/test-licensing.mjs across all 24 orderings
// of a 4-way race). The WHERE clause excludes the activating device itself from the count, so
// re-activating an already-bound device is idempotent (ON CONFLICT ... DO UPDATE) even when
// the key is already at the cap.
const INSERT_SQL = `
  INSERT INTO devices (key_hash, device_id, label, bound_at, last_seen)
  SELECT ?1, ?2, ?3, ?4, ?4
  WHERE (SELECT COUNT(*) FROM devices WHERE key_hash = ?1 AND device_id != ?2) < ${MAX_DEVICES}
  ON CONFLICT(key_hash, device_id) DO UPDATE SET last_seen = ?4, label = ?3`;

async function isRevoked(db, kh) { return !!(await db.prepare(`SELECT 1 FROM revoked WHERE key_hash = ?1`).bind(kh).first()); }
async function getView(db, kh) {
  const revoked = await isRevoked(db, kh);
  const { results } = await db.prepare(
    `SELECT device_id, label, bound_at, last_seen FROM devices WHERE key_hash = ?1 ORDER BY bound_at ASC, rowid ASC`
  ).bind(kh).all();
  return {
    revoked, max: MAX_DEVICES, used: results.length,
    devices: results.map(d => ({ id: d.device_id.slice(0, 8), label: d.label, boundAt: d.bound_at, lastSeen: d.last_seen })),
  };
}

// Each returns { data, status } — kept as plain objects (not Response) so handleAuth can
// attach a session token to a successful activation before the single json() at the end.
async function doActivate(db, kh, deviceId, label, evict) {
  if (await isRevoked(db, kh)) return { data: { error: 'This license has been revoked. Contact support.' }, status: 403 };
  if (!deviceId) return { data: { error: 'Missing device id.' }, status: 400 };
  const now = Date.now();
  const insert = db.prepare(INSERT_SQL).bind(kh, deviceId, String(label || 'Device'), now);
  // Self-service: knowing the key proves ownership, so the holder may evict an old device (by
  // its short id) to free a slot before adding this one. Batched with the insert so no other
  // request can steal the freed slot in between (D1 batches run as one transaction).
  const results = evict
    ? await db.batch([db.prepare(`DELETE FROM devices WHERE key_hash = ?1 AND device_id LIKE ?2 || '%'`).bind(kh, String(evict)), insert])
    : [await insert.run()];
  const insertResult = results[results.length - 1];
  const view = await getView(db, kh);
  if (insertResult.meta.changes === 0)
    return { data: { error: `Device limit reached (${MAX_DEVICES} of ${MAX_DEVICES}). Remove a device on another machine to free a slot.`, limit: true, ...view }, status: 409 };
  return { data: { ok: true, ...view }, status: 200 };
}
async function doVerify(db, kh, deviceId) {
  if (await isRevoked(db, kh)) return { data: { ok: false, error: 'revoked' }, status: 403 };
  const upd = await db.prepare(`UPDATE devices SET last_seen = ?3 WHERE key_hash = ?1 AND device_id = ?2`).bind(kh, deviceId, Date.now()).run();
  if (upd.meta.changes === 0) return { data: { ok: false, error: 'device_not_bound' }, status: 401 };
  return { data: { ok: true, ...(await getView(db, kh)) }, status: 200 };
}
async function doRelease(db, kh, deviceId, removeId) {
  const target = String(removeId || '');
  const del = target
    ? await db.prepare(`DELETE FROM devices WHERE key_hash = ?1 AND device_id LIKE ?2 || '%'`).bind(kh, target).run()
    : await db.prepare(`DELETE FROM devices WHERE key_hash = ?1 AND device_id = ?2`).bind(kh, deviceId).run();
  return { data: { ok: true, removed: del.meta.changes, ...(await getView(db, kh)) }, status: 200 };
}

/* ---------------- auth route handler ---------------- */
async function handleAuth(request, env, op) {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const secret = env.LICENSE_SECRET;
  if (!secret) return json({ error: 'Licensing is not configured on this server (LICENSE_SECRET missing).' }, 500);
  if (!env.DB) return json({ error: 'Licensing backend (DB — D1 database) is not bound.' }, 500);
  const body = await request.json().catch(() => ({}));

  // Resolve the license key: directly (activate) or from a signed token (verify/release/status).
  let kh, deviceId = String(body.deviceId || '');
  if (op === 'activate') {
    const valid = await validateKey(secret, body.key);
    if (!valid) return json({ error: 'That serial key is not valid. Check for typos and try again.' }, 400);
    kh = await keyHash(secret, valid);
  } else {
    const sess = await readSession(secret, body.token);
    if (!sess) return json({ error: 'session_expired' }, 401);
    kh = sess.kh; deviceId = deviceId || sess.d;
  }

  let res;
  if (op === 'activate') res = await doActivate(env.DB, kh, deviceId, body.label, body.evict);
  else if (op === 'verify') res = await doVerify(env.DB, kh, deviceId);
  else if (op === 'release') res = await doRelease(env.DB, kh, deviceId, body.removeId);
  else res = { data: { ok: true, ...(await getView(env.DB, kh)) }, status: 200 };   // status

  if (op === 'activate' && res.status === 200 && res.data.ok) res.data.token = await signSession(secret, kh, deviceId);
  return json(res.data, res.status);
}

/* ---------------- entrypoint ---------------- */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // Defense in depth: never serve build/secret material even if asset filtering is misconfigured.
    if (/^\/(keys|scripts)(\/|$)/.test(pathname) || pathname === '/wrangler.toml' || pathname === '/_worker.js')
      return json({ error: 'not found' }, 404);

    if (pathname === '/api/health') {
      if (request.method === 'OPTIONS') return preflight();
      // Granular flags so the login screen (and you) can see exactly which setup step is missing.
      return json({ ok: true, key: !!env.NVIDIA_API_KEY, licensing: !!(env.LICENSE_SECRET && env.DB), secret: !!env.LICENSE_SECRET, db: !!env.DB });
    }

    if (pathname === '/api/auth/activate') return handleAuth(request, env, 'activate');
    if (pathname === '/api/auth/verify') return handleAuth(request, env, 'verify');
    if (pathname === '/api/auth/release') return handleAuth(request, env, 'release');
    if (pathname === '/api/auth/status') return handleAuth(request, env, 'status');

    if (pathname === '/api/v1/chat/completions') {
      if (request.method === 'OPTIONS') return preflight();
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      const KEY = env.NVIDIA_API_KEY;
      if (!KEY) return json({ error: 'NVIDIA_API_KEY is not set on this Worker.' }, 500);
      try {
        const body = await request.text();
        const upstream = await fetch(UPSTREAM, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
          body,
        });
        const text = await upstream.text();
        return new Response(text, { status: upstream.status, headers: { 'Content-Type': 'application/json', ...cors } });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 502);
      }
    }

    return env.ASSETS.fetch(request);   // static site
  },
};
