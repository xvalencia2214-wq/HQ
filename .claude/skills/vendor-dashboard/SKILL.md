---
name: vendor-dashboard
description: Use when changing what vendors (bandas, mariachis, DJs, caterers, decorators, rental and venue owners) see and do in Bella's Música (bellas-musica/) — the dashboard tabs, requests and replies, calendar and availability, profile editing, packages/add-ons, photos and video, payouts, stats, Pro/Featured/Spotlight upgrades, team helpers, payment links, morning text and alerts.
---

# Vendor dashboard improvements

Vendors are busy, often on a phone between gigs, often more at home in Spanish, and some are older. The dashboard decides how fast they answer requests. Response speed is the biggest single driver of bookings, so every change should make "see the request, answer it, get paid" faster.

## Where it lives

- **Screen**: `public/js/views/dashboard.js`.
  - Tabs: `TABS = ["requests", "calendar", "listing", "extras", "business", "media", "reviews", "payments", "messages"]`.
  - Setup steps at the top come from `setupSteps` / `missing` in `server/routes/groups.js`.
- **Vendor data**: `GET /api/groups/:id/manage` (`manageView` in `server/routes/groups.js`): stats (`stats_30d`), pending requests, unread threads, Stripe state.
- **Requests**: `GET /api/groups/:id/bookings`, then `PATCH /api/bookings/:id` (accept/decline). Each request carries `answer_by`; after `ANSWER_HOURS` (72h) it is cancelled and refunded.
- **Business tools**: `views/business.js` with `routes/paylinks.js`, `crew.js`, `team.js`, `extras.js`, `specials.js`, `series.js`, `tips.js`.
- **Permissions**:
  - `requireOwner` lets the owner or a team helper run the listing.
  - `requireRealOwner` keeps payouts, the team and paid upgrades to the owner only.
- **Alerts**: `server/notify.js` (email, text, WhatsApp, push in the vendor's language) and the morning text in `server/jobs.js`.
- **Stats**: `server/stats.js` (`count`, `total`). Today it counts `group_view`, `feed_view`, `feed_tap`, `booking_paid` and `booking_confirmed` per listing. Search appearances are counted per ZIP, not per listing.

## Rules that must keep holding

1. **A helper can never touch money settings or the team.** Use `requireRealOwner` for payouts, upgrades and team changes, and say so in a test (`test/access.test.js` audits every route).
2. **Vendors see only what they need about a customer.** Name and event details always; the phone number only after confirming; never the customer's email.
3. **The vendor edits its own listing.** The owner should never have to type vendor data. Every field a customer sees must be editable on the Profile, Packages or Media tabs.
4. **A draft can't go live half-empty.** Publishing checks `missing` (photo, story, events, an open date, payouts in live mode). Keep that list and the setup steps in sync.
5. **One tap to answer.** Accept/Decline sits on the request card itself, with the deadline in plain words ("Answer by Friday 6 PM").
6. **Big targets and plain words.** Buttons at least 44px tall (`e2e/touch.mjs` checks), `html.big` bigger-text mode respected, no jargon ("payout" → "where your money goes").

## Checklist for a change

- [ ] Try it as the owner, as a team helper and as a stranger (403/404).
- [ ] Try it on a phone width in Spanish with Bigger text on.
- [ ] Nothing a vendor must do is more than two taps from the Requests tab.
- [ ] New numbers on the dashboard come from `stats.count` events that really happen, are per listing, and cover a stated window ("last 30 days").
- [ ] New alerts go through `notify.toGroup` (all channels, the vendor's language, opt-outs respected).

## Verify

```bash
cd bellas-musica
node --test test/vendortools.test.js test/business.test.js test/access.test.js test/publish.test.js
NODE_PATH=$(npm root -g) node e2e/e2e12.mjs   # vendor tools: Pro, referral, website page, insurance, calendar sync, earnings
NODE_PATH=$(npm root -g) node e2e/e2e13.mjs   # business tools: windows, crews, payment link, lineup, team helper
NODE_PATH=$(npm root -g) node e2e/touch.mjs   # tap-target sizes on the main screens
```

## What the dashboard has since Oct 14, 2026 (keep it working)

- **Today box** (`todayBox` in `server/vendor-insights.js`, `todayCard` in `dashboard.js`): first on the Requests tab, above the checklist.
  - Requests waiting with the earliest answer-by time.
  - The next party, unread messages, balances to collect, held deposits.
- **Seen in search**: `/api/search` counts `search_seen` per listing (`stats.countMany`). It leads the tiles, with a one-line tip (`stat.tipOpen` / `stat.tipBook`).
- **Price insight** (`priceInsight`): the middle half of real, live listings of the same type within 30 miles.
  - Needs 3 or more; sample listings never count.
  - Shown on Profile and Packages.
- **Five tabs on a phone** (`TAB_GROUPS`, `.tabs-grouped`/`.tabs-sub` under 700px). The addresses (`tab=…`) are unchanged; add a new tab to both `TABS` and a group.
- **Quick replies**: `renderChat({ quick })` with `{ label, en, es }`. The vendor picks the language; the text fills the box to edit, never sent by itself.
- **Payouts paused** by Stripe: the vendor is emailed/texted (`payouts.off.group`).
- **Still to consider**: reply templates the vendor writes, and per-listing conversion over time.
