# cogninode — managed-mode deployment runbook

The app boots in **local mode** (BYOK, no backend) when env vars are unset —
that build is what self-hosters get and what the Playwright smokes test.
**Managed mode** (Clerk sign-in, per-user OpenRouter keys, credits, sync)
switches on when `VITE_CONVEX_URL` + `VITE_CLERK_PUBLISHABLE_KEY` are set at
build time. This file is the once-per-environment setup; everything in it is
manual account work — the code is already wired.

## 1. Convex

1. `npx convex dev` (interactive — log in or pick "try without an account"
   for a local deployment). This creates the deployment, pushes `convex/`,
   regenerates `convex/_generated/`, and writes `CONVEX_DEPLOYMENT` +
   `VITE_CONVEX_URL` into `.env.local`.
2. Dashboard → Settings → Environment variables (per deployment):
   - `CLERK_JWT_ISSUER_DOMAIN` — from step 2.3
   - `CLERK_WEBHOOK_SECRET`    — from step 2.4
   - `OPENROUTER_MANAGEMENT_KEY` — from step 3
   - `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` — from step 4
   - optional overrides: `USD_PER_CREDIT` (0.0005), `STARTER_CREDITS` (100),
     `PACK_INR` (300), `PACK_CREDITS` (3000)
3. Seed + backfill (dashboard → Functions → run):
   - `tiers:seed` — plants Fast/Thinking (remap anytime by editing the
     `tiers` table — no deploy needed)
   - `models:syncCatalog` — first pricing snapshot (then daily via cron)
   - `credits:backfillStarterGrants` — only if users signed up before the
     ledger deploy
4. Ops: `admin:overview` is the operator dashboard query. Wire log streams
   (Sentry/Axiom) and alert on `[alert] reconcile drift` lines.

## 2. Clerk

1. Create the application (enable email + Google at minimum).
2. Enable **user self-deletion** (Configure → User & Authentication →
   account deletion) — Settings → Delete account calls `user.delete()`.
3. JWT template: create one named exactly `convex`. Copy the **issuer
   domain** (Frontend API URL, `https://….clerk.accounts.dev`) into
   `CLERK_JWT_ISSUER_DOMAIN`.
4. Webhook: endpoint `https://<deployment>.convex.site/clerk-users-webhook`,
   subscribe `user.created`, `user.updated`, `user.deleted`; copy the
   signing secret into `CLERK_WEBHOOK_SECRET`. (Signup works without the
   webhook too — the client calls `users.ensure` — but deletion sync and
   email updates need it.)
5. Put the **publishable key** into `.env.local` as
   `VITE_CLERK_PUBLISHABLE_KEY`.
6. Bot protection ON (starter-credit farming guard).

## 3. OpenRouter

1. Buy platform credits (the shared pool all user keys draw from — top it
   up before users can spend; 5.5% purchase fee applies).
2. openrouter.ai/settings/management-keys → create a **management key** →
   `OPENROUTER_MANAGEMENT_KEY`.
3. Recommended: a Guardrail with a cheap-model allowlist applied to new
   keys (dashboard; swap on first purchase) — limits extracted-starter-key
   abuse to cheap models.
4. **Day-1 spike (do once, first real send):** confirm the final SSE frame
   carries `usage.cost`, and send one `webSearch` message to confirm the
   ~$0.02 plugin fee is included in it. If it is NOT, nothing breaks — the
   estimated-cost fallback adds a flat surcharge — but verify which path
   you're on (message chips show "(estimated)" in the tooltip otherwise).

## 4. Razorpay  ⚠ start KYC FIRST — it's the long pole

1. Sign up as individual/sole proprietor (personal PAN, Aadhaar, bank
   account; GSTIN optional below ₹20L turnover — sign the non-enrollment
   declaration). KYC review wants the site live with terms/privacy/refund/
   contact pages → `/legal` (review its draft text first!).
2. Keys: dashboard → API keys → `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`.
3. Webhook: `https://<deployment>.convex.site/razorpay-webhook`, event
   `payment.captured`, set a secret → `RAZORPAY_WEBHOOK_SECRET`.
4. Test mode end-to-end before going live: buy the pack with a test UPI id,
   confirm credits land instantly (client confirm) AND that replaying the
   webhook doesn't double-grant.

## 5. Hosting (Vercel)

1. `vercel.json` already provides the SPA fallback and the `/hf` rewrite
   (embedding-model downloads are same-origin proxied — the dev-server
   proxy equivalent). Other hosts need an equivalent rewrite, or set
   `VITE_HF_DIRECT=1` and verify HF CORS from that origin.
2. Project env: `VITE_CONVEX_URL` (prod deployment), `VITE_CLERK_PUBLISHABLE_KEY`
   (prod instance key).
3. `npx convex deploy` for the prod backend; repeat §1.2–1.3 on prod.
4. After the domain is live: re-point the Clerk + Razorpay webhooks at the
   prod `.convex.site` URL, and switch Clerk/Razorpay to live keys.

## 6. Launch checklist

- [ ] `/legal` reviewed by a human (refund window, GST position, contact)
- [ ] Razorpay KYC approved, live keys in prod env
- [ ] OpenRouter platform credits topped up + low-balance alert set
- [ ] One real signup → starter credits visible → one Fast send → credits
      deducted → reconcile (`openrouter:reconcileMe`) shows ~zero drift
- [ ] Test purchase on live keys (₹300 → 3,000 credits, then refund it)
- [ ] Two-device sync sanity: chat created on A appears on B without reload
- [ ] GTM timing: the paid push targets the ChatGPT-Go renewal wave
      (Nov 2026 – Jan 2027); beta with student/power-user communities first
