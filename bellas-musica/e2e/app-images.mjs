// Makes the app images from the logo and the test drive: the app icons, the notification badge, the Android "maskable"
// icons, the share picture, and the store / install screenshots (phone size, 1080x1920).
//   npm run tryout (in another window), then:  NODE_PATH=$(npm root -g) node e2e/app-images.mjs [http://localhost:3000]
//   only the icons and pictures made from the logo (no server needed):  ... node e2e/app-images.mjs --icons
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const iconsOnly = process.argv.includes("--icons");
const base = process.argv.slice(2).find((a) => !a.startsWith("--")) || "http://localhost:3000";
const svg = fs.readFileSync(path.join(pub, "logo.svg"), "utf8");
const hatOnly = svg.replace(/<rect[^>]*\/>/g, ""); // the sombrero without its rounded square
const CREAM = "radial-gradient(circle at 50% 35%,#ffffff,#f7f1e3 80%)"; // the logo's own background, full bleed
const dataUrl = (s) => "data:image/svg+xml;base64," + Buffer.from(s).toString("base64");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage();
async function render(file, size, html) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(pub, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("made", file);
}
// The home-screen icons: the logo as it is (192, 512) and, for iPhone and iPad, full bleed (iOS rounds the corners itself)
for (const n of [192, 512]) await render(`icon-${n}.png`, n, `<img src="${dataUrl(svg)}" style="width:${n}px;height:${n}px;display:block">`);
await render("apple-touch-icon.png", 180, `<div style="width:180px;height:180px;background:${CREAM};display:flex;align-items:center;justify-content:center"><img src="${dataUrl(hatOnly)}" style="width:176px;height:176px"></div>`);
// Android's small status-bar icon: one color (white) on transparent
await render("badge.png", 96, `<img src="${dataUrl(hatOnly)}" style="width:96px;height:96px;filter:brightness(0) invert(1)">`);
// Maskable icons: full-bleed background, the hat inside the middle 70% so any shape (circle, squircle) keeps it whole
for (const n of [192, 512]) await render(`icon-maskable-${n}.png`, n, `<div style="width:${n}px;height:${n}px;background:${CREAM};display:flex;align-items:center;justify-content:center"><img src="${dataUrl(hatOnly)}" style="width:${Math.round(n * 0.7)}px;height:${Math.round(n * 0.7)}px"></div>`);

// Google Play's "feature graphic" (1024x500): the banner at the top of the store page
fs.mkdirSync(path.join(root, "docs", "store"), { recursive: true });
await page.setViewportSize({ width: 1024, height: 500 });
// The banner: white and gold, navy writing. Google Play's "feature graphic" (1024x500) and the picture WhatsApp and
// Facebook show when someone shares the site (og.png, 1200x630).
const banner = (w, h, logo) => `<html><body style="margin:0"><div style="width:${w}px;height:${h}px;background:radial-gradient(circle at 25% 40%,#ffffff,#f7f1e3 75%);border-bottom:10px solid #c9962b;display:flex;align-items:center;gap:52px;padding:0 76px;box-sizing:border-box;font-family:Georgia,serif;color:#0b1838">
  <img src="${dataUrl(svg)}" style="width:${logo}px;height:${logo}px;flex:none;filter:drop-shadow(0 12px 26px rgba(11,24,56,.25))">
  <div><div style="font-size:${Math.round(w / 15)}px;line-height:1.05;color:#0b1838">Bella's Música</div>
  <div style="font:500 ${Math.round(w / 34)}px/1.35 system-ui,sans-serif;margin-top:18px;color:#1c2f63">Mariachi, banda, norteño and everything for the party</div>
  <div style="font:700 ${Math.round(w / 46)}px/1.3 system-ui,sans-serif;margin-top:22px;color:#8a6414;letter-spacing:.06em">SAFE DEPOSITS · ENGLISH Y ESPAÑOL</div></div></div></body></html>`;
for (const [file, w, h, logo] of [[path.join(root, "docs", "store", "feature-graphic.png"), 1024, 500, 300], [path.join(pub, "og.png"), 1200, 630, 360]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(banner(w, h, logo));
  await page.waitForTimeout(150);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h } });
  console.log("made", path.relative(root, file));
}
if (iconsOnly) { await browser.close(); process.exit(0); }

// Screenshots from the test drive (practice data), as a phone sees them
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
// the store pictures don't show the "test mode" bar
await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "#banner{display:none!important}"; document.head.appendChild(st); }); });
const p = await ctx.newPage();
fs.mkdirSync(path.join(pub, "screens"), { recursive: true });
const shot = async (name) => { await p.waitForTimeout(900); await p.screenshot({ path: path.join(pub, "screens", name) }); console.log("made screens/" + name); };
const login = async (email) => { await p.goto(base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", "fiesta2026"); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); };
await p.goto(base + "/#/?zip=60608&event=Quincea%C3%B1era"); await p.waitForTimeout(2500);
await p.evaluate(() => { const r = document.querySelector("#results, .results, #list"); if (r) { r.scrollIntoView(); window.scrollBy(0, -90); } }); await shot("1-find.png");
const ids = await p.evaluate(async () => (await (await fetch("/api/search?zip=60608")).json()).results.map((g) => [g.id, g.name]));
const pick = ids.find(([, n]) => /Sol de Jalisco/.test(n)) || ids[0];
await p.goto(base + "/#/group/" + pick[0]); await p.waitForSelector("#calbox .cal"); await shot("2-group.png");
await login("familia@prueba.com");
await p.goto(base + "/#/bookings"); await p.waitForSelector(".req"); await shot("3-bookings.png");
await login("mariachi@prueba.com");
await p.evaluate(() => { localStorage.setItem("bm_lang", "es"); localStorage.setItem("bm_push_later", String(Date.now())); });
await p.goto(base + "/#/dashboard?tab=requests"); await p.reload(); await p.waitForSelector(".req"); await p.evaluate(() => { document.querySelector(".req").scrollIntoView({ block: "start" }); window.scrollBy(0, -90); }); await shot("4-vendor-es.png");
await p.evaluate(() => { localStorage.removeItem("bm_lang"); });
// small copies for the welcome page's phone (600 px wide, ~45 KB instead of ~700 KB)
for (const n of ["1-find", "2-group", "3-bookings", "4-vendor-es"]) {
  const src = "data:image/png;base64," + fs.readFileSync(path.join(pub, "screens", n + ".png")).toString("base64");
  const out = await p.evaluate(async (src) => {
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement("canvas"); c.width = 600; c.height = Math.round(im.naturalHeight * 600 / im.naturalWidth);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL("image/webp", 0.82);
  }, src);
  fs.writeFileSync(path.join(pub, "screens", n + ".webp"), Buffer.from(out.split(",")[1], "base64")); console.log("made screens/" + n + ".webp");
}
await browser.close();
