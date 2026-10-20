# Launch and lawyer prep

Plain-language notes so you are ready for the lawyer, an accountant, vendors, or anyone else who asks how Bella's
Fiestas works. Written October 15, 2026. **This is not legal or tax advice.** It tells you what to ask and what the app
already does, so your time with professionals is well spent.

---

## 1. Where things stand

**The app is finished and tested.** In the last full round (October 15, 2026):

- 166 automatic tests pass.
- A long simulation of the marketplace passes: 6 runs × 1,500 steps with the clock moving forward, real-payment mode
  included.
- 21 browser test runs pass, covering every screen on phone, iPad and computer.
- A random-tapping stress test passes.
- A new security sweep passes: booby-trapped text was typed into every field, and 31 screens were checked as a customer,
  a vendor and the owner.
- The accessibility check passes.
- The Docker image builds and starts.

**Fixed in this round, because a lawyer would have caught them:**

1. **Sign-up now requires agreement.** People must check "I'm 18 or older and I agree to the Terms of Service and the
   Privacy Policy" to create an account, on both sign-up screens. The app records **which version** they agreed to and
   **when**. Before, nobody actually agreed to anything, which makes terms hard to enforce.
2. **No fake star ratings.** Sample listings had made-up stars, like "★ 4.9 (132)". Since October 2024 the FTC's rule
   on fake reviews (16 CFR Part 465) forbids showing made-up ratings to consumers. Fines can be over $50,000 per
   violation. Now, as soon as real payments are on, sample listings show **no stars at all**. The test drive keeps them.
3. **The Terms and Privacy pages were rewritten to match the app.** The old ones said "music groups only". They didn't
   mention tips, payment plans, padrinos, the Show-up guarantee, held payouts, texts, signed agreements, guest lists,
   past-client reviews, Pro/Featured/Spotlight, referrals, the 3% payment-link fee, the email and backup companies, or
   the uploaded license documents. A lawyer can only approve terms that describe what the app really does.
4. The yellow "draft" box on those pages was almost invisible: light text on a light background. It's fixed.
5. The launch checker (`npm run preflight`) now warns you if sample listings are still showing once real payments are
   on.

---

## 2. Fill these in before you meet the lawyer

The Terms (`public/terms.html`) and Privacy Policy (`public/privacy.html`) still have **[brackets]**. Have these
answers ready:

