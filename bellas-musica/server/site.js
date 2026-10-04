import { addDays, todayStr } from "./util.js";
import { getGroup, groupDetail, isLive, openSlots } from "./shared.js";
import { lookupZip } from "./geo.js";

const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0 });
const day = (k) => new Date(k + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// A free one-page website for every live listing: /v/<id>. Fast, readable without the app, shareable, and every button
// leads into the normal booking flow. (A custom domain or subdomain would need DNS set up by the site owner.)
export function renderVendorSite(ctx, id) {
  const { db, config } = ctx;
  let g;
  try { g = getGroup(db, id); } catch { return null; }
  if (!isLive(g)) return null;
  const d = groupDetail(ctx, g);
  const z = lookupZip(g.zip), place = z ? `${z.city}, ${z.state}` : "";
  const book = `${config.baseUrl}/#/group/${encodeURIComponent(g.id)}`, url = `${config.baseUrl}/v/${encodeURIComponent(g.id)}`;
  const open = [];
  for (let i = 1; i <= 120 && open.length < 6; i++) { const k = addDays(todayStr(), i); const s = openSlots(db, g.id, k, { expire: false }); if (s.length) open.push([k, s]); }
  const photo = d.photos[0] ? `${config.baseUrl}${d.photos[0].url}` : `${config.baseUrl}/og.png`;
  const badges = [d.verified && "✓ Verified", d.insured && "🛡 Insured", d.licensed && "📄 Licensed", d.pro && "★ Pro", d.events_done && `${d.events_done} events booked`].filter(Boolean);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${g.name}: ${url}`)}`;
  const desc = (g.story || `${g.type} in ${place}`).replace(/\s+/g, " ").slice(0, 200);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(g.name)} · ${h(g.type)}${place ? " in " + h(place) : ""}</title>
<meta name="description" content="${h(desc)}"><link rel="canonical" href="${h(url)}">
<meta property="og:type" content="website"><meta property="og:title" content="${h(g.name)}"><meta property="og:description" content="${h(desc)}"><meta property="og:image" content="${h(photo)}"><meta property="og:url" content="${h(url)}">
<link rel="icon" href="/logo.svg"><link rel="stylesheet" href="/style.css">
<style>
.site{max-width:820px;margin:0 auto;padding:16px}.site-hero{position:relative;border-radius:18px;overflow:hidden;background:radial-gradient(ellipse at 15% 20%,#1c3a7a,transparent 55%),#0b1430;color:#fff;min-height:240px;border:1px solid rgba(127,176,255,.25);display:flex;align-items:flex-end}
.site-hero img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}.site-hero .in{position:relative;padding:22px}.site-hero h1{color:#fff;font-size:clamp(1.8rem,5vw,2.6rem);margin:0 0 4px}
.site .btns{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.site .gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:12px 0}.site .gal img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px}
.site .row2{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dashed rgba(255,255,255,.14)}.site .pill{display:inline-block;background:rgba(47,107,255,.18);border:1px solid rgba(127,176,255,.4);color:#d6e4ff;backdrop-filter:none;border-radius:999px;padding:3px 10px;margin:2px;font-size:.85rem}
.site footer{color:var(--ink-2);font-size:.85rem;text-align:center;margin:26px 0}
</style></head><body><main class="site">
<section class="site-hero">${d.photos[0] ? `<img class="bg" src="${h(d.photos[0].url)}" alt="">` : ""}<div class="in"><h1>${h(g.name)}</h1><div>${h(g.type)}${place ? " · " + h(place) : ""}${d.reviews ? ` · ★ ${d.rating.toFixed(1)} (${d.reviews})` : ""}</div>
${badges.length ? `<div>${badges.map((b) => `<span class="pill">${h(b)}</span>`).join("")}</div>` : ""}</div></section>
<div class="btns"><a class="btn" href="${h(book)}">See dates &amp; book</a><a class="btn ghost" href="${h(book)}?chat=1">Send a message</a><a class="btn ghost" href="${h(wa)}" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></div>
${g.story ? `<div class="panel"><h2 class="sec">About us</h2><p>${h(g.story)}</p>${d.events.length ? `<p>${d.events.map((e) => `<span class="pill">${h(e)}</span>`).join("")}</p>` : ""}</div>` : ""}
${d.photos.length > 1 ? `<div class="gal">${d.photos.slice(0, 9).map((p) => `<img src="${h(p.url)}" alt="${h(g.name)}" loading="lazy">`).join("")}</div>` : ""}
${d.packages.length ? `<div class="panel"><h2 class="sec">Packages</h2>${d.packages.map((p) => `<div class="row2"><span><strong>${h(p.name)}</strong>${p.description ? `<br><span class="dim small">${h(p.description)}</span>` : ""}</span><strong>${usd(p.price_cents)}</strong></div>`).join("")}${g.hourly !== 0 ? `<p class="dim small">Or by the hour: ${usd(g.rate_cents)}/hr${g.min_hours > 1 ? `, ${g.min_hours}-hour minimum` : ""}.</p>` : ""}</div>` : g.hourly !== 0 ? `<div class="panel"><h2 class="sec">Price</h2><p>${usd(g.rate_cents)} per hour${g.min_hours > 1 ? `, ${g.min_hours}-hour minimum` : ""}.</p></div>` : ""}
${d.addons.length ? `<div class="panel"><h2 class="sec">Extras</h2>${d.addons.map((a) => `<div class="row2"><span>${h(a.name)}</span><span>${a.price_cents ? usd(a.price_cents) : "Included"}</span></div>`).join("")}</div>` : ""}
<div class="panel"><h2 class="sec">Next open dates</h2>${open.length ? open.map(([k, s]) => `<div class="row2"><span>${h(day(k))}</span><span class="dim">${h(s.length > 6 ? `${s[0]} – ${s[s.length - 1]}` : s.join(", "))}</span></div>`).join("") + `<p><a class="btn small" href="${h(book)}">Book one of these</a></p>` : `<p class="dim">Message us to ask about your date.</p>`}</div>
${d.recent_reviews.length ? `<div class="panel"><h2 class="sec">What customers say</h2>${d.recent_reviews.slice(0, 5).map((r) => `<p>${"★".repeat(r.rating)} <strong>${h(r.name)}</strong><br>${h(r.text)}</p>`).join("")}</div>` : ""}
${g.weather_policy ? `<div class="panel"><h2 class="sec">If it rains</h2><p>${h(g.weather_policy)}</p></div>` : ""}
<footer>Deposits and bookings are handled securely by <a href="${h(config.baseUrl)}/">Bella's Música</a>.</footer>
</main></body></html>`;
}
