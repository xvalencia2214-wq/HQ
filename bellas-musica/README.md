# Bella's Música (demo)

Booking site for live Mexican music groups, from the sketch. Cream / gold / black theme.

**Customers:** search by ZIP, top groups near you (up to 20) as a list or on a map, filter by type
and price, group story page, open dates and times, deposit estimate, private chat, My bookings.
**Groups ("For groups"):** create a listing or open a demo group, set price and story, choose open
dates/time slots, accept or decline booking requests, and feature the group at the top of search.

Static site, no build step. Run `python3 -m http.server` in this folder and open it, or add it to
the iPad home screen. Groups are fictional (`data.js`); everything you do is saved in the browser
only ("Reset all demo data" is at the bottom of the dashboard). Map: Leaflet (vendored, BSD-2) with
OpenStreetMap tiles; heavy use would need a paid tile provider. `logo.svg` is a placeholder logo.

## Not built yet (needs a backend)
- Accounts and login (the dashboard is open to anyone in the demo)
- Real deposits (e.g. Stripe Connect) and payouts to groups
- Real chat / SMS with masked phone numbers
- Full ZIP database and real addresses (only 5 demo ZIPs; map pins are approximate on purpose)
- Photos, videos and reviews
