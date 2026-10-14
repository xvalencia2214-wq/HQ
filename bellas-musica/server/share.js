import fs from "node:fs";
import path from "node:path";
import { lookupZip, miles, zipsWithin } from "./geo.js";
import { MARKET } from "./market.js";
import { LIVE_SQL, fromCents, ratingMap, ratingOf, reaches } from "./shared.js";
import { categoryOf } from "./pricing.js";
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

  let ld = "", robots = "", alternates = "";
  if (kind === "l") { // a neighborhood / event landing page (see renderLandingPage)
    if (!extra) return null;
    ({ title, desc, url, summary, ld } = extra);
    robots = extra.indexable ? "" : `<meta name="robots" content="noindex">`;
    // the same page in English and Spanish: search engines show each person the one in their language
    alternates = Object.entries(extra.alternates || {}).map(([l, u]) => `<link rel="alternate" hreflang="${l}" href="${h(u)}">`).join("\n") + (extra.alternates ? `\n<link rel="alternate" hreflang="x-default" href="${h(extra.alternates.en)}">` : "");
    if (extra.lang === "es") html = html.replace('<html lang="en">', '<html lang="es">');
  }
  const tags = [
    `<meta name="description" content="${h(desc)}">`, `<link rel="canonical" href="${h(url)}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="Bella's Música">`,
    `<meta property="og:title" content="${h(title)}">`, `<meta property="og:description" content="${h(desc)}">`,
    `<meta property="og:url" content="${h(url)}">`, `<meta property="og:image" content="${h(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${h(title)}">`, `<meta name="twitter:image" content="${h(image)}">`,
    robots, alternates, ld
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
  corporate: { event: "Corporate / Restaurant", phrase: "a corporate event or restaurant", label: "corporate event" },
  baptism: { event: "Baptism", phrase: "a baptism", label: "baptism" },
  "first-communion": { event: "First Communion", phrase: "a first communion", label: "first communion" },
  graduation: { event: "Graduation", phrase: "a graduation party", label: "graduation party" },
  "baby-shower": { event: "Baby shower", phrase: "a baby shower", label: "baby shower" },
  funeral: { event: "Funeral / Memorial", phrase: "a funeral or memorial", label: "funeral or memorial" }
};
// The Spanish pages (/es/chicago/<barrio>/<evento>): most families search in Spanish ("mariachi para quinceañera en Pilsen").
export const LANDING_EVENTS_ES = {
  quinceanera: { key: "quinceanera", phrase: "una quinceañera", label: "quinceañera" },
  boda: { key: "wedding", phrase: "una boda", label: "boda" },
  cumpleanos: { key: "birthday", phrase: "un cumpleaños", label: "cumpleaños" },
  serenata: { key: "serenata", phrase: "una serenata", label: "serenata" },
  aniversario: { key: "anniversary", phrase: "un aniversario", label: "aniversario" },
  corporativo: { key: "corporate", phrase: "un evento corporativo o restaurante", label: "evento corporativo" },
  bautizo: { key: "baptism", phrase: "un bautizo", label: "bautizo" },
  "primera-comunion": { key: "first-communion", phrase: "una primera comunión", label: "primera comunión" },
  graduacion: { key: "graduation", phrase: "una graduación", label: "graduación" },
  "baby-shower": { key: "baby-shower", phrase: "un baby shower", label: "baby shower" },
  funeral: { key: "funeral", phrase: "un funeral o una misa", label: "funeral" }
};
const esSlugOf = (key) => Object.keys(LANDING_EVENTS_ES).find((s) => LANDING_EVENTS_ES[s].key === key);
// Everything else a party needs gets its own pages too: /chicago/pilsen/catering, /es/chicago/pilsen/comida...
export const LANDING_CATS = {
  catering: { cat: "food", es: "comida", en: { h: "Catering and food", what: "taqueros, catering, food trucks, cakes and aguas frescas", noun: "food vendors" }, esText: { h: "Comida para fiestas", what: "taqueros, banquetes, food trucks, pasteles y aguas frescas", noun: "proveedores de comida" } },
  decorations: { cat: "decor", es: "decoracion", en: { h: "Party decorations", what: "balloon garlands, flowers, backdrops and full hall decoration", noun: "decorators" }, esText: { h: "Decoración para fiestas", what: "arcos de globos, flores, fondos y decoración de salón", noun: "decoradores" } },
  rentals: { cat: "rentals", es: "rentas", en: { h: "Party rentals", what: "tents, tables and chairs, bounce houses, dance floors and linens", noun: "rental companies" }, esText: { h: "Renta de mobiliario", what: "carpas, mesas y sillas, brincolines, pistas de baile y mantelería", noun: "negocios de rentas" } },
  "photo-video": { cat: "photo", es: "foto-video", en: { h: "Photo and video", what: "photographers, videographers and photo booths", noun: "photographers" }, esText: { h: "Foto y video", what: "fotógrafos, videógrafos y cabinas de fotos", noun: "fotógrafos" } },
  "party-services": { cat: "services", es: "servicios", en: { h: "Party help", what: "security, bartenders, MCs, choreographers, hair and makeup, and clean-up", noun: "service pros" }, esText: { h: "Servicios para fiestas", what: "seguridad, bartenders, animadores, coreógrafos, peinado y maquillaje, y limpieza", noun: "proveedores" } },
  venues: { cat: "venues", es: "salones", en: { h: "Party halls and venues", what: "party halls and outdoor spaces", noun: "venues" }, esText: { h: "Salones para fiestas", what: "salones de fiestas y espacios al aire libre", noun: "salones" } }
};
const catOfEsSlug = (s) => Object.keys(LANDING_CATS).find((k) => LANDING_CATS[k].es === s);
const LANDING_RADIUS = 20; // miles from the neighborhood's ZIP

