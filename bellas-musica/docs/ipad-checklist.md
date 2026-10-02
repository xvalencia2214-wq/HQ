# iPad test checklist (about 20 minutes)

The automated browser tests run in Chromium. They cannot prove how the site behaves in real Safari on a real iPad: the on-screen keyboard, the Home Screen app, autoplay rules, and how a thumb feels on a swipe are all different there. Do this once on a real iPad (and once on an iPhone) before any group or customer sees the site.

What *is* already checked automatically: `node e2e/touch.mjs` drags a finger across the Discover feed (one swipe moves exactly one card), measures every button and link at iPad size, and fails if any is under 24 px. Buttons are 44 px tall on touch screens. Run it again after any layout change.

Open the site in **Safari** (not Chrome) at your real address. Tick each line; write what you saw next to anything that fails.

## 1. Install it like an app
- [ ] Share button, **Add to Home Screen**. The silver-blue hat icon and the name "Bella's Música" appear.
- [ ] Open it from the Home Screen: it opens full screen, no Safari bars, and the top of the page is not hidden by the clock or notch.
- [ ] Log in, close the app, reopen it: you are still logged in.

## 2. Discover (the video feed)
- [ ] One swipe up moves exactly one card. Swiping fast three times does not skip or stop between two cards.
- [ ] Swiping with your thumb **on top of the video** still scrolls (the video must never catch the finger).
- [ ] The clip starts a moment after a card settles (muted), and stops when you swipe on. Only one clip plays at a time.
- [ ] Tap 🔇: sound turns on and stays on for the next cards. (Safari blocks sound until you tap; that is expected.)
- [ ] Tap ♡ while logged out: goes to log in. Logged in: the heart fills and the group appears under Saved.
- [ ] The Message / Get quote buttons at the bottom are not hidden behind Safari's bottom bar. Rotate the iPad: the card still fits.
- [ ] A group with a TikTok or Instagram clip: it plays, or at least shows its "open on TikTok/Instagram" fallback instead of a blank box.

## 3. Find music and a group page
- [ ] Type a ZIP (60608): the number keypad appears; results load. "Use my location" asks permission and works.
- [ ] Filters, List/Map toggle, and the map pins can be tapped without zooming the page by accident.
- [ ] On a group page: photo gallery swipes, the video plays inline (does not jump to full screen), the Share and WhatsApp buttons open the right apps.
- [ ] Tap into any text field: Safari does **not** zoom the page in (that happens when text is under 16 px).

## 4. Get quotes (the step-by-step form)
- [ ] Every step fits on screen with the keyboard open; **Next** is not hidden behind the keyboard.
- [ ] Date picker, time picker, and the budget fields are easy to use with a thumb.
- [ ] Close Safari in the middle, reopen: your answers are still there (it saves the draft).
- [ ] Finish with a new email address: the account is created at the end and the request is sent.

## 5. Booking and paying
- [ ] Pick a date on the calendar, see the price, press Book. The Stripe card form (test mode) opens, and Apple Pay or autofill suggestions do not cover the Pay button.
- [ ] After paying you land on the booking page; **Add to calendar** opens the iPad's calendar dialog.
- [ ] Open the **Agreement** page: it reads well and can be shared or printed.

## 6. For groups (do on the iPad, because many will)
- [ ] Dashboard: edit the profile, upload a photo **from the iPad camera roll** (including a large HEIC photo), and see it appear.
- [ ] Paste a YouTube, TikTok or Instagram link: the preview appears.
- [ ] Replying in Messages works with the keyboard open, and new messages appear without refreshing.
- [ ] Day of the event: the check-in screen accepts the 4-digit code the customer reads out.

## 7. Spanish
- [ ] Tap **ES**: the whole screen changes; reload and it stays Spanish. Spot-check a few screens for text that is cut off (Spanish is about 20% longer).

## If something fails
Send the screen (side button + volume up for a screenshot), what you tapped, and the iPad model and iOS version. The most likely trouble spots are video autoplay, the keyboard covering a button, and photo upload size.
