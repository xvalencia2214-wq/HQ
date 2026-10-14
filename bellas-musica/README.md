# Bella's Música

**Launch market: Chicago.** **To put it online: `docs/publish.md`** (plain steps, no commands). **App stores: `docs/app-stores.md`.** New visitors land on the welcome page (`#/welcome`); after editing `tools/landing3d.js` run `npm install && npm run build:landing`. Then `docs/go-live.md` and `docs/chicago-launch.md`. **What to improve next:** `docs/improvement-plan.md` (audit of Oct 14, 2026); the rules and checks for each area are project skills in `/.claude/skills/`.

A marketplace for booking live Mexican music (mariachi, banda, norteño, trío, grupera, conjunto, DJ).
Customers search by event, date, guests, ZIP and even a song, see who is free, pay a deposit and message the group.
Groups list themselves, set prices, packages, songs, photos, video and open dates, and accept or decline requests.
English and Spanish. White and gold across the whole app, with black and navy writing (Bricolage Grotesque type), matching the 3D welcome page, with a navy sombrero logo seen from the side (a tall crown with a dented top and a gold band, a long brim curling up at both ends, gold zigzag on the front of the brim and scallops on the back); a sidebar menu in sections and a Bigger text button.

**No dependencies.** Node 22.13+ only (built-in SQLite). Nothing to `npm install`.

```bash
npm start          # http://localhost:3000  (test mode: no keys needed)
npm run tryout     # test drive: practice accounts and a party in progress, to try every feature (docs/test-drive.md)
npm test           # 164 tests (incl. the improvement plan in test/plan.test.js and errors in Spanish in test/errors-es.test.js, the competitor features in test/winning.test.js, Spotlight and the 48-hour rule): API, money, Stripe/Twilio/Resend against fakes, random stress test, marketplace simulation, scheduling (any time, crews), vendor business tools, tips, weekly gigs, morning text, unanswered requests refunded after 3 days, an access audit of every route, phone notifications (encrypted and checked end to end), hostile-input fuzzer, time zones, i18n, share pages, ops
# Marketplace simulation: vendors of every kind, families, padrinos and the owner over weeks of simulated time (holds expire,
# events happen, reminders and background jobs run), checking the money and every page after each step. Longer runs:
SIM_STEPS=1500 SIM_SEEDS=1,2,3,4 node --test test/sim.test.js
# Browser scripts (need Playwright + Chromium; run with NODE_PATH=$(npm root -g)):
node e2e/e2e.mjs [dir]                     # 48-step end-to-end run: manager sets up and publishes, customer books, chats, cancels, admin
node e2e/e2e3.mjs [dir]                    # 14-step run of the Discover feed (video mounting, promoted slots, counters, reduced motion, desktop)
node e2e/e2e4.mjs [dir]                    # 17-step run of the show-up guarantee (incl. the check-in lock and the customer's "group arrived") and the agreement
node e2e/e2e6.mjs [dir]                    # 22-step run of Get quotes: the step-by-step flow, group offer, booking the offer, account-last, resume after refresh, no-match, Spanish
node e2e/e2e5.mjs [dir]                    # 22-step run of saved groups, shortlists, neighborhood landing pages, TikTok/Instagram clips
node e2e/e2e8.mjs [dir]                    # 26-step run of minimum hours and add-ons: a DJ sets a 3-hour minimum and adds fog/lighting/AV, a customer ticks them and the total updates, booking, agreement, Spanish
node e2e/e2e9.mjs [dir]                    # 28-step run of party vendors: a tent company lists itself, category chips, Plan a party, booking a package-only vendor, Discover by category, Spanish
node e2e/e2e10.mjs [dir]                   # 22-step run of saved parties: template, budget, weather, family link (vote + comment, no account), timeline the vendor sees, QR sign, credits page
node e2e/e2e11.mjs [dir]                   # 17-step run of money features: a bundle set up in two dashboards, one checkout with the bundle discount, a payment plan, a padrino via the family link
node e2e/e2e12.mjs [dir]                   # 18-step run of vendor tools: Pro, referral link, website page, insurance upload + admin approval, calendar sync, weather policy, WhatsApp, review photos, earnings CSV, partner-link sign-up, quotes for rentals
node e2e/e2e13.mjs [dir]                   # 23-step run of the business tools: 5 AM start and a window, crews and travel time, needs, payment link, lineup on WhatsApp, team helper, one more hour, holiday serenatas
node e2e/e2e14.mjs [dir]                   # 14-step run: weekly gigs with a discount, accept all, a tip after the party, morning text off, Spanish
node e2e/e2e15.mjs [dir]                   # 17-step run of the phone app: service worker, offline page, Get the app, notifications switch and reminder, store version without in-app purchases, manifest and store files
node e2e/e2e16.mjs [dir]                   # 18-step run of the welcome page: 3D sombrero, fanfare, budget with real prices, real groups, search into the app, cleanup, Spanish, reduce motion, phone
node e2e/e2e19.mjs [dir]                   # 41-step run of the improvement plan: price before an account (kept through sign-up), errors in Spanish, Show more, no rank on paid cards, search by name, new events, quotes for food, price steps, the vendor's Today box, seen in search, price insight, quick replies, five tabs on a phone
node e2e/e2e18.mjs [dir]                   # 34-step run of the white-and-gold look: sidebar sections, phone Menu, bigger text, Spotlight bought and shown, Apple Pay note, words per category, a draft's setup steps, Edit your page, the owner's invite link, 48-hour rule wording
node e2e/e2e17.mjs [dir]                   # 22-step run of the competitor features: founding offer, signing the agreement, a past client's review, guest list + RSVP on a phone + court of honor, held deposit notes, Spanish
node e2e/e2e2.mjs [dir]                    # 42-step run of the launch features: password reset, Chicago page, waitlist, invite/claim, balance, reschedule, offers, replies, badges
node e2e/touch.mjs                         # iPad-style touch run: real finger swipes on Discover, and a tap-target size check on the main screens
npm run spanish-sheet                      # writes docs/spanish-review.md: every screen string and email, English next to Spanish, for a native speaker to correct
npm run stripe:expect -- 600 25 moderate   # prints the amounts Stripe should show (fee, transfer, balance, refunds) to check a test-mode run against
node e2e/qa.mjs <dir>                      # seeds a realistic marketplace and screenshots every screen (iPad + phone)
AXE=/path/axe.min.js node e2e/a11y.mjs     # accessibility audit (axe-core, WCAG 2.2 AA) of every screen
```

