import { HttpError, int, isZip, str } from "../util.js";
import { lookupZip, miles, zipsWithin } from "../geo.js";
import { MARKET } from "../market.js";
import { embedUrl } from "../media.js";
import { LIVE_SQL, firstPhotos, isPromoted, ratingMap, ratingOf } from "../shared.js";

const PAGE = 6;           // cards per request
const MAX_ITEMS = 60;     // the longest one session of scrolling can be; usually it ends sooner with "you've seen everyone nearby"
const EVERY = 4;          // the feed's rhythm: [group, PROMOTED, group, group]
const PROMO_SLOT = 1;     // ...so a promoted card is the 2nd, 6th, 10th...

// Small seeded shuffle so a visitor's scroll order is stable while paging, but different from other visitors'.
function rng(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  for (const c of String(seedStr)) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (list, rand) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// "Discover": a swipeable feed of nearby groups. Groups that paid for Featured also get more turns here (labelled "Promoted");
// everyone else still appears, in an order that favors groups with a video, then a photo.
export default function feedRoutes(ctx, add) {
  const { db, stats, limiters } = ctx;

  add("GET", "/api/feed", ({ query }) => {
    const zip = query.zip ? str(query.zip, "ZIP", { max: 5 }) : MARKET.center.zip;
    if (!isZip(zip)) throw new HttpError(400, "Enter a 5-digit ZIP code");
    const origin = lookupZip(zip);
    if (!origin) throw new HttpError(404, "We don't recognize that ZIP code");
    const radius = query.radius ? int(query.radius, "radius", { min: 5, max: 150 }) : 60;
    const page = query.page ? int(query.page, "page", { min: 0, max: 100 }) : 0;
    const seed = str(query.seed || "x", "seed", { max: 40 });

    const nearby = zipsWithin(origin, radius);
    const rows = nearby.length ? db.all(`SELECT * FROM groups WHERE ${LIVE_SQL} AND zip IN (${nearby.map(() => "?").join(",")})`, ...nearby) : [];
    const ratings = ratingMap(db), photos = firstPhotos(db);
    const cards = new Map();
    for (const g of rows) {
      const z = lookupZip(g.zip);
      if (!z) continue;
      const d = miles(origin, z);
      if (d > radius) continue;
      const r = ratingOf(g, ratings);
      cards.set(g.id, {
        g, tier: g.video_provider ? 0 : photos.has(g.id) ? 1 : 2,
        item: {
          id: g.id, name: g.name, type: g.type, city: z.city, state: z.state, distance_miles: Math.round(d),
          rating: Math.round(r.rating * 10) / 10, reviews: r.reviews, members: g.members, story: String(g.story || "").slice(0, 160),
          from_cents: null, verified: Boolean(g.verified), insured: Boolean(g.insured), demo: Boolean(g.demo),
          promoted: isPromoted(g),
          video: g.video_provider ? { provider: g.video_provider, id: g.video_id, embed: embedUrl(g.video_provider, g.video_id) } : null,
          photo: photos.has(g.id) ? "/uploads/" + photos.get(g.id) : null
        }
      });
    }
    const minPrice = new Map(db.all("SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL GROUP BY group_id").map((r) => [r.group_id, r.m]));
    for (const c of cards.values()) c.item.from_cents = minPrice.get(c.g.id) ?? c.g.rate_cents;

    const rand = rng(`${seed}|${zip}`);
    const all = [...cards.values()];
    const promoted = shuffle(all.filter((c) => c.item.promoted), rand).map((c) => c.item);
    // organic order: clips first, then photos, then the rest; shuffled inside each tier
    const organic = [0, 1, 2].flatMap((tier) => shuffle(all.filter((c) => !c.item.promoted && c.tier === tier), rand)).map((c) => c.item);

    // Build the stream by position. Every group appears once. Promoted groups take every 4th slot while there are other cards
    // to put between them, so a paying group with a big feed comes around several times; nobody repeats back to back.
    const stream = [];
    let oi = 0, pi = 0;
    for (let i = 0; i < MAX_ITEMS; i++) {
      if (oi >= organic.length && pi >= promoted.length) break;
      let pick;
      if (promoted.length && i % EVERY === PROMO_SLOT && oi < organic.length) pick = promoted[pi++ % promoted.length];
      else if (oi < organic.length) pick = organic[oi++];
      else pick = promoted[pi++]; // the organic cards ran out: show any promoted group not yet seen
      stream.push({ ...pick, position: i });
    }
    const items = stream.slice(page * PAGE, page * PAGE + PAGE);
    return {
      origin: { zip: origin.zip, city: origin.city, state: origin.state },
      items, next: (page + 1) * PAGE < stream.length ? page + 1 : null, groups_nearby: cards.size
    };
  });

  // Anonymous, capped counters so groups can see what the feed did for them: "view" = a card was on screen for a moment,
  // "tap" = someone opened the profile or chat from it. Each visitor counts at most a few times per group per half hour.
  add("POST", "/api/feed/event", ({ body, ip }) => {
    const kind = body.kind === "tap" ? "tap" : body.kind === "view" ? "view" : null;
    if (!kind) throw new HttpError(400, "Unknown event");
    const id = str(body.groupId, "Group", { required: true, max: 80 });
    if (!limiters.feedEvent.check(`${ip}|${id}|${kind}`)) return { ok: true, counted: false };
    const g = db.get(`SELECT id FROM groups WHERE id = ? AND ${LIVE_SQL}`, id);
    if (!g) return { ok: true, counted: false };
    stats.count(kind === "tap" ? "feed_tap" : "feed_view", g.id);
    return { ok: true, counted: true };
  });
}
