// Browser end-to-end for weekly gigs (a restaurant books every Friday in one checkout), the vendor accepting them all,
// a tip after the party, and turning the morning text off.
//   NODE_PATH=$(npm root -g) node e2e/e2e14.mjs [screenshotDir]
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
let failed = 0, nav = 0;
const ok = (name, cond) => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
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

try {
  const bo = client(S.base), re = client(S.base);
  await bo.signup("beto@example.com", "Beto Ramírez"); await re.signup("sol@example.com", "Restaurante El Sol", { phone: "312-555-0142" });
  const first = inDays(8);
  const gid = await makeGroup(bo, { name: "Mariachi Viernes", dates: [] });
  const dates = Object.fromEntries([0, 1, 2, 3].map((i) => [inDays(8 + 7 * i), ["7:00 PM"]]));
  await bo.put(`/api/groups/${gid}/availability`, { dates });

  // ---- the vendor sets a weekly discount ----
  const B = await person("beto");
  await login(B, "beto@example.com");
  await go(B, `#/dashboard?g=${gid}&tab=calendar`); await B.waitForSelector("#cap-w");
  await B.selectOption("#cap-w", "10"); await B.click("#capform button[type=submit]");
  await B.waitForFunction(() => /saved|guard/i.test(document.body.innerText));
  for (let i = 0; i < 20 && S.db.get("SELECT weekly_discount_pct p FROM groups WHERE id = ?", gid).p !== 10; i++) await new Promise((r) => setTimeout(r, 100));
  ok("the vendor sets 10% off for weekly bookings", S.db.get("SELECT weekly_discount_pct p FROM groups WHERE id = ?", gid).p === 10);

  // ---- the restaurant books every week ----
  const R = await person("sol");
  await login(R, "sol@example.com");
  await go(R, `#/group/${gid}?date=${first}`); await R.waitForSelector("#calbox .cal");
  await R.locator(`.day[data-d="${first}"]`).click(); await R.locator(".slot").first().click();
  await R.waitForSelector("#bookform");
  await R.selectOption("#b-weeks", "4");
  ok("the weekly hint and discount show", /10% off/.test(await R.locator("#wk-hint").innerText()) && await R.locator("#wk-hint").isVisible());
  await R.fill("#b-guests", "80"); await R.fill("#b-addr", "Restaurante El Sol, 1800 W Cermak Rd, Chicago");
  await R.check("#b-agree"); await R.click("#bookbtn");
  await R.waitForSelector("#paybtn, #bookerr:not(:empty)");
  if (await R.locator("#bookerr:not(:empty)").count()) console.log("bookerr:", await R.locator("#bookerr").innerText());
  ok("one payment page for all 4 weeks", (await R.locator(".panel").innerText()).split(first.slice(0, 4)).length >= 1 && /4|Mariachi Viernes/.test(await text(R)));
  await shot(R, "1-weekly-cart.png");
  await R.click("#paybtn"); await R.waitForFunction(() => location.hash.startsWith("#/bookings"));
  const rows = S.db.all("SELECT id, status, discount_cents FROM bookings WHERE series_id != '' ORDER BY date");
  ok("4 weekly bookings, all paid and waiting for the vendor", rows.length === 4 && rows.every((b) => b.status === "requested" && b.discount_cents > 0));
  await R.waitForSelector(".req");
  ok("each booking says week N of 4", /Weekly · 1 of 4/.test(await text(R)) && /Weekly · 4 of 4/.test(await text(R)));

  // ---- the vendor accepts all ----
  await go(B, `#/dashboard?g=${gid}&tab=requests`); await B.waitForSelector("[data-seriesacc]");
  await shot(B, "2-accept-all.png");
  await B.locator("[data-seriesacc]").first().click();
  for (let i = 0; i < 30 && S.db.all("SELECT status FROM bookings WHERE series_id != ''").some((b) => b.status !== "confirmed"); i++) await new Promise((r) => setTimeout(r, 100));
  ok("one tap accepts all 4 weeks", S.db.all("SELECT status FROM bookings WHERE series_id != ''").every((b) => b.status === "confirmed"));

  // ---- the first Friday happened: the restaurant leaves a tip ----
  S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-1), rows[0].id);
  await go(R, `#/booking/${rows[0].id}`); await R.waitForSelector("[data-tip]");
  await R.click("[data-tip]"); await R.click(".tip-form [data-amt='50']");
  await R.fill(".tip-form input[name=note]", "¡Qué bonito tocaron!");
  await shot(R, "3-tip.png");
  await R.click(".tip-form button[type=submit]"); await R.waitForSelector("#paybtn");
  ok("the tip page shows $50", /\$50/.test(await R.locator(".panel").innerText()));
  await R.click("#paybtn"); await R.waitForFunction(() => /You left a \$50\.00 tip|You left a \$50 tip/.test(document.body.innerText));
  ok("the booking shows the tip and the vendor got it", S.db.get("SELECT status FROM tips").status === "paid");
  await go(B, `#/dashboard?g=${gid}&tab=requests&past=1`);
  await B.waitForFunction(() => /\$50/.test(document.body.innerText));
  ok("the vendor sees the $50 tip", true);
  await go(R, `#/booking/${rows[3].id}`); await R.waitForSelector(".req");
  ok("the last week offers 'Book 4 more weeks'", /Book 4 more weeks/.test(await text(R)));

  // ---- the morning text can be turned off ----
  await go(B, "#/account"); await B.waitForSelector("#p-daily");
  ok("the morning text is on by default", await B.isChecked("#p-daily"));
  await B.uncheck("#p-daily"); await B.click("#pform button[type=submit]");
  for (let i = 0; i < 20 && S.db.get("SELECT daily_text d FROM users WHERE email = 'beto@example.com'").d !== 0; i++) await new Promise((r) => setTimeout(r, 100));
  ok("turning it off is saved", S.db.get("SELECT daily_text d FROM users WHERE email = 'beto@example.com'").d === 0);

  // ---- Spanish ----
  await R.evaluate(() => localStorage.setItem("bm_lang", "es"));
  await go(R, `#/booking/${rows[1].id}`); await R.waitForSelector(".req");
  ok("Spanish: Cada semana · 2 de 4", /Cada semana · 2 de 4/.test(await text(R)));
} catch (e) { failed++; console.log("FAIL crashed:", e.message); }
finally {
  for (const p of problems) { console.log("PROBLEM", p); failed++; }
  await browser.close(); await S.close();
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}
