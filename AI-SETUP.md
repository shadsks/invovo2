# Invoice Studio — Smart features setup

All smart features are powered by free NVIDIA NIM models and share **three model roles**: **vision**
(image reading), **followup** (message/text drafting), and **scope** (request checking). The roles come
preconfigured with fast, verified models — there is nothing to configure beyond flipping the switch in
*Settings → Smart features*.

The app has no local component and no proxy URL to set. It calls the same-origin `/api` endpoint on the
Worker, which adds your NVIDIA key (kept in a Worker secret) and forwards the request. Your key is never
in the app or the browser.

**Vision (screenshot/photo reading)**
1. **Payment-screenshot reader** — read a GCash/Maya "paid na po" screenshot and auto-fill the reference, amount, and method. In *Record payment*, installment payments, and split-payer shares.
2. **Supplier-receipt reader** — on a project's *Pass-Through Costs* card, **Scan receipt** reads a vendor/expense receipt and pre-fills the description, category, and cost.

**Drafting (followup role)**
3. **Register-matched follow-up draft** — in *Compose & send the ask*, **Smart draft** writes the message in the client's own Taglish/formality.
4. **Tone check** — in the composer, **Tone check** flags a hostile/unclear message and offers a softer, still-firm rewrite.
5. **Escalating reminder ladder** — on an overdue invoice, **Draft all 4 reminders** writes friendly → firm → files-locked → formal versions in one go.
6. **Smart quote / proposal** — on the Action Center, **Smart quote** turns a short brief into an itemized PHP proposal with PH-appropriate terms.
7. **Cash-flow explainer** — on *Insights → Cash-flow forecast*, **Explain** narrates which months are thin/strong and what to do this week.
8. **Discount ("pa-tawad") coach** — on *Change Orders*, **Handle a discount request** returns reply options that trade scope, not price.
9. **Reschedule / typhoon message** — on *Weather Reschedule*, **Smart reschedule message** drafts the empathetic-but-clear move message.
10. **Onboarding setup** — in *Settings → Business profile*, **Describe your studio** suggests business name, terms, reservation %, and revision policy.
11. **Review & testimonial co-writer** — on a delivered/paid project's *Review & Referral* card, **Smart review & testimonial** drafts the ask plus a testimonial the client can edit.
12. **Tax read explainer** — on *Insights → BIR tax estimate*, **Explain** turns the 8%-vs-graduated numbers into plain language and a set-aside plan.

**Request checking (scope role)**
13. **Scope-creep / request checker** — on *Change Orders*, **Check a request** decides in-scope vs. billable, with a ready reply and one-tap change order.
14. **Closeout check** — in a project header, **Smart closeout** lists everything still unbilled/uncollected before you mark it delivered.
15. **Payment-risk briefing** — on *Insights → Client payment-risk*, **Smart briefing** turns payment history into who-to-watch and concrete terms advice.

Every text draft also runs through a shared voice layer (warm, concise, no em dashes or filler, never
invents amounts or dates), so messages read like a real Filipino freelancer wrote them.

## Models

| Role | Model | Why |
|---|---|---|
| Screenshot reader (vision) | `nvidia/nemotron-nano-12b-v2-vl` | small, fast vision-language model |
| Message drafts (followup) | `meta/llama-3.1-8b-instruct` | drafts come back in seconds |
| Request / scope checker (scope) | `meta/llama-3.1-8b-instruct` | same fast instruct model |

Old saves that still point at the slower 70B/49B models are migrated to the fast defaults automatically.
To experiment with other models from build.nvidia.com, edit `aiDefaults()` in `core.js` (format
`vendor/model`) — the settings panel intentionally stays simple.

## Setup

The smart features ride on the same Worker deployment as the app itself (see `AUTH.md` for the full
deploy). The only extra step is the key:

1. **Get an NVIDIA API key** at <https://build.nvidia.com> → sign in → open any model → *Get API Key*. It looks like `nvapi-...`.
2. **Set it as a Worker secret** from the project folder:
   ```
   npx wrangler secret put NVIDIA_API_KEY     # paste your nvapi-... key
   ```
3. **Turn it on:** open your deployed URL → **Settings → Smart features** → tick *Enable smart features* → **Test connection** → **Save settings**.

### Verify
Visit `https://<your-app>/api/health` → expect `{"ok":true,"key":true,...}`. `key:false` means the
secret isn't set on the Worker.

## Vercel (optional alternative for the AI proxy only)

The repo also ships Vercel serverless functions (`api/health.js`, `api/v1/chat/completions.js`) and
`vercel.json`, using the same `/api` paths. Note that the serial-key licensing (`/api/auth/*`) requires
the Cloudflare Worker's Durable Object and does not run on Vercel — Vercel is only an option for the
AI proxy in a non-licensed build.

## Security notes

- The NVIDIA key exists only as a server-side secret on your Worker. It is never bundled into the static files, so it cannot leak to the browser.
- Everything the AI sees (a screenshot, a chat thread, a request) is sent to NVIDIA for that one call. Don't paste anything you wouldn't send to a cloud API.
- Screenshots are downscaled in-browser before upload to stay under request-size limits.
