# Test drive: try every feature

One command starts Bella's Música with practice accounts and a quinceañera already being planned. Money and texts are
pretend. It uses its own practice data (the `data-tryout` folder), so it never mixes with anything real.

## Start it

1. Download the newest ZIP of the branch and unzip it (replace the old folder).
2. Open the `bellas-musica` folder, click the address bar, type `cmd`, press Enter.
3. If the app is already running in another black window, close that window first.
4. Type `npm run tryout` and press Enter. Wait for "TEST DRIVE is running".
5. Open **http://localhost:3000** in Chrome.

To start over with fresh practice data: `npm run tryout -- --reset`

**Every password is `fiesta2026`.** To switch people, tap your name at the top, then **Log out**, then log in as someone
else. Or use a private (incognito) window for a second person at the same time.

| Log in as | Who |
|---|---|
| familia@prueba.com | Rosa, the mom planning Sofía's quinceañera |
| padrino@prueba.com | Tío Juan, a padrino |
| dj@prueba.com | DJ Relámpago (fog, lights, visuals, audio/video add-ons, 3-hour minimum, Pro) |
| carpas@prueba.com | Carpas Lupe (tents, in a bundle with the mariachi) |
| mariachi@prueba.com | Mariachi Sol de Jalisco (2-hour minimum) |
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
- **Find music:** open DJ Relámpago and pick add-ons. Try 1 or 2 hours: it asks for at least 3. The tent company is
  booked by package only.
- **Get quotes:** ask for food or rentals, not only music.

## 2. Tío Juan, the padrino (padrino@prueba.com)

- In Rosa's party, press *Share with family* and copy the link. Open it in Tío Juan's window, press
  **🎁 Be a padrino** and pay part of the DJ's balance.
- **My bookings:** his anniversary request to the DJ is waiting for an answer.

## 3. DJ Relámpago (dj@prueba.com)

- **For groups:** the dashboard, with Tío Juan's request to **Accept** or **Decline**.
- **Packages:** the add-ons (fog, dance floor lights, special lighting, visuals, audio/video). Add one from the suggestions.
- **Profile:** the minimum hours (3) and the rain/weather policy.
- **Calendar:** availability, calendar sync (Google/iPhone link) and importing your own calendar.
- **Payments:** Bella's Pro (active), Featured, the referral link (invite another vendor: lower fee), the free
  website page link, licenses and insurance, and the earnings report (download the CSV for taxes).
- **View public page**, and open the website page link from Payments.
- **Reviews:** answer Rosa's review after she leaves it.

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