// Real live groups serving a neighborhood, nearest first; with an event, those that play it (or haven't limited their events).
const playsEvent = (x, eventKey) => { if (!eventKey) return true; const events = safeJson(x.g.events, []); return !events.length || events.includes(LANDING_EVENTS[eventKey].event); };

// All real live groups near a neighborhood, nearest first. `shared` lets the sitemap load ratings and prices once for every neighborhood.
function hoodGroups(ctx, hood, shared = {}) {
  const { db } = ctx;
  const origin = lookupZip(hood.zip);
  if (!origin) return [];
  const nearby = zipsWithin(origin, LANDING_RADIUS);
  if (!nearby.length) return [];
  const ratings = shared.ratings || ratingMap(db);
  const minPrice = shared.minPrice || new Map(db.all("SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL GROUP BY group_id").map((r) => [r.group_id, r.m]));
  const out = [];
  for (const g of db.all(`SELECT * FROM groups WHERE demo = 0 AND ${LIVE_SQL} AND zip IN (${nearby.map(() => "?").join(",")})`, ...nearby)) {
    const z = lookupZip(g.zip);
    if (!z) continue;
    const d = miles(origin, z);
    if (d > LANDING_RADIUS || !reaches(g, d)) continue;
    out.push({ g, cat: categoryOf(g.type), distance: d, from: fromCents(g, minPrice), r: ratingOf(g, ratings), place: `${z.city}, ${z.state}` });
  }
  return out.sort((a, b) => a.distance - b.distance || b.r.rating - a.r.rating);
}

// Real live groups serving a neighborhood; with an event, those that play it (or haven't limited their events).
export function landingGroups(ctx, hood, eventKey) {
  return hoodGroups(ctx, hood).filter((x) => x.cat === "music" && playsEvent(x, eventKey));
}

