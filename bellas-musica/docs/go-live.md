# Go-live guide

Do these in order. Each step says what to check before moving on. Nothing here needs you to talk to anyone except the services' own sign-up forms.

## 0. Where things stand

The site runs end to end in **test mode** with no accounts: payments, texts and emails are simulated (a banner says so). "Live" means turning on real Stripe, Resend and (optionally) Twilio. Do them in the order below. You can launch with **Stripe + email only**; texting can wait.

## 1. Host it (about 30 minutes)

Any host that runs Docker, or Node 22.13+, with a **persistent disk** works. `Dockerfile` and `render.yaml` are included (Render: create a Web Service from the repo, add a 1 GB disk at `/data`).

Set these environment variables (see `.env.example` for the full list):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `BASE_URL` | your public **https** address, no trailing slash |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `DATA_DIR` | the persistent disk, e.g. `/data` |
| `TRUST_PROXY` | `1` behind Render/Fly/Railway |
| `ADMIN_EMAILS` | your email. Sign up with it, and an **Admin** link appears |
| `BUSINESS_TZ` | `America/Chicago` |
| `BACKUP_DIR` | e.g. `/data/backups` (nightly copies, verified, 14 kept) |
| `ALERT_WEBHOOK_URL` | a Slack/Discord webhook so you're told when something breaks (server errors, failed payments, and pages that crash in someone's browser) |
| `SENTRY_DSN` | optional: also send those alerts to Sentry (free tier is plenty) |

Run `npm run preflight` on the server. It checks every setting and calls Stripe/Resend/Twilio to make sure the keys work. **Fix every FAIL; read every WARN.**

Check: open your address, sign up with your `ADMIN_EMAILS` email, and confirm **Admin** shows in the top bar.

## 2. Email (Resend), about 20 minutes

Email carries password resets, booking confirmations and reminders. Without it, people who forget a password are locked out.

1. Create a Resend account, **add and verify your domain** (they show you the DNS records; wait for "Verified").
2. Create an API key. Set `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `Bella's Música <hello@yourdomain.com>`), `EMAIL_REPLY_TO`.
3. Set `BUSINESS_ADDRESS` (a real postal address; a PO box or registered-agent address is fine) and `SUPPORT_EMAIL`. US commercial email must include it, and the footer prints it.
4. Redeploy, run `npm run preflight`, then sign up with a fresh address and check the confirmation email arrives (not in spam). Try **Forgot password** end to end.

Check: the "test mode" note disappears from the Forgot-password page, and the Admin page says **Email: live**.

## 3. Stripe (the important one)

Follow `docs/stripe.md`. Do the **whole test-mode script** before touching live keys.

## 4. Texts (optional, do last)

Follow `docs/twilio-a2p.md`. Carriers need a registration that takes days to weeks to approve, so **start it early**, but launch without it. Email covers everything important.

## 5. Legal (do before real customers pay)

- `public/terms.html` and `public/privacy.html` are **templates** with `[brackets]`. Fill them in. Have a lawyer review them; a marketplace that holds deposits has real obligations.
- Ask an accountant about: sales tax on your fee, 1099-K/payment reporting (Stripe handles most of it for Connect), and whether to form an LLC first.
- Groups are independent contractors. Decide your policy on no-shows, and whether you require insurance. The **Insured** badge is only for groups whose proof you have actually seen.

## 6. Launch

1. Turn off the fictional samples only when there are **10+ real, published Chicago groups**: `DEMO_SEED=0`. Until then they keep search from looking empty; they are labelled "Sample listing".
2. Follow `docs/chicago-launch.md` to get the groups.
3. Bookmark the **Admin** page. Look at it daily: sign-ups, waitlist by city, funnel, backups, alerts.

## Daily / weekly

- Daily: Admin page. Anything in **Health** that says Off or "none yet"?
- Weekly: download the waitlist CSV, see where demand is. Check that a backup restored cleanly at least once (`npm run backup -- /tmp/test.db` then open it with `sqlite3`).
- Locked-out user with no email access: `npm run admin -- reset-password them@example.com`.

## If something breaks

The site alerts your webhook on failed payments, refunds, texts, emails and backups. Payments and refunds are idempotent and reconciled per booking, so re-running a failed action is safe. If the disk is lost, restore the latest file from `BACKUP_DIR` (copy it back as `DATA_DIR/app.db`, then restart) and re-upload nothing: photos live in `DATA_DIR/uploads`, so back that folder up too.

## Before the public sees it

Three checks only a person can do: a native Spanish speaker reads `docs/spanish-review.md` (regenerate with `npm run spanish-sheet`); someone tries the site on a real iPad with `docs/ipad-checklist.md`; and you run the Stripe test-mode script and record it in `docs/stripe-test-log.md`.
