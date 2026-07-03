# Licensing & deployment — how the serial-key login works and why it's secure

Invoice Studio ships as a **licensed SaaS**: a customer enters a serial key, it binds to their device, and
the app unlocks. One key works on **at most 2 devices**, shared by the web app and the installable app.

This document is the thing to verify. It covers (1) how to deploy — drag-and-drop, no CLI required — (2)
exactly how enforcement works, and (3) the security properties and honest limits.

---

## 1. Deploy — Cloudflare dashboard, drag-and-drop, no CLI

The whole `invoice-studio` folder is deployable straight from the Cloudflare dashboard: no terminal, no
`wrangler`. The one piece of infrastructure the licensing needs — a small D1 database — is also 100%
dashboard-clickable (create it, run its schema, bind it, all in the browser). A `wrangler`/CLI alternative
is given at the end for anyone who prefers it, but it's optional.

**a) Generate your keys, once, locally** (this step needs Node, but produces plain text files — nothing
Cloudflare-specific):
```
node scripts/genkeys.mjs 100
```
This writes `keys/LICENSE_SECRET.txt` (the HMAC secret — **never commit or upload this file**) and
`keys/serial-keys.txt` (the 100-key handout list). `.assetsignore` already keeps the whole `keys/` folder
out of the public upload.

**b) Create the D1 database** — Cloudflare dashboard → Workers & Pages → **D1 SQL Database** → Create
database → name it (e.g. `invoice-studio-licensing`) → Create.

**c) Run the schema** — open the new database → **Console** tab → paste the contents of
`scripts/schema.sql` → run. This creates the two tables the device binding needs. (Re-running it later is
harmless — the schema uses `IF NOT EXISTS`.)

**d) Drag-and-drop the site** — Cloudflare dashboard → Workers & Pages → **Create** → **Pages** → **Upload
assets** → drag the `invoice-studio` folder in (or a zip of its contents) → deploy. This serves the static
site and activates `_worker.js` (Cloudflare's "Advanced Mode," which drag-and-drop deployments do support).

**e) Bind the database** — on the new Pages project → **Settings → Functions → D1 database bindings** →
Add binding → variable name **`DB`** → select the database from step (b) → Save (add it for both
Production and Preview). Redeploy (re-run step d, or use "Retry deployment") so the binding takes effect.

**f) Set the secrets** — same project → **Settings → Variables and Secrets** → add:
- `LICENSE_SECRET` — paste the value from `keys/LICENSE_SECRET.txt` (Encrypt it)
- `NVIDIA_API_KEY` — optional, enables the smart features (see `AI-SETUP.md`)

Redeploy once more to pick up the secrets.

**g) Verify** — visit `https://<your-app>.pages.dev/api/health` → expect
`{"ok":true,"key":true,"licensing":true}`. `licensing:false` means the secret or the `DB` binding isn't set
yet, or the redeploy hasn't happened.

Local development runs in **preview mode** (on `file://` or `localhost`) — the app opens without the gate so
you can build. The gate is only active on a real deployed origin.

### Optional: CLI alternative

Everything above can also be driven from `wrangler`, if you prefer:
```
cd invoice-studio
npx wrangler d1 create invoice-studio-licensing     # paste the printed database_id into wrangler.toml
npx wrangler d1 execute invoice-studio-licensing --remote --file=scripts/schema.sql
npx wrangler secret put LICENSE_SECRET              # paste keys/LICENSE_SECRET.txt
npx wrangler secret put NVIDIA_API_KEY              # optional
npx wrangler deploy
```
`wrangler.toml` is read only by these CLI commands — dashboard/drag-and-drop deploys ignore it entirely, so
there's no conflict between the two paths.

---

## 2. Enforcement logic (the part to verify)

There are two independent checks. A key must pass **both** to unlock a device.

### a) Key authenticity — cryptographic, no database

A key is `IS-XXXX-XXXX-XXXX-XXXX-XXXX-XX`. Strip the dashes and you get 22 Crockford-base32 characters:

```
[ 16 chars: random body ][ 6 chars: checksum ]
checksum = base32( HMAC-SHA256( LICENSE_SECRET, body ) )[:6]
```

The server recomputes the checksum from the body and compares it (constant-time). **Forging a valid key
requires the secret**, which never leaves the Worker. So the server rejects fakes *without any lookup* — no
database of keys to leak, sync, or exhaust. The 100 keys we handed out are simply 100 bodies we signed; you
can mint more anytime with the same secret.

Guessing a key blind means hitting a 1-in-2^80 body **and** its matching 30-bit checksum — not feasible.

### b) Device binding — atomic, exactly 2 slots (D1, one SQL statement)

