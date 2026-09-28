// Visual QA: seeds a realistic marketplace and screenshots every screen at iPad and phone sizes.
//   NODE_PATH=$(npm root -g) node e2e/qa.mjs <outdir>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, bookingBody } from "../test/helpers.js";
import { png } from "./png.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const out = process.argv[2] || "qa-shots";
fs.mkdirSync(out, { recursive: true });
const S = await startApp();
const B64 = (c) => png(640, 420, c).toString("base64");

// ---- seed ----
const owner = client(S.base), other = client(S.base), ana = client(S.base), luis = client(S.base);
await owner.signup("owner@qa.test", "Marisol Vega", { phone: "312-555-0111", sms_opt_in: true });
await other.signup("other@qa.test", "Otro Dueño");
await ana.signup("ana@qa.test", "Ana García", { phone: "312-555-0142" });
await luis.signup("luis@qa.test", "Luis Ramírez", { phone: "312-555-0143" });
const g = (await owner.post("/api/groups", { name: "Mariachi Tierra Viva", type: "Mariachi", zip: "60608", rate: 375, members: 8, story: "Eight musicians from Pilsen who grew up playing in their abuelo's living room. We bring trajes, a full sound system and a lot of corazón to weddings, quinceañeras and Sunday serenatas across Chicagoland." })).json;
const id = g.id;
await owner.patch(`/api/groups/${id}`, { events: ["Wedding", "Quinceañera", "Serenata", "Anniversary"], songs: ["Cielito Lindo", "El Rey", "Las Mañanitas", "Volver Volver", "Amor Eterno", "México Lindo y Querido", "La Negra", "Si Nos Dejan", "Sway (Quién Será)", "Bésame Mucho"], max_guests: 250, sound_system: true, dress_code: "Black and silver charro suits", set_minutes: 50, travel_miles: 25, travel_fee: 80, deposit_pct: 25, cancel_policy: "moderate", contact_phone: "312-555-0111", video_url: "https://youtu.be/dQw4w9WgXcQ" });
for (const c of [[210, 120, 40], [60, 110, 190], [190, 60, 80], [70, 150, 90]]) await owner.post(`/api/groups/${id}/photos`, { data: B64(c) });
await owner.post(`/api/groups/${id}/packages`, { name: "Serenata", description: "3 songs at the door, about 20 minutes", hours: 1, price: 250 });
await owner.post(`/api/groups/${id}/packages`, { name: "Quinceañera", description: "Waltz, entrance and 2 hours of music", hours: 3, price: 950 });
await owner.post(`/api/groups/${id}/packages`, { name: "Full wedding", description: "Ceremony + cocktail hour + dinner, 4 hours", hours: 4, price: 1300 });
await owner.post(`/api/groups/${id}/availability/weekends`, { weeks: 12 });
// bookings in each state
const wk = (n) => { for (let i = 1; i < 200; i++) { const d = new Date(); d.setDate(d.getDate() + i); if ([5, 6].includes(d.getDay()) && n-- === 0) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; } };
const book = async (c, date, time, o = {}) => (await c.post("/api/bookings", bookingBody(id, date, { time, ...o }))).json.booking;
const pay = (c, b) => c.post(`/api/bookings/${b.id}/simulate-pay`);
const b1 = await book(ana, wk(1), "12:00 PM", { event: "Quinceañera", guests: 180 }); await pay(ana, b1); await owner.patch(`/api/bookings/${b1.id}`, { action: "accept" });
const b2 = await book(luis, wk(2), "2:00 PM", { event: "Wedding", guests: 120, message: "Please play Amor Eterno for the first dance" }); await pay(luis, b2);
const b3 = await book(ana, wk(3), "4:00 PM", { event: "Anniversary", guests: 40, hours: 1 }); await pay(ana, b3); await ana.patch(`/api/bookings/${b3.id}`, { action: "cancel" });
const b4 = await book(ana, wk(4), "2:00 PM", { event: "Serenata", guests: 30, hours: 1 }); // left unpaid
const past = await book(luis, wk(0), "6:00 PM", { event: "Birthday", guests: 60 }); await pay(luis, past); await owner.patch(`/api/bookings/${past.id}`, { action: "accept" });
S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-6), past.id);
await luis.post(`/api/bookings/${past.id}/review`, { rating: 5, text: "Best decision we made for my mom's 60th. Everyone was crying and dancing. They learned her favorite song just for us." });
const oldR = await book(ana, wk(5), "12:00 PM", { event: "Wedding" }); await pay(ana, oldR); await owner.patch(`/api/bookings/${oldR.id}`, { action: "accept" });
S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-30), oldR.id);
await ana.post(`/api/bookings/${oldR.id}/review`, { rating: 4, text: "Great music, a little late setting up but worth it." });
await ana.post(`/api/groups/${id}/messages`, { text: "Hola! Do you play for 180 guests outdoors? We have a canopy." });
const cid = (await owner.get(`/api/groups/${id}/threads`)).json.threads[0].customer_id;
await owner.post(`/api/groups/${id}/threads/${cid}`, { text: "Sí claro! We bring our own sound system. What time does the quince start?" });
await luis.post(`/api/groups/${id}/messages`, { text: "Can you learn a new song for the entrance?" });
await owner.post(`/api/groups/${id}/feature`).then((f) => owner.post(`/api/feature/${f.json.id}/simulate-pay`));