export function renderLandingPage(ctx, hoodId, eventSlug, lang = "en") {
  const { config } = ctx;
  const hood = MARKET.neighborhoods.find((n) => n.id === hoodId);
  const catKey = lang === "es" ? catOfEsSlug(eventSlug) : LANDING_CATS[eventSlug] ? eventSlug : "";
  if (hood && catKey) return categoryPage(ctx, hood, catKey, lang);
  // Spanish pages use Spanish event words in the address (boda, cumpleanos...); both point at the same event
  const eventKey = lang === "es" ? (eventSlug ? LANDING_EVENTS_ES[eventSlug]?.key : "") : eventSlug;
  const ev = eventKey ? LANDING_EVENTS[eventKey] : null;
  if (!hood || (eventSlug && !ev)) return null;
  const groups = landingGroups(ctx, hood, eventKey);
  const alternates = { en: `${config.baseUrl}/${MARKET.key}/${hood.id}${ev ? "/" + eventKey : ""}`, es: `${config.baseUrl}/es/${MARKET.key}/${hood.id}${ev ? "/" + esSlugOf(eventKey) : ""}` };
  if (lang === "es") return landingPageEs(ctx, hood, eventKey, groups, alternates);
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
    <h2>Nearby</h2><p>${others}</p><p><a href="${h(alternates.es.replace(config.baseUrl, ""))}" hreflang="es">En español</a></p></div>`;
  const ld = groups.length ? `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: title.replace(" · Bella's Música", ""),
    itemListElement: groups.map((x, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "MusicGroup", name: x.g.name, url: `${config.baseUrl}/g/${x.g.id}`, address: { "@type": "PostalAddress", addressLocality: x.place.split(", ")[0], addressRegion: x.place.split(", ")[1] }, ...(x.r.reviews >= 3 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Math.round(x.r.rating * 10) / 10, reviewCount: x.r.reviews } } : {}) } }))
  }).replace(/</g, "\\u003c")}</script>` : "";
  return { title, desc, url, summary, ld, indexable: groups.length > 0, alternates, lang: "en" };
}

// A page for one kind of party vendor near a neighborhood (catering, decorations...), in English or Spanish.
function categoryPage(ctx, hood, catKey, lang) {
  const { config } = ctx;
  const c = LANDING_CATS[catKey], es = lang === "es", tx = es ? c.esText : c.en;
  const groups = hoodGroups(ctx, hood).filter((x) => x.cat === c.cat);
  const alternates = { en: `${config.baseUrl}/${MARKET.key}/${hood.id}/${catKey}`, es: `${config.baseUrl}/es/${MARKET.key}/${hood.id}/${c.es}` };
  const title = es ? `${tx.h} en ${hood.name}, ${MARKET.name} · Bella's Música` : `${tx.h} in ${hood.name}, ${MARKET.name} · Bella's Música`;
  const from = groups.length ? Math.round(Math.min(...groups.map((x) => x.from)) / 100) : 0;
  const desc = (es
    ? `Contrata ${tx.what} en ${hood.name}, ${MARKET.name}. ${groups.length ? `${groups.length} ${tx.noun} de la zona con precios y fechas libres, desde $${from}.` : "Ve quién está libre en tu fecha."} Paga un depósito en línea.`
    : `Book ${tx.what} in ${hood.name}, ${MARKET.name}. ${groups.length ? `${groups.length} local ${tx.noun} with prices and open dates, from $${from}.` : "See who is free on your date."} Pay a deposit online.`).slice(0, 300);
  const searchHash = `/chicago/${hood.id}/${catKey}`;
  const list = groups.length
    ? `<ul>${groups.map((x) => `<li><a href="/g/${h(x.g.id)}"><strong>${h(x.g.name)}</strong></a> · ${h(x.g.type)} · ${Math.round(x.distance) < 1 ? (es ? "en el barrio" : "in the neighborhood") : es ? `a ${Math.round(x.distance)} millas` : `${Math.round(x.distance)} mi away`} · ${es ? "desde" : "from"} $${Math.round(x.from / 100)}${x.r.reviews ? ` · ★ ${x.r.rating.toFixed(1)} (${x.r.reviews})` : ""}</li>`).join("")}</ul>`
    : `<p>${es ? `Estamos sumando ${h(tx.noun)} en ${h(hood.name)}. Busca por tu fecha para ver quién está libre.` : `We're adding ${h(tx.noun)} in ${h(hood.name)} now. Search by your date to see who is free.`}</p>`;
  const others = MARKET.neighborhoods.filter((n) => n.id !== hood.id).slice(0, 8).map((n) => `<a href="${es ? "/es" : ""}/${MARKET.key}/${n.id}/${es ? c.es : catKey}">${h(n.name)}</a>`).join(" · ");
  const kinds = Object.entries(LANDING_CATS).filter(([k]) => k !== catKey).map(([k, o]) => `<a href="${es ? "/es" : ""}/${MARKET.key}/${hood.id}/${es ? o.es : k}">${h((es ? o.esText : o.en).h)}</a>`).join(" · ");
  const summary = `<div class="panel"><h1>${h(tx.h)} ${es ? "en" : "in"} ${h(hood.name)}, ${h(MARKET.name)}</h1>
    <p>${es ? `Bella's Música ayuda a las familias de ${h(hood.name)} a contratar ${h(tx.what)}. Ve primero el precio y las fechas libres, mándales un mensaje y aparta tu fecha con un depósito.` : `Bella's Música helps families in ${h(hood.name)} book ${h(tx.what)}. See prices and open dates first, message them, and secure your date with a deposit.`}</p>
    <h2>${es ? `${h(tx.noun[0].toUpperCase() + tx.noun.slice(1))} cerca de ${h(hood.name)}` : `${h(tx.noun[0].toUpperCase() + tx.noun.slice(1))} serving ${h(hood.name)}`}</h2>${list}
    <p><a class="btn" href="${h(searchHash)}">${es ? "Ve quién está libre en tu fecha" : "See who is free on your date"}</a></p>
    <h2>${es ? "Todo para tu fiesta" : "Everything for your party"}</h2><p><a href="${es ? "/es" : ""}/${MARKET.key}/${hood.id}">${es ? "Música en vivo" : "Live music"}</a> · ${kinds}</p>
    <h2>${es ? "Cerca" : "Nearby"}</h2><p>${others}</p><p><a href="${h((es ? alternates.en : alternates.es).replace(config.baseUrl, ""))}" hreflang="${es ? "en" : "es"}">${es ? "English" : "En español"}</a></p></div>`;
  const ld = groups.length ? `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: title.replace(" · Bella's Música", ""), ...(es ? { inLanguage: "es" } : {}),
    itemListElement: groups.map((x, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "LocalBusiness", name: x.g.name, url: `${config.baseUrl}/g/${x.g.id}`, address: { "@type": "PostalAddress", addressLocality: x.place.split(", ")[0], addressRegion: x.place.split(", ")[1] }, ...(x.r.reviews >= 3 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Math.round(x.r.rating * 10) / 10, reviewCount: x.r.reviews } } : {}) } }))
  }).replace(/</g, "\\u003c")}</script>` : "";
  return { title, desc, url: es ? alternates.es : alternates.en, summary, ld, indexable: groups.length > 0, alternates, lang: es ? "es" : "en" };
}

function landingPageEs(ctx, hood, eventKey, groups, alternates) {
  const esSlug = eventKey ? esSlugOf(eventKey) : "";
  const ev = esSlug ? LANDING_EVENTS_ES[esSlug] : null;
  const what = ev ? `para ${ev.phrase}` : "para tu fiesta";
  const title = `Mariachi, banda y norteño en vivo ${what} en ${hood.name}, ${MARKET.name} · Bella's Música`;
  const rates = groups.map((x) => x.g.rate_cents);
  const priceLine = groups.length ? ` Los grupos cerca de ${hood.name} cobran desde $${Math.round(Math.min(...groups.map((x) => x.from)) / 100)}${rates.length > 1 ? `; por hora, de $${Math.round(Math.min(...rates) / 100)} a $${Math.round(Math.max(...rates) / 100)}` : ""}.` : "";
  const desc = `Contrata música mexicana en vivo ${what} en ${hood.name}, ${MARKET.name}. ${groups.length ? `${groups.length} grupo${groups.length > 1 ? "s" : ""} de la zona con precios y fechas libres.` : "Ve quién está libre en tu fecha."}${priceLine} Paga un depósito en línea.`.slice(0, 300);
  const searchHash = `/chicago/${hood.id}${eventKey ? "/" + eventKey : ""}`;
  const list = groups.length
    ? `<ul>${groups.map((x) => `<li><a href="/g/${h(x.g.id)}"><strong>${h(x.g.name)}</strong></a> · ${h(x.g.type)} · ${Math.round(x.distance) < 1 ? "en el barrio" : `a ${Math.round(x.distance)} millas`} · desde $${Math.round(x.from / 100)}${x.r.reviews ? ` · ★ ${x.r.rating.toFixed(1)} (${x.r.reviews})` : ""}</li>`).join("")}</ul>`
    : `<p>Estamos sumando grupos en ${h(hood.name)}. Busca por tu fecha para ver quién está libre.</p>`;
  const others = MARKET.neighborhoods.filter((n) => n.id !== hood.id).slice(0, 8).map((n) => `<a href="/es/${MARKET.key}/${n.id}${esSlug ? "/" + esSlug : ""}">${h(n.name)}</a>`).join(" · ");
  const evLinks = Object.entries(LANDING_EVENTS_ES).filter(([s]) => s !== esSlug).map(([s, e]) => `<a href="/es/${MARKET.key}/${hood.id}/${s}">${h(e.label)}</a>`).join(" · ");
  const summary = `<div class="panel"><h1>Música mexicana en vivo ${h(what)} en ${h(hood.name)}, ${h(MARKET.name)}</h1>
    <p>Bella's Música ayuda a las familias de ${h(hood.name)} y de todo ${h(MARKET.area)} a contratar mariachi, banda, norteño, grupera, trío y DJ ${h(what)}. Ve primero el precio y las fechas libres de cada grupo, mándales un mensaje y aparta tu fecha con un depósito. Si un grupo no llega, te devolvemos todo lo que pagaste en la app.</p>
    <h2>Grupos que tocan en ${h(hood.name)}</h2>${list}
    <p><a class="btn" href="${h(searchHash)}">Ve quién está libre en tu fecha</a></p>
    ${ev ? "" : `<h2>Por evento</h2><p>${evLinks}</p>`}
    <h2>Cerca</h2><p>${others}</p><p><a href="${h(alternates.en.replace(ctx.config.baseUrl, ""))}" hreflang="en">English</a></p></div>`;
  const ld = groups.length ? `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: title.replace(" · Bella's Música", ""), inLanguage: "es",
    itemListElement: groups.map((x, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "MusicGroup", name: x.g.name, url: `${ctx.config.baseUrl}/g/${x.g.id}`, address: { "@type": "PostalAddress", addressLocality: x.place.split(", ")[0], addressRegion: x.place.split(", ")[1] }, ...(x.r.reviews >= 3 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Math.round(x.r.rating * 10) / 10, reviewCount: x.r.reviews } } : {}) } }))
  }).replace(/</g, "\\u003c")}</script>` : "";
  return { title, desc, url: alternates.es, summary, ld, indexable: groups.length > 0, alternates, lang: "es" };
}

