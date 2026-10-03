// Browser end-to-end for the vendor business tools: any start time and windows on the calendar, crews and travel time,
// what the vendor needs from the family, a payment link for the vendor's own client, lineup and pay, team logins,
// one more hour at the party, and holiday serenatas.
//   NODE_PATH=$(npm root -g) node e2e/e2e13.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", WEATHER: "0" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let step = 0, failed = 0, nav = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";

async function person(label, viewport = { width: 1000, height: 1100 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::|Failed to fetch|Connection problem/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "" : undefined));
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); };
const text = (p) => p.locator("body").innerText();
const pickDay = async (p, root, key) => {
  for (let i = 0; i < 5 && !(await p.locator(`${root} .day[data-d="${key}"]:not([disabled])`).count()); i++) {
    const before = await p.locator(`${root} h3`).first().innerText();
    await p.click(`${root} [data-nav="1"]`);
    await p.waitForFunction(([r, b]) => document.querySelector(`${r} h3`)?.innerText !== b, [root, before]);
  }
  await p.click(`${root} .day[data-d="${key}"]`);
};

try {
  const bo = client(S.base), ro = client(S.base), ca = client(S.base), lu = client(S.base);
  await bo.signup("beto@example.com", "Beto Ramírez"); await ro.signup("rosa@example.com", "Rosa Martínez", { phone: "312-555-0142" });
  await ca.signup("carla@example.com", "Carla Cliente", { phone: "773-555-0100" }); await lu.signup("lupe@example.com", "Lupe Torres");
  const d = inDays(12), d2 = inDays(13);
  const gid = await makeGroup(bo, { name: "DJ Relámpago", dates: [d, d2] });

  // ---- the vendor: calendar with any time, a window, crews and travel time ----
  const B = await person("beto");
  await login(B, "beto@example.com");
  await go(B, `#/dashboard?g=${gid}&tab=calendar`); await B.waitForSelector("#calbox .cal");
  await pickDay(B, "#calbox", d); await B.waitForSelector(".cal-more");
  await B.click(".cal-more summary");
  await B.selectOption("#cal-one", "5:00 AM"); await B.click("#cal-add1");
  await B.waitForFunction(() => /5:00 AM ✕/.test(document.getElementById("daybox").innerText));
  await B.selectOption("#cal-from", "6:00 PM"); await B.selectOption("#cal-to", "10:00 PM"); await B.click("#cal-addw");
  await B.waitForFunction(() => /Any start from 6:00 PM to 10:00 PM/.test(document.getElementById("daybox").innerText));
  ok("the vendor adds a 5:00 AM start and a 6-10 PM window to a day", true);
  await B.selectOption("#cap-n", "2"); await B.selectOption("#cap-b", "30"); await B.click("#capform button[type=submit]");
  await B.waitForFunction(() => /Saved/.test(document.body.innerText));
  ok("crews (2 at once) and travel time are saved", S.db.get("SELECT capacity, buffer_min FROM groups WHERE id = ?", gid).capacity === 2 && S.db.get("SELECT buffer_min FROM groups WHERE id = ?", gid).buffer_min === 30);
  await shot(B, "biz-calendar.png");

  // ---- My business: needs, roster, a payment link, a holiday special, a team invite ----
  await go(B, `#/dashboard?g=${gid}&tab=business`); await B.waitForSelector("#biz-needs .chip");
  ok("the My business tab opens with every section", (await B.locator("#biz-links, #biz-crew, #biz-payroll, #biz-needs, #biz-specials, #biz-team").count()) === 6);
  await B.click("#biz-needs .chip"); await B.click("#nd-save");
  const savedNeeds = () => JSON.parse(S.db.get("SELECT needs_json FROM groups WHERE id = ?", gid).needs_json).length === 1;
  for (let i = 0; i < 50 && !savedNeeds(); i++) await B.waitForTimeout(100); // the save is a request: wait for it to land
  ok("a preset 'what we need' line is saved", savedNeeds());
  await B.fill("#cw-name", "Juan Trompeta"); await B.fill("#cw-role", "Trumpet"); await B.fill("#cw-phone", "773-555-0101"); await B.fill("#cw-pay", "150");
  await B.click("#crewform button[type=submit]"); await B.waitForFunction(() => /Juan Trompeta/.test(document.getElementById("biz-crew").innerText));
  ok("a musician is added to the roster with their pay", /\$150 per gig/.test(await B.locator("#biz-crew").innerText()));
  await B.fill("#pl-client", "Carla Cliente"); await B.fill("#pl-title", "Boda de Carla"); await B.fill("#pl-date", d2); await B.selectOption("#pl-time", "7:30 PM"); await B.selectOption("#pl-len", "240");
  await B.fill("#pl-addr", "Salón Los Arcos, Cicero"); await B.fill("#pl-total", "1200"); await B.selectOption("#pl-dep", "50");
  await B.click("#plform button[type=submit]"); await B.waitForSelector("#pl-made .copyrow input");
  const payUrl = await B.locator("#pl-made .copyrow input").inputValue();
  ok("a payment link is made for the vendor's own client, with WhatsApp", /#\/pay-link\//.test(payUrl) && (await B.locator("#pl-made a.wa").count()) === 1);
  await B.click("#biz-specials details summary"); await B.fill("#sp-price-mothers_day", "200"); await B.click('.spform[data-h="mothers_day"] button[type=submit]');
  await B.waitForFunction(() => /✓ Serenata del 10 de mayo/.test(document.getElementById("biz-specials").innerText));
  ok("a Mother's Day serenata special is offered", true);
  await B.click("#tmform button[type=submit]"); await B.waitForSelector("#tm-made .copyrow input");
  const teamUrl = await B.locator("#tm-made .copyrow input").inputValue();
  ok("a team invitation link is made", /#\/team\//.test(teamUrl));
  await shot(B, "biz-tab.png");

  // ---- a family books 5:00 AM mañanitas and confirms what the vendor needs ----
  const R = await person("rosa");
  await login(R, "rosa@example.com");
  await go(R, `#/group/${gid}`); await R.waitForSelector("#calbox .day[data-d]");
  await pickDay(R, "#calbox", d); await R.waitForSelector("#slotbox .slot");
  ok("many start times are grouped (early morning, evening…)", (await R.locator("#slotbox .slot-period").count()) >= 2 && /Early morning/.test(await R.locator("#slotbox").innerText()));
  ok("the group page shows what they need from you", /What they need from you/.test(await text(R)));
  await R.click('#slotbox .slot[data-t="5:00 AM"]'); await R.waitForSelector("#bookform");
  await R.fill("#b-guests", "60"); await R.fill("#b-addr", "Casa de Rosa, Pilsen");
  await R.check("#b-agree"); await R.click("#bookbtn");
  await R.waitForFunction(() => /confirm you can provide/.test(document.getElementById("bookerr").innerText));
  ok("booking asks the family to confirm what the vendor needs", true);
  await R.check("#b-needs"); await R.click("#bookbtn"); await R.waitForSelector("#paybtn");
  await R.click("#paybtn"); await R.waitForFunction(() => /#\/booking\//.test(location.hash));
  const rb = S.db.get("SELECT * FROM bookings WHERE customer_id = (SELECT id FROM users WHERE email = 'rosa@example.com')");
  ok("the 5:00 AM booking is paid, with the needs saved on it", rb.time === "5:00 AM" && rb.payment_status === "paid" && JSON.parse(rb.needs_json).length === 1);

  // ---- the vendor accepts and sends the lineup ----
  await go(B, `#/dashboard?g=${gid}&tab=requests`); await B.waitForSelector("[data-act=accept]");
  await B.click("[data-act=accept]"); await B.waitForSelector("[data-lineup]");
  await B.click("[data-lineup]"); await B.waitForSelector(".luform");
  await B.check('.luform input[name="m"]'); await B.click(".luform button[type=submit]"); await B.waitForSelector(".luform a.wa");
  const wa = await B.locator(".luform a.wa").getAttribute("href");
  ok("the lineup goes out on WhatsApp with the time, address and pay", /wa\.me\/17735550101/.test(wa) && /5%3A00%20AM/.test(wa) && /Casa%20de%20Rosa/.test(wa) && /150/.test(wa));
  await B.click(".luform [data-paidtoggle]"); await B.waitForFunction(() => /Paid ✓/.test(document.querySelector(".luform").innerText));
  ok("the musician is marked paid", S.db.get("SELECT paid_at FROM booking_crew").paid_at > 0);
  await shot(B, "biz-lineup.png");

  // ---- the vendor's own client pays through the link ----
  const C = await person("carla");
  await C.goto(payUrl.replace(/^https?:\/\/[^/]+/, S.base)); await C.waitForSelector(".pl-head");
  ok("the client sees the link with the price and deposit (and is asked to sign in)", /\$1,200/.test(await text(C)) && /\$600/.test(await text(C)) && /Create a free account/.test(await text(C)));
  await login(C, "carla@example.com"); await C.goto(payUrl.replace(/^https?:\/\/[^/]+/, S.base)); await C.waitForSelector("#plpay");
  await C.check('#plpay input[name="needs"]'); await C.check('#plpay input[name="agree"]'); await C.click("#plpay button[type=submit]");
  await C.waitForSelector("#paybtn"); await C.click("#paybtn"); await C.waitForFunction(() => /#\/booking\//.test(location.hash));
  const cb = S.db.get("SELECT * FROM bookings WHERE direct = 1");
  ok("paying the link confirms the booking right away", cb && cb.status === "confirmed" && cb.date === d2 && cb.time === "7:30 PM");
  await shot(C, "pay-link.png");

  // ---- a helper joins the team ----
  const L = await person("lupe");
  await login(L, "lupe@example.com");
  await L.goto(teamUrl.replace(/^https?:\/\/[^/]+/, S.base)); await L.waitForSelector("#tm-join");
  await L.click("#tm-join"); await L.waitForFunction(() => /#\/dashboard/.test(location.hash));
  await L.waitForSelector(".tabs");
  ok("the helper joins and lands on the listing's dashboard", /DJ Relámpago/.test(await text(L)));
  await go(L, `#/dashboard?g=${gid}&tab=payments`); await L.waitForSelector("#tabbody .panel");
  await L.waitForFunction(() => /Only the owner of this listing/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {}); // the note replaces the buttons once the panels load
  ok("the helper sees that payouts and upgrades are the owner's", /Only the owner of this listing/.test(await text(L)) && (await L.locator("#feature, #buypro").count()) === 0);

  // ---- the party is today: one more hour, paid on the phone ----
  S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), rb.id);
  await go(B, `#/dashboard?g=${gid}&tab=requests`); await B.waitForSelector(`[data-extra="${rb.id}"]`);
  await B.click(`[data-extra="${rb.id}"]`); await B.waitForSelector(".exform");
  await B.click(".exform button[type=submit]"); await B.waitForFunction(() => /Waiting for payment/.test(document.body.innerText));
  ok("the vendor offers one more hour", S.db.get("SELECT status FROM extras").status === "offered");
  await go(R, "#/bookings"); await R.waitForSelector("[data-expay]");
  await R.click("[data-expay]"); await R.waitForSelector("#paybtn"); await R.click("#paybtn");
  await R.waitForFunction(() => /#\/booking\//.test(location.hash));
  ok("the family pays it on their phone", S.db.get("SELECT status FROM extras").status === "paid");

  // ---- the holiday page ----
  await go(R, "#/specials/mothers_day"); await R.waitForSelector(".sp-card");
  ok("the Mother's Day page lists the DJ's serenata", /DJ Relámpago/.test(await text(R)) && /Serenata del 10 de mayo/.test(await text(R)));
  await shot(R, "specials.png");

  // ---- Spanish ----
  await go(B, `#/dashboard?g=${gid}&tab=business`); await B.waitForSelector("#biz-team");
  if (await B.locator("#navtoggle").isVisible()) await B.click("#navtoggle");
  await B.click("#langbtn"); await B.waitForFunction(() => /Mi negocio/.test(document.body.innerText));
  const es = await B.waitForFunction(() => /Enlace de pago para tu propio cliente/.test(document.body.innerText) && /Tus músicos y tu equipo/.test(document.body.innerText), null, { timeout: 8000 }).then(() => true, () => false);
  ok("Spanish: My business", es);

  ok("no JavaScript or console errors", problems.length === 0);
  if (problems.length) console.log(problems.slice(0, 8).join("\n"));
} catch (e) { failed++; console.log("CRASH", e.stack.split("\n").slice(0, 3).join("\n")); if (problems.length) console.log(problems.slice(0, 8).join("\n")); }
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed ? 1 : 0);
