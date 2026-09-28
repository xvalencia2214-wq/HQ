# Bella's Música

A marketplace for booking live Mexican music (mariachi, banda, norteño, trío, grupera, conjunto, DJ).
Customers search by event, date, guests, ZIP and even a song, see who is free, pay a deposit and message the group.
Groups list themselves, set prices, packages, songs, photos, video and open dates, and accept or decline requests.
English and Spanish. Cream / gold / black theme.

**No dependencies.** Node 22.13+ only (built-in SQLite). Nothing to `npm install`.

```bash
npm start          # http://localhost:3000  (test mode: no keys needed)
npm test           # 48 tests: API, money, Stripe/Twilio against fakes, random stress test, time zones, i18n, share pages, ops
# Browser scripts (need Playwright + Chromium; run with NODE_PATH=$(npm root -g)):
node e2e/e2e.mjs [dir]                     # 46-step end-to-end run: manager sets up, customer books, chats, cancels, admin
node e2e/qa.mjs <dir>                      # seeds a realistic marketplace and screenshots every screen (iPad + phone)
AXE=/path/axe.min.js node e2e/a11y.mjs     # accessibility audit (axe-core, WCAG 2.2 AA) of every screen
```

In test mode payments and texts are **simulated** (a banner says so), and fictional sample groups fill the search.

## What's in it

| Area | What it does |
| --- | --- |
| Search | Event, date (only groups free that day), guests, song (accent-insensitive), type, price, distance; full US ZIP database (42k ZIPs); list or map; featured groups first; "Best of your city" pages |
| Group page | Photos, YouTube/Vimeo video, facts, songs (searchable), packages, reviews, calendar, live quote, deposit and cancellation policy shown before paying, chat, share + WhatsApp |
| Booking | Server-priced (packages, hourly, travel fee), slot held 30 min while paying, no double-booking, deposit via Stripe Connect, group accepts/declines, refunds by policy |
| Privacy | Phone numbers and emails are masked in chat and hidden until a booking is confirmed; texts come from the platform number |
| Reviews | Only after the event, only from a paid, confirmed booking, once |
| Groups | Dashboard: requests, calendar, listing, packages and songs, photos and video, payouts, paid featuring, messages |
| Accounts | Sign-up, login, sessions, password change, self-serve account deletion (anonymizes, keeps payment records), English/Spanish, optional text alerts (opt-in) |
| Inbox | Customers see every conversation in one place; unread badges for customers and managers |
| Calendar | "Add to calendar" (.ics) for customers and groups |
| Launch checklist | Tells a new group exactly what's missing (photos, video, story, songs, package, dates, payouts, text alerts) |
| Sharing | `/g/<id>` links show a photo card in WhatsApp/iMessage/Facebook (Open Graph), plus robots.txt, sitemap.xml, home-screen icon |
| Owner page | `#/admin` for you: fees kept, deposits, refunds, users, groups; hide a group, comp a featured spot, reset a password; every action is logged |

## Money model

- The customer pays a **deposit** (group sets 20–50% of the total) at booking time. The rest is paid to the group directly.
- **Your fee** is `PLATFORM_FEE_PCT` (default 10%) of the booking **total**, taken out of the deposit; the rest of the deposit is transferred to the group's Stripe account. Example: $600 booking, 25% deposit = $150 charged, $60 is your fee, $90 goes to the group.
- Refunds reverse the transfer and refund your fee too. Group declines or cancels = full refund. Customer cancels = by the group's policy (Flexible / Moderate / Strict, see `server/pricing.js`).
- Featured placement (or a free one you grant from the owner page) is a separate $49 (`FEATURE_PRICE_CENTS`) charge for 30 days.
- All amounts are computed on the server; nothing the browser sends can change a price.

## Going live checklist

You do these once; I could not do them for you because they need your accounts.

