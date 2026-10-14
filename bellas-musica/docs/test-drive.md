# Test drive: try every feature

One command starts Bella's Música with practice accounts and a quinceañera already being planned. Money and texts are
pretend. It uses its own practice data (the `data-tryout` folder), so it never mixes with anything real.

## Start it

1. Close every black window where the app is running.
2. Download the newest ZIP of the branch and unzip it. **Delete the old folder first**: if the old one is still there,
   Windows names the new one with **(1)** at the end, and it's easy to open the old one by mistake.
3. Open the `bellas-musica` folder, click the address bar, type `cmd`, press Enter.
4. Type `npm run tryout` and press Enter. Wait for "TEST DRIVE is running". The first line shows the **version**
   (for example `version 2026.10.5`): if it's older than the one in the newest message, you opened an old folder.
5. Your browser opens the **welcome page** by itself (or open **http://localhost:3000/#/welcome**): move the mouse,
   tap the sombrero, press **Play la diana**, and scroll all the way down. **Find music** or **Log in** takes you into the app.
   If the black window says an **older copy is still running**, do what it says (close it in Task Manager) and try again.

### On your iPad or phone

The test drive runs on your computer, and an iPad or phone on the **same Wi-Fi** can open it:

1. Start it on the computer as above. The black window prints a line like
   `>>> On your iPad or phone (same Wi-Fi as this computer), open:  http://192.168.1.23:3000`
2. The first time, Windows may ask whether to allow **Node.js** on networks: tick **Private networks** and press **Allow**.
   (If you pressed Cancel by mistake: Start → "Allow an app through Windows Firewall" → find Node.js → tick Private.)
3. On the iPad, open **Safari** and type that address exactly (with `http://` and the `:3000`).
4. Log in with the practice accounts below. Invitation, review and payment links made in the test drive use this address,
   so they open on the iPad too. The computer has to stay on with the black window open.

Phone notifications and "Add to Home Screen" need the published site (https), not the test drive.

### No computer? A practice copy online (free, from an iPad or phone)

This puts the same test drive (practice accounts, Rosa's party, every feature) on the internet for free, so you can
open it in Safari anywhere. Money and texts are pretend.

1. In Safari go to **render.com** and log in (or **Get Started → GitHub** with the GitHub account that has **HQ**).
2. Press **New +** → **Blueprint**. Pick the **HQ** repository and the branch **`claude/gallant-turing-ycaabs`**.
3. Where it asks for the **Blueprint path** (the file name; it says `render.yaml`), type **`render-tryout.yaml`**.
4. It shows one service, **bellas-musica-test-drive**, on the **Free** plan. For **PREVIEW_PASSWORD** make up a
   password (for example `fiesta-ipad`). Press **Apply** and wait until it says **Live** (about 5 minutes).
5. Tap the address that ends in **.onrender.com**. Safari asks for a user name and password: type anything as the name
   and your **PREVIEW_PASSWORD**.
6. Log in with the practice accounts below (password `fiesta2026`).

Good to know: the free copy goes to sleep after 15 minutes without visits; the next visit takes about a minute to wake
up, and it **starts over with fresh practice data** each time. It never touches your real site. Render may ask for a
card even for the free plan.

To start over with fresh practice data: `npm run tryout -- --reset` (do this once after downloading a new version, so the
practice data has the newest tools).

**Every password is `fiesta2026`.** To switch people, tap your name at the top, then **Log out**, then log in as someone
else. Or use a private (incognito) window for a second person at the same time.

| Log in as | Who |
|---|---|
| familia@prueba.com | Rosa, the mom planning Sofía's quinceañera |
| padrino@prueba.com | Tío Juan, a padrino |
| dj@prueba.com | DJ Relámpago (fog, lights, visuals, audio/video add-ons, 3-hour minimum, Pro, two setups at once) |
| ayudante@prueba.com | Memo, the DJ's helper (team login) |
| carpas@prueba.com | Carpas Lupe (tents, in a bundle with the mariachi) |
| mariachi@prueba.com | Mariachi Sol de Jalisco (2-hour minimum, plays every Friday at a restaurant) |
| restaurante@prueba.com | Restaurante El Sol (books the mariachi every Friday) |
| lucia@prueba.com | Lucía, a past client of the mariachi (she already wrote a review) |
| dueno@prueba.com | You, the owner (Admin page) |

## 1. Rosa, the mom (familia@prueba.com)

- **Plan a party → Quinceañera de Sofía.** Budget ($8,000: booked, paid, still to pay), the vendors for that day,
  the party checklist, and vendors to add for food, rentals, decorations, photo, staff and venues.
- **Family shortlist and chat.** Her niece added Tacos El Güero and Tía Carmen left a comment. Add another vendor, vote ♥.
- **Day-of timeline.** Change a time, link a row to a vendor, press *Save timeline*.
- **Guest calculator** (tables, tacos, aguas frescas for 150), **QR sign for the party** (print it), **Share with family**.
- **My bookings:**
  - DJ Relámpago is confirmed with **fog machine + dance floor lights**. Rosa paid $100 of the balance and **Tío Juan
    paid $200 as padrino**. Try *Pay part of the balance*.
  - **🛒 Pay all at once:** tent + mariachi in one payment. The button shows **"You save $190"** because those two
    vendors are a bundle. Pay it with the practice card.
  - **Leave a review** with a photo for the DJ (the birthday party last week).
  - **Mateo's baptism is today:** press **➕ Ask for one more hour**. Then log in as the DJ to accept it, and pay it here.
  - **💝 Leave a tip (propina)** on last week's birthday party with the DJ: pick $20, $50 or $100 and pay it with the
    practice card. All of it goes to the vendor.
  - Each booking shows **what the vendor needs from you** (power, parking…), which you confirmed when booking.
- **Book the mariachi at 5:00 AM** (mañanitas) or a **20-minute serenata** at night: many start times are grouped as
  early morning, daytime, evening and night.
- **Mother's Day serenatas:** open `#/specials/mothers_day` (add it after the address) to see who plays and book a stop.
- **Find music:** open DJ Relámpago and pick add-ons. Try 1 or 2 hours: it asks for at least 3. The tent company is
  booked by package only.
- **Get quotes:** ask for food or rentals, not only music.

## 2. Tío Juan, the padrino (padrino@prueba.com)

- In Rosa's party, press *Share with family* and copy the link. Open it in Tío Juan's window, press
  **🎁 Be a padrino** and pay part of the DJ's balance.
- **My bookings:** his anniversary request to the DJ is waiting for an answer. Until the DJ accepts, cancelling gives
  the whole deposit back; if the DJ doesn't answer within 3 days, it's cancelled and refunded on its own.

## 3. DJ Relámpago (dj@prueba.com)

- **My business** tab (new):
  - **Payment link for your own client:** Karla's wedding link is waiting for payment. Make a new one, then press
    WhatsApp or Copy. Open the link as `padrino@prueba.com` to pay it: the booking is confirmed right away, at a 3% fee.
  - **Your musicians and crew:** Toño and Memo, with their pay. **Who's owed what** adds up each month.
  - **What you need from the family:** tap a suggestion to add it, then Save.
  - **Holiday serenatas:** set a Mother's Day or Virgen de Guadalupe special (length, price, hours).
  - **Your team:** Memo is a helper. Invite someone else with a link.
- **Requests:** on Sofía's party press **👥 Lineup**: check who goes, Save, then **WhatsApp** sends each one the time,
  address and pay. Mark them paid. On today's baptism press **➕ Add something at the party** (one more hour, an
  add-on or anything with a price), or accept Rosa's request.
- **Calendar:** pick a day, open **More times** to add a 5:00 AM start or a window (6 PM to 11 PM), or copy a day to
  every same weekday. **Bookings at the same time** (2 setups) and travel time between bookings are below it.
- **Packages:** add a short set (Or a short set: 20 min).

- **For groups:** the dashboard, with Tío Juan's request to **Accept** or **Decline**.
- **Packages:** the add-ons (fog, dance floor lights, special lighting, visuals, audio/video). Add one from the suggestions.
- **Profile:** the minimum hours (3) and the rain/weather policy.
- **Calendar:** availability, calendar sync (Google/iPhone link) and importing your own calendar.
- **Payments:** Bella's Pro (active), Featured, the referral link (invite another vendor: lower fee), the free
  website page link, licenses and insurance, and the earnings report (download the CSV for taxes).
- **View public page**, and open the website page link from Payments.
- **Reviews:** answer Rosa's review after she leaves it.

## 3b. Memo, the helper (ayudante@prueba.com)

- **For groups** opens DJ Relámpago's dashboard: he can answer requests and messages, run the calendar and lineups.
- **Payments:** payouts, Pro and Featured say "Only the owner of this listing can do this".

## 3c. Restaurante El Sol and the mariachi (restaurante@prueba.com, mariachi@prueba.com)

- **Restaurante El Sol → My bookings:** the mariachi plays **every Friday for 6 weeks**, booked once with one payment
  and 10% off each week ("Weekly · 1 of 6"). Last Friday already happened and they left a **$50 tip**. On the last
  week, **🔁 Book 6 more weeks** starts the next round.
- **Book weekly yourself:** open any group, pick a date and time, and under **Every week?** choose how many weeks. Dates
  the group isn't open are skipped and you're told which.
- **The mariachi → Requests:** the weekly gigs show "Weekly · N of 6"; a new weekly request has **Accept all** and
  **Decline all**. **Calendar** → *Discount for weekly bookings* sets the weekly discount. **Payments → earnings**
  shows the tip in its own column.
- **Morning text:** every vendor gets a text in the morning in their language ("Today: 1 gig, 1 new request, $337.50
  to collect"). Texts are pretend here, so the black window prints what it would say. Turn it off in **Account**.

## 4. Carpas Lupe (carpas@prueba.com)

- **Messages:** Rosa asked if the 40x60 tent has lights. Answer her.
- **Packages:** the tent packages, add-ons, and the bundle with the mariachi (10% off when booked together). Start a
  new bundle with another vendor.
- **Payments → Licenses and insurance:** the insurance is waiting for the owner; the badge shows after it's approved.
- After Rosa pays all at once: accept her request.

## 5. You, the owner (dueno@prueba.com)

- **Admin:** money totals (practice), bookings, **licenses and insurance to check** (approve Carpas Lupe's
  insurance), no-show reports, partner links (`?src=iglesia-san-pio`) and where sign-ups came from.

## 6. New: what beats the big booking sites

- **Guest list and RSVPs (Rosa → Plan a party → Quinceañera de Sofía, scroll down):** 6 groups of guests, 4 answered,
  Prima Daniela answered from the family chat link. Add a guest, paste a list, press **WhatsApp** next to a guest to
  send their own invitation, or **Copy** and open it in a private window: that's what the guest sees (no account).
  Answer it, then come back and see the totals change; press **Use … as the guest count**. Open **🔗 One link for
  everyone** to change the message on the invitation and the answer-by date. Below it: the **court of honor and
  padrinos** (damas, chambelanes, madrina de última muñeca…).
- **Sign the agreement:** Rosa already signed the DJ's agreement (**My bookings → Agreement ✓**). Log in as the DJ →
  Requests → **✍️ Sign the agreement** on Sofía's party: type your name, tick the box, sign. Both names show.
- **Reviews from past clients (mariachi → Reviews):** Lucía's review shows with a **Past client** label (also on the
  mariachi's page). "Familia Ortega" is waiting: press **New link**, copy it, and open it in a private window logged in
  as someone else (for example padrino@prueba.com) to write the review.
- **Founding vendors:** the DJ, the tents and the mariachi were the first three to go live, so their fee is 5% for 6
  months (**Payments** says "Founding vendor #1"). Make a new listing to see "22 of 25 spots left".
- **Held deposits for new vendors:** these vendors are new, so families see "🔒 Bella's Música keeps your deposit safe
  until the group checks in", and the DJ sees "Your share is sent when you check in". Check in at Mateo's baptism
  (today) with Rosa's code and the note disappears (the money moves for real only with live Stripe).
- **Spanish search page:** open **http://localhost:3000/es/chicago/pilsen/quinceanera** (Google shows this one to
  people searching in Spanish).
- **You (dueno@prueba.com) → Admin:** reviews from past clients, with a **Remove** button; founding spots used.

## 7. New: the white-and-gold look

- **The menu:** on an iPad held sideways (or a computer) it is a sidebar on the left, in sections: *Find and plan*,
  *My party*, *For businesses*, *You*. On a phone or an iPad held upright, tap the big **Menu** button at the top.
- **Bigger text:** in the menu, under *You*. It stays on for that device until you tap it again.
- **Spotlight:** log in as the mariachi (mariachi@prueba.com) → **For groups → Payments → Get seen more**. Featured
  ($49) and Spotlight ($99) side by side; buy Spotlight with the test button. Then log out and look at the home page
  (the **In the spotlight** strip), search (first, with a gold **Spotlight** badge) and **Discover** (it comes round
  twice as often). The owner can give or clear it from **Admin**.
- **Apple Pay:** under every pay button: *Apple Pay · Google Pay · Card*. In the test drive the payment is pretend;
  on the real site Stripe shows the Apple Pay button on an iPhone or iPad with a card in Wallet.
- **Words for each kind of business:** on Find music, tap **Food**: the heading and the list talk about food vendors,
  **Venues** about venues, and a tent company's page says "Request this rental company". Same in Spanish.
- **Businesses make their own page:** as the owner (dueno@prueba.com) → **Admin**, the first box is a link to send a
  business by WhatsApp or text; they sign up and fill in their own page. A vendor sees **Edit your page** on its own
  listing, and a new listing shows its setup as numbered steps that tick off as they go.
- **Cancelling at the last minute:** the cancellation rules now say that cancelling within 48 hours of the party never
  gives the deposit back, under any policy.

## Switch to Spanish

Open the menu and press **Español** (**English** to go back). Everything above is in Spanish too.
