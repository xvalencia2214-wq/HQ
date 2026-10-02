// Browser end-to-end for minimum hours and add-ons (DJ fog machine / lights / visuals / audio-video).
//   NODE_PATH=$(npm root -g) node e2e/e2e8.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let step = 0, failed = 0, nav = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";

async function person(label, viewport = { width: 900, height: 1200 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::|Failed to fetch|Connection problem/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); };

try {
  const dj = client(S.base), cust = client(S.base);
  await dj.signup("dj@example.com", "Dani DJ"); await cust.signup("cus@example.com", "Carla Cliente");
  const gid = await makeGroup(dj, { name: "DJ Luces Chicago", rate: 200, dates: [inDays(30), inDays(31)], extra: { type: "DJ", events: ["Wedding", "Quinceañera"] } });

  // ---- the DJ sets a minimum and adds the lighting/effects extras from the quick-add buttons ----
  const D = await person("dj");
  await login(D, "dj@example.com");
  await go(D, `#/dashboard?g=${gid}&tab=listing`); await D.waitForSelector("#l-minh");
  await D.selectOption("#l-minh", "3"); await D.click("#lform button[type=submit]");
  await D.waitForSelector(".toast, [role=status]", { timeout: 4000 }).catch(() => {});
  await D.waitForTimeout(500);
  ok("the minimum hours is saved", (await dj.get("/api/my/groups")).json.groups[0].min_hours === 3);
  await go(D, `#/dashboard?g=${gid}&tab=extras`); await D.waitForSelector("#aoform");
  ok("a DJ sees quick-add buttons for fog, lights, visuals and audio/video", (await D.locator("#ao-presets [data-preset]").allTextContents()).join("|").match(/Fog machine.*Dance floor lights.*Special lighting.*Visuals.*Audio and video/s) !== null);
  ok("the DJ tip is shown", (await D.locator("#addons-panel").innerText()).includes("fog machine"));
  const addPreset = async (label, price) => {
    await D.click(`#ao-presets [data-preset^="${label}"]`);
    ok(`quick-add "${label}" fills the name`, (await D.inputValue("#ao-name")).startsWith(label));
    await D.fill("#ao-price", String(price)); await D.click("#aoform button[type=submit]");
    await D.waitForFunction((l) => [...document.querySelectorAll("#addons-panel .pkg strong")].some((e) => e.textContent.startsWith(l)), label);
  };
  await addPreset("Fog machine", 75); await addPreset("Special lighting", 150); await addPreset("Audio and video setup", 0);
  ok("an added extra leaves the quick-add list", (await D.locator('#ao-presets [data-preset^="Fog machine"]').count()) === 0);
  ok("a price of $0 shows as Included", (await D.locator("#addons-panel").innerText()).includes("Included"));
  await D.fill("#ao-name", "My own thing"); await D.fill("#ao-price", "-4"); await D.click("#aoform button[type=submit]");
  await D.waitForFunction(() => document.getElementById("aoerr").textContent.length > 0);
  ok("a bad price shows an error and saves nothing", (await dj.get(`/api/groups/${gid}`)).json.addons.length === 3);
  await shot(D, "dj-addons.png");

  // ---- a customer sees the minimum, the hour choices start there, and ticking add-ons updates the total ----
  const C = await person("customer", { width: 430, height: 900 });
  await login(C, "cus@example.com");
  await go(C, `#/?zip=60608`); await C.waitForSelector(".card, .gcard, [data-gid]", { timeout: 8000 }).catch(() => {});
  ok("the search card says 3-hour minimum", (await C.locator("body").innerText()).includes("3-hour minimum"));
  await go(C, `#/group/${gid}`); await C.waitForSelector(".day[data-d]");
  ok("the group page shows the minimum and an Add-ons list with prices", (await C.locator("body").innerText()).includes("3-hour minimum"));
  ok("the add-ons section lists fog machine at $75 and audio/video as Included", await C.evaluate(() => { const t = document.body.innerText; return /Fog machine[\s\S]*\$75/.test(t) && /Audio and video setup[\s\S]*Included/.test(t); }));
  await C.click(`.day[data-d="${inDays(30)}"]`); await C.click(".slot");
  await C.waitForSelector("#bookform");
  const hours = await C.locator("#b-hrs option").allTextContents();
  ok("the hour choices start at the group's minimum", hours[0].startsWith("3") && hours.length === 4);
  ok("the hourly option names the minimum", (await C.locator("#b-pkg option").first().innerText()).includes("3-hour minimum"));
  await C.fill("#b-guests", "100"); await C.fill("#b-ezip", "60608");
  await C.waitForFunction(() => document.querySelector("#quote .sum"));
  const total = async () => C.evaluate(() => { const rows = [...document.querySelectorAll("#quote .sum")]; const r = rows.find((x) => /total/i.test(x.firstChild.textContent)); return r ? r.lastChild.textContent : ""; });
  ok("without add-ons the total is 3 hours x $200", (await total()) === "$600");
  await C.check('input[name="addon"] >> nth=0'); await C.check('input[name="addon"] >> nth=1');
  await C.waitForFunction(() => /\$825/.test(document.getElementById("quote").innerText));
  ok("ticking fog + special lighting adds $225", (await total()) === "$825");
  ok("each ticked add-on is its own line in the quote", await C.evaluate(() => /Fog machine[\s\S]*\$75/.test(document.getElementById("quote").innerText) && /Special lighting[\s\S]*\$150/.test(document.getElementById("quote").innerText)));
  await C.uncheck('input[name="addon"] >> nth=1');
  await C.waitForFunction(() => /\$675/.test(document.getElementById("quote").innerText));
  ok("unticking removes it again", (await total()) === "$675");
  await C.check('input[name="addon"] >> nth=1'); await C.waitForFunction(() => /\$825/.test(document.getElementById("quote").innerText));
  await shot(C, "customer-booking-addons.png");

  // ---- book it: the server's total matches, the booking page and the DJ's request list show the extras ----
  await C.fill("#b-phone", "(312) 555-0142"); await C.fill("#b-addr", "Casa Blanca Hall, Chicago"); await C.check("#b-agree");
  await C.click("#bookbtn");
  await C.waitForURL(/#\/pay\/booking\//); await C.waitForSelector("button, .btn");
  const bk = (await cust.get("/api/my/bookings")).json.bookings[0];
  ok("the booking was saved with the add-ons and the right total", bk.total_cents === 82500 && bk.addons.length === 2);
  await cust.post(`/api/bookings/${bk.id}/simulate-pay`);
  await go(C, "#/bookings"); await C.waitForSelector(".req");
  ok("My bookings lists the add-ons", (await C.locator(".req").first().innerText()).includes("Add-ons: Fog machine, Special lighting"));
  await go(D, `#/dashboard?g=${gid}&tab=requests`); await D.waitForSelector(".req");
  ok("the DJ's request lists the add-ons to bring", (await D.locator(".req").first().innerText()).includes("Add-ons: Fog machine, Special lighting"));
  await dj.patch(`/api/bookings/${bk.id}`, { action: "accept" });
  await go(C, `#/agreement/${bk.id}`); await C.waitForSelector("table.kv");
  ok("the agreement itemizes the add-ons and the total", await C.evaluate(() => { const t = document.body.innerText; return /Fog machine/.test(t) && /Special lighting/.test(t) && /\$825/.test(t); }));
  await shot(C, "agreement-addons.png");

  // ---- Spanish ----
  await go(C, `#/group/${gid}`); await C.waitForSelector(".day[data-d]"); await C.click("#navtoggle"); await C.click("#langbtn");
  await C.waitForFunction(() => /Mínimo 3 horas/.test(document.body.innerText));
  ok("Spanish: minimum and add-ons are translated", await C.evaluate(() => /Mínimo 3 horas/.test(document.body.innerText) && /Extras/.test(document.body.innerText) && /Incluido/.test(document.body.innerText)));
  await D.click("#langbtn"); await go(D, `#/dashboard?g=${gid}&tab=extras`); await D.waitForSelector("#aoform");
  ok("Spanish: the DJ's panel and quick-add buttons are translated", (await D.locator("#addons-panel").innerText()).includes("Agregar este extra") || (await D.locator("#aoform").innerText()).includes("Agregar este extra"));

  // ---- a group with no extras and the default minimum looks exactly as before ----
  const plain = await makeGroup(dj, { name: "Plain Band", dates: [inDays(30)] });
  await go(C, `#/group/${plain}`); await C.waitForSelector(".day[data-d]");
  ok("no minimum tag and no add-ons section when the group has neither", !/Mínimo|minimum/.test(await C.locator("body").innerText()) && (await C.locator("fieldset.addons").count()) === 0);
  ok("no JavaScript or console errors", problems.length === 0);
  if (problems.length) console.log(problems.slice(0, 8).join("\n"));
} catch (e) { failed++; console.log("CRASH", e.stack.split("\n").slice(0, 3).join("\n")); }
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed ? 1 : 0);