| Blank | What to decide |
| --- | --- |
| Business name | The legal name (e.g. "Bella's Fiestas LLC"). Form the company first (section 4). |
| Address | A real postal address. A registered-agent address or PO box works for email footers. |
| Support email | e.g. `ayuda@yourdomain.com`. It must be read every day. |
| Governing law | Probably Illinois, where you are. |
| Disputes | Small claims, arbitration, or courts? (Lawyer question #4.) |
| Fees | Already filled with the app's settings: 10% standard, 6% Pro, 5% founding, 3% payment link. Change them only if you change the settings in Render too. |
| Notice periods | 30 days before fee changes, 14 days before terms changes. Your choice. |
| Record keeping | 7 years for payment records is common for taxes. Ask the accountant. |
| DMCA agent | Your name, email and address after you register (section 4). |
| Backup storage | The company you use for off-site backups (e.g. Cloudflare R2). |

**When the pages change later:** update the date in both pages **and** `TERMS_VERSION` in `server/routes/auth.js`. A
test fails if they don't match, so you can't forget. Then everyone who signs up afterwards is recorded as agreeing to
the new version.

---

## 3. Questions for the lawyer (most important first)

The red boxes on the two pages are these same questions.

1. **Payment structure.** "We collect deposits for vendors through Stripe Connect (Express accounts) and pay them out
   minus our fee. Are we a 'limited payment collection agent' for the vendors? Does that keep us out of money-transmitter
   licensing in Illinois? Should the Terms say it in those words?"
2. **Deposits and cancellations.** "Our cancellation policies (Flexible, Moderate, Strict) and the rule that a deposit
   is kept for cancellations in the last 3 days: are they enforceable under Illinois consumer law? Do we need any
   wording for weddings and quinceañeras specifically?"
3. **Liability and insurance.** "Is the cap (the greater of the fee we earned or $100) and the vendor indemnity okay?
   Should we *require* vendors to carry general liability insurance, especially food, tents, inflatables and venues?
   What insurance do *we* need?" (See section 4.)
4. **Disputes.** "Arbitration with a class-action waiver, small claims, or courts? Where?"
5. **The Show-up guarantee.** "We decide no-show reports and can refund the customer and take back the vendor's share.
   Is our wording strong enough, and fair enough, to hold up?"
6. **Spanish.** "Many customers read only Spanish. Do we need a full Spanish translation of the Terms and Privacy
   Policy? Which version controls?" The app's buttons and messages are already in both languages. These two pages are
   English only.
7. **Texts.** "Our text consent wording (checkbox, STOP/HELP, frequency, rates): does it meet the TCPA and the carriers'
   A2P 10DLC rules?" (`docs/twilio-a2p.md` has the full kit.)
8. **Reviews.** "Vendors can invite up to 10 past clients to review them, labelled 'Past client'. Is that okay under the
   FTC review rule? Sample listings never show stars to real customers. Is labelling them 'Sample listing' enough, or
   should we hide them entirely at launch?"
9. **Anti-circumvention.** "Should we forbid customers and vendors who meet here from booking off the app to skip the
   fee? What happens if they do?"
10. **Privacy laws.** "We're in Illinois. Which state privacy laws apply as we grow, and when? We keep no biometrics
    (so Illinois BIPA shouldn't apply), and we don't sell data or use ad trackers."
11. **Trademark.** "Can we register 'Bella's Fiestas'? Is anyone else using it for events?"
12. **Don Chuy, the AI helper.** "Our helper is an AI (Claude, by Anthropic). He says he's an AI in his title, in his
    first message, and whenever someone asks. His answers can be wrong, so the Terms say the vendor page and the booking
    control. Conversations go to Anthropic to be answered, but we don't store them. Is our disclaimer (Terms 11a) and
    the Privacy section enough? Do any state chatbot or AI-disclosure laws require more?"

13. **Mi Oficina (AI used to run the business).** "We use AI to draft vendor emails, support replies and social posts,
    and to summarize the business. It sees bookings with the customer's first name only, never contact details. A person
    approves every message before it goes out. Is the Privacy section 'AI that helps us run Bella's Fiestas' enough?"

**Bring to the meeting:** this document, the two pages (open `yourdomain.com/terms.html` on your iPad, or print them),
and the fee list in section 6.

---

## 4. Business setup before taking real money

Ask the accountant about anything marked "ask".

- [ ] **Form an LLC** in Illinois (Secretary of State website). It protects your personal money if the business is
  sued. About $150 to form and $75 per year for the annual report. Check the current fees.
- [ ] **EIN** (free from the IRS website, 10 minutes). You need it for the bank and for Stripe.
- [ ] **Business bank account** in the LLC's name. Keep the business money separate.
- [ ] **Stripe account in the LLC's name**, with the EIN. Do the test-mode script in `docs/stripe.md` first.
  - Stripe charges the standard card fee (2.9% + 30¢).
  - With Express accounts, Stripe also charges the platform about $2 per vendor per month that gets paid, plus a small
    fee per payout. Check Stripe's "Connect pricing" page.
  - Remember: card fees come out of **your** share, not the vendor's.
- [ ] **Insurance** for the business (ask a broker):
  - general liability
  - cyber/data-breach
  - errors & omissions (professional liability) for a marketplace
- [ ] **Taxes** (ask):
  - Is your platform fee subject to Illinois or Chicago tax? Services usually aren't, but ask.
  - Quarterly estimated taxes.
  - Stripe sends 1099-Ks to vendors who pass the IRS threshold. You don't send them yourself, but confirm.
- [ ] **Chicago business license** (ask): the city may require one even for an online business run from home.
- [ ] **BOI report**: as of 2025, U.S.-formed companies no longer have to file it with FinCEN. Confirm with the
  accountant, since rules have changed several times.
- [ ] **Trademark search** for "Bella's Fiestas" (USPTO website, free to search). Registering costs about $350 per
  category.
- [ ] **DMCA agent**: register at copyright.gov ($6, renew every 3 years). It protects you if a vendor uploads someone
  else's photo or video.
- [ ] **Domain and email**: your own domain (e.g. bellasfiestas.com) for the site and for email (Resend needs a
  verified domain).
- [ ] **Texts**: Twilio A2P 10DLC registration takes days to weeks. Start early (`docs/twilio-a2p.md`). Email covers
  everything important until it's approved.

**If you publish to the app stores (optional; the website already installs like an app):**
- Apple Developer: $99 per year, in the LLC's name (needs a D-U-N-S number, which is free).
- Google Play: $25 once.
- Both stores ask for:
  - your privacy policy URL and a support URL
  - in-app account deletion (already built: Account → Delete my account)
  - a "data safety" / "privacy nutrition label" form. Answer it from section 2 of the Privacy Policy.
- `docs/app-stores.md` has the steps.

---

## 5. What people will ask you, and the answers

**"How does the money work?"**
1. The family pays a deposit by card, Apple Pay or Google Pay. Stripe processes it, and we never see card numbers.
2. Stripe sends the deposit, minus our fee, to the vendor's own Stripe account.
3. The balance is paid in the app (all at once, in a payment plan, or split with padrinos) or directly to the vendor on
   the day.
4. Tips go to the vendor with no fee from us.

**"Who holds the money?"**
Stripe does, not us. Money moves from the customer to the vendor's Stripe account. Our fee is split off automatically.
For a vendor's first 3 events, its share waits until it checks in at the party.

**"What if the vendor doesn't show up?"**
1. Every booking has a 4-digit arrival code. The vendor must enter it at the party.
2. If they never check in, the family can report it within 3 days.
3. We look at both sides on the Admin page and can refund everything with one tap, taking the vendor's share back.

**"What if the family cancels?"**
The vendor's policy decides it, and the family sees it before paying:
- Flexible: full refund 3 or more days before.
- Moderate: full 7 or more days before; half from 3 to 6 days before.
- Strict: full 30 or more days before; half from 14 to 29 days before.

Under every policy, the deposit is kept for cancellations in the last 3 days. If the vendor cancels, the family gets
everything back.

**"What if the vendor never answers?"**
Vendors have 72 hours. After that the request cancels itself and the deposit is refunded automatically.

**"How do you make money?"**
- A fee on bookings: 10% standard, 6% for Pro vendors, 5% for the first 25 founding vendors for 6 months, 3% for a
  vendor's own clients paid through its payment link.
- Optional paid upgrades for vendors: Featured $49, Spotlight $99, Pro $29, each for 30 days, never auto-renewing.
- Families pay no fee. Vendors never pay for leads.

**"How is this different from GigSalad or Thumbtack?"**
- No paying for leads.
- Spanish first.
- Prices shown before signing up.
- Deposits protected by the Show-up guarantee.
- Every category of party vendor in one place: music, food, tents, decorations, photo, venues.
- Built for Mexican-American families in Chicago.

(More in `docs/competitors.md`.)

**"Are the reviews real?"**
- Booking reviews can only come from a family with a confirmed, paid booking, after the event.
- Past-client reviews are capped at 10, labelled "Past client", and blocked from the vendor's own internet connection.
- Sample listings show no stars once real payments are on.

**"What data do you keep, and do you sell it?"**
We keep accounts, bookings, messages and listings. We don't sell data, we have no ad trackers, and there is one
cookie, to stay logged in. People can delete their account themselves. Full list: the Privacy Policy.

**"Is it secure?"**
- Encrypted connections (HTTPS).
- Passwords stored only as scrambled hashes.
- Limits on login attempts.
- Strict browser security rules (a Content Security Policy).
- Private documents kept outside the public site.
- Every page and permission covered by automatic tests, including an attack test and the new security sweep.
- Card data never touches our server (Stripe handles it, which keeps the PCI paperwork to the simplest form).

**"What if the server crashes or the data is lost?"**
- Nightly checked backups, plus off-site copies (once you set up R2).
- `npm run restore -- <day>` brings everything back.
- You get an alert when something breaks.

**"Is it accessible?"**
Every screen passes an automatic accessibility check. There are big buttons, a Bigger text mode, and full Spanish.

**"Is it legal for kids?"**
Accounts are for people 18 and older: everyone confirms it with the box at sign-up. Families can add younger relatives to a guest list.

---

## 6. Cheat sheet: the numbers in the app

| Rule | Value | Where to change it |
| --- | --- | --- |
| Platform fee | 10% of the booking total, from the deposit | `PLATFORM_FEE_PCT` in Render |
| Pro vendors | 6%; Pro costs $29 for 30 days | `PRO_FEE_PCT`, `PRO_PRICE_CENTS` |
| Founding vendors | first 25 listings: 5% for 180 days | `FOUNDING_SLOTS`, `FOUNDING_FEE_PCT`, `FOUNDING_DAYS` |
| Payment-link clients | 3% | `DIRECT_FEE_PCT` |
| Referral | both businesses pay half the fee for 30 days | code |
| Featured / Spotlight | $49 / $99 for 30 days | `FEATURE_PRICE_CENTS`, `SPOTLIGHT_PRICE_CENTS` |
| Tips | no fee (only the 2.9% + 30¢ card cost) | `TIPS_COVER_PROCESSING` |
| Vendor must answer | 72 hours | code |
| Slot held while paying | 30 minutes | code |
| Last-minute rule | deposit kept in the last 3 calendar days | code |
| No-show report window | 3 days after the event | code |
| Held payouts | first 3 events, until check-in or 4 days after | `HOLD_NEW_VENDOR_EVENTS` |
| Weekly bookings | up to 12 weeks | code |
| Past-client reviews | up to 10 per listing | code |

If you change a number in Render, change it in the Terms too.

---

## 7. Still to do before launch (your list)

1. Fill in the [brackets] and have the lawyer review both pages. Delete the red boxes and the yellow "draft" box when
   done.
2. In Render, on the real service, set:
   - `SESSION_SECRET`
   - `ADMIN_EMAILS`
   - `BUSINESS_ADDRESS`
   - `SUPPORT_EMAIL`
   - `ALERT_WEBHOOK_URL`
   - `BACKUP_DIR` and the three `BACKUP_S3_*` values
3. Stripe: the test-mode script in `docs/stripe.md`, then live keys. Add the dispute events and the "connected
   accounts" endpoint.
4. Resend: verify your domain, then set `RESEND_API_KEY` and `EMAIL_FROM`.
5. A native Spanish speaker reads `docs/spanish-review.md`.
6. Someone tries everything on a real iPad and phone (`docs/ipad-checklist.md`).
7. Run `npm run preflight` on the live server. No FAIL allowed. Read every warning.
8. Sign up 10 or more real Chicago vendors (`docs/chicago-launch.md`), then set `DEMO_SEED=0` so the samples go away.
9. Remove `PREVIEW_PASSWORD` on launch day so the public can get in.
10. Optional: turn on Don Chuy for real (section 8).

**Run all the checks again any time:**
```bash
npm test                                         # 170 automatic tests
SIM_STEPS=1500 SIM_SEEDS=1,2,3,4 node --test test/sim.test.js
NODE_PATH=$(npm root -g) node e2e/xss.mjs        # the security sweep
```
NODE_PATH=$(npm root -g) node e2e/e2e20.mjs      # Don Chuy on screen
```

---

## 8. Turning on Don Chuy, the AI helper

Until you do this, Don Chuy runs in **free test mode**. He greets people and can list vendors near a ZIP code, but he
doesn't really chat. **Nothing is charged until you finish all the steps below.**

**On your iPad (about 10 minutes):**
1. Go to **console.anthropic.com** and sign up with your business email. Confirm the email they send.
2. Open **Billing**, add a card, and **buy credits** (start with $10–$20). It works like a prepaid phone: it can't spend
   more than the credit you bought. Leave **auto-reload off** unless you want automatic top-ups.
3. Open **API keys** → **Create key**. Name it "Bella's Fiestas" and **copy it** (it's shown only once; it starts with
   `sk-ant-`). Don't paste it anywhere except Render.
4. In **Render**, open your real service → **Environment** → add:
   - `ANTHROPIC_API_KEY` = the key you copied
   - `AI_DAILY_LIMIT_USD` = the most he may spend per day (default 5). Past it, he says he's resting until tomorrow,
     and you get an alert.
5. **Save, rebuild and deploy.** Open the site, tap Don Chuy and ask "¿Cuánto cuesta un mariachi?" The "test mode"
   note is gone when he's live.
6. Run `npm run preflight`. It checks the key works. Your **Admin** page shows what he cost today and this month.

**What it costs:** he uses Claude Opus 5.5, Anthropic's best everyday model. A typical answer costs about 1–2 cents,
so a whole conversation is about 5–10 cents. With the $5 daily limit, the most he can ever spend is about $150 a month,
and much less if fewer people use him.

**What he can and can't do:**
- He can look up vendors, a vendor's page and open dates, and the person's own bookings (only when they're logged in,
  and only their own).
- He can't book, pay, cancel, message or change anything. He points to the right button.
- He never sees anyone's email, phone, address, card or arrival code.

**To turn him off completely:** set `AI_HELPER` = `0` in Render. The button disappears.

### Mi Oficina, your private AI office

The same key also turns on **Mi Oficina**: open the menu → **Mi Oficina** (only you see it), or the button at the top of
your Admin page. It's a little office with six desks around a shared memory:

- 📊 **Morning briefing**: how the business is doing and the 3 most important things to do today. Emailed to you every
  morning between 7 and 11.
- 🔎 **Recruiting**: where families searched and found nobody, and invitations ready to send to groups you find on
  TikTok or Instagram.
- 📱 **Social media**: posts for the week made from real new vendors, real reviews and the holidays coming up.
- ⭐ **Vendor quality**: vendors with unfinished pages or slow answers, with a kind email ready for each.
- 🛟 **Support**: no-shows, chargebacks, cancellations and reschedules that need you, with calm replies ready.
- 💰 **Money & taxes**: what the business earned and spent each month and this year, an amount to set aside for taxes,
  the next estimated-tax dates, and a **Download for your accountant** spreadsheet (one row per month). It counts your
  fees after refunds, Featured/Spotlight/Pro payments, fees on extras and the card cost kept on tips; costs are
  estimated card fees (2.9% + 30¢) and the AI. Text-message and hosting bills aren't in the app, so add those yourself.
  The set-aside is a rule of thumb (`TAX_SETASIDE_PCT`, default 25%), **not tax advice**: ask your accountant what you
  actually owe, and how Stripe's 1099-K forms count the vendors' share of deposits.

**Nothing goes out on its own.** Tap a room to read its report and the drafts it left. Change any words you want, then
tap **Approve and send email** (the app emails that vendor or family), **Approve** (a post or invitation becomes "ready
to copy"), or **Reject**. Tap the 🧠 **Shared memory** to leave your own rules ("Focus on Cicero this month"), and use
**Talk to your office** to ask anything.

**What it costs:** a full morning (all six desks) is usually about $1–2 once you have real vendors and bookings, and less while it is quiet. `OFFICE_DAILY_LIMIT_USD` (default $3)
is the most it can spend in a day, separate from Don Chuy's limit. Today's and this month's cost are at the top of the
office. `OFFICE_MORNING` = `0` stops the morning run and email.

