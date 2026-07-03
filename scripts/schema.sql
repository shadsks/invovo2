-- Invoice Studio — licensing schema (Cloudflare D1).
--
-- Paste this into the D1 dashboard console once, right after creating the database
-- (Workers & Pages -> D1 -> your database -> Console), or run it via:
--   npx wrangler d1 execute invoice-studio-licensing --remote --file=scripts/schema.sql
--
-- IF NOT EXISTS makes re-pasting harmless.

CREATE TABLE IF NOT EXISTS devices (
  key_hash  TEXT NOT NULL,
  device_id TEXT NOT NULL,
  label     TEXT,
  bound_at  INTEGER,
  last_seen INTEGER,
  PRIMARY KEY (key_hash, device_id)
);

CREATE TABLE IF NOT EXISTS revoked (
  key_hash   TEXT PRIMARY KEY,
  revoked_at INTEGER
);
