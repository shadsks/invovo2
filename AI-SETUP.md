# Invoice Studio — AI features setup

All AI features are powered by free NVIDIA NIM models and share **three model roles** you configure in *Settings → AI features*: **vision** (image reading), **followup** (message/text drafting), and **scope** (request checking). Each feature below reuses one of those three roles — there is nothing extra to configure.

The app has no local component and no proxy URL to set. It calls the same-origin `/api` endpoint, which is a serverless function that adds your NVIDIA key (kept in a Cloudflare environment variable) and forwards the request. Your key is never in the app or the browser.

**Vision (screenshot/photo reading)**
1. **Payment-screenshot reader** — read a GCash/Maya "paid na po" screenshot and auto-fill the reference, amount, and method. In *Record payment*, installment payments, and split-payer shares.
2. **Supplier-receipt reader** — on a project's *Pass-Through Costs* card, **Scan receipt (AI)** reads a vendor/expense receipt and pre-fills the description, category, and cost.

**Drafting (followup role)**
3. **Register-matched follow-up draft** — in *Compose & send the ask*, **AI draft** writes the message in the client's own Taglish/formality.
4. **Tone check** — in the composer, **Tone check** flags a hostile/unclear message and offers a softer, still-firm rewrite.
5. **Escalating reminder ladder** — on an overdue invoice, **AI: draft all 4 reminders** writes friendly → firm → files-locked → formal versions in one go.
6. **AI quote / proposal** — on the Action Center, **AI quote** turns a short brief into an itemized PHP proposal with PH-appropriate terms.
7. **Cash-flow explainer** — on *Insights → Cash-flow forecast*, **Explain** narrates which months are thin/strong and what to do this week.
8. **Discount ("pa-tawad") coach** — on *Change Orders*, **Handle a discount request** returns reply options that trade scope, not price.
9. **Reschedule / typhoon message** — on *Weather Reschedule*, **AI reschedule message** drafts the empathetic-but-clear move message.
10. **Onboarding setup** — in *Settings → Business profile*, **Describe your studio (AI)** suggests business name, terms, reservation %, and revision policy.
11. **Review & testimonial co-writer** — on a delivered/paid project's *Review & Referral* card, **AI review & testimonial** drafts the ask plus a testimonial the client can edit.

**Request checking (scope role)**
12. **Scope-creep / request checker** — on *Change Orders*, **Check a request** decides in-scope vs. billable, with a ready reply and one-tap change order.
13. **Closeout check** — in a project header, **AI closeout** lists everything still unbilled/uncollected before you mark it delivered.
14. **Payment-risk briefing** — on *Insights → Client payment-risk*, **AI briefing** turns payment history into who-to-watch and concrete terms advice.

Every text draft also runs through a shared voice layer (warm, concise, no em dashes or filler, never invents amounts or dates), so messages read like a real Filipino freelancer wrote them.

## Model ids

Settings ships with fast, verified defaults. If a feature returns a **404**, the slug is wrong — copy the exact id from the model's page on build.nvidia.com (format `vendor/model`) into the matching field in **Settings → AI features**:

| Role | Default slug | Swap for any… |
|---|---|---|
| Screenshot reader (vision) | `nvidia/nemotron-nano-12b-v2-vl` | vision-language model |
| AI message drafts (followup) | `meta/llama-3.3-70b-instruct` | strong multilingual LLM |
| Request / scope checker (scope) | `meta/llama-3.3-70b-instruct` | strong multilingual LLM |

> Speed note: the request checker used to default to a 49B *reasoning* model (`nvidia/llama-3.3-nemotron-super-49b-v1`). Its hidden thinking tokens made every call very slow, so it now uses the same fast instruct model as drafting. Old saved settings are migrated automatically. Want even faster? Drop the followup/scope fields to a small model like `meta/llama-3.1-8b-instruct`; want higher quality? any larger instruct model works.

## One-time setup (Cloudflare Pages — 100% free)

Cloudflare Pages is free, and both environment variables and serverless functions are free. The AI function is a single **`_worker.js`** at the project root ("Advanced Mode") that handles `/api/health` + `/api/v1/chat/completions` and serves everything else as static files.

1. **Get an NVIDIA API key** at <https://build.nvidia.com> → sign in → open any model → *Get API Key*. It looks like `nvapi-...`.
2. **Deploy with Wrangler** from the project folder (this is what activates the function — the dashboard "Upload assets" drag-and-drop only serves static files and will 404 on `/api/*`):
   ```
   npx wrangler login                     # opens a browser; authorize (free account)
   npx wrangler pages deploy .            # pick your project (keeps the URL) or create one
   ```
3. **Give it the key** (free), then redeploy so it applies:
   ```
   npx wrangler pages secret put NVIDIA_API_KEY --project-name <your-project>   # paste your nvapi-... key
   npx wrangler pages deploy . --project-name <your-project>
   ```
   (Or set `NVIDIA_API_KEY` in the dashboard → project → *Settings → Variables and Secrets*, then re-run `wrangler pages deploy .`.)
4. **Turn AI on:** open your `*.pages.dev` URL → **Settings → AI features** → tick *Enable AI features* → **Test connection** (green = key found) → **Save AI settings**.

### Or connect Git (also activates the function)
Push this folder to a GitHub repo → Cloudflare **Workers & Pages → Create → Pages → Connect to Git** → select the repo → Framework preset **None**, no build command, output dir `/` → add the `NVIDIA_API_KEY` variable → Deploy.

### Verify
Visit `https://<app>.pages.dev/api/health` → expect `{"ok":true,"key":true}`. `key:false` means the variable isn't set, or you didn't redeploy after adding it.

## Vercel (optional alternative)

The repo also ships Vercel serverless functions (`api/health.js`, `api/v1/chat/completions.js`) and `vercel.json`, using the same `/api` paths. To use Vercel instead: deploy the folder (framework preset **Other**, no build), add `NVIDIA_API_KEY` in *Settings → Environment Variables*, and **Redeploy** (env vars only apply to deploys made after they're added). Env vars are free on Vercel Hobby via the CLI (`vercel env add`) or Git.

## Security notes

- The NVIDIA key exists only as a server-side environment variable/secret on your host. It is never bundled into the static files, so it cannot leak to the browser.
- Everything the AI sees (a screenshot, a chat thread, a request) is sent to NVIDIA for that one call. Don't paste anything you wouldn't send to a cloud API.
- Screenshots are downscaled in-browser before upload to stay under serverless request-size limits.
