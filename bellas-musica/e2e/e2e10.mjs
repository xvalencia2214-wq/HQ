// Browser end-to-end for saved parties: save from Plan a party with a template, budget, booked vendors, family shortlist,
// the family link in another browser (vote + comment, no account), timeline that the vendor sees, weather, QR sign and credits page.
//   NODE_PATH=$(npm root -g) node e2e/e2e10.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup, bookingBody } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const d = inDays(4);
const weather = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/geo+json" });
  if (req.url.startsWith("/points/")) res.end(JSON.stringify({ properties: { forecast: `http://127.0.0.1:${weather.address().port}/f` } }));
  else res.end(JSON.stringify({ properties: { periods: [{ name: "Saturday", startTime: `${d}T06:00:00-05:00`, isDaytime: true, temperature: 78, temperatureUnit: "F", shortForecast: "Showers Likely", probabilityOfPrecipitation: { value: 65 } }] } }));
});
await new Promise((r) => weather.listen(0, r));
const S = await startApp({ DEMO_SEED: "0", WEATHER_API_BASE: `http://127.0.0.1:${weather.address().port}` });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let step = 0, failed = 0, nav = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";
const TINY_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");

async function person(label, viewport = { width: 1000, height: 1100 }) {
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
const text = (p) => p.locator("body").innerText();

try {
  const mo = client(S.base), vo = client(S.base), cust = client(S.base);
  await mo.signup("music@example.com", "Mario Music"); await vo.signup("vendor@example.com", "Vera Vendor"); await cust.signup("rosa@example.com", "Rosa Martinez");
  const mus = await makeGroup(mo, { name: "Mariachi Del Barrio", dates: [d] });
  const mus2 = await makeGroup(mo, { name: "Banda Los Primos", dates: [d] });
  for (const [n, pr] of [["Party (2 hours)", 700], ["Full event (4 hours)", 1300]]) await mo.post(`/api/groups/${mus2}/packages`, { name: n, description: "", hours: 2, price: pr });
  const tent = (await vo.post("/api/groups", { name: "Carpas La Fiesta", type: "Tents", zip: "60608", members: 3, story: "Tents delivered, staked and taken down by our crew. Rain or shine, the party goes on." })).json.id;
  await vo.patch(`/api/groups/${tent}`, { events: ["Quinceañera", "Birthday"] }); await vo.put(`/api/groups/${tent}/availability`, { dates: { [d]: ["12:00 PM"] } });
  await vo.post(`/api/groups/${tent}/photos`, { data: TINY_PNG }); await vo.post(`/api/groups/${tent}/packages`, { name: "20x40 tent", description: "80 guests", hours: 1, price: 650 }); await vo.post(`/api/groups/${tent}/publish`);

  // ---- plan, pick a template, save ----
  const R = await person("rosa");
  await login(R, "rosa@example.com");
  await go(R, `#/party?date=${d}&zip=60608&guests=150`); await R.waitForSelector("#pform");
  await R.selectOption("#p-tpl", "birthday");
  ok("a template ticks what that kind of party needs", (await R.locator("#needs input:checked").count()) === 4 && (await R.inputValue("#p-event")) === "Birthday");
  await R.click("#psave"); await R.waitForURL(/#\/my-party\//);
  const pid = R.url().split("/my-party/")[1];
  await R.waitForSelector(".party-head");
  ok("the saved party page opens with its name", (await R.locator(".party-head h1").innerText()).includes("Birthday party"));
  await R.waitForSelector("#pp-weather .weather");
  ok("weather shows rain and suggests tents (none booked)", /65% chance of rain/.test(await R.locator("#pp-weather").innerText()) && (await R.locator("#pp-weather a").count()) === 1);
  ok("the guest calculator uses the guest count", /19 round tables/.test(await text(R)) && /600 tacos/.test(await text(R)));

  // ---- budget ----
  await R.fill("#b-amt", "3000"); await R.click("#pp-budget button"); await R.waitForFunction(() => /Left in your budget/.test(document.body.innerText));
  ok("with a budget the page shows what is left and a typical split", /\$3,000/.test(await text(R)) && (await R.locator("details.split").count()) === 1);

  // ---- family shortlist from the vendor sections ----
  await R.waitForFunction(() => document.querySelectorAll("#pc-music .card").length >= 2 && document.querySelector("#pc-rentals .card"));
  ok("the price guide appears for a category with enough prices", /Usually \$\d/.test(await R.locator("#pc-music .guide").innerText()));
  await R.click(`#pc-music [data-pick="${mus2}"]`); await R.waitForFunction(() => /Added/.test(document.querySelector("#pc-music").innerText));
  await R.click(`#pc-rentals [data-pick="${tent}"]`); await R.waitForFunction(() => /Added/.test(document.querySelector("#pc-rentals").innerText));
  await go(R, `#/my-party/${pid}`); await R.waitForSelector("#pp-picks");
  ok("both options are on the family shortlist", (await R.locator("#pp-picks .pick").count()) === 2);

  // ---- book music for that day: it shows up as a vendor and counts against the budget ----
  const bk = (await cust.post("/api/bookings", bookingBody(mus, d, { hours: 3, event: "Birthday" }))).json.booking;
  await cust.post(`/api/bookings/${bk.id}/simulate-pay`); await mo.patch(`/api/bookings/${bk.id}`, { action: "accept" });
  await go(R, `#/my-party/${pid}`); await R.waitForSelector(".plist");
  ok("the booked mariachi is listed with its balance", /Mariachi Del Barrio/.test(await R.locator(".plist").first().innerText()) && /left to pay/.test(await R.locator(".plist").first().innerText()));
  ok("the budget counts it ($900 booked, $2,100 left)", /\$900/.test(await text(R)) && /\$2,100/.test(await text(R)));
  ok("music is ticked as booked and no longer searched", (await R.locator("#pp-needs .need.done").count()) === 1 && (await R.locator("#pc-music").count()) === 0);

  // ---- timeline, linked to the mariachi ----
  await R.click("#tl-tpl");
  ok("the suggested schedule fills the timeline", (await R.locator(".tlrow").count()) >= 5);
  const lastRow = R.locator(".tlrow").nth(5);
  await lastRow.locator(".tl-b").selectOption(bk.id);
  await R.click("#tl-save"); await R.waitForFunction(() => /Saved/.test(document.body.innerText));
  const vendorView = (await mo.get(`/api/groups/${mus}/bookings`)).json.bookings.find((b) => b.id === bk.id);
  ok("the mariachi sees the arrival time the family set", vendorView.arrival && vendorView.arrival.at === "19:00");
  await shot(R, "party-owner.png");

  // ---- family link in another browser, no account ----
  const P = (await cust.get(`/api/parties/${pid}`)).json.party;
  const F = await person("tia", { width: 430, height: 900 });
  await F.goto(P.share_url.replace(/^https?:\/\/[^/]+/, S.base)); await F.waitForSelector(".pick");
  ok("the family page greets them and shows the shortlist", /Rosa wants your help/.test(await text(F)) && (await F.locator(".pick").count()) === 2);
  ok("the family page shows no address and no money paid", !/Casa Blanca|Budget|Paid so far/.test(await text(F)));
  await F.click(".pick >> nth=1 >> [data-vote]"); await F.waitForFunction(() => document.querySelector(".pick [aria-pressed='true']"));
  ok("a vote moves the option to the top with 1 ♥", (await F.locator(".pick").first().locator("[data-vote]").innerText()).includes("1"));
  const form = F.locator(".pick").first().locator("form");
  await form.locator("input[name=name]").fill("Tía Lupe"); await form.locator("input[name=text]").fill("¡Esta carpa está bonita!"); await form.locator("button").click();
  await F.waitForFunction(() => /Tía Lupe/.test(document.body.innerText));
  ok("the comment appears with their name", /Tía Lupe.*Esta carpa/.test(await text(F)));
  await shot(F, "party-family-phone.png");
  await go(R, `#/my-party/${pid}`); await R.waitForSelector("#pp-picks");
  ok("the host sees the vote and the comment", /♥ 1/.test(await R.locator("#pp-picks").innerText()) && /Tía Lupe/.test(await R.locator("#pp-picks").innerText()));

  // ---- QR sign and the credits page ----
  await go(R, `#/my-party/${pid}/sign`); await R.waitForSelector("#allow");
  await R.click("#allow"); await R.waitForSelector("#qr svg");
  ok("the sign shows a QR code and the booked vendors", (await R.locator("#qr svg rect, #qr svg path").count()) > 0 && /Mariachi Del Barrio/.test(await R.locator(".sign").innerText()));
  await shot(R, "party-sign.png");
  const G = await person("guest", { width: 430, height: 900 });
  await go(G, `#/thanks/${pid}`); await G.waitForSelector(".plist");
  ok("scanning opens the credits page with the vendors", /planned on Bella's Música/.test(await text(G)) && /Mariachi Del Barrio/.test(await text(G)) && !/\$/.test(await G.locator(".plist").innerText()));

  // ---- open this week ----
  await go(R, "#/?zip=60608&soon=1"); await R.waitForSelector(".card");
  ok("the Open this week filter shows the badge", (await R.locator(".tag.soon").count()) >= 1);

  // ---- Spanish family page ----
  await F.click("#navtoggle"); await F.click("#langbtn");
  await F.waitForFunction(() => /quiere tu ayuda/.test(document.body.innerText));
  ok("the family page in Spanish", /Lista de la familia/.test(await text(F)));

  ok("no JavaScript or console errors", problems.length === 0);
  if (problems.length) console.log(problems.slice(0, 8).join("\n"));
} catch (e) { failed++; console.log("CRASH", e.stack.split("\n").slice(0, 3).join("\n")); }
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close(); weather.close();
process.exit(failed ? 1 : 0);
