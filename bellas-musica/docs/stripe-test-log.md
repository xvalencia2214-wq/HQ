# Stripe test-mode log

Nobody can run this for you: it needs **your** Stripe account in test mode. I could only test the money code against a fake Stripe server (the 100+ automated tests do), so the first run against the real Stripe is the real proof. Budget one hour.

Setup and the step-by-step script are in [stripe.md](stripe.md) (sections A and B). This page is how to **check the numbers** and record the result.

## 1. Know the right answer first
`npm run stripe:expect -- 600 25 moderate` prints what Stripe should show for a $600 booking with a 25% deposit and the Moderate policy (total, deposit, your fee, the group's transfer, the balance, and the refund at each number of days before the event). Change the three numbers to match whatever you book.

For $600 / 25% / Moderate it prints: deposit $150.00, your application fee $60.00, transfer to the group $90.00, balance $450.00 (no fee, all to the group), 50% back when cancelling 3 to 6 days out.

## 2. Run the script, fill in the table
Do each step of stripe.md section B. For each, compare Stripe Dashboard (test mode) with the expected number.

| # | What you did | Expected (from the calculator) | Stripe showed | OK? |
| --- | --- | --- | --- | --- |
| 1 | Group finished payout onboarding | "Payouts ready" in the dashboard | | |
| 2 | Customer paid the deposit | charge = deposit; application fee = fee; transfer = deposit − fee | | |
| 3 | Group accepted, customer paid the balance | second charge = balance; **no** fee; transfer = full balance | | |
| 4a | Cancel 10+ days out | refund = everything paid; transfers reversed; fee refunded | | |
| 4b | Cancel 4 days out (Moderate) | refund = 50% as printed by the calculator | | |
| 5a | Group declined | full refund of the deposit | | |
| 5b | Group cancelled a confirmed booking | full refund of deposit and balance | | |
| 6 | Reschedule approved | nothing charged or refunded; the date changed | | |
| 7 | Featured placement bought | one $49 charge | | |
| 8 | Declined test card `4000 0000 0000 9995` | clear message; slot freed after 30 minutes | | |
| 9 | Webhook "Resend" twice | nothing refunded or confirmed twice | | |
| 11 | Payment plan: $50, then the rest | two payments to the group, no fee on either | | |
| 12 | Padrino pays $40 from the family link, then the group cancels | each payment refunded to the card that paid it | | |
| 13 | Pay two deposits at once | one platform charge + one transfer per vendor (deposit − fee); declining one reverses its transfer | | |
| 14 | Bundle booked together | each deposit lower by the bundle's % | | |
| 10 | Show-up guarantee: no-show report, then admin Refund | everything paid is refunded; booking shows Cancelled | | |

## 3. Cross-check the Admin page
Open the Admin page. Money tiles (collected, refunded, fees kept) should equal the totals in Stripe Dashboard for the test period. If they differ by even a cent, stop and send me both numbers.

## 4. Before going live
- [ ] `npm run preflight` is all green on the real server.
- [ ] Every row above is OK.
- [ ] Switched to live keys **and** a new live webhook (live and test have different signing secrets).
- [ ] Made one real $1-style booking with your own card and your own group, then refunded it.

Date of last run: ________  Result: ________  Notes: ________
