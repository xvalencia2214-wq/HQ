---
name: vendor-marketplace-quality
description: Use when changing how customers find, compare or trust vendors in Bella's Música (bellas-musica/) — search, ranking, category chips, cards, vendor pages, badges, reviews, Spotlight/Featured placement, Discover, "Best of" and the /chicago landing pages — or when auditing listing quality (bandas, grupos, mariachi, catering, decorations, rentals, venues).
---

# Vendor marketplace quality

The app lives in `bellas-musica/`. It is a two-sided marketplace: families find and book vendors for Mexican-American events, and vendors run their business from it. "Quality" here means the right vendors show up, the ranking is fair and honest, and every card tells the customer the truth.

## Where it lives

| Concern | Server | Screen |
| --- | --- | --- |
| Search, ranking, cards | `server/routes/search.js` (`search()`, `card()`) | `public/js/views/home.js` (`groupCard`) |
| Categories and types | `server/pricing.js` (`CATEGORIES`, `EVENT_TYPES`, `categoryOf`) | `public/js/cats.js` |
| Public listing fields | `server/shared.js` (`publicGroup`, `groupDetail`, `LIVE_SQL`, `isLive`) | `public/js/views/group.js` |
| Ratings | `ratingMap` / `ratingOf` in `shared.js` (site reviews + past-client reviews + seed) | — |
| Paid placement | `isSpotlight`, `isPromoted`, `addPaidTime` in `shared.js`; `/api/spotlight` | Spotlight strip on home |
| Discover feed | `server/routes/feed.js` (smooth weighted round-robin) | `views/discover.js` |
| SEO pages | `server/share.js` (`renderLandingPage`, `sitemapXml`) | `/chicago/<hood>/<event>`, `/es/chicago/...` |
| Quotes matching | `server/routes/requests.js` (`matches()`, max 5 vendors) | `views/quotes.js` |

## Rules that must keep holding

1. **Only live listings are findable.** Every query that lists vendors filters with `LIVE_SQL` (published, not paused, not hidden; sample listings always live). A draft must 404 for strangers (`getVisibleGroup`).
2. **Sample listings are always labelled** (`demo` → "Sample" tag), never counted as real on SEO pages, never show response time or ID-checked, and `DEMO_SEED=0` removes them.
3. **Paid placement is always labelled.** Spotlight shows "★ Spotlight"; Featured shows "Featured"/"Promoted". Never let a paid card look like an organic ranking. The rank badge (`.rank #1`) sits on paid cards too, which needs a decision (see the plan).
4. **Trust badges come from data, never from the vendor's own say-so.** Verified/Insured come from Admin; Licensed from approved documents with an expiry; ID checked from Stripe (`/stripe/refresh`); "booked here" from `doneCount` (confirmed, past, not refunded).
5. **Reviews are only from real, paid, finished bookings** (one per booking), or past-client links that are labelled and kept out of "booked here".
6. **Category words follow the category**: `{who}`/`{whos}` via `setWho(category, screen)`. Never hard-code "group" on a screen any category can reach.
7. **Ranking stays explainable**: Spotlight → Featured → event fit → the chosen sort (Bayesian rating `bayes()`, price, distance). If you add a signal, write the reason in a comment and add a test.
8. **Search stays cheap**: candidates are cut by ZIP radius in SQL first (`zipsWithin`). Pass `ids` to `ratingMap` / `firstPhotos` when you only need a few cards.

## Checklist for a change

- [ ] Works for every category, not only music: try `category=food`, `decor`, `rentals`, `venues`.
- [ ] Spanish: every new string in both `EN` and `ES` of the right `i18n*.js` file (the i18n test fails otherwise).
- [ ] Paid and sample labels still show on cards, the vendor page and Discover.
- [ ] Hidden, paused and draft listings stay out (`test/access.test.js`, `test/publish.test.js`).
- [ ] No new per-card query inside a loop over every vendor in the radius.
- [ ] The card's "from" price is what a customer can really book (cheapest public package, or hourly × minimum hours).

## Verify

```bash
cd bellas-musica
npm test                                               # all unit tests
node --test test/look.test.js test/feed.test.js test/landing.test.js test/chicago.test.js
NODE_PATH=$(npm root -g) node e2e/e2e9.mjs              # party vendors: category chips, Discover by category
NODE_PATH=$(npm root -g) node e2e/e2e18.mjs             # Spotlight shown and labelled, words per category
```

## Rules added by the Oct 14, 2026 plan (keep them)

- **Travel range**: `reaches(g, distance)` / `reachMiles(g)` in `shared.js`. Free within `travel_miles`; with a travel fee, up to twice that (30 more at least). Used by search, Get quotes, Discover, the neighborhood pages and booking (`priceRequest` refuses past it). Cards show `travel_extra_cents`.
- **Pages**: `/api/search` returns `page`, `total`, `more`; the screen has Show more. Ranks (`.rank`) are only on unpaid cards and keep counting across pages.
- **Paid order**: on `sort=rating` all paid first (Spotlight, then Featured); on price or distance at most `PAID_ON_TOP` (2) paid first, then the order asked for.
- **"From" price**: `fromCents` is the least it can be booked for (cheapest public package, or rate × `min_hours`). Price filter and sort use it, and the price steps differ per category (`PRICE_STEPS` in `home.js`).
- **Search by name**: `q`, accents ignored; a name searches every category.
- **Events**: `EVENT_TYPES` includes Baptism, First Communion, Graduation, Baby shower, Funeral / Memorial. A new event needs `event.*` in both languages, `ES_EVENTS`, `EVENT_FIT`, and the `LANDING_EVENTS`/`_ES` slugs, plus `EVENT_NAMES` in `main.js`.
- **Category pages for Google**: `LANDING_CATS` in `share.js` (`/chicago/<hood>/catering`, `/es/chicago/<barrio>/comida`…), indexable and in the sitemap only with a real vendor; `main.js` maps the slug to `category=`.
- **Proof**: `test/plan.test.js` and `e2e/e2e19.mjs`.
