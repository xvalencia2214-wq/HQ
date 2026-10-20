// Browser end-to-end for the last requests before launch: the "Photographers & videographers" name (English and
// Spanish); how far each vendor is from the family, on the cards and on the vendor page (with the travel fee, or "doesn't
// travel that far"); the vendor page's calendar with Booked days and its legend; and the calendar updating by itself when
// someone else books the time a family is looking at.
//   NODE_PATH=$(npm root -g) node e2e/e2e22.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup, bookingBody } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", WEATHER: "0" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let failed = 0, nav = 0;
const ok = (name, cond) => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
async function person(label, viewport = { width: 1180, height: 820 }, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && viewport.width < 500 });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await ctx.addInitScript(() => { window.__bmRecheckMs = 1000; }); // the calendar checks every second here (30 s for real)
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
const until = async (fn, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

try {
  const o = client(S.base), x = client(S.base);
  await o.signup("o22@example.com", "Dueño"); await x.signup("x22@example.com", "Otra Familia");
  const one = inDays(20), three = inDays(21), taken = inDays(22);
  const gid = await makeGroup(o, { name: "Banda Calendario", zip: "60608", dates: [three], extra: { travel_miles: 10, travel_fee: 60 } });
  await o.put(`/api/groups/${gid}/availability`, { dates: { [one]: ["2:00 PM"], [taken]: ["2:00 PM"] } });
  const pre = (await x.post("/api/bookings", bookingBody(gid, taken))).json.booking; await x.post(`/api/bookings/${pre.id}/simulate-pay`);

  // ---- the name ----
  const W = await person("wide");
  await go(W, "#/?zip=60540"); await W.waitForSelector(".catrow");
  const chips = await W.locator(".catchip").allInnerTexts();
  ok("the category is called Photographers & videographers", chips.some((c) => c.includes("Photographers & videographers")));

  // ---- distance on the cards ----
  await W.waitForSelector(".card");
  const card = W.locator(".card", { hasText: "Banda Calendario" });
  const cardText = await card.innerText();
  ok("the card says how far it is, with a pin", /📍\s*\d+ mi away/.test(cardText));
  ok("and what travel adds", cardText.includes("+$60 travel"));
  await shot(W, "cards-distance.png");

  // ---- the vendor page: distance from the family ----
  await card.locator(`a[href^="#/group/${gid}"]`).first().click();
  await W.waitForSelector(".fromyou");
  const from = await W.locator(".fromyou").innerText();
  ok("the vendor page says how far it is from the family's ZIP", /\d+ mi from you \(Naperville 60540\)/.test(from));
  ok("with the travel fee it adds", from.includes("+$60 travel fee"));

  // ---- the calendar ----
  await W.waitForSelector("#calbox .day");
  if (!(await W.locator(`#calbox .day[data-d="${taken}"]`).count())) await W.click('#calbox [data-nav="1"]');
  await W.waitForSelector(`#calbox .day[data-d="${taken}"]`);
  const tk = W.locator(`#calbox .day[data-d="${taken}"]`);
  ok("a day someone booked shows as Booked, and can't be picked", (await tk.getAttribute("class")).includes("booked") && (await tk.isDisabled()) && /booked/.test(await tk.getAttribute("aria-label")));
  ok("an open day is gold", (await W.locator(`#calbox .day[data-d="${one}"]`).getAttribute("class")).includes("open"));
  ok("a legend explains Open, Booked and Not open", /Open[\s\S]*Booked[\s\S]*Not open/.test(await W.locator(".cal-legend").innerText()));
  ok("and it says the calendar updates when someone books", (await W.locator("#calpanel .legend").innerText()).includes("never booked twice"));

  // the family picks the only time on one day... and someone else books it first
  await W.click(`#calbox .day[data-d="${one}"]`); await W.click('#slotbox .slot[data-t="2:00 PM"]');
  ok("the family picked a time", (await W.locator("#bookform").count()) === 1);
  await shot(W, "calendar-before.png");
  const other = (await x.post("/api/bookings", bookingBody(gid, one))).json.booking;
  ok("someone else books it", Boolean(other && other.id));
  ok("the calendar turns that day Booked by itself", await until(async () => (await W.locator(`#calbox .day[data-d="${one}"]`).getAttribute("class")).includes("booked")));
  ok("the family is told the time was just booked", (await W.locator("#toast").innerText()).includes("just booked"));
  ok("and their pick is cleared, so they can't send it", (await W.locator("#bookform").count()) === 0);
  await shot(W, "calendar-after.png");
  // the other family pays, then the group declines: the day opens again by itself
  await x.post(`/api/bookings/${other.id}/simulate-pay`);
  ok("the group can decline it", (await o.patch(`/api/bookings/${other.id}`, { action: "decline" })).status === 200);
  ok("when it frees up, it turns gold again", await until(async () => (await W.locator(`#calbox .day[data-d="${one}"]`).getAttribute("class")).includes("open")));

  // ---- too far ----
  await go(W, `#/group/${gid}?zip=61801`); await W.waitForSelector(".fromyou");
  ok("a family too far away is told the group doesn't travel that far", (await W.locator(".fromyou").innerText()).includes("Doesn't travel that far") && (await W.locator(".fromyou.far").count()) === 1);

  // ---- Spanish, on a phone ----
  const P = await person("phone", { width: 390, height: 844 }, true);
  await go(P, "#/?zip=60540"); await P.waitForSelector(".catrow");
  await P.evaluate(() => document.getElementById("langbtn").click()); await P.waitForFunction(() => document.documentElement.lang === "es");
  await P.waitForSelector(".catchip");
  ok("in Spanish: Fotógrafos y videógrafos", (await P.locator(".catchip").allInnerTexts()).some((c) => c.includes("Fotógrafos y videógrafos")));
  await go(P, `#/group/${gid}?zip=60540`); await P.waitForSelector(".fromyou");
  ok("the distance in Spanish", /A \d+ mi de ti \(Naperville 60540\) · \+\$60 de viaje/.test(await P.locator(".fromyou").innerText()));
  await P.waitForSelector(".cal-legend");
  ok("the legend in Spanish", /Disponible[\s\S]*Reservado[\s\S]*No disponible/.test(await P.locator(".cal-legend").innerText()));
  ok("no sideways scrolling on a phone", await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot(P, "group-phone-es.png");
  // the vendor's own page doesn't tell the vendor how far they are from themselves
  const V = await person("vendor");
  await go(V, "#/login"); await V.fill("#a-email", "o22@example.com"); await V.fill("#a-pw", "correct horse battery"); await V.click("#authform button[type=submit]"); await V.waitForFunction(() => !location.hash.startsWith("#/login"));
  await go(V, `#/group/${gid}?zip=60540`); await V.waitForSelector("#calbox");
  ok("the vendor looking at their own page sees no 'from you' line", (await V.locator(".fromyou").count()) === 0);
  // ---- a dropped connection is not a crash; a real bug still is ----
  const octx = await browser.newContext(); const O = await octx.newPage(); const oerr = [], reports = [];
  O.on("pageerror", (e) => oerr.push(e.message)); O.on("request", (r) => { if (r.url().includes("/api/client-error")) reports.push(r.url()); });
  await O.goto(S.base + "/#/?zip=60608"); await O.waitForSelector("#sform");
  await octx.setOffline(true);
  await O.evaluate(() => { import("/js/api.js").then((m) => { m.api.get("/api/meta"); }); }); // a request nobody waits for, with no signal
  await O.waitForTimeout(800);
  ok("losing the connection mid-request is not reported as an error", oerr.length === 0);
  await octx.setOffline(false);
  await O.evaluate(() => { setTimeout(() => { throw new Error("a real bug"); }); });
  ok("a real error is still caught and reported", await until(async () => oerr.includes("a real bug") && reports.length === 1, 3000));
  await octx.close();
} catch (e) { failed++; console.log("FAIL crashed: " + (e.stack || e)); }
finally {
  ok("no page errors", problems.length === 0); if (problems.length) console.log(problems.join("\n"));
  await browser.close(); await S.close();
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}
