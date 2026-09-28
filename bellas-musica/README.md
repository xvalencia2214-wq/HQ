# Bella's Música (demo)

Booking site for live Mexican music groups, from the sketch: search by ZIP, top groups near you
(up to 20) with price filter, group story page, open dates/times, deposit, private chat with the
manager, and a "for groups" promotion form. Cream / gold / black theme.

Static site, no build step, no dependencies. Open `index.html`, or run `python3 -m http.server`
in this folder. Data is fictional (`data.js`); bookings and chat are saved in the browser only.

## Not built yet (needs a backend)
- Accounts and real group listings/photos
- Real deposits (e.g. Stripe Connect) and payouts to groups
- Real chat/SMS with masked phone numbers
- Full ZIP database and a map (only 5 demo ZIPs, no map yet)
- Reviews, group dashboard to manage open dates