export function robotsTxt(config) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${config.baseUrl}/sitemap.xml\n`;
}

// Built from every real group, so with thousands of groups it is not free. This server handles one request at a time, so the result
// is kept for a few minutes (SITEMAP_CACHE seconds; a crawler doesn't need it to be fresher) and each neighborhood is loaded once.
let sitemapCache = { at: 0, key: "", xml: "" };
export function sitemapXml(ctx) {
  const { db, config } = ctx;
  const ttl = config.sitemapCacheSeconds * 1000;
  if (ttl > 0 && sitemapCache.key === config.baseUrl && Date.now() - sitemapCache.at < ttl) return sitemapCache.xml;
  const urls = [config.baseUrl + "/", `${config.baseUrl}/c/${MARKET.key}`];
  const zips = new Set();
  for (const g of db.all(`SELECT id, zip FROM groups WHERE demo = 0 AND ${LIVE_SQL} ORDER BY created_at`)) { urls.push(`${config.baseUrl}/g/${g.id}`); zips.add(g.zip); }
  for (const z of zips) urls.push(`${config.baseUrl}/b/${z}`);
  // landing pages only when a real group stands behind them
  const shared = { ratings: ratingMap(db), minPrice: new Map(db.all("SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL GROUP BY group_id").map((r) => [r.group_id, r.m])) };
  for (const hood of MARKET.neighborhoods) {
    const everyone = hoodGroups(ctx, hood, shared), all = everyone.filter((x) => x.cat === "music");
    for (const [k, c] of Object.entries(LANDING_CATS)) if (everyone.some((x) => x.cat === c.cat)) urls.push(`${config.baseUrl}/${MARKET.key}/${hood.id}/${k}`, `${config.baseUrl}/es/${MARKET.key}/${hood.id}/${c.es}`);
    if (all.length) urls.push(`${config.baseUrl}/${MARKET.key}/${hood.id}`, `${config.baseUrl}/es/${MARKET.key}/${hood.id}`);
    for (const k of Object.keys(LANDING_EVENTS)) if (all.some((x) => playsEvent(x, k))) urls.push(`${config.baseUrl}/${MARKET.key}/${hood.id}/${k}`, `${config.baseUrl}/es/${MARKET.key}/${hood.id}/${esSlugOf(k)}`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${h(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
  sitemapCache = { at: Date.now(), key: config.baseUrl, xml };
  return xml;
}
