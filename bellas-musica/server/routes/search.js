import { HttpError, addDays, int, isDate, isZip, now, oneOf, str, safeJson, todayStr, getTimezone } from "../util.js";
import { ADDON_PRESETS, CATEGORIES, EVENT_TYPES, GROUP_TYPES, HOURLY_BY_DEFAULT, MAX_HOURS, NEEDS_PRESETS, POLICIES, SHORT_MINUTES, SLOTS, TIMES, categoryOf } from "../pricing.js";
import { lookupZip, miles, zipCount, nearestZip, zipsWithin } from "../geo.js";
import { MARKET, inMarket } from "../market.js";
import { expirePending, firstPhotos, foundingLeft, fromCents, isPromoted, isSpotlight, openSlots, publicGroup, ratingMap, ratingOf, reaches, LIVE_SQL } from "../shared.js";
import { upcomingHolidays } from "./specials.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Which music suits which event when a group hasn't said what it plays.
const EVENT_FIT = {
  "Serenata": ["Mariachi", "Trío romántico"],
  "Wedding": ["Mariachi", "Banda", "Grupera", "DJ", "Trío romántico", "Sierreño", "Tierra Caliente", "Cumbia / Sonido", "Tamborazo"],
  "Quinceañera": ["Banda", "Mariachi", "Grupera", "DJ", "Sierreño", "Tierra Caliente", "Cumbia / Sonido", "Tamborazo"],
  "Anniversary": ["Trío romántico", "Mariachi"],
  "Corporate / Restaurant": ["Conjunto", "Trío romántico", "Mariachi", "DJ", "Norteño", "Sierreño"],
  "Baptism": ["Trío romántico", "Mariachi", "DJ"],
  "First Communion": ["Trío romántico", "Mariachi", "DJ"],
  "Graduation": ["DJ", "Banda", "Norteño", "Grupera", "Mariachi", "Sierreño", "Cumbia / Sonido"],
  "Baby shower": ["DJ", "Trío romántico", "Mariachi"],
  "Funeral / Memorial": ["Mariachi", "Trío romántico"]
};
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const bayes = (rating, n) => (rating * n + 4.2 * 3) / (n + 3);
const PAID_ON_TOP = 2; // paid listings shown first when the family sorts by price or distance

