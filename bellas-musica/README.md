# Bella's Música

**Launch market: Chicago.** Start with `docs/go-live.md`, then `docs/chicago-launch.md`.

A marketplace for booking live Mexican music (mariachi, banda, norteño, trío, grupera, conjunto, DJ).
Customers search by event, date, guests, ZIP and even a song, see who is free, pay a deposit and message the group.
Groups list themselves, set prices, packages, songs, photos, video and open dates, and accept or decline requests.
English and Spanish. Blue / white / silver / dark navy theme with a charro-hat logo.

**No dependencies.** Node 22.13+ only (built-in SQLite). Nothing to `npm install`.

```bash
npm start          # http://localhost:3000  (test mode: no keys needed)
npm test           # 95 tests: API, money, Stripe/Twilio/Resend against fakes, random stress test, hostile-input fuzzer, time zones, i18n, share pages, ops
# Browser scripts (need Playwright + Chromium; run with NODE_PATH=$(npm root -g)):
node e2e/e2e.mjs [dir]                     # 48-step end-to-end run: manager sets up and publishes, customer books, chats, cancels, admin
node e2e/e2e3.mjs [dir]                    # 14-step run of the Discover feed (video mounting, promoted slots, counters, reduced motion, desktop)
node e2e/e2e4.mjs [dir]                    # 15-step run of the show-up guarantee and the agreement
node e2e/e2e5.mjs [dir]                    # 22-step run of saved groups, shortlists, neighborhood landing pages, TikTok/Instagram clips
node e2e/e2e2.mjs [dir]                    # 42-step run of the launch features: password reset, Chicago page, waitlist, invite/claim, balance, reschedule, offers, replies, badges
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
| Owner page | `#/admin` for you: fees kept, deposits, refunds, funnel, top searched ZIPs, waitlist by city (+CSV), health (email, alerts, backups); invite a group with a private claim link, mark groups Verified/Insured, hide, comp a featured spot, reset a password; every action is logged |
| Discover | `#/discover`: a swipe feed of nearby groups' short clips (links to a YouTube Short, Vimeo, TikTok or Instagram Reel the group already posted), one at a time, muted until tapped (sound control works for YouTube and Vimeo; TikTok and Instagram show their own controls), with Message and Profile & book. Groups that bought Featured get every 4th slot, labelled **Promoted**; everyone else still appears. Groups see feed views and taps on their dashboard |
| Saved groups | A heart on every card, profile and Discover reel; `#/saved` lists them and makes a **shortlist link** (a read-only snapshot with the sharer's first name only) to send a partner or family chat; links can be revoked |
| Landing pages | `/chicago/<neighborhood>` and `/chicago/<neighborhood>/<event>`: server-rendered pages for searches like "mariachi for a quinceañera in Pilsen", listing the **real** (non-sample) live groups within 20 miles with prices and structured data. A page with no real group behind it is served but `noindex` and left out of the sitemap. Inside the app they open the matching search |
| Show-up guarantee | Arrival code for the customer on the event day, group check-in, no-show reports for 3 days, admin review queue with a one-click full refund (deposit and balance, payout reversed) |
| Agreement | Printable one-page booking agreement for either side (`#/agreement/<id>`) |
| Chicago | `#/chicago` landing page (neighborhood quick-picks, how it works, FAQ, top groups), launch-market waitlist for other cities, Chicagoland sample groups |
| Publishing | New listings are drafts; the group sees exactly what is missing (photo, story, events, an open date, payouts in live mode) and publishes or pauses with one tap |
| Balance | Customer can pay the rest in the app (no fee on it); groups can mark it received in cash/Zelle; refunds cover both payments by policy |
| Rescheduling | Customer asks for another date (max 2 times, 3+ days out), the requested slot is held, the group approves or declines; price and deposit don't change |
| Offers | Customers can send a one-tap quote request; the group replies with a private custom-priced offer only that customer can book |
| Trust | Public replies to reviews, admin-granted Verified/Insured badges, "usually replies within..." computed from real message times |
| Email | Password reset, email confirmation, booking/message/reminder emails (English/Spanish), unsubscribe links; simulated without a Resend key |

## Money model

- The customer pays a **deposit** (group sets 20–50% of the total) at booking time. The rest (the balance) is paid to the group at the event, or in the app by the customer (no fee on it), or recorded by the group as received offline.
- **Your fee** is `PLATFORM_FEE_PCT` (default 10%) of the booking **total**, taken out of the deposit; the rest of the deposit is transferred to the group's Stripe account. Example: $600 booking, 25% deposit = $150 charged, $60 is your fee, $90 goes to the group.
- Refunds reverse the transfer and refund your fee too. Group declines or cancels = full refund. Customer cancels = by the group's policy (Flexible / Moderate / Strict, see `server/pricing.js`).
- Featured placement (or a free one you grant from the owner page) is a separate $49 (`FEATURE_PRICE_CENTS`) charge for 30 days.
- All amounts are computed on the server; nothing the browser sends can change a price.

## Going live checklist

You do these once; I could not do them for you because they need your accounts.

1. **Host it** (any host that runs Docker or Node 22 with a persistent disk). `Dockerfile` and `render.yaml` are included. Put the site on **HTTPS** and set `BASE_URL` to that address, set `SESSION_SECRET` (`openssl rand -hex 32`) and `TRUST_PROXY=1` behind a proxy. Copy `.env.example` for the full list.
2. **Stripe** (full script in `docs/stripe.md`)
   1. Create a Stripe account, turn on **Connect** (Express accounts) and fill in the platform profile.
   2. Put the **test-mode** secret key in `STRIPE_SECRET_KEY` first. Create a webhook endpoint `https://YOUR-DOMAIN/api/stripe/webhook` for events `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
   3. Run a full booking with Stripe test cards (`4242 4242 4242 4242`), including accept, decline and cancel, and check the refunds in the Stripe dashboard. Then switch to live keys.
   4. In live mode, groups must finish Stripe onboarding (Dashboard, Payments tab) before they can take deposits; the fictional sample groups can't be booked.
3. **Email**: `docs/go-live.md` step 2 (Resend). Without it, password reset and confirmations only go to a log.
3. **Texts (optional)**: `docs/twilio-a2p.md` has the carrier-registration kit. Users only get texts if they opt in.
4. **Legal**: `public/terms.html` and `public/privacy.html` are **templates**. Fill in the brackets and have a lawyer review them. Also ask an accountant about sales/payments reporting for a marketplace, and consider whether groups need insurance or licenses.
5. **Real groups**: set `DEMO_SEED=0` when you have enough real listings to remove the fictional samples.
6. **Backups**: back up `DATA_DIR` (database and `uploads/`). `npm run backup -- /path/copy.db` makes a safe copy while the server is running.

## Owner page

Set `ADMIN_EMAILS=you@example.com` (comma-separated) and log in with that email; an **Admin** link appears in the top bar. Everyone else gets a plain "not found".
It shows fees kept, deposits collected and refunded, booking counts, users, and groups. In test mode the numbers come from simulated payments and say so.

## Operating it

```bash
npm run admin -- reset-password someone@example.com   # for people who can't use the emailed reset link
npm run preflight                                       # checks every setting and calls Stripe/Resend/Twilio
npm run admin -- stats                                  # users, groups, bookings, deposits, fees
```

## Security notes

- Passwords: scrypt with per-user salt. Sessions: random 256-bit tokens, stored hashed, `HttpOnly; SameSite=Lax; Secure` (on HTTPS).
- CSRF: SameSite cookies + Origin check + JSON-only bodies. Strict CSP (no inline scripts), HSTS, nosniff.
- Stripe webhooks are signature-verified (with timestamp tolerance), deduplicated, and amount-checked. Refund and payment changes are serialized per booking and idempotent, including payments that arrive after a slot hold expired.
- Uploads are validated by file signature (JPG/PNG/WebP only), renamed, size-limited. Video links are limited to YouTube, Vimeo, TikTok and Instagram; only the id is stored and the embed address is built by us. (Tested against stand-in players only: check a real TikTok and a real Reel on your own site. Instagram embeds sometimes ask visitors to log in, and a private account's clips won't embed at all.)
- Rate limits on login, sign-up, chat, uploads and bookings. SQL is parameterized.

## Known limits (be honest with yourself about these)

- **Not verified against live Stripe or Twilio.** They are tested against fakes that check the exact requests this code sends. Test with Stripe test mode before real money.
- **Not verified against live Resend** either (tested against a fake). Send yourself every email type before launch.
- Texts need US carrier registration (A2P 10DLC) before real use; email is the primary channel.
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