// ---- screenshots ----
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const VP = { land: { width: 1024, height: 768 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } };
async function person(vp, login) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await ctx.route("**/*youtube*/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<meta charset=utf-8><body style='margin:0;background:#222;color:#ccc;display:flex;align-items:center;justify-content:center;height:100vh;font:20px sans-serif'>▶ video</body>" }));
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load|net::/.test(m.text())) errs.push(m.text()); });
  p.errs = errs;
  if (login) { await p.goto(S.base + "/#/login"); await p.fill("#a-email", login); await p.fill("#a-pw", "correct horse battery"); await p.click("#authform button[type=submit]"); await p.waitForTimeout(500); }
  return p;
}
async function shoot(p, vpName, name, hash, ready = ".panel, .card, h2") {
  await p.goto(S.base + "/" + hash); await p.waitForSelector(ready, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, `${vpName}-${name}.png`), fullPage: true });
}
const problems = [];
for (const [vpName, vp] of Object.entries(VP)) {
  const anon = await person(vp), cust = await person(vp, "ana@qa.test"), own = await person(vp, "owner@qa.test");
  await shoot(anon, vpName, "home", "#/?zip=60608&event=Quincea%C3%B1era&guests=150", ".card");
  await shoot(anon, vpName, "map", "#/?zip=60608&view=map", ".leaflet-marker-icon");
  await shoot(anon, vpName, "best", "#/best/60608", ".card");
  await shoot(anon, vpName, "group-anon", `#/group/${id}`, "#calbox .cal");
  await shoot(anon, vpName, "login", "#/login", "#authform");
  await shoot(cust, vpName, "bookings", "#/bookings", ".req");
  await cust.goto(S.base + `/#/group/${id}`); await cust.waitForSelector("#calbox .cal");
  for (let i = 0; i < 4 && !(await cust.locator(".day.open").count()); i++) await cust.click('[data-nav="1"]');
  await cust.locator(".day.open").first().click(); await cust.locator(".slot").first().click(); await cust.waitForSelector("#b-guests");
  await cust.fill("#b-guests", "120"); await cust.waitForSelector("#quote .sum"); await cust.waitForTimeout(400);
  await cust.screenshot({ path: path.join(out, `${vpName}-group-booking.png`), fullPage: true });
  await shoot(cust, vpName, "account", "#/account", "#pform");
  for (const tab of ["requests", "calendar", "listing", "extras", "media", "payments", "messages"]) await shoot(own, vpName, `dash-${tab}`, `#/dashboard?g=${id}&tab=${tab}`, `.tabs`);
  for (const p of [anon, cust, own]) p.errs.forEach((e) => problems.push(`${vpName}: ${e}`));
}
console.log(problems.length ? "PAGE ERRORS:\n" + [...new Set(problems)].join("\n") : "no page errors while browsing");
console.log(fs.readdirSync(out).length + " screenshots in " + out);
await browser.close(); await S.close();
