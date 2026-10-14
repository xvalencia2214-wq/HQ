---
name: marketplace-conversion
description: Use when working on turning visitors into bookings in Bella's Música (bellas-musica/) — the welcome page, home search, category chips, vendor cards, the vendor page and booking form, sign-up timing, Get quotes, Plan a party, saved/shortlists, share links, trust signals, prices shown, and the funnel numbers on the Admin page. Also for any A/B-style or copy change meant to get more families to book bandas, grupos, catering, decorations and other vendors.
---

# Marketplace conversion optimization

The path that pays the bills:

**welcome page → search (ZIP, event, date) → card → vendor page → pick a date and time → see the price → account → pay the deposit → vendor accepts.**

Every extra step, unknown price or English-only error on that path loses families. Measure first, change one thing, measure again.

## Where it lives

| Step | Code |
| --- | --- |
| Welcome (3D sombrero, budget, real groups) | `public/js/views/landing.js`, `public/landing.css`, `tools/landing3d.js` |
| Search and cards | `public/js/views/home.js` (`home`, `groupCard`), `server/routes/search.js` |
| Vendor page and booking form | `public/js/views/group.js` (`drawBook`, `/api/quote`, `/api/bookings`) |
| Sign up / log in (with `?next=`) | `public/js/views/auth.js`, `server/routes/auth.js` |
| Get quotes (account created last) | `public/js/views/quotes.js`, `server/routes/requests.js` |
| Plan a party / saved party | `views/party.js`, `views/myparty.js`, `server/routes/parties.js` |
| Sharing (WhatsApp cards) | `server/share.js` (`/g/<id>`), `shareButtons` in `public/js/ui.js` |
| Funnel numbers | `server/stats.js`; `funnel_30d` on `GET /api/admin/summary` (`server/routes/admin.js`) |

Funnel events counted today:
- `search` (per ZIP), `group_view`, `signup`, `booking_started`, `booking_paid`, `booking_confirmed`
- `event_request`, `waitlist`, plus feed views and taps

## Principles

1. **Show the price before asking for an account.** `/api/quote` works without logging in. Gate only the payment, never the date picker or the price.
2. **Keep what the customer typed.** Event, date, guests and ZIP flow from search to the vendor page through `carry()` in `home.js`, and from the page into the booking form. Never ask twice.
3. **Trust next to the button**:
   - Real reviews, "booked here N times", badges, the response time, the deposit and cancellation policy in plain words.
   - "Apple Pay · Google Pay · Card" (`payWays()`).
4. **Never a dead end.** No results → widen the radius, clear filters, Get quotes, or the waitlist outside Chicago. A taken slot → reload the calendar and say so in the user's language.
5. **Honest paid placement.** Spotlight and Featured are labelled. Conversion gains must not come from making ads look organic.
6. **Phones first, Spanish first-class, big text.** Test at 390px wide, in Spanish, with Bigger text on.
7. **One change at a time, with a number.** Write down the funnel step you expect to move (e.g. `booking_started / group_view`) before and after.

## Checklist for a change

- [ ] Which funnel step does this move, and how will we see it (an existing `stats.count` key or a new one)?
- [ ] Still works logged out, logged in, and for a vendor looking at its own page.
- [ ] Every category, not only music: a caterer, a decorator, a venue.
- [ ] Spanish copy reviewed; no English error text on the path.
- [ ] No new layout shift or slow request on the vendor page (it already loads the listing, offers, bundle deals and the calendar month).
- [ ] e2e runs that cover the path still pass.

## Verify

```bash
cd bellas-musica
npm test
NODE_PATH=$(npm root -g) node e2e/e2e.mjs      # search → book → pay → chat → cancel
NODE_PATH=$(npm root -g) node e2e/e2e6.mjs     # Get quotes flow, account last
NODE_PATH=$(npm root -g) node e2e/e2e16.mjs    # welcome page into the app
AXE=/path/to/axe.min.js NODE_PATH=$(npm root -g) node e2e/a11y.mjs
node e2e/qa.mjs /tmp/shots                     # screenshots of every screen (iPad + phone) to eyeball
```

## Biggest opportunities (2026-10-14 audit, `bellas-musica/docs/improvement-plan.md`)

1. **The vendor page shows the calendar but hides the booking form and the price until the customer logs in** (`drawBook` in `group.js` returns the log-in box first). Let them pick a package and see the total and deposit first; ask for the account at "Pay deposit".
2. **Search shows at most 20 vendors** and has no "Show more".
3. **Missing event types**: Bautizo, Primera Comunión, Graduation, Baby shower and Funeral/Velorio, which are common reasons to hire mariachi or catering.
4. **Get quotes and the Google pages are offered only for music.** Catering, decorations and rentals miss both doors.
5. **Card prices for hourly vendors show the hourly rate**, not the real minimum (rate × minimum hours).
6. **Search appearances are not counted per vendor**, so neither the owner nor the vendor can see where families drop off.
