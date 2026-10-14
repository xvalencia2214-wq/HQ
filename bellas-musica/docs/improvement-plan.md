# Improvement plan (audit of 2026-10-14)

**What this is:** a review of the code as it stands (commit `bc9aa8b`), with fixes ranked by how much they help families find and book bandas, grupos, mariachis, catering, decorations and other vendors.

**Nothing in the app was changed for this audit.** The project skills in `/.claude/skills/` hold the rules and checks for each area, so future work follows the same playbook.

**Starting point:**
- All 153 automatic tests pass.
- Search answers in under 0.05 s even with 1,500 extra vendors loaded.
- The booking and money code is careful:
  - no double booking
  - refunds that can't pay twice
  - Stripe webhooks deduplicated
  - strict security headers
  - every route covered by an access audit

The list below is what is still missing or wrong.

---

## Priority 1: fix before launch (small, high impact)

| # | What | Why it matters | Area | Size |
| --- | --- | --- | --- | --- |
| 1 | **A bad browser cookie breaks the whole app for that visitor.** `parseCookies` (`server/util.js`) calls `decodeURIComponent`, which throws on a stray `%`. Every `/api/*` call then answers 500 and the owner gets an alert each time. Reproduced with `Cookie: _ga=100%`. | Another script or site on the same domain (analytics, a link shortener) can set such a cookie. That visitor can't search, log in or book, and the alerts become noise. | Bug / reliability | Tiny |
| 2 | **Errors are English-only on Spanish screens.** About 391 server messages ("That time was just taken. Please pick another.", "Pick a start time", "Enter a valid US phone number") are shown as they are. | Spanish speakers hit these at the worst moment: while paying. Start with booking, payment, sign-up and search messages: give each a code and translate it on screen, keeping English as the fallback. | Bilingual / conversion | Medium |
| 3 | **The price is hidden until the customer creates an account.** The vendor page shows the calendar, but the booking form, total, deposit and policy appear only after logging in (`drawBook` in `public/js/views/group.js`). The price endpoint (`/api/quote`) already works without an account. | "How much?" is the first question. Asking for an account before answering it loses families. Show the form and the quote to everyone; ask for the account at "Pay deposit" and return to the same date and choices. | Conversion | Small–medium |
| 4 | **Search ignores how far a vendor travels.** A vendor that serves 30 miles still appears 60 miles away. The default travel fee is $0, so the far booking costs nothing extra. | The vendor declines (refund, wasted week for the family) or drives far for free. Hide vendors beyond their range unless they set a fee for farther, and say "travel fee $X" on the card when it applies. | Marketplace quality / booking | Small |
| 5 | **No alerts for chargebacks, and payout problems go unnoticed.** Stripe's `charge.dispute.*` and `account.updated` events are not handled. "Payouts ready" refreshes only when the vendor opens their Payments tab. | With deposit payments, the platform answers for chargebacks and has days to respond. A vendor whose Stripe account gets restricted keeps showing as bookable until checkout fails. | Booking / money | Small–medium |

## Priority 2: help customers find vendors

| # | What | Why it matters | Size |
| --- | --- | --- | --- |
| 6 | **"Show more" in search.** Results stop at 20 (max 50) with no next page. | As vendors join, most become invisible on a busy search. | Small |
| 7 | **More event types**: Bautizo, Primera Comunión, Graduación, Baby shower, Funeral / Misa. Today: Wedding, Quinceañera, Birthday, Anniversary, Serenata, Corporate, Other. The party templates already know baptism and graduation; search doesn't. | These are everyday reasons to hire mariachi, catering and decorations, and families search by them. | Small |
| 8 | **Search by vendor name** ("Mariachi Los Gallos"). | Families who heard of a group at a party can't type its name. | Small |
| 9 | **Get quotes for every category.** The home page offers "Get quotes" only for music, though the server already supports food, rentals, decor and the rest. | One request to 5 caterers or decorators is the easiest way to book them. | Small |
| 10 | **Honest "from" prices and price filters per category.** Hourly vendors show the hourly rate as "From $X" even with a 3-hour minimum. The price filter offers $250–$900 for everything, including catering and venues. | Price surprises at the booking form cause drop-off; the filter is useless outside music. | Small |
| 11 | **Google pages for catering, decorations, rentals and venues** (`/chicago/<neighborhood>/catering`, plus Spanish). Today the neighborhood pages are music only. | Most families start on Google; non-music vendors get no free traffic. | Medium |
| 12 | **Fair paid placement.** Spotlight and Featured jump above everything even when the customer sorts by price or distance, and paid cards carry the "#1" rank badge. | Clearly labelled ads are fine, but "#1" on an ad and ignoring "cheapest first" erode trust. **Your decision needed:** see below. | Small |

