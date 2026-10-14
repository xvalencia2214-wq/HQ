---
name: production-readiness
description: Use before deploying Bella's Música (bellas-musica/) or when changing the server, security headers, auth/sessions, uploads, rate limits, config/env vars, the Dockerfile/render.yaml, backups, alerts/Sentry, background jobs or the database schema — or when asked "is it ready to go live?". Covers the go-live gates, the single-server constraints, the security baseline and how to check them.
---

# Production readiness

The app is one Node 22 process with a built-in SQLite file on a persistent disk, deployed on Render with Docker (`render.yaml`, `bellas-musica/Dockerfile`, `start.sh`). It has no npm dependencies at runtime. That simplicity is deliberate; keep it.

## The single-server constraint

These are **in memory, per process**, so the app must run as **one instance** (Render: `numInstances: 1`, no autoscaling):

- rate limiters (`createLimiter` in `server/util.js`)
- per-booking locks (`withLock`)
- the gzip cache
- background jobs (`server/jobs.js`)
- the double-booking guarantee (check + insert with no `await` in between)

Running two copies would break the locks and run every job twice. If traffic ever needs more, scale the machine up, not out, or move locks and limits into SQLite first.

## Go-live gates

`npm run preflight` must show no `FAIL`:
- `SESSION_SECRET`, `BASE_URL` (https), `DATA_DIR`, `BUSINESS_TZ`, `STRIPE_WEBHOOK_SECRET` when Stripe is live.

Then the warnings, item by item:
- `ADMIN_EMAILS`, `ALERT_WEBHOOK_URL` and/or `SENTRY_DSN`, `BACKUP_DIR`, `SUPPORT_EMAIL`
- `BUSINESS_ADDRESS` (the law requires it in commercial email), `TRUST_PROXY=1` behind Render
- `PREVIEW_PASSWORD` removed on launch day
- `DEMO_SEED=0` once 10+ real vendors are live

Plus the human steps in `docs/go-live.md`, `docs/publish.md` and `docs/stripe.md`:
- a Stripe test-mode run logged in `docs/stripe-test-log.md`
- Twilio A2P registration (`docs/twilio-a2p.md`)
- the Resend domain verified

## Security baseline (keep it)

- **Headers** (`securityHeaders` in `server/app.js`):
  - Strict CSP, `script-src 'self'` with no inline scripts; `frame-ancestors 'none'`, `nosniff`.
  - HSTS when on https.
- **Sessions**:
  - Random 32-byte token in an `HttpOnly; SameSite=Lax; Secure` cookie, with only its SHA-256 stored.
  - All sessions cleared on a password change or reset.
- **Passwords**: scrypt; one-time tokens are hashed, single-use and burn atomically (`consumeAuthToken`).
- **Requests**:
  - CSRF: writes must be JSON, and a cross-site `Origin` is refused.
  - Rate limits on API, login, sign-up, forgot-password, chat, uploads and bookings.
- **Uploads**: content sniffed (`sniffImage`; JPG/PNG/WEBP only), and licence documents stored outside the public folder.
- **Stripe webhook**: signature verified, deduplicated by event id, amounts checked.
- **Privacy**: phones and emails masked in chat; the customer's phone reaches the vendor only after confirmation.
- **Access**: every route is covered by `test/access.test.js`. A new route must be added there.

## Checklist for a server change

- [ ] New env var: read in `server/config.js` with a safe default, added to `preflight.js` if it matters for launch, and documented in `docs/go-live.md`.
- [ ] Schema change: an `ensureColumn` / `CREATE ... IF NOT EXISTS` migration in `server/db.js` that is safe on an existing database. Never drop data.
- [ ] Indexes for any new query on a growing table (bookings, messages, reviews, photos, packages, stats).
- [ ] Errors: user mistakes throw `HttpError` with a clear message; anything else is alerted (`ctx.alert`) and returns a generic 500.
- [ ] Jobs are idempotent and safe if the server restarts halfway.
- [ ] `docker build` works and the container starts as the `node` user with `/data` writable.

## Verify

```bash
cd bellas-musica
npm test                                             # includes access audit, hostile fuzz, ops, monitoring
npm run preflight                                    # with the production env vars set
SIM_STEPS=1500 SIM_SEEDS=1,2,3,4 node --test test/sim.test.js
docker build -t bm . && docker run --rm -e TRYOUT=1 -e PREVIEW_PASSWORD=x -p 3000:3000 bm   # then GET /api/health
```

Connected tools that help (claude.ai connectors in this account):
- **Sentry**: search the errors the app sends when `SENTRY_DSN` is set.
- **Stripe**: test-mode objects, webhooks, disputes.

Vercel is also connected but does not fit this app (it needs a persistent disk and one long-running process).

## Known gaps (2026-10-14 audit, `bellas-musica/docs/improvement-plan.md`)

1. **A malformed cookie crashes every API call for that visitor.**
   - `parseCookies` calls `decodeURIComponent`, which throws on a stray `%`. The result is a 500 on `/api/*` and an alert each time.
   - Reproduced with `Cookie: _ga=100%`.
2. **Backups stay on the same disk**:
   - The nightly copies go to the same disk as the database (`/data/backups`).
   - Photos (`/data/uploads`) are covered only by Render's disk snapshots.
   - Add an off-site copy (e.g. S3/R2) and a restore drill.
3. **Stripe events not handled**: no webhook handling for `charge.dispute.*` (chargebacks) or `account.updated` (a vendor's payouts disabled).
4. **Missing indexes**: `reviews(group_id)`, `photos(group_id)`, `packages(group_id)`. Fine at launch size, but needed as listings grow.
5. **Login limiter keys**: the login limiter is keyed per IP + email, so one network can try many accounts (capped only by the general 300/min limit).
