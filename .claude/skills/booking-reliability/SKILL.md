---
name: booking-reliability
description: Use before touching anything in Bella's Música (bellas-musica/) that creates, prices, holds, pays, moves, cancels or refunds a booking — bookings, deposits, balance, payment plans, padrinos, carts/bundles, weekly series, tips, extras, check-in/no-show, held payouts, Stripe webhooks, scheduling and availability. Covers the money invariants, concurrency rules and the tests that prove them.
---

# Booking system reliability

A booking moves real money between a family, a vendor and the platform. A bug here means a double-booked quinceañera or a refund paid twice. The code is careful today; this skill keeps it that way.

## Lifecycle

`pending_payment` (30-min hold, `HOLD_SECONDS`) → paid → `requested` (vendor has `ANSWER_HOURS` = 72h, else auto-cancelled and refunded) → `confirmed` → the event → completed (`displayStatus`). It can also end as `declined`, `cancelled` or `expired`.

- Status changes: `PATCH /api/bookings/:id` in `server/routes/bookings.js`.
- Payment state and refunds: `server/shared.js` (`markBookingPaid`, `refundBooking`, `refundBalance`, `settleCartTransfer`, `releasePayoutLocked`, `strayRefund`).
- Prices: always computed on the server in `priceRequest()` + `buildQuote()` (`server/pricing.js`). The client total is never trusted.
- Free times: `server/schedule.js` (`openTimes`, `checkStart`, `assertStart`). Minute durations, capacity (crews), travel buffer, external calendar busy blocks.
- Background work: `server/jobs.js` (expiry, auto-cancel, reminders, held-payout release and retries).

## Rules that must keep holding

1. **No double booking.** Do the slot check (`assertStart`) and the `INSERT` in the same synchronous stretch, with **no `await` in between**. Node runs one request at a time between awaits, and that is what makes it atomic. Call `expirePending(db)` first so stale holds don't block.
2. **Any handler that changes money on an existing booking runs inside `withLock("booking:" + id, ...)`.** It locks in-process only, so the app must stay a single instance (see production-readiness).
3. **Refunds aim at absolute targets** ("refund until X has been returned"), never "refund X more", so a retry can't pay twice. Every Stripe call carries an idempotency key built from running totals (`refund-${id}-${cents}`, `transfer-${id}`, `reverse-${id}-${total}`).
4. **Webhooks**:
   - Verify the signature and record the `event.id` in `webhook_events`; on failure, delete the row so Stripe retries.
   - Compare `amount_total` with what we expect before marking anything paid.
   - A payment that arrives after a cancel or as a duplicate is refunded in full by `strayRefund` and written to `extra_refunds`.
5. **Policy math lives in one place**: `refundPercent`, with the `LATE_CANCEL_DAYS = 3` floor (no deposit back within 48 hours, counted in calendar days).
   - A vendor cancelling, or a request not yet accepted, refunds everything paid in the app.
   - Never duplicate this math in the client; show `refund_if_cancel_cents` from the server.
6. **Dates use the business day** (`todayStr()` in `BUSINESS_TZ`, America/Chicago), never `new Date()` on the server clock.
7. **Held payouts** (a new vendor's first `HOLD_NEW_VENDOR_EVENTS` events):
   - The deposit stays with the platform until check-in, or until `RELEASE_AFTER_DAYS` passes with no no-show report.
   - `releaseDue` decides. Never transfer outside `releasePayoutLocked`.
8. **What each side sees**:
   - The customer's phone number reaches the vendor only once the booking is confirmed.
   - Customers never see the platform fee breakdown.
9. **Every new money path gets a line in `test/invariants.js`.** The simulation checks those invariants after every step.

## Checklist for a change

- [ ] Re-read the handler for an `await` between the availability check and the write.
- [ ] Money-changing route wrapped in `withLock`; Stripe calls have idempotency keys derived from totals.
- [ ] Retrying the same request (double tap, Stripe retry, page refresh) is safe.
- [ ] The cancel / decline / no-show / reschedule paths still refund the right amount for every policy row and for the 48-hour floor.
- [ ] Cart, padrino and payment-plan bookings: refunds go back to each payer's own card, newest first.
- [ ] The customer gets a clear next step in both languages when a slot is taken (409) or a payment fails.

## Verify

```bash
cd bellas-musica
npm test                                                     # includes money, balance, reschedule, schedule, timezone, stripe, sim
SIM_STEPS=1500 SIM_SEEDS=1,2,3,4 node --test test/sim.test.js # long marketplace simulation, invariants after every step
npm run stripe:expect -- 600 25 moderate                     # the amounts Stripe should show, to check a test-mode run
NODE_PATH=$(npm root -g) node e2e/e2e.mjs                     # 48-step booking run in a real browser
NODE_PATH=$(npm root -g) node e2e/e2e11.mjs                   # carts, bundles, payment plan, padrino
```

Before going live with real cards, follow `docs/stripe.md` and record the run in `docs/stripe-test-log.md`.

## Known gaps (2026-10-14 audit, `bellas-musica/docs/improvement-plan.md`)

- No webhook for chargebacks (`charge.dispute.*`). The owner never hears about one.
- No webhook for vendors' payout accounts (`account.updated`). `stripe_ready` only refreshes when the vendor opens Payments.
- A booking can be priced for an event far outside the vendor's `travel_miles` with no extra fee, because the default travel fee is $0.
- Booking errors from the server are English-only (see bilingual-ux).
