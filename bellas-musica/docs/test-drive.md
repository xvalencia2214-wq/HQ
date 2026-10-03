# Test drive: try every feature

One command starts Bella's Música with practice accounts and a quinceañera already being planned. Money and texts are
pretend. It uses its own practice data (the `data-tryout` folder), so it never mixes with anything real.

## Start it

1. Download the newest ZIP of the branch and unzip it (replace the old folder).
2. Open the `bellas-musica` folder, click the address bar, type `cmd`, press Enter.
3. If the app is already running in another black window, close that window first.
4. Type `npm run tryout` and press Enter. Wait for "TEST DRIVE is running".
5. Open **http://localhost:3000** in Chrome.

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
- **My bookings:** his anniversary request to the DJ is waiting for an answer.

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

## Switch to Spanish

Press **ES** at the top (EN to go back). Everything above is in Spanish too.
