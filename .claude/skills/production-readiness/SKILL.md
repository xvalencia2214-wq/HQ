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

## Since the Oct 14, 2026 plan (keep it this way)

- **Cookies**: `parseCookies` keeps a malformed cookie's raw text instead of throwing; `test/errors-es.test.js` covers it.
- **Off-site backups** (`server/offsite.js`), set with `BACKUP_S3_URL`, `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET` and optional `BACKUP_S3_REGION`:
  - Photos and documents are sent first, then a fresh, checked database copy once a day, to any S3-compatible bucket (`offsite_files` records what went).
  - Signed with SigV4, verified against AWS's published examples in `test/plan.test.js`.
  - Failures and staleness are alerted. Status shows on the Admin page; preflight warns when it is off.
  - `npm run restore -- <day>` restores onto a new disk and keeps what was there.
- **Stripe**: chargebacks are alerted, and paused payouts are applied (see booking-reliability). Preflight warns when the endpoint lacks `charge.dispute.created`.
- **Login**: wrong passwords from one IP are limited across all accounts (`loginFails` limiter, `RATE_LOGIN_IP`, default 30 per 15 min). Correct logins don't count.
- **Indexes**: `idx_reviews_group`, `idx_photos_group`, `idx_packages_group`.
- **One instance**: `numInstances: 1` in `render.yaml`. Never scale out (see the top of this skill).

## Since Oct 15, 2026 (legal launch prep)

- **Sign-up agreement**: `/api/auth/register` refuses a new account without `agree: true` (the 18+ / Terms / Privacy box on both sign-up screens) and stores `terms_version` + `terms_at`. When `public/terms.html` or `public/privacy.html` changes, update its "(version …)" date **and** `TERMS_VERSION` in `server/routes/auth.js`; `test/ops.test.js` fails if they differ.
- **No made-up stars with real payments**: `showSampleStars(!stripe.live)` in `server/app.js`; `ratingOf` ignores `seed_rating`/`seed_reviews` then (FTC 16 CFR 465). Preflight warns while `DEMO_SEED` is on with Stripe live.
- **Security sweep**: `NODE_PATH=$(npm root -g) node e2e/xss.mjs` before every launch.
- **Lawyer and business prep**: `docs/launch-legal-prep.md`.
- **Don Chuy, the AI helper** (`server/helper.js`, `server/routes/helper.js`, `public/js/chuy.js`): Claude Opus 5.5 through `@anthropic-ai/sdk` (the only runtime npm package; the Dockerfile runs `npm ci --omit=dev`, and the app still starts without it). Keep it **read-only**: tools go through `ctx.readApi` (GET routes only, as the person asking) and the trimmers in `helper.js`; never add a tool that writes. `ANTHROPIC_API_KEY` empty = free test mode; `AI_DAILY_LIMIT_USD` caps spend; `RATE_HELPER` per hour per network and account. Tests: `test/helper.test.js` (fake Claude API), `e2e/e2e20.mjs`. A change to what he sends to Anthropic needs the Privacy Policy updated (and `TERMS_VERSION`).

