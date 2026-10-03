# Put Bella's Música in the app stores

The store apps are a frame around your live website, so **every update to the site shows up in the apps by itself**.
You don't build anything twice. Everything here is clicking in websites; no code.

**Do these first:**
1. The website is published (`docs/publish.md`) **on your own domain** (for example `bellasmusica.com`). The apps are
   tied to that address, so don't use the `.onrender.com` one.
2. Launch day has passed: **PREVIEW_PASSWORD is deleted**. Store reviewers and testers can't type a site password.
3. Make a **test account** for the store reviewers (for example `reviewer@bellasmusica.com`) with a booking in it, so
   they can see the app working.

What's already built for the stores: the install page (`yourdomain.com/#/app`), phone notifications, an offline
page, app icons for every shape, four phone screenshots (`public/screens/`), the Google Play banner
(`docs/store/feature-graphic.png`), the verification files, and the store version hides the Pro / Featured purchases
(Apple and Google want their own payment system for digital upgrades; vendors buy those on the website instead).
Deposits, balances and tips keep using Stripe: they pay for a real service in person, which the stores allow.

---

## Part 1: Google Play (do this first)

**Cost:** $25 once. **Time:** about an hour of clicking, then about 2 weeks of testing before the public can download it.

### 1. Make a Google Play developer account
1. Go to **play.google.com/console** and sign up. Pay the $25 and verify your identity (photo of your ID). Google can
   take a few days to approve.
2. **Personal or organization?** If Bella's Música is an LLC, choose **Organization** (you'll need a free D-U-N-S
   number from dnb.com, which takes about a week), and you skip the 12-tester rule below. If not, choose **Personal**.

### 2. Make the Android app with PWABuilder (free)
1. Go to **pwabuilder.com**, type `https://bellasmusica.com` (your domain) and press **Start**. It checks the site;
   everything should be green.