The device list lives in a **D1 database** (`devices` table, keyed by `key_hash`), not a Durable Object —
D1 is what makes the whole deployment drag-and-drop-able (Durable Object *migrations* can only ever be
created via `wrangler`, never the dashboard; D1 databases, schema, and bindings are fully dashboard-doable).

Activation is **one atomic SQL statement**:

```sql
INSERT INTO devices (key_hash, device_id, label, bound_at, last_seen)
SELECT ?1, ?2, ?3, ?4, ?4
WHERE (SELECT COUNT(*) FROM devices WHERE key_hash = ?1 AND device_id != ?2) < 2
ON CONFLICT(key_hash, device_id) DO UPDATE SET last_seen = ?4, label = ?3
```

D1 is SQLite under the hood, with a single writer per database. SQLite evaluates an entire
`INSERT…SELECT…WHERE` — including the correlated subquery that counts existing devices — against one
consistent snapshot *before* writing any row, and no other write statement can interleave in the middle of
that evaluation. So two devices activating the same key at the same instant cannot both slip past the cap,
for **every possible arrival order**, not just whichever one interleaving happens to occur. (The WHERE
clause excludes the activating device from its own count, which is what makes re-activating an
already-bound device idempotent — `ON CONFLICT … DO UPDATE` — even when the key is already at the cap.)

Verify it yourself — `node scripts/test-licensing.mjs` runs the real Worker code (imported directly, not
reimplemented) against a `node:sqlite`-backed stand-in for D1: 14 checks covering the cap, idempotent
re-activation, eviction, release semantics, forged keys, tampered tokens, revocation, and — the strongest
proof available without a live D1 instance — a 4-device race replayed across **all 24 possible arrival
orders**, asserting the cap holds in every single one.

**Self-service:** knowing the key proves ownership, so a maxed-out customer can free a slot themselves —
`activate` accepts an `evict` (a device's short id) to drop an old machine before adding the new one,
batched with the insert in one D1 transaction so no other request can steal the freed slot in between. In
the app this is **Settings → License & devices** ("Remove"), and on the login screen when the limit is hit.

**Revocation** (new, and simpler than before): a key can be blocked with a single line typed into the D1
dashboard console — `INSERT INTO revoked (key_hash, revoked_at) VALUES ('...', unixepoch())` — no code
change or redeploy needed. (`key_hash` for a given key can be read off any of its rows in the `devices`
table.)

**Trust boundary to note:** this guarantee assumes D1's documented single-writer-per-database model. Leave
**Global Read Replication off** for this database (or ensure reads route through the primary) — turning it
on would let a stale replica answer a read while a write is in flight elsewhere, which the atomicity
argument above doesn't cover.

### c) Sessions — signed, revocable

On successful activation the Worker returns a **stateless session token**:

```
sess.<base64url(JSON{ keyHash, deviceId, exp })>.<HMAC-SHA256(LICENSE_SECRET, payload)>
```

The client stores it and, on every load, calls `/api/auth/verify`, which (1) checks the HMAC and expiry —
the client cannot forge or extend it — and (2) re-checks the D1 table, so a **revoked key or a removed
device is locked out on the next load**. Offline, the client trusts its unexpired token so a paying user
isn't locked out by a dropped connection; the token expires after 30 days, forcing a re-verify.

### Endpoints

| Route | Does |
| --- | --- |
| `POST /api/auth/activate` | validate key → bind this device (or `evict` one) → return token |
| `POST /api/auth/verify` | check token signature + expiry + D1 binding, and the revoked table |
| `POST /api/auth/release` | remove a device (frees a slot) |
| `POST /api/auth/status` | list the key's devices for the Settings panel |

---

## 3. Security properties & honest limits

**Strong:**
- Secret and NVIDIA key exist only as Worker secrets — never in the bundle, never in the browser.
- Keys are unforgeable and self-validating (HMAC); no key database to breach.
- The 2-device cap is race-proof (a single atomic D1/SQLite statement), not best-effort.
- Session tokens are tamper-proof and server-revocable; constant-time compares avoid timing leaks.
- `keys/` and the secret are excluded from the public asset upload *and* hard-blocked in the Worker.
- The entire deployment — app, licensing backend, and its schema — is drag-and-drop / dashboard-only. No
  CLI dependency anywhere in the required path.

**Honest limits (and the mitigation):**
- A web "device" is a random id in `localStorage`. A determined user who clears storage looks like a new
  device — true hardware fingerprinting isn't reliable or privacy-friendly on the web. The 2-device cap plus
  self-service eviction is built to **deter casual key sharing**, which is the realistic goal for this
  market; it is not DRM against a motivated attacker.
- Rotating `LICENSE_SECRET` invalidates *all* outstanding keys — rotate only intentionally.