In test mode payments and texts are **simulated** (a banner says so), and fictional sample groups fill the search.

## What's in it

| Area | What it does |
| --- | --- |
| Search | Event (incl. Bautizo, Primera Comunión, Graduación, Baby shower, Funeral / Misa), date (only groups free that day), guests, song (accent-insensitive), vendor name, type, price (steps that fit each category), distance; full US ZIP database (42k ZIPs); list or map; **Show more** (pages of 20); only vendors whose travel area reaches you (twice as far when they charge a travel fee, shown on the card); paid spots labelled and never ranked "#1": on Best match Spotlight then Featured first, on Lowest price or Closest at most 2 paid first and then the order asked for; "From" is the least it can be booked for (cheapest package, or hourly x minimum hours); "Best of your city" pages |
| Group page | Photos, YouTube/Vimeo video, facts, songs (searchable), packages, reviews, calendar, live quote, deposit and cancellation policy shown before paying, chat, share + WhatsApp. **Visitors see the whole booking form and the total before having an account**; "Continue to pay deposit" signs them up (or in) and brings them back with everything they picked |
| Booking | Server-priced (packages, hourly, travel fee), slot held 30 min while paying, no double-booking, deposit via Stripe Connect, group accepts/declines, refunds by policy |
| Privacy | Phone numbers and emails are masked in chat and hidden until a booking is confirmed; texts come from the platform number |
| Reviews | Only after the event, only from a paid, confirmed booking, once |
| Groups | Dashboard: requests, calendar, listing, packages and songs, photos and video, payouts, paid featuring, messages. A **Today** box first (requests waiting with the answer-by time, the next party, unread messages, balances to collect, held deposits); **Seen in search** next to page views, with a one-line tip; **typical prices** of the same kind of vendor within 30 miles next to the price fields; **quick replies** in English or Spanish; on a phone the nine tabs become five. Vendors are told at once if Stripe pauses their payouts |
| Accounts | Sign-up, login, sessions, password change, self-serve account deletion (anonymizes, keeps payment records), English/Spanish, optional text alerts (opt-in) |
| Inbox | Customers see every conversation in one place; unread badges for customers and managers |
| Calendar | "Add to calendar" (.ics) for customers and groups |
| Party vendors | Besides music: food (food trucks, taquizas, catering, cakes, aguas frescas), rentals (tents, tables and chairs, bounce houses, dance floors, linens), decorations (balloons, decorators, flowers, backdrops), photo and video (photographers, videographers, photo booths), staff and services (security, bartenders, MC, kids' entertainment, quinceañera choreographers, hair and makeup, clean-up) and venues (party halls, outdoor spaces). Same listings, calendar, deposits, policies, reviews, chat, add-ons and show-up guarantee. Vendors can be booked by the hour or by package only. Search has category chips (music stays the default), Discover can be filtered by category, and Get quotes and the neighborhood pages stay about music |
| Vendor tools | **Bella's Pro** (30-day pass, default $29: platform fee 6% instead of 10%, Pro badge, 20 photos). **Referrals**: each vendor has a link; when the business it invites publishes, both pay half the fee for 30 days. **Free website page** `/v/<id>` (photos, prices, extras, next open dates, reviews, rain policy; every button leads to booking). **Calendar sync**: block times from the vendor's own Google/Apple/Outlook calendar (private iCal link, re-read hourly; https only) and a private feed of bookings to add to it. **Earnings** by month with CSV. **Licenses and insurance**: upload PDF/photo (stored outside the public folder), the owner reviews them on the Admin page, approved papers show Insured/Licensed badges that disappear when they expire. **Rain policy** on the listing. **WhatsApp** alerts (optional Twilio WhatsApp number). **Review photos** (up to 3). **Get quotes** for any category. **Partner links** `?src=` (churches, dress shops) counted on the Admin page. Optional party-insurance partner link |
| Party payments | **Payment plan**: after the vendor confirms, pay the balance in parts (from $20, any time before the event). **Padrinos**: anyone with the family link (and an account) can pay toward a booked vendor; the family and the vendor see who paid; refunds go back to each payer's own card, newest payment first. **One checkout**: several unpaid holds (up to 6) paid in one payment, then each vendor gets its own transfer; refunds take back exactly the vendor's share, by running totals so retries never double. **Bundles**: vendors invite each other (by page link), and when all are booked for the same day in one checkout, each gives the bundle's discount (5–30%) |
| Beating the big sites (docs/competitors.md) | **Founding vendors**: the first 25 listings to go live pay 5% (not 10%) for 6 months (`FOUNDING_SLOTS`, `FOUNDING_FEE_PCT`, `FOUNDING_DAYS`). **Agreement signed in the app**: both sides type their name and tick "I agree"; we keep who, when, a hashed connection and a fingerprint of the terms, and a changed booking (new date or price) needs new signatures. **Past-client reviews**: a vendor sends up to 10 clients from before it joined a one-time link (email or WhatsApp); they log in and review; shown with a "Past client" label, counted in the stars, never in "events booked here"; not from the vendor's own account, team or internet connection; you can remove any from Admin. **ID checked** badge when Stripe has verified the owner's identity for payouts (live mode; we never see the ID). **Held deposits for new vendors**: for a vendor's first 3 events here (`HOLD_NEW_VENDOR_EVENTS`, 0 = off) the deposit stays with the platform until the vendor checks in with the family's code, or 4 days after the event if nobody reports a no-show, so a no-show refund never takes money back from a vendor; a vendor's own payment-link clients are never held. **Spanish search pages** `/es/chicago/<barrio>/<evento>` (boda, cumpleanos…) with hreflang links both ways and in the sitemap only when a real group stands behind them |
| Guest list and RSVPs | On a saved party: add guests one by one or paste a list ("name, people, group, phone"), send each a personal invitation on WhatsApp, or one open link for the family group chat; guests answer yes/no/maybe and how many (no account), with a note; the host sees totals, can mark answers by hand and use the "coming" count as the guest count; an invitation message and answer-by date; **court of honor and padrinos** (damas, chambelanes, padrinos de velación, anillo, última muñeca…) |
| Saved parties | `#/my-party/<id>`: budget tracker (booked, paid, still to pay, left; typical split by party type), the vendors booked for that day, a family shortlist with ♥ votes and comments through a private link (no account, no address/phone/money shown, link can be replaced), a day-of timeline (vendors linked to a row see their arrival time and get it in the day-before reminder), guest calculator (tables, chairs, tent size, tacos, aguas, security), weather from the National Weather Service in the last 7 days with a tent nudge, price guide per category, and a printable QR sign that opens a public "who made this party" page the host can turn on and off. Templates: quinceañera, wedding, birthday, baptism, backyard, graduation. Search has an "Open this week" filter |
| Plan a party | `#/party`: one date and ZIP, then who is free that day in every category, a checklist of what you still need (remembered on the device) that ticks off what you've already booked for that date |
| Minimum hours and add-ons | A group sets a minimum number of hours for booking by the hour (listed packages stay as priced). Groups can list priced extras customers tick when booking (DJs get quick-add buttons for fog machine, dance-floor lights, special lighting, visuals/video screen, audio and video setup); the total, deposit, agreement, calendar entry and the group's request list all include them |
| Launch checklist | Tells a new group exactly what's missing (photos, video, story, songs, package, dates, payouts, text alerts) |
| Sharing | `/g/<id>` links show a photo card in WhatsApp/iMessage/Facebook (Open Graph), plus robots.txt, sitemap.xml, home-screen icon |
| Owner page | `#/admin` for you: fees kept, deposits, refunds, funnel, top searched ZIPs, waitlist by city (+CSV), health (email, alerts, backups and the off-site copy); **chargebacks** with the date to answer by (from Stripe's dispute events); invite a group with a private claim link, mark groups Verified/Insured, hide, comp a featured spot, reset a password; every action is logged |
| Discover | `#/discover`: a swipe feed of nearby groups' short clips (links to a YouTube Short, Vimeo, TikTok or Instagram Reel the group already posted), one at a time, muted until tapped (sound control works for YouTube and Vimeo; TikTok and Instagram show their own controls), with Message and Profile & book. Groups that bought Featured get every 4th slot, labelled **Promoted**; everyone else still appears. Groups see feed views and taps on their dashboard |
| Get quotes | `#/quotes`: a one-question-per-screen flow (progress ring, answers kept on refresh, **account created last**) covering event, date, start time, length, ZIP, guests, group size, budget and planning stage. It goes to **at most 5 groups that can really do it** (live, claimed, free that day, play that event, fit the guest count, within 60 miles), never a blast. Groups answer in chat or with a private offer; the customer sees every reply and offer on one page and books from it. Budget skips groups far above it; start time and size only reorder. Free for both sides, 3 requests a day, phone and email never shared |
| Booked here | Each group shows how many events it has actually played through the site (confirmed, past, money not refunded). A refunded no-show doesn't count |
| Saved groups | A heart on every card, profile and Discover reel; `#/saved` lists them and makes a **shortlist link** (a read-only snapshot with the sharer's first name only) to send a partner or family chat; links can be revoked |
| Landing pages | `/chicago/<neighborhood>/catering` (also `decorations`, `rentals`, `photo-video`, `party-services`, `venues`; Spanish `/es/chicago/<barrio>/comida`, `decoracion`, `rentas`...) for every kind of party vendor. `/chicago/<neighborhood>` and `/chicago/<neighborhood>/<event>`: server-rendered pages for searches like "mariachi for a quinceañera in Pilsen", listing the **real** (non-sample) live groups within 20 miles with prices and structured data. A page with no real group behind it is served but `noindex` and left out of the sitemap. Inside the app they open the matching search |
| Show-up guarantee | Arrival code for the customer on the event day, group check-in (3 wrong codes lock it for 3 hours; the customer can confirm the arrival in their own app instead), no-show reports for 3 days, admin review queue with a one-click full refund (deposit and balance, payout reversed) |
| Agreement | Printable one-page booking agreement for either side (`#/agreement/<id>`) |
| Chicago | `#/chicago` landing page (neighborhood quick-picks, how it works, FAQ, top groups), launch-market waitlist for other cities, Chicagoland sample groups |
| Publishing | New listings are drafts; the group sees exactly what is missing (photo, story, events, an open date, payouts in live mode) and publishes or pauses with one tap |
| Balance | Customer can pay the rest in the app (no fee on it); groups can mark it received in cash/Zelle; refunds cover both payments by policy |
| Rescheduling | Customer asks for another date (max 2 times, 3+ days out), the requested slot is held, the group approves or declines; price and deposit don't change |
| Offers | Customers can send a one-tap quote request; the group replies with a private custom-priced offer only that customer can book |
| Trust | Public replies to reviews, admin-granted Verified/Insured badges, "usually replies within..." computed from real message times |
| Email | Password reset, email confirmation, booking/message/reminder emails (English/Spanish), unsubscribe links; simulated without a Resend key |
| Look and menu | White and gold with black and navy writing (welcome page, app, emails, vendor web pages); a navy charro-sombrero icon seen from the side, with gold stitching on the rolled brim (`public/logo.svg`; all the app icons, the share picture and the store banner are made from it by `node e2e/app-images.mjs --icons`). The menu is a **sidebar in sections** (Find and plan, My party, For businesses, You) with an icon and a word on each big row on wide screens, and a big **Menu** button on phones. **Bigger text** button in the menu (remembered on the device) |
| Spotlight | The paid level above Featured (default $99 for 30 days, `SPOTLIGHT_PRICE_CENTS`): first in local search (above Featured), on the home page's "In the spotlight" strip, twice the Discover turns of Featured (spread out), always labelled. Vendors pick Featured or Spotlight side by side under Payments; paid time never overlaps (Featured bought during a Spotlight starts when it ends; Featured days left move to after a new Spotlight); you can comp or clear either from the owner page |
| Words per category | A listing is a *group* (music), *food vendor*, *rental company*, *decorator*, *photographer*, *service pro* or *venue* on the search page, its own page, the booking screens and the dashboard (`{who}`/`{whos}` in the strings, set per screen with `setWho`), and each category has its own search-page heading, in English and Spanish |
| Self-serve pages | Businesses make and edit their own page: every field, photos, packages, add-ons, policies and dates are in their dashboard; a draft shows its setup as numbered steps (done ones ticked); the owner of a listing sees **Edit your page** on it. The owner page has a **sign-up link to send a business** (copy, WhatsApp, text; counted as `vendor-invite`), so you never type a business's details; "set up a page for them" is still there for those who prefer it |
| Apple Pay | Stripe's checkout shows Apple Pay and Google Pay by itself (turned on in the Stripe Dashboard, see docs/stripe.md); every pay button says "Apple Pay · Google Pay · Card" |

## Money model

- The customer pays a **deposit** (group sets 20–50% of the total) at booking time. The rest (the balance) is paid to the group at the event, or in the app by the customer (no fee on it), or recorded by the group as received offline.
- **Your fee** is `PLATFORM_FEE_PCT` (default 10%) of the booking **total**, taken out of the deposit; the rest of the deposit is transferred to the group's Stripe account. Example: $600 booking, 25% deposit = $150 charged, $60 is your fee, $90 goes to the group.
- Refunds reverse the transfer and refund your fee too. Group declines or cancels = full refund. Customer cancels = by the group's policy (Flexible / Moderate / Strict, see `server/pricing.js`). **Last-minute rule, for every policy:** a customer who cancels within 48 hours of the party (counted as the last 3 calendar days) gets no deposit back (`LATE_CANCEL_DAYS`). Before the group accepts, cancelling is always a full refund.
- Featured placement (or a free one you grant from the owner page) is a separate $49 (`FEATURE_PRICE_CENTS`) charge for 30 days; Spotlight is $99 (`SPOTLIGHT_PRICE_CENTS`).
- All amounts are computed on the server; nothing the browser sends can change a price.

## Going live checklist

You do these once; I could not do them for you because they need your accounts.

1. **Host it** (any host that runs Docker or Node 22 with a persistent disk). `Dockerfile` and `render.yaml` are included. Put the site on **HTTPS** and set `BASE_URL` to that address, set `SESSION_SECRET` (`openssl rand -hex 32`) and `TRUST_PROXY=1` behind a proxy. Copy `.env.example` for the full list.
2. **Stripe** (full script in `docs/stripe.md`; record your test run in `docs/stripe-test-log.md`)
   1. Create a Stripe account, turn on **Connect** (Express accounts) and fill in the platform profile.
   2. Put the **test-mode** secret key in `STRIPE_SECRET_KEY` first. Create a webhook endpoint `https://YOUR-DOMAIN/api/stripe/webhook` for events `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
   3. Run a full booking with Stripe test cards (`4242 4242 4242 4242`), including accept, decline and cancel, and check the refunds in the Stripe dashboard. Then switch to live keys.
   4. In live mode, groups must finish Stripe onboarding (Dashboard, Payments tab) before they can take deposits; the fictional sample groups can't be booked.
3. **Email**: `docs/go-live.md` step 2 (Resend). Without it, password reset and confirmations only go to a log.
3. **Texts (optional)**: `docs/twilio-a2p.md` has the carrier-registration kit. Users only get texts if they opt in.
4. **Legal**: `public/terms.html` and `public/privacy.html` are **templates**. Fill in the brackets and have a lawyer review them. Also ask an accountant about sales/payments reporting for a marketplace, and consider whether groups need insurance or licenses.
5. **Real groups**: set `DEMO_SEED=0` when you have enough real listings to remove the fictional samples.
6. **Three human checks**: a native Spanish speaker reads `docs/spanish-review.md`; try it on a real iPad with `docs/ipad-checklist.md`; run and record the Stripe test with `docs/stripe-test-log.md`.
7. **Backups**: turn on the **off-site copy** (`docs/publish.md`, Cloudflare R2, free): every night the database, `uploads/` and `documents/` go to a bucket elsewhere; `npm run restore -- 2026-10-14` brings a day back onto a new disk. `npm run backup -- /path/copy.db` makes a safe local copy while the server is running.
8. **Run one copy of the server** (`numInstances: 1`): bookings, rate limits and background jobs rely on it.

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
