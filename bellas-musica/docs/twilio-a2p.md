# Text messages (Twilio) and US carrier registration

**You can launch without this.** Email carries everything; texts are a bonus for groups who want instant alerts. US carriers **block** unregistered business texting from regular numbers, so do the registration properly or don't send.

Texts are opt-in: people tick a box (sign-up or account page) that says *"Text me about my bookings and messages. Message and data rates may apply. Reply STOP to opt out."* and add their phone. Nobody's number is ever shown to another user.

## Steps

1. Create a Twilio account and buy a local Chicago (312/773) number, or a toll-free number (toll-free verification is often quicker).
2. **Register your brand** (Trust Hub / A2P 10DLC): legal business name, EIN or sole-proprietor details, website (your live domain), contact info. Use the **Sole Proprietor** path only if you have no EIN; volume limits are much lower.
3. **Register a campaign** using the kit below.
4. Wait for **Approved** (days to weeks). Then set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (`+13125550100` format) and redeploy. `npm run preflight` will remind you that A2P status can't be checked automatically: look at the console yourself.

## Campaign kit (copy and paste)

**Use case:** Account Notification (Low Volume Mixed is also fine at the start).

**Campaign description:**
> Bella's Música is a marketplace where people book live Mexican music groups (mariachi, banda, norteño) for events. We text customers and musicians who opt in about their own bookings: new booking requests, confirmations, date-change requests, reminders before an event, replies to their messages, and a review request after the event. We do not send marketing or promotional texts, and we never share numbers with third parties.

**How do users opt in?**
> On the sign-up form at https://YOUR-DOMAIN/#/signup and on the Account page, users enter their mobile number and check an unchecked box that reads: "Text me about my bookings and messages. Message and data rates may apply. Reply STOP to opt out." The Terms and Privacy Policy (https://YOUR-DOMAIN/terms.html, https://YOUR-DOMAIN/privacy.html) describe SMS use. Consent is not a condition of using the service.

**Opt-in screenshot:** take one of the sign-up form with the checkbox (or the Account page).

**Sample messages** (these are the real templates, sent from `server/emails.js`):
1. `Bella's Música: new booking request for 2026-11-07 2:00 PM. Open your dashboard to accept: https://YOUR-DOMAIN/#/dashboard`
2. `Bella's Música: Mariachi Tierra Viva confirmed your booking for 2026-11-07 at 2:00 PM.`
3. `Bella's Música: reminder, Mariachi Tierra Viva plays tomorrow (2026-11-07 2:00 PM).`
4. `Bella's Música: Mariachi Tierra Viva replied to your message. Open the app to read it: https://YOUR-DOMAIN/#/messages`
5. `Bella's Música: how was Mariachi Tierra Viva? Leave a quick review: https://YOUR-DOMAIN/#/bookings`

**Message flow / keywords:**
- **STOP** (also STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT): Twilio handles opt-out automatically on your number and confirms it. Users can also untick the box on the Account page.
- **HELP**: reply with `Bella's Música: help at support@YOUR-DOMAIN. Msg&data rates may apply. Reply STOP to opt out.` (set this as the HELP auto-reply in your Twilio Messaging Service).
- Embedded links: yes (your own domain, no shorteners). Embedded phone numbers: no.
- Age-gated content, lending, gambling, crypto, cannabis: none.

**Things reviewers reject, and how this project avoids them**
- Missing opt-in proof: the checkbox is unchecked by default and the wording is on the page.
- Missing STOP/HELP language: shown at opt-in; auto-replies set in Twilio.
- Privacy policy without SMS language: `public/privacy.html` has it. Fill in the template's brackets first.
- URL shorteners or third-party links: none.

## Costs and volume

Registration fees and per-message costs change; check Twilio's current pricing page. Message volume here is low (a few texts per booking per person).
