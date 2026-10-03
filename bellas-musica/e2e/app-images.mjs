// Makes the app images from the logo and the test drive: the notification badge, the Android "maskable" icons, and the
// store / install screenshots (phone size, 1080x1920).
//   npm run tryout (in another window), then:  NODE_PATH=$(npm root -g) node e2e/app-images.mjs [http://localhost:3000]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const base = process.argv[2] || "http://localhost:3000";
const svg = fs.readFileSync(path.join(pub, "logo.svg"), "utf8");
const hatOnly = svg.replace(/<rect[^>]*\/>/g, ""); // the sombrero without its rounded square
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
// Android's small status-bar icon: one color (white) on transparent
await render("badge.png", 96, `<img src="${dataUrl(hatOnly)}" style="width:96px;height:96px;filter:brightness(0) invert(1)">`);
// Maskable icons: full-bleed background, the hat inside the middle 70% so any shape (circle, squircle) keeps it whole
for (const n of [192, 512]) await render(`icon-maskable-${n}.png`, n, `<div style="width:${n}px;height:${n}px;background:radial-gradient(circle at 50% 38%,#1b2c55,#0a1022 75%);display:flex;align-items:center;justify-content:center"><img src="${dataUrl(hatOnly)}" style="width:${Math.round(n * 0.7)}px;height:${Math.round(n * 0.7)}px"></div>`);

// Google Play's "feature graphic" (1024x500): the banner at the top of the store page
fs.mkdirSync(path.join(root, "docs", "store"), { recursive: true });
await page.setViewportSize({ width: 1024, height: 500 });
await page.setContent(`<html><body style="margin:0"><div style="width:1024px;height:500px;background:radial-gradient(circle at 30% 40%,#1f3a7a,#0a1022 70%);display:flex;align-items:center;gap:48px;padding:0 72px;box-sizing:border-box;font-family:Georgia,serif;color:#fff">
  <img src="${dataUrl(svg)}" style="width:300px;height:300px;flex:none;filter:drop-shadow(0 12px 30px rgba(0,0,0,.5))">
  <div><div style="font-size:68px;line-height:1.05;color:#cfe0ff">Bella's Música</div>
  <div style="font:500 30px/1.35 system-ui,sans-serif;margin-top:18px;color:#e8eefc">Mariachi, banda, norteño and everything for the party</div>
  <div style="font:600 22px/1.3 system-ui,sans-serif;margin-top:22px;color:#7fb0ff;letter-spacing:.06em">SAFE DEPOSITS · ENGLISH Y ESPAÑOL</div></div></div></body></html>`);
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(root, "docs", "store", "feature-graphic.png"), clip: { x: 0, y: 0, width: 1024, height: 500 } });
console.log("made docs/store/feature-graphic.png");

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
await browser.close();