1. **Host it** (any host that runs Docker or Node 22 with a persistent disk). `Dockerfile` and `render.yaml` are included. Put the site on **HTTPS** and set `BASE_URL` to that address, set `SESSION_SECRET` (`openssl rand -hex 32`) and `TRUST_PROXY=1` behind a proxy. Copy `.env.example` for the full list.
2. **Stripe**
   1. Create a Stripe account, turn on **Connect** (Express accounts) and fill in the platform profile.
   2. Put the **test-mode** secret key in `STRIPE_SECRET_KEY` first. Create a webhook endpoint `https://YOUR-DOMAIN/api/stripe/webhook` for events `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
   3. Run a full booking with Stripe test cards (`4242 4242 4242 4242`), including accept, decline and cancel, and check the refunds in the Stripe dashboard. Then switch to live keys.
   4. In live mode, groups must finish Stripe onboarding (Dashboard, Payments tab) before they can take deposits; the fictional sample groups can't be booked.
3. **Texts (optional)**: get a Twilio number, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. US carriers require **A2P 10DLC registration** for business texting, and they will look at your Terms/Privacy pages. Users only get texts if they opt in.
4. **Legal**: `public/terms.html` and `public/privacy.html` are **templates**. Fill in the brackets and have a lawyer review them. Also ask an accountant about sales/payments reporting for a marketplace, and consider whether groups need insurance or licenses.
5. **Real groups**: set `DEMO_SEED=0` when you have enough real listings to remove the fictional samples.
6. **Backups**: back up `DATA_DIR` (database and `uploads/`). `npm run backup -- /path/copy.db` makes a safe copy while the server is running.

## Owner page

Set `ADMIN_EMAILS=you@example.com` (comma-separated) and log in with that email; an **Admin** link appears in the top bar. Everyone else gets a plain "not found".
It shows fees kept, deposits collected and refunded, booking counts, users, and groups. In test mode the numbers come from simulated payments and say so.

## Operating it

```bash
npm run admin -- reset-password someone@example.com   # there is no email service, so this is how you help locked-out users
npm run admin -- stats                                  # users, groups, bookings, deposits, fees
```

## Security notes

- Passwords: scrypt with per-user salt. Sessions: random 256-bit tokens, stored hashed, `HttpOnly; SameSite=Lax; Secure` (on HTTPS).
- CSRF: SameSite cookies + Origin check + JSON-only bodies. Strict CSP (no inline scripts), HSTS, nosniff.
- Stripe webhooks are signature-verified (with timestamp tolerance), deduplicated, and amount-checked. Refund and payment changes are serialized per booking and idempotent, including payments that arrive after a slot hold expired.
- Uploads are validated by file signature (JPG/PNG/WebP only), renamed, size-limited. Video links are limited to YouTube and Vimeo and embedded from our own template.
- Rate limits on login, sign-up, chat, uploads and bookings. SQL is parameterized.

## Known limits (be honest with yourself about these)

- **Not verified against live Stripe or Twilio.** They are tested against fakes that check the exact requests this code sends. Test with Stripe test mode before real money.
- **No email**: no password-reset email, no email verification, no booking emails (texts only, opt-in). Adding an email provider is the next infrastructure step.
- One server process with SQLite: fine for a few thousand bookings, and it keeps rate limits in memory. Search takes ~30 ms with 3,000 groups and ~70-130 ms with 20,000. Move to Postgres and shared limits before serious scale.
- US only (ZIP codes, US phone numbers). Group-authored text (stories, song names) is not translated.
- Groups aren't vetted. Decide how you'll verify groups and handle no-shows and disputes before promoting it.
- Search loads the groups in the ZIP codes inside the radius: fine for tens of thousands of listings, not millions.

## Layout

```
server/   Node server, routes, pricing rules, Stripe/Twilio clients, seed data, ZIP table
public/   the website (ES modules, no build step), Leaflet map vendored under vendor/
test/     node:test suites (npm test)      e2e/  browser end-to-end test
```
