import fs from "node:fs";
import path from "node:path";
import { lookupZip, miles, zipsWithin } from "./geo.js";
import { MARKET } from "./market.js";
import { LIVE_SQL, ratingMap, ratingOf } from "./shared.js";
import { safeJson } from "./util.js";

const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Serves the normal app page with Open Graph tags (so WhatsApp/iMessage/Facebook show a photo card)
// and a short plain-text summary that search engines and slow connections can read before the app loads.
export function renderSharePage(ctx, kind, id, extra) {
  const { db, config } = ctx;
  let html = fs.readFileSync(path.join(config.publicDir, "index.html"), "utf8");
  let title = "Bella's Música · Book live Mexican music", desc = "Find and book mariachis, bandas, norteños and more for your wedding, quinceañera or fiesta. See who is free and pay a deposit online.";
  let image = `${config.baseUrl}/og.png`, url = config.baseUrl + "/", summary = "";

  if (kind === "g") {
    const g = db.get(`SELECT * FROM groups WHERE id = ? AND ${LIVE_SQL}`, id);
    if (g) {
      const z = lookupZip(g.zip);
      const place = z ? `${z.city}, ${z.state}` : "";
      title = `${g.name} · ${g.type}${place ? " in " + place : ""}`;
      desc = (g.story || `${g.type} available for weddings, quinceañeras and parties.`).replace(/\s+/g, " ").slice(0, 200);
      const photo = db.get("SELECT file FROM photos WHERE group_id = ? ORDER BY position, created_at LIMIT 1", g.id);
      if (photo) image = `${config.baseUrl}/uploads/${photo.file}`;
      url = `${config.baseUrl}/g/${g.id}`;
      const fromPrice = db.get("SELECT MIN(price_cents) m FROM packages WHERE group_id = ? AND private_customer_id IS NULL", g.id).m ?? g.rate_cents;
      summary = `<div class="panel"><h1>${h(g.name)}</h1><p>${h(g.type)}${place ? " · " + h(place) : ""} · from $${Math.round(fromPrice / 100)}</p><p>${h(g.story)}</p></div>`;
    }
  } else if (kind === "c" && id === MARKET.key) {
    title = "Live Mexican music in Chicago: mariachi, banda, norteño and more · Bella's Música";
    desc = "Book mariachis, bandas, norteño groups and DJs for your quinceañera, wedding or fiesta anywhere in Chicagoland. See who is free on your date, compare prices, and pay a deposit online.";
    url = `${config.baseUrl}/c/${MARKET.key}`;
    summary = `<div class="panel"><h1>Live Mexican music for your Chicago fiesta</h1>
      <p>Bella's Música helps families in ${h(MARKET.area)} find and book mariachi, banda, norteño, grupera, trío and DJ groups for quinceañeras, weddings, birthdays, anniversaries and serenatas. Search by your date and guest count, compare prices, message the group, and secure your date with a deposit.</p>
      <h2>Serving</h2><p>${MARKET.neighborhoods.map((n) => `<a href="/${MARKET.key}/${n.id}">${h(n.name)}</a>`).join(", ")} and the surrounding suburbs.</p>
      <h2>Common questions</h2>
      <p><strong>How does the deposit work?</strong> You pay a deposit to request a group. If the group declines, you get it back in full. The balance is paid at the event or in the app.</p>
      <p><strong>What if I need to cancel?</strong> Each group shows its cancellation policy before you pay: flexible, moderate or strict.</p>
      <p><strong>Is there a fee for families?</strong> No. Groups pay a small platform fee out of the deposit.</p></div>`;
  } else if (kind === "b") {
    const z = lookupZip(id);
    if (z) {
      title = `Best mariachis and bands in ${z.city}, ${z.state} · Bella's Música`;
      desc = `The top-rated live Mexican music groups near ${z.city}, ${z.state}. See prices, open dates and book with a deposit.`;
      url = `${config.baseUrl}/b/${z.zip}`;
    }
  }

  let ld = "", robots = "";
  if (kind === "l") { // a neighborhood / event landing page (see renderLandingPage)
    if (!extra) return null;
    ({ title, desc, url, summary, ld } = extra);
    robots = extra.indexable ? "" : `<meta name="robots" content="noindex">`;
  }
  const tags = [
    `<meta name="description" content="${h(desc)}">`, `<link rel="canonical" href="${h(url)}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="Bella's Música">`,
    `<meta property="og:title" content="${h(title)}">`, `<meta property="og:description" content="${h(desc)}">`,
    `<meta property="og:url" content="${h(url)}">`, `<meta property="og:image" content="${h(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${h(title)}">`, `<meta name="twitter:image" content="${h(image)}">`,
    robots, ld
  ].filter(Boolean).join("\n");
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${h(title)}</title>`).replace("</head>", tags + "\n</head>");
  if (summary) html = html.replace('<main id="app"></main>', `<main id="app">${summary}</main>`);
  return html;
}

// ---- landing pages: /chicago/<neighborhood> and /chicago/<neighborhood>/<event> ----
// Real, indexable content for searches like "mariachi for a quinceañera in Pilsen": the real (non-sample) groups that
// serve that neighborhood, with their prices. A page with no real group behind it is still served, but marked noindex
// and left out of the sitemap, so search engines never see thin or made-up pages.
export const LANDING_EVENTS = {
  quinceanera: { event: "Quinceañera", phrase: "a quinceañera", label: "quinceañera" },
  wedding: { event: "Wedding", phrase: "a wedding", label: "wedding" },
  birthday: { event: "Birthday", phrase: "a birthday party", label: "birthday party" },
  serenata: { event: "Serenata", phrase: "a serenata", label: "serenata" },
  anniversary: { event: "Anniversary", phrase: "an anniversary", label: "anniversary" },
  corporate: { event: "Corporate / Restaurant", phrase: "a corporate event or restaurant", label: "corporate event" }
};
const LANDING_RADIUS = 20; // miles from the neighborhood's ZIP

// Real live groups serving a neighborhood, nearest first; with an event, those that play it (or haven't limited their events).
export function landingGroups(ctx, hood, eventKey) {
  const { db } = ctx;
  const origin = lookupZip(hood.zip);
  if (!origin) return [];
  const nearby = zipsWithin(origin, LANDING_RADIUS);
  if (!nearby.length) return [];
  const ratings = ratingMap(db);
  const minPrice = new Map(db.all("SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL GROUP BY group_id").map((r) => [r.group_id, r.m]));
  const want = eventKey ? LANDING_EVENTS[eventKey].event : "";
  const out = [];
  for (const g of db.all(`SELECT * FROM groups WHERE demo = 0 AND ${LIVE_SQL} AND zip IN (${nearby.map(() => "?").join(",")})`, ...nearby)) {
    const z = lookupZip(g.zip);
    if (!z) continue;
    const d = miles(origin, z);
    if (d > LANDING_RADIUS) continue;
    const events = safeJson(g.events, []);
    if (want && events.length && !events.includes(want)) continue;
    out.push({ g, distance: d, from: minPrice.get(g.id) ?? g.rate_cents, r: ratingOf(g, ratings), place: `${z.city}, ${z.state}` });
  }
  return out.sort((a, b) => a.distance - b.distance || b.r.rating - a.r.rating);
}

export function renderLandingPage(ctx, hoodId, eventKey) {
  const { config } = ctx;
  const hood = MARKET.neighborhoods.find((n) => n.id === hoodId);
  const ev = eventKey ? LANDING_EVENTS[eventKey] : null;
  if (!hood || (eventKey && !ev)) return null;
  const groups = landingGroups(ctx, hood, eventKey);
  const what = ev ? `for ${ev.phrase}` : "for your event";
  const title = `Live mariachi, banda and norteño ${what} in ${hood.name}, ${MARKET.name} · Bella's Música`;
  const url = `${config.baseUrl}/${MARKET.key}/${hood.id}${ev ? "/" + eventKey : ""}`;
  const rates = groups.map((x) => x.g.rate_cents);
  const priceLine = groups.length ? ` Groups near ${hood.name} list from $${Math.round(Math.min(...groups.map((x) => x.from)) / 100)}${rates.length > 1 ? `; hourly rates run $${Math.round(Math.min(...rates) / 100)} to $${Math.round(Math.max(...rates) / 100)}` : ""}.` : "";
  const desc = `Book live Mexican music ${what} in ${hood.name}, ${MARKET.name}. ${groups.length ? `${groups.length} local group${groups.length > 1 ? "s" : ""} with prices and open dates.` : "See who is free on your date."}${priceLine} Pay a deposit online.`.slice(0, 300);
  const searchHash = `/chicago/${hood.id}${ev ? "/" + eventKey : ""}`; // opens the search for this place and event inside the app
  const list = groups.length
    ? `<ul>${groups.map((x) => `<li><a href="/g/${h(x.g.id)}"><strong>${h(x.g.name)}</strong></a> · ${h(x.g.type)} · ${Math.round(x.distance) < 1 ? "in the neighborhood" : `${Math.round(x.distance)} mi away`} · from $${Math.round(x.from / 100)}${x.r.reviews ? ` · ★ ${x.r.rating.toFixed(1)} (${x.r.reviews})` : ""}</li>`).join("")}</ul>`
    : `<p>We're adding groups in ${h(hood.name)} now. Search by your date to see who is free.</p>`;
  const others = MARKET.neighborhoods.filter((n) => n.id !== hood.id).slice(0, 8).map((n) => `<a href="/${MARKET.key}/${n.id}${ev ? "/" + eventKey : ""}">${h(n.name)}</a>`).join(" · ");
  const evLinks = Object.entries(LANDING_EVENTS).filter(([k]) => k !== eventKey).map(([k, e]) => `<a href="/${MARKET.key}/${hood.id}/${k}">${h(e.label)}</a>`).join(" · ");
  const summary = `<div class="panel"><h1>Live Mexican music ${h(what)} in ${h(hood.name)}, ${h(MARKET.name)}</h1>
    <p>Bella's Música helps families in ${h(hood.name)} and across ${h(MARKET.area)} book mariachi, banda, norteño, grupera, trío and DJ groups ${h(what)}. See each group's price and open dates first, message them, and secure your date with a deposit. If a group doesn't show up, you get back everything you paid in the app.</p>
    <h2>Groups serving ${h(hood.name)}</h2>${list}
    <p><a class="btn" href="${h(searchHash)}">See who is free on your date</a></p>
    ${ev ? "" : `<h2>By event</h2><p>${evLinks}</p>`}
    <h2>Nearby</h2><p>${others}</p></div>`;
  const ld = groups.length ? `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: title.replace(" · Bella's Música", ""),
    itemListElement: groups.map((x, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "MusicGroup", name: x.g.name, url: `${config.baseUrl}/g/${x.g.id}`, address: { "@type": "PostalAddress", addressLocality: x.place.split(", ")[0], addressRegion: x.place.split(", ")[1] }, ...(x.r.reviews >= 3 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Math.round(x.r.rating * 10) / 10, reviewCount: x.r.reviews } } : {}) } }))
  }).replace(/</g, "\\u003c")}</script>` : "";
  return { title, desc, url, summary, ld, indexable: groups.length > 0 };
}

export function robotsTxt(config) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${config.baseUrl}/sitemap.xml\n`;
}

export function sitemapXml(ctx) {
  const { db, config } = ctx;
  const urls = [config.baseUrl + "/", `${config.baseUrl}/c/${MARKET.key}`];
  const zips = new Set();
  for (const g of db.all(`SELECT id, zip FROM groups WHERE demo = 0 AND ${LIVE_SQL} ORDER BY created_at`)) { urls.push(`${config.baseUrl}/g/${g.id}`); zips.add(g.zip); }
  for (const z of zips) urls.push(`${config.baseUrl}/b/${z}`);
  // landing pages only when a real group stands behind them
  for (const hood of MARKET.neighborhoods) {
    if (landingGroups(ctx, hood, "").length) urls.push(`${config.baseUrl}/${MARKET.key}/${hood.id}`);
    for (const k of Object.keys(LANDING_EVENTS)) if (landingGroups(ctx, hood, k).length) urls.push(`${config.baseUrl}/${MARKET.key}/${hood.id}/${k}`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${h(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}
