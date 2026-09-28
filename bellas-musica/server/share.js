import fs from "node:fs";
import path from "node:path";
import { lookupZip } from "./geo.js";

const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Serves the normal app page with Open Graph tags (so WhatsApp/iMessage/Facebook show a photo card)
// and a short plain-text summary that search engines and slow connections can read before the app loads.
export function renderSharePage(ctx, kind, id) {
  const { db, config } = ctx;
  let html = fs.readFileSync(path.join(config.publicDir, "index.html"), "utf8");
  let title = "Bella's Música · Book live Mexican music", desc = "Find and book mariachis, bandas, norteños and more for your wedding, quinceañera or fiesta. See who is free and pay a deposit online.";
  let image = `${config.baseUrl}/og.png`, url = config.baseUrl + "/", summary = "";

  if (kind === "g") {
    const g = db.get("SELECT * FROM groups WHERE id = ? AND hidden = 0", id);
    if (g) {
      const z = lookupZip(g.zip);
      const place = z ? `${z.city}, ${z.state}` : "";
      title = `${g.name} · ${g.type}${place ? " in " + place : ""}`;
      desc = (g.story || `${g.type} available for weddings, quinceañeras and parties.`).replace(/\s+/g, " ").slice(0, 200);
      const photo = db.get("SELECT file FROM photos WHERE group_id = ? ORDER BY position, created_at LIMIT 1", g.id);
      if (photo) image = `${config.baseUrl}/uploads/${photo.file}`;
      url = `${config.baseUrl}/g/${g.id}`;
      const fromPrice = db.get("SELECT MIN(price_cents) m FROM packages WHERE group_id = ?", g.id).m ?? g.rate_cents;
      summary = `<div class="panel"><h1>${h(g.name)}</h1><p>${h(g.type)}${place ? " · " + h(place) : ""} · from $${Math.round(fromPrice / 100)}</p><p>${h(g.story)}</p></div>`;
    }
  } else if (kind === "b") {
    const z = lookupZip(id);
    if (z) {
      title = `Best mariachis and bands in ${z.city}, ${z.state} · Bella's Música`;
      desc = `The top-rated live Mexican music groups near ${z.city}, ${z.state}. See prices, open dates and book with a deposit.`;
      url = `${config.baseUrl}/b/${z.zip}`;
    }
  }

  const tags = [
    `<meta name="description" content="${h(desc)}">`, `<link rel="canonical" href="${h(url)}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="Bella's Música">`,
    `<meta property="og:title" content="${h(title)}">`, `<meta property="og:description" content="${h(desc)}">`,
    `<meta property="og:url" content="${h(url)}">`, `<meta property="og:image" content="${h(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${h(title)}">`, `<meta name="twitter:image" content="${h(image)}">`
  ].join("\n");
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${h(title)}</title>`).replace("</head>", tags + "\n</head>");
  if (summary) html = html.replace('<main id="app"></main>', `<main id="app">${summary}</main>`);
  return html;
}

export function robotsTxt(config) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${config.baseUrl}/sitemap.xml\n`;
}

export function sitemapXml(ctx) {
  const { db, config } = ctx;
  const urls = [config.baseUrl + "/"];
  const zips = new Set();
  for (const g of db.all("SELECT id, zip FROM groups WHERE demo = 0 AND hidden = 0 ORDER BY created_at")) { urls.push(`${config.baseUrl}/g/${g.id}`); zips.add(g.zip); }
  for (const z of zips) urls.push(`${config.baseUrl}/b/${z}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${h(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}