export default function searchRoutes(ctx, add) {
  const { db, stripe, sms, config } = ctx;
  // The welcome page's 3D scene, with a fingerprint of the file in its address: phones keep /vendor/ files for a week, so a
  // rebuilt scene gets a new address and is fetched fresh, with nothing to remember to change.
  const landing3d = (() => {
    try { return "/vendor/landing3d.js?v=" + crypto.createHash("sha256").update(fs.readFileSync(path.join(config.publicDir, "vendor", "landing3d.js"))).digest("hex").slice(0, 10); }
    catch { return "/vendor/landing3d.js"; }
  })();

  function search(q, { defaultRadius = 60, limit = 20 } = {}) {
    if (!isZip(q.zip)) throw new HttpError(400, "Enter a 5-digit ZIP code");
    const origin = lookupZip(q.zip);
    if (!origin) throw new HttpError(404, "We don't recognize that ZIP code");
    const radius = q.radius ? int(q.radius, "radius", { min: 5, max: 250 }) : defaultRadius;
    const type = q.type ? oneOf(q.type, "type", GROUP_TYPES) : "";
    const name = q.q ? norm(str(q.q, "q", { max: 60 })) : ""; // a vendor someone heard about at a party: "Los Gallos"
    // Music unless asked otherwise ("all" = every kind of vendor); a type implies its category; a name looks everywhere.
    const category = type ? categoryOf(type) : q.category ? oneOf(q.category, "category", ["all", ...Object.keys(CATEGORIES)]) : name ? "all" : "music";
    const event = q.event ? oneOf(q.event, "event", EVENT_TYPES) : "";
    const maxPrice = q.max ? int(q.max, "max", { min: 1, max: 100000 }) * 100 : 0;
    const guests = q.guests ? int(q.guests, "guests", { min: 1, max: 5000 }) : 0;
    const date = q.date ? (isDate(q.date) ? q.date : (() => { throw new HttpError(400, "Bad date"); })()) : "";
    if (date && date <= todayStr()) throw new HttpError(400, "Pick a future date");
    const song = q.song ? norm(str(q.song, "song", { max: 60 })) : "";
    const sort = q.sort ? oneOf(q.sort, "sort", ["rating", "price", "distance"]) : "rating";
    const soon = q.soon === "1";
    const cap = Math.min(int(q.limit ?? limit, "limit", { min: 1, max: 50 }), 50);
    const page = q.page ? int(q.page, "page", { min: 0, max: 50 }) : 0; // "Show more" asks for the next page

    expirePending(db);
    const ratings = ratingMap(db), photos = firstPhotos(db);
    const minPrice = new Map(db.all("SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL GROUP BY group_id").map((r) => [r.group_id, r.m]));

    // Price filters and sorting compare the least a customer can book for (the card's "from" price).
    const priceKey = (g) => fromCents(g, minPrice);
    let list = [];
    // Only groups whose ZIP is inside the radius can match, so let SQL skip everything else.
    const nearby = zipsWithin(origin, radius);
    const candidates = nearby.length ? db.all(`SELECT * FROM groups WHERE ${LIVE_SQL} AND zip IN (${nearby.map(() => "?").join(",")})`, ...nearby) : [];
    for (const g of candidates) {
      const z = lookupZip(g.zip);
      if (!z) continue;
      const distance = miles(origin, z);
      if (distance > radius) continue;
      if (!reaches(g, distance)) continue; // beyond the vendor's own travel area
      if (type && g.type !== type) continue;
      if (category !== "all" && categoryOf(g.type) !== category) continue;
      if (name && !norm(g.name).includes(name)) continue;
      if (maxPrice && priceKey(g) > maxPrice) continue;
      if (guests && g.max_guests < guests) continue;
      const songs = safeJson(g.songs, []);
      const matched = song ? songs.filter((s) => norm(s).includes(song)) : [];
      if (song && !matched.length) continue;
      const openForDate = date ? openSlots(db, g.id, date, { expire: false }) : null;
      if (date && !openForDate.length) continue;
      const openSoon = openSoonOf(g);
      if (soon && !openSoon) continue;
      const events = safeJson(g.events, []);
      const fits = event ? (events.length ? events.includes(event) : (EVENT_FIT[event] || []).includes(g.type)) : false;
      const r = ratingOf(g, ratings);
      list.push({ g, distance, r, fits, matched, openForDate, openSoon, score: bayes(r.rating, r.reviews) });
    }
    // Paid placement, always labelled: on "Best match" Spotlight then Featured come first. When the family chose "Lowest
    // price" or "Closest", that choice is respected: at most PAID_ON_TOP paid listings go first, everyone else keeps the order asked for.
    const paidRank = (x) => (isSpotlight(x.g) ? 2 : isPromoted(x.g) ? 1 : 0);
    const chosen = (a, b) => {
      if (event && a.fits !== b.fits) return a.fits ? -1 : 1;
      if (sort === "price") return priceKey(a.g) - priceKey(b.g) || a.distance - b.distance;
      if (sort === "distance") return a.distance - b.distance;
      return b.score - a.score || b.r.reviews - a.r.reviews;
    };
    if (sort === "rating") list.sort((a, b) => paidRank(b) - paidRank(a) || chosen(a, b));
    else {
      list.sort(chosen);
      const top = list.filter((x) => paidRank(x)).sort((a, b) => paidRank(b) - paidRank(a) || chosen(a, b)).slice(0, PAID_ON_TOP);
      list = [...top, ...list.filter((x) => !top.includes(x))];
    }
    const total = list.length;
    list = list.slice(page * cap, page * cap + cap);

    return {
      origin: { zip: origin.zip, city: origin.city, state: origin.state, lat: origin.lat, lon: origin.lon },
      in_market: inMarket(origin.zip),
      results: list.map((x) => card(x, photos, minPrice)),
      page, total, more: total > (page + 1) * cap
    };
  }

  // A search card: the public listing, trimmed, with what the search worked out about it.
  function card(x, photos, minPrice) {
    const z = lookupZip(x.g.zip);
    const c = publicGroup(ctx, x.g, {
      rating: x.r,
      fields: {
        distance_miles: Math.round(x.distance), photo: photos.has(x.g.id) ? "/uploads/" + photos.get(x.g.id) : null,
        from_cents: fromCents(x.g, minPrice), fits_event: x.fits || false, matched_songs: (x.matched || []).slice(0, 3),
        open_slots: x.openForDate || null, open_soon: x.openSoon || null, lat: z.lat, lon: z.lon,
        travel_extra_cents: x.distance > x.g.travel_miles ? x.g.travel_fee_cents : 0 // what getting to this ZIP adds
      }
    });
    c.story = c.story.slice(0, 220);
    c.song_count = c.songs.length;
    delete c.songs;
    return c;
  }
  // "Last-minute": the first day with an open slot in the next 7 days
  function openSoonOf(g) { for (let i = 1; i <= 7; i++) if (openSlots(db, g.id, addDays(todayStr(), i), { expire: false }).length) return addDays(todayStr(), i); return null; }

  add("GET", "/api/health", () => ({ ok: true }));

  add("GET", "/api/meta", () => ({
    events: EVENT_TYPES, group_types: GROUP_TYPES, categories: CATEGORIES, hourly_by_default: HOURLY_BY_DEFAULT, slots: SLOTS, times: TIMES, short_minutes: SHORT_MINUTES, needs_presets: NEEDS_PRESETS, addon_presets: ADDON_PRESETS, max_hours: MAX_HOURS,
    policies: Object.fromEntries(Object.entries(POLICIES).map(([k, v]) => [k, v.text])),
    market: { name: MARKET.name, area: MARKET.area, center_zip: MARKET.center.zip, radius_miles: MARKET.radiusMiles, neighborhoods: MARKET.neighborhoods },
    helper: ctx.helper ? ctx.helper.mode : "off", support_email: config.supportEmail,
    payments: stripe.mode, sms: sms.mode, whatsapp: Boolean(config.twilioWhatsappFrom), pro_price_cents: config.proPriceCents, pro_fee_pct: config.proFeePct, fee_pct: config.platformFeePct, insurance_url: config.partyInsuranceUrl, email: ctx.email.mode, feature_price_cents: config.featurePriceCents, spotlight_price_cents: config.spotlightPriceCents, direct_fee_pct: config.directFeePct,
    hold_events: config.holdNewVendorEvents,
    founding: config.foundingSlots > 0 ? { left: foundingLeft(ctx.db, config), slots: config.foundingSlots, fee_pct: config.foundingFeePct, days: config.foundingDays } : null, holidays: upcomingHolidays(ctx.db, todayStr()), zip_count: zipCount(), today: todayStr(), timezone: getTimezone(),
    landing3d,
    play_url: config.androidPackage ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(config.androidPackage)}` : "", app_store_url: config.appStoreUrl
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

  add("GET", "/api/search", ({ query }) => {
    const out = search(query);
    if (!out.page) ctx.stats.count("search", out.origin.zip);
    ctx.stats.countMany("search_seen", out.results.map((g) => g.id)); // each vendor sees how often it shows up in searches
    // a search that found nobody: the clearest sign of where vendors are missing (what kind | which ZIP), on the Admin page
    if (!out.page && !out.results.length) ctx.stats.count("search_empty", `${query.type || query.category || "any"}|${out.origin.zip}`);
    return out;
  });

  // The home page's "In the spotlight" strip: paid Spotlight vendors of any kind near a ZIP (the market's center by default),
  // best rated first. Only Spotlight listings are read, so it stays cheap however many vendors there are.
  add("GET", "/api/spotlight", ({ query }) => {
    const origin = lookupZip(isZip(query.zip) ? query.zip : MARKET.center.zip) || lookupZip(MARKET.center.zip);
    const nearby = zipsWithin(origin, 60);
    const rows = nearby.length ? db.all(`SELECT * FROM groups WHERE ${LIVE_SQL} AND spotlight_until > ? AND zip IN (${nearby.map(() => "?").join(",")})`, now(), ...nearby) : [];
    if (!rows.length) return { results: [] };
    const ids = rows.map((g) => g.id), ratings = ratingMap(db, ids), photos = firstPhotos(db, ids);
    const minPrice = new Map(db.all(`SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL AND group_id IN (${ids.map(() => "?").join(",")}) GROUP BY group_id`, ...ids).map((r) => [r.group_id, r.m]));
    const list = rows.map((g) => { const z = lookupZip(g.zip); return { g, r: ratingOf(g, ratings), distance: z ? miles(origin, z) : Infinity }; }).filter((x) => x.distance <= 60)
      .sort((a, b) => bayes(b.r.rating, b.r.reviews) - bayes(a.r.rating, a.r.reviews)).slice(0, 6);
    return { results: list.map((x) => card({ ...x, openSoon: openSoonOf(x.g) }, photos, minPrice)) };
  });

  // "Best of your city": the top-rated groups within 40 miles of a ZIP.
  add("GET", "/api/best", ({ query }) => {
    const out = search({ zip: query.zip, sort: "rating", limit: 10 }, { defaultRadius: 40, limit: 10 });
    return { city: out.origin.city, state: out.origin.state, zip: out.origin.zip, groups: out.results };
  });
}