## Priority 3: vendor dashboard

| # | What | Why it matters | Size |
| --- | --- | --- | --- |
| 13 | **A "Today" box at the top**: next gig, requests waiting with time left to answer, unread messages, money on the way. | Faster answers mean more bookings; vendors use phones between gigs. | Small–medium |
| 14 | **How many times you showed up in search**, plus a simple funnel: seen → opened → requested → confirmed. Today only page views are counted per vendor. | Tells a vendor whether the photos or the price is the problem, and is the reason to buy Spotlight. | Medium |
| 15 | **Price insight**: "Mariachis near you charge $X–$Y for 2 hours", from real public packages. | Helps new vendors price to get booked. | Small |
| 16 | **Fewer tabs on phones**: 9 tabs → Requests · Calendar · My page · Money · Messages. | Easier for older and busy vendors. | Medium |
| 17 | **Quick replies in both languages** (price, travel, song list, availability). | Faster first answers; "usually replies within an hour" shows on their page. | Small |

## Priority 4: production hardening

| # | What | Why it matters | Size |
| --- | --- | --- | --- |
| 18 | **Backups off the server.** Nightly copies go to the same disk as the database (`/data/backups`); photos rely on Render's disk snapshots. Add an off-site copy of both (e.g. Cloudflare R2 or S3) and a restore drill. | One lost or corrupted disk shouldn't be able to take every booking and photo. | Medium |
| 19 | **Database indexes** on reviews, photos and packages by vendor. | Fine at launch size; keeps search fast as reviews and photos grow. | Tiny |
| 20 | **Login limiter across accounts.** Today the limit is per network + email, so one network can try many accounts (capped only by 300 requests a minute). | Slows down password-guessing across many accounts. | Tiny |
| 21 | **Keep one server.** Locks, rate limits and background jobs live in memory. Never turn on more than one instance or autoscaling on Render; scale the machine up instead. | Two copies would break double-booking protection and run every job twice. (Already true; documented in the production-readiness skill.) | — |

---

## Decisions for you

1. **Paid placement (#12).** Recommended:
   - Keep Spotlight/Featured on top for the default "Best match".
   - When a family picks "Lowest price" or "Closest", show at most 2 labelled paid cards first, then the real order.
   - Drop the "#1, #2…" badge from paid cards.
2. **Travel range (#4).** Recommended:
   - Hide a vendor beyond its own travel miles, unless it set a fee for going farther.
   - In that case show it with "+$X travel".
3. **New event types (#7).** Recommended: Bautizo, Primera Comunión, Graduación, Baby shower, Funeral / Misa. Add or remove any.

## Suggested order

1. **Batch 1 (launch blockers): #1–#5.** About two days of work, each with its own tests and a full re-run of the test suite, simulation and browser checks.
2. **Batch 2 (find vendors): #6–#12.**
3. **Batch 3 (vendor dashboard): #13–#17.**
4. **Batch 4 (hardening): #18–#20.** These can go alongside any batch.

## Tools reviewed

- **Project skills (new):** `/.claude/skills/`
  - `vendor-marketplace-quality`
  - `booking-reliability`
  - `bilingual-ux`
  - `vendor-dashboard`
  - `marketplace-conversion`
  - `production-readiness`
- **Connected services that help:**
  - **Stripe**: test-mode runs, checking disputes and payouts.
  - **Sentry**: the app already sends errors there once `SENTRY_DSN` is set.
  - **Context7**: up-to-date library documentation.
  - **Figma** and **OpenArt**: optional, for design and pictures.
- **Not a fit:**
  - **Vercel**: the app needs one always-on server with a disk; stay on Render.
  - **Higgsfield, Interactive Brokers, MT Newswires**: not connected, and not relevant to this app.
- **Plugins:** none installed; none needed for this work.
