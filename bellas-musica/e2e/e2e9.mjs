// Browser end-to-end for party vendors: a tent company lists itself, a customer browses categories, plans a party,
// books a tent (package-only) and sees it ticked on the checklist; Discover filters by category; Spanish.
//   NODE_PATH=$(npm root -g) node e2e/e2e9.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", RATE_FEEDEVENT: "1000" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let step = 0, failed = 0, nav = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";
const TINY_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");

async function person(label, viewport = { width: 1000, height: 1100 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await ctx.route(/youtube|vimeo|tiktok|instagram/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<body>player</body>" }));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::|Failed to fetch|Connection problem/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); };
const text = (p) => p.locator("body").innerText();

try {
  const vo = client(S.base), mo = client(S.base), cust = client(S.base);
  await vo.signup("vendor@example.com", "Vera Vendor"); await mo.signup("music@example.com", "Mario Music"); await cust.signup("cus@example.com", "Carla Cliente");
  const d = inDays(21);
  await makeGroup(mo, { name: "Mariachi Del Barrio", dates: [d] });

  // ---- a tent company lists itself through the normal form ----
  const V = await person("vendor");
  await login(V, "vendor@example.com");
  await go(V, "#/dashboard?new=1"); await V.waitForSelector("#cform");
  ok("the type list is grouped by category", (await V.locator("#c-type optgroup").count()) === 7);
  ok("a new music listing is booked by the hour by default", await V.isChecked("#c-hourly") && await V.isVisible("#c-rate"));
  await V.selectOption("#c-type", "Tents");
  ok("choosing Tents switches to packages and hides the hourly price", !(await V.isChecked("#c-hourly")) && !(await V.isVisible("#c-rate")));
  ok("the people field is called Team size for vendors", (await V.locator("#c-mem-l").innerText()) === "Team size");
  await V.fill("#c-name", "Carpas La Fiesta"); await V.fill("#c-zip", "60608"); await V.fill("#c-mem", "3");
  await V.fill("#c-story", "Tents from 20x20 to 40x60, delivered, staked and taken down by our crew. Rain or shine.");
  await V.click("#cform button[type=submit]");
  await V.waitForURL(/tab=calendar/);
  const gid = (await vo.get("/api/my/groups")).json.groups[0].id;
  const mine = (await vo.get("/api/my/groups")).json.groups[0];
  ok("the listing was created as a package-only rental", mine.hourly === false && mine.category === "rentals" && mine.rate_cents === 0);
  ok("the launch checklist doesn't ask a tent company for songs", !mine.checklist.items.some((i) => i.key === "songs"));
  await go(V, `#/dashboard?g=${gid}&tab=listing`); await V.waitForSelector("#lform");
  ok("music-only settings (sound system, set length) are hidden for a tent company", !(await V.isVisible("#l-set")) && !(await V.isVisible("#l-rate")));
  await go(V, `#/dashboard?g=${gid}&tab=extras`); await V.waitForSelector("#aoform");
  ok("the songs box is hidden for a tent company", !(await V.isVisible("#songs")));
  ok("tent quick-add extras are offered (side walls, heaters...)", /Side walls[\s\S]*Heaters/.test(await V.locator("#ao-presets").innerText()));
  // finish the listing the quick way
  await vo.patch(`/api/groups/${gid}`, { events: ["Wedding", "Quinceañera", "Birthday"] });
  await vo.put(`/api/groups/${gid}/availability`, { dates: { [d]: ["12:00 PM", "2:00 PM"] } });
  await vo.post(`/api/groups/${gid}/photos`, { data: TINY_PNG });
  ok("publishing without a package is refused with a clear reason", (await vo.post(`/api/groups/${gid}/publish`)).json.missing.includes("packages"));
  await vo.post(`/api/groups/${gid}/packages`, { name: "20x40 tent (80 guests)", description: "Delivery, setup and takedown", hours: 1, price: 650 });
  await vo.post(`/api/groups/${gid}/addons`, { name: "Side walls", price: 80 });
  ok("with a package it publishes", (await vo.post(`/api/groups/${gid}/publish`)).status === 200);

  // ---- a customer browses by category ----
  const C = await person("customer", { width: 430, height: 900 });
  await login(C, "cus@example.com");
  await go(C, "#/?zip=60608"); await C.waitForSelector(".catrow"); await C.waitForSelector(".card");
  ok("the search page starts on Music and only shows music", (await C.locator(".catchip.on").innerText()).includes("Music") && (await text(C)).includes("Mariachi Del Barrio") && !(await text(C)).includes("Carpas La Fiesta"));
  const rowBox = await C.locator(".catrow").boundingBox();
  ok("on a phone the category chips are one swipeable row", rowBox.height < 70);
  await C.click('.catchip:has-text("Rentals")'); await C.waitForFunction(() => /Carpas La Fiesta/.test(document.body.innerText));
  ok("Rentals shows the tent company, the heading changes and the ZIP is kept", (await text(C)).includes("Everything for your fiesta") && (await C.inputValue("#s-zip")) === "60608" && !(await text(C)).includes("Mariachi Del Barrio"));
  ok("vendor cards don't talk about musicians", !(await C.locator(".card").first().innerText()).includes("musicians"));

  // ---- Plan a party ----
  await go(C, "#/party"); await C.waitForSelector("#pform");
  await C.fill("#p-date", d); await C.fill("#p-zip", "60608"); await C.selectOption("#p-event", "Quinceañera"); await C.fill("#p-guests", "80");
  await C.click("#pform button[type=submit]");
  await C.waitForFunction(() => document.querySelectorAll(".party-cat").length === 7 && ![...document.querySelectorAll(".party-cat")].some((s) => /Searching/.test(s.innerText)));
  ok("Plan a party shows a section for each category", (await C.locator(".party-cat").count()) === 7);
  ok("music and rentals sections show who is free that day", (await C.locator("#pc-music").innerText()).includes("Mariachi Del Barrio") && (await C.locator("#pc-rentals").innerText()).includes("Carpas La Fiesta"));
  ok("empty categories say so", (await C.locator("#pc-food").innerText()).includes("Nobody in this category"));
  await C.uncheck('#needs input[value="venues"]');
  await C.waitForFunction(() => !document.getElementById("pc-venues"));
  ok("unticking a category in the checklist removes its section", (await C.locator("#pc-venues").count()) === 0);
  await shot(C, "party-phone.png");

  // ---- book the tent from there (package only, no hourly option) ----
  await C.click('#pc-rentals a.btn:has-text("See dates")');
  await C.waitForSelector(".day[data-d]");
  await C.click(`.day[data-d="${d}"]`); await C.click(".slot"); await C.waitForSelector("#bookform");
  const opts = await C.locator("#b-pkg option").allTextContents();
  ok("a package-only vendor has no hourly option, just its packages", opts.length === 1 && opts[0].includes("20x40 tent") && !(await C.isVisible("#b-hrs")));
  ok("the booking box says Request a booking (not 'this group')", (await C.locator("#bookpanel h2").innerText()) === "Request a booking");
  await C.check('input[name="addon"]');
  await C.fill("#b-guests", "80"); await C.fill("#b-ezip", "60608"); await C.fill("#b-phone", "(312) 555-0142"); await C.fill("#b-addr", "Backyard, 2100 S Ashland");
  await C.waitForFunction(() => /\$730/.test(document.getElementById("quote").innerText));
  ok("tent + side walls = $730", (await C.locator("#quote").innerText()).includes("$730"));
  await C.check("#b-agree"); await C.click("#bookbtn"); await C.waitForURL(/#\/pay\/booking\//);
  const bk = (await cust.get("/api/my/bookings")).json.bookings[0];
  await cust.post(`/api/bookings/${bk.id}/simulate-pay`);
  await go(C, `#/party?date=${d}&zip=60608`); await C.waitForSelector("#needs");
  await C.waitForFunction(() => /Booked: Carpas La Fiesta/.test(document.getElementById("needs").innerText));
  ok("the checklist ticks Rentals as booked for that date", (await C.locator("#needs").innerText()).includes("Booked: Carpas La Fiesta"));

  // ---- Discover by category ----
  await go(C, "#/discover"); await C.waitForSelector(".reel");
  ok("Discover starts with everything (music and vendors)", (await C.locator(".reel:not(.end) h2").allTextContents()).length >= 2);
  await C.click('.catchip:has-text("Rentals")'); await C.waitForSelector(".reel");
  await C.waitForFunction(() => [...document.querySelectorAll(".reel:not(.end) h2")].every((h) => /Carpas/.test(h.textContent)));
  ok("tapping Rentals in Discover shows only rentals", (await C.locator(".reel:not(.end) h2").allTextContents()).every((n) => n.includes("Carpas")));
  await C.click('.catchip:has-text("Everything")');
  await C.waitForFunction(() => document.querySelectorAll(".reel:not(.end) h2").length >= 2);

  // ---- Spanish ----
  await go(C, `#/?zip=60608&category=rentals`); await C.waitForSelector(".catrow");
  await C.click("#navtoggle"); await C.click("#langbtn");
  await C.waitForFunction(() => /Rentas/.test(document.body.innerText) && /Todo para tu fiesta/.test(document.body.innerText) && document.querySelector(".card"));
  ok("Spanish: categories, heading and vendor types are translated", (await text(C)).includes("Carpas") && (await text(C)).includes("Decoración"));
  await go(C, "#/party"); await C.waitForSelector("#pform");
  ok("Spanish: Plan a party is translated", (await text(C)).includes("Planea toda tu fiesta en un solo lugar"));

  ok("no JavaScript or console errors", problems.length === 0);
  if (problems.length) console.log(problems.slice(0, 8).join("\n"));
} catch (e) { failed++; console.log("CRASH", e.stack.split("\n").slice(0, 3).join("\n")); }
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed ? 1 : 0);
