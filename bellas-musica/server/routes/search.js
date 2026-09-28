import { HttpError, int, isDate, isZip, oneOf, str, safeJson, todayStr, getTimezone } from "../util.js";
import { EVENT_TYPES, GROUP_TYPES, POLICIES, SLOTS } from "../pricing.js";
import { lookupZip, miles, zipCount, nearestZip, zipsWithin } from "../geo.js";
import { MARKET, inMarket } from "../market.js";
import { expirePending, firstPhotos, isPromoted, openSlots, publicGroup, ratingMap, ratingOf, LIVE_SQL } from "../shared.js";

// Which music suits which event when a group hasn't said what it plays.
const EVENT_FIT = {
  "Serenata": ["Mariachi", "Trío romántico"],
  "Wedding": ["Mariachi", "Banda", "Grupera", "DJ", "Trío romántico"],
  "Quinceañera": ["Banda", "Mariachi", "Grupera", "DJ"],
  "Anniversary": ["Trío romántico", "Mariachi"],
  "Corporate / Restaurant": ["Conjunto", "Trío romántico", "Mariachi", "DJ", "Norteño"]
};
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const bayes = (rating, n) => (rating * n + 4.2 * 3) / (n + 3);

export default function searchRoutes(ctx, add) {
  const { db, stripe, sms, config } = ctx;

  function search(q, { defaultRadius = 60, limit = 20 } = {}) {
    if (!isZip(q.zip)) throw new HttpError(400, "Enter a 5-digit ZIP code");
    const origin = lookupZip(q.zip);
    if (!origin) throw new HttpError(404, "We don't recognize that ZIP code");
    const radius = q.radius ? int(q.radius, "radius", { min: 5, max: 250 }) : defaultRadius;
    const type = q.type ? oneOf(q.type, "type", GROUP_TYPES) : "";
    const event = q.event ? oneOf(q.event, "event", EVENT_TYPES) : "";
    const maxPrice = q.max ? int(q.max, "max", { min: 1, max: 100000 }) * 100 : 0;
    const guests = q.guests ? int(q.guests, "guests", { min: 1, max: 5000 }) : 0;
    const date = q.date ? (isDate(q.date) ? q.date : (() => { throw new HttpError(400, "Bad date"); })()) : "";
    if (date && date <= todayStr()) throw new HttpError(400, "Pick a future date");
    const song = q.song ? norm(str(q.song, "song", { max: 60 })) : "";
    const sort = q.sort ? oneOf(q.sort, "sort", ["rating", "price", "distance"]) : "rating";
    const cap = Math.min(int(q.limit ?? limit, "limit", { min: 1, max: 50 }), 50);

    expirePending(db);
    const ratings = ratingMap(db), photos = firstPhotos(db);
    const minPrice = new Map(db.all("SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL GROUP BY group_id").map((r) => [r.group_id, r.m]));

    let list = [];
    // Only groups whose ZIP is inside the radius can match, so let SQL skip everything else.
    const nearby = zipsWithin(origin, radius);
    const candidates = nearby.length ? db.all(`SELECT * FROM groups WHERE ${LIVE_SQL} AND zip IN (${nearby.map(() => "?").join(",")})`, ...nearby) : [];
    for (const g of candidates) {
      const z = lookupZip(g.zip);
      if (!z) continue;
      const distance = miles(origin, z);
      if (distance > radius) continue;
      if (type && g.type !== type) continue;
      if (maxPrice && g.rate_cents > maxPrice) continue;
      if (guests && g.max_guests < guests) continue;
      const songs = safeJson(g.songs, []);
      const matched = song ? songs.filter((s) => norm(s).includes(song)) : [];
      if (song && !matched.length) continue;
      const openForDate = date ? openSlots(db, g.id, date, { expire: false }) : null;
      if (date && !openForDate.length) continue;
      const events = safeJson(g.events, []);
      const fits = event ? (events.length ? events.includes(event) : (EVENT_FIT[event] || []).includes(g.type)) : false;
      const r = ratingOf(g, ratings);
      list.push({ g, distance, r, fits, matched, openForDate, score: bayes(r.rating, r.reviews) });
    }
    list.sort((a, b) => {
      const pa = isPromoted(a.g), pb = isPromoted(b.g);
      if (pa !== pb) return pa ? -1 : 1;
      if (event && a.fits !== b.fits) return a.fits ? -1 : 1;
      if (sort === "price") return a.g.rate_cents - b.g.rate_cents;
      if (sort === "distance") return a.distance - b.distance;
      return b.score - a.score || b.r.reviews - a.r.reviews;
    });
    list = list.slice(0, cap);

    return {
      origin: { zip: origin.zip, city: origin.city, state: origin.state, lat: origin.lat, lon: origin.lon },
      in_market: inMarket(origin.zip),
      results: list.map((x) => {
        const c = publicGroup(ctx, x.g, {
          rating: x.r,
          fields: {
            distance_miles: Math.round(x.distance), photo: photos.has(x.g.id) ? "/uploads/" + photos.get(x.g.id) : null,
            from_cents: minPrice.get(x.g.id) ?? x.g.rate_cents, fits_event: x.fits, matched_songs: x.matched.slice(0, 3),
            open_slots: x.openForDate, lat: lookupZip(x.g.zip).lat, lon: lookupZip(x.g.zip).lon
          }
        });
        c.story = c.story.slice(0, 220);
        c.song_count = c.songs.length;
        delete c.songs;
        return c;
      })
    };
  }

  add("GET", "/api/health", () => ({ ok: true }));

  add("GET", "/api/meta", () => ({
    events: EVENT_TYPES, group_types: GROUP_TYPES, slots: SLOTS,
    policies: Object.fromEntries(Object.entries(POLICIES).map(([k, v]) => [k, v.text])),
    market: { name: MARKET.name, area: MARKET.area, center_zip: MARKET.center.zip, radius_miles: MARKET.radiusMiles, neighborhoods: MARKET.neighborhoods },
    payments: stripe.mode, sms: sms.mode, email: ctx.email.mode, feature_price_cents: config.featurePriceCents, zip_count: zipCount(), today: todayStr(), timezone: getTimezone()
  }));

  add("GET", "/api/nearest-zip", ({ query }) => {
    const lat = Number(query.lat), lon = Number(query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, "Bad location");
    const z = nearestZip(lat, lon);
    if (!z || miles({ lat, lon }, z) > 60) throw new HttpError(404, "No US ZIP code near that location");
    return z;
  });

  add("GET", "/api/zip/:zip", ({ params }) => {
    const z = isZip(params.zip) ? lookupZip(params.zip) : null;
    if (!z) throw new HttpError(404, "Unknown ZIP code");
    return z;
  });

  add("GET", "/api/search", ({ query }) => { const out = search(query); ctx.stats.count("search", out.origin.zip); return out; });

  // "Best of your city": the top-rated groups within 40 miles of a ZIP.
  add("GET", "/api/best", ({ query }) => {
    const out = search({ zip: query.zip, sort: "rating", limit: 10 }, { defaultRadius: 40, limit: 10 });
    return { city: out.origin.city, state: out.origin.state, zip: out.origin.zip, groups: out.results };
  });
}
