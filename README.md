# Invoice Studio

Billing, follow-ups, and cash-flow for **Filipino creative freelancers** (photo, video, events, design).
Ships as a licensed SaaS: serial-key login, max 2 devices per key, web app + installable app from one
deployment — drag-and-drop deployable on Cloudflare, no CLI required.

## What's in the box

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `core.js`, `views.js`, `views2.js`, `auth.js`, `actions.js` | The app — vanilla JS SPA, no build step. `auth.js` is the serial-key gate. |
| `manifest.webmanifest`, `sw.js`, `icon.svg` | PWA layer — makes the deployment installable as the app version. |
| `_worker.js` | Cloudflare Worker: serves the site, proxies NVIDIA NIM (`/api/v1/...`), and enforces licensing (`/api/auth/*`) with a D1 database per deployment (one atomic SQL statement per key, no Durable Object). |
| `wrangler.toml`, `.assetsignore` | Deploy config for CLI users; `.assetsignore` keeps `keys/` and `scripts/` out of the public upload either way. |
| `keys/` | **Git-ignored secret + generated serial keys.** `serial-keys.txt` is the 100-key handout list. |
| `scripts/` | `genkeys.mjs` (mint keys), `liclib.mjs` (key format), `schema.sql` (D1 schema — paste into the dashboard console), `test-licensing.mjs` (14-check enforcement proof). |
| `api/`, `vercel.json` | Optional Vercel functions for the AI proxy only (no licensing there). |
| `AUTH.md` | Deploy steps (drag-and-drop first, CLI optional) + the full licensing security model (read this to verify enforcement). |
| `AI-SETUP.md` | The 15 smart features and the NVIDIA key setup. |

The installable **app version** (icon assets + PWA install / Bubblewrap / Capacitor store-wrap guide) lives
in the sibling folder `../invoice-studio-app/`, one level up from this project — it shares this same
deployment and device pool, it just isn't part of the files you drag-and-drop for the web app.

## Quick start (Cloudflare dashboard, no CLI)

1. `node scripts/genkeys.mjs 100` — generates `keys/LICENSE_SECRET.txt` + `keys/serial-keys.txt` locally.
2. Cloudflare dashboard → **D1 SQL Database** → Create database → open its **Console** → paste in
   `scripts/schema.sql`.
3. Cloudflare dashboard → **Workers & Pages** → Create → Pages → **Upload assets** → drag this folder in.
4. On the new project: **Settings → Functions** → bind the D1 database as `DB`. **Settings → Variables and
   Secrets** → add `LICENSE_SECRET` (from step 1) and optionally `NVIDIA_API_KEY`. Redeploy.

Full click-by-click steps (and a `wrangler` CLI alternative) are in `AUTH.md`.

Open the deployed URL → enter a key from `keys/serial-keys.txt` → the device binds (2 max per key,
managed in **Settings → License & devices**). Install it from the browser's address bar for the app
version — the install shares the same key and device pool.

Local dev: open `index.html` directly or serve on `localhost` — that runs in preview mode with no
license gate.

## Verify it

```
node scripts/test-licensing.mjs    # 14 checks: cap, eviction, release, revoke, forgery, tampering, 24-way race
```

## Feature highlights

- **Action Center** — every peso you're owed (overdue invoices, unbilled overtime/rush/revisions,
  installments, split payments, crew payouts) surfaced with one-tap actions.
- **PH-first billing** — GCash/Maya/InstaPay details + QR on every invoice, "paid na po" screenshot
  reconciliation, Messenger/Viber/SMS send links, hulugan installment plans with file gating.
- **BIR tax estimator** — 8% vs graduated+OSD comparison from your actual paid invoices, a
  set-aside-per-₱100 guide, and 1701Q deadline reminders in the Action Center.
- **15 smart features** — screenshot/receipt readers, register-matched drafts, reminder ladders,
  scope-creep checks, risk briefings (NVIDIA NIM via the Worker; key never touches the browser).
- **Clean print** — invoices print as a white, premium document in light or dark mode.