2. Press **Package for stores** → **Android** → **Generate Package**. In **Options**, change only these:
   - **Package ID:** `com.bellasmusica.app`
   - **Start URL:** `/?app=android` ← important: this is what hides the in-app purchases
   - **Notification delegation:** on (so notifications look like a normal Android app's)
   - **Signing key:** Create new
3. Download the ZIP. **Save it in two safe places** (for example Google Drive and a USB stick). It has your signing
   key; you need it for every update.

### 3. Tell the website about the app
1. In the ZIP, open `assetlinks.json` (Notepad is fine) and copy the long code after `sha256_cert_fingerprints`
   (it looks like `AB:12:CD:...`).
2. In Render → your service → **Environment**, add:
   - `ANDROID_PACKAGE` = `com.bellasmusica.app`
   - `ANDROID_SHA256` = the code you copied
3. Save. Check that `https://bellasmusica.com/.well-known/assetlinks.json` shows them. (If this step is missing, the
   app shows a browser address bar at the top.)

### 4. Create the app in Play Console
1. **Create app:** name `Bella's Música`, default language **English (United States)**, **App**, **Free**.
2. Go through **Set up your app** (each item is a short form):
   - **Privacy policy:** `https://bellasmusica.com/privacy.html`
   - **App access:** "All or some functionality is restricted" → give the reviewer's email and password.
   - **Ads:** No ads.
   - **Content rating:** fill in the questionnaire (no violence, no gambling; users can talk to each other and buy
     services).
   - **Target audience:** 18 and over.
   - **Data safety:** the app collects name, email, phone number, approximate location (ZIP code), messages, photos
     that vendors upload, and purchase history; payments are handled by Stripe; data is encrypted in transit; people
     can delete their account in the app (Account → Delete my account).
   - **Financial features:** "My app doesn't provide any financial features."
3. **Main store listing** (copy the text below):
   - App icon: `public/icon-512.png`
   - Feature graphic: `docs/store/feature-graphic.png`
   - Phone screenshots: the four files in `public/screens/`
   - Add a **Spanish (Latin America)** translation with the Spanish text below.

### 5. Testing, then the public
1. **Testing → Closed testing → Create track.** Upload the `.aab` file from the ZIP.
2. Add your testers' Gmail addresses: vendors and families you know. A **personal** account needs **at least 12
   testers who keep the app for 14 days**. Send them the opt-in link Play Console gives you.
3. After you upload, go to **Setup → App signing**, copy the **App signing key certificate SHA-256**, and add it to
   `ANDROID_SHA256` in Render after the first code, with a comma between them (Google re-signs the app with its own
   key).
4. After the 14 days: **Apply for production**, answer the few questions, and publish. Google reviews it (a few days).
5. Once it's live, the **Get it on Google Play** button appears on your site's "Get the app" page by itself.

### Store listing text

**Short description (EN):** Book mariachi, banda, norteño and everything for your party, with safe deposits.

**Full description (EN):**
Bella's Música is the easiest way to book live Mexican music and everything else for your party in Chicago.
Find mariachi, banda, norteño, tríos, DJs, taqueros, tents, decorations, photographers and venues, see real prices
and open dates, and book with a deposit that's held safely. Plan the whole quinceañera, wedding or birthday in one
place: one checkout for every vendor, padrinos can chip in, and a timeline for the big day. Leave a tip for the
musicians after the party. Restaurants can book a group every week with one booking.
For groups and vendors: get requests and payments on your phone, manage your calendar and crew, send payment links
to your own clients, and get a morning summary of your day. In English and Spanish.

**Descripción corta (ES):** Reserva mariachi, banda, norteño y todo para tu fiesta, con depósitos seguros.

**Descripción completa (ES):**
Bella's Música es la forma más fácil de reservar música mexicana en vivo y todo lo demás para tu fiesta en Chicago.
Encuentra mariachi, banda, norteño, tríos, DJs, taqueros, carpas, decoración, fotógrafos y salones, ve precios reales y
fechas libres, y reserva con un depósito que se guarda de forma segura. Planea toda la quinceañera, boda o cumpleaños en
un solo lugar: un solo pago para todos los proveedores, los padrinos pueden cooperar y un horario para el gran día.
Deja una propina a los músicos después de la fiesta. Los restaurantes pueden reservar un grupo cada semana con una sola
reserva. Para grupos y proveedores: recibe solicitudes y pagos en tu teléfono, maneja tu calendario y tu equipo, manda
links de pago a tus propios clientes y recibe un resumen de tu día cada mañana. En español e inglés.

---

## Part 2: Apple App Store (later, once you have real users)

**Cost:** $99 a year. **Needs:** a Mac for about an hour (a friend's, or a rented one online such as MacinCloud).

Until then, iPhone users already have the app: **Safari → Share → Add to Home Screen** (your site's "Get the app"
page shows them how), and notifications work that way on iOS 16.4 and newer.

When you're ready:
1. Join the **Apple Developer Program** at developer.apple.com (as an organization if you have an LLC; that needs the
   same D-U-N-S number).
2. On **pwabuilder.com**, choose **iOS** → Generate. Use the bundle ID `com.bellasmusica.app` and the start URL
   `/?app=ios`.
3. On the Mac, open the project in Xcode, choose your team, then **Product → Archive → Distribute** to upload it.
4. In **App Store Connect**, fill in the listing (the same text and screenshots), the privacy answers (same as Google's
   Data safety), and the reviewer account.
5. In Render → Environment add `APPLE_APP_ID` = `YOURTEAMID.com.bellasmusica.app` (Team ID is on developer.apple.com →
   Membership). When the app is approved, add `APP_STORE_URL` = its `https://apps.apple.com/...` link and the **App
   Store** button appears on your site.

**Tell me when you get to this part:** Apple's app needs one extra setup for notifications inside the App Store
version (through Google's free Firebase service), and I'll set it up with you. Apple also reviews more strictly, and
the notifications, offline page and account deletion that are already built are what they look for.

---

## Remaking the pictures

The icons, screenshots and Google Play banner come from the test drive. To make new ones (for example after real
groups add photos): start `npm run tryout`, then on a computer with Playwright run `node e2e/app-images.mjs`.
