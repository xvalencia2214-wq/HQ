# Stripe go-live guide

Bella's Música uses **Stripe Connect (Express)**: the customer pays a deposit; your fee stays with you and the rest is transferred to the group's own Stripe account. You never hold their money. Groups onboard from their dashboard (Payments tab).

## A. Set up the platform (once)

1. Create a Stripe account for the business. Activate it (business details, bank account).
2. Turn on **Connect** (Dashboard, Connect, Get started). Choose **Platform or marketplace**, **Express** accounts. Fill in the platform profile (name, support email, icon).
3. In Connect settings, set the branding (logo, colors) and add your Terms/Privacy links.
4. Developers, API keys: copy the **test** secret key (`sk_test_...`) into `STRIPE_SECRET_KEY`.
5. Developers, Webhooks, add endpoint `https://YOUR-DOMAIN/api/stripe/webhook` with events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
6. Redeploy. `npm run preflight` should say "Stripe key: test mode", "account reachable", and that the webhook endpoint points at your domain with the right events.

## B. The test-mode script (do all of it, with two browsers/accounts)

Use card `4242 4242 4242 4242`, any future date, any CVC. For a group to receive money in test mode, its onboarding form accepts Stripe's test data (the form has a "Use test data" shortcut).

1. **Group** signs up, creates a group, opens **Payments**, **Set up payouts**, finishes Stripe's test onboarding, returns to the dashboard and sees "Payouts ready". Publish.
2. **Customer** finds the group, books a date, pays the deposit with the test card. Check Stripe Dashboard, Payments: the charge, your application fee, and the transfer to the group's connected account.
3. Group **accepts**. Customer **pays the balance** from My bookings. Check the second charge (no fee this time).
4. **Cancel** one booking as the customer 10+ days out: full refund of everything paid, including the balance. Cancel one 4 days out under a Moderate policy: 50%. Check the refunds in Stripe, and that the transfers were **reversed** and your fee refunded.
5. Group **declines** a request: full refund. Group **cancels** a confirmed booking: full refund of both payments.
6. **Reschedule**: customer asks for another date, group approves. Nothing is charged or refunded; the date changes.
7. **Featured placement**: buy it from the Payments tab, check the $49 charge.
8. Use the declining test card `4000 0000 0000 9995` to see the failure message. A declined deposit leaves the slot held for 30 minutes, then it frees up.
9. Send the same webhook twice from the Stripe Dashboard ("Resend"): nothing should double-refund or double-confirm.

The Admin page's money tiles should match what Stripe shows (deposits collected, refunded, fees kept).

## C. Go live

1. Complete Stripe's live-mode activation. Switch the dashboard to **Live** and repeat A.4 and A.5 with **live** keys and a **live** webhook endpoint.
2. Replace `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with the live values, redeploy, run `npm run preflight`.
3. Do one real booking with your own card for the smallest package with a friendly group, accept it, then cancel it and confirm the refund arrives.
4. From now on, groups **must** finish Stripe onboarding before they can publish (the publish checklist enforces it), and the fictional samples can't be booked.

## Notes and limits

- **Not verified against live Stripe by this project's tests.** They run against a fake Stripe that checks the exact requests sent. Step B exists to close that gap. Read the first few live transactions carefully.
- Fee = `PLATFORM_FEE_PCT`% of the booking **total**, taken from the deposit (capped at the deposit). Change it with the env variable; existing bookings keep the fee they were made with.
- Stripe's own processing fees come out of the platform (you), per your account's pricing. With a 10% fee on a 25% deposit, the margin is fine; with a very small deposit it may not be. Check the numbers for your cheapest package.
- Refund failures are alerted and retried safely. If Stripe is down during a cancel, the booking is still cancelled and the refund is completed on the next attempt; the Admin page and your alert webhook show it.
- Disputes/chargebacks are handled in the Stripe Dashboard. Decide your policy in advance (see the go-live guide).
