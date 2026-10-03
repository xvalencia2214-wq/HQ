// Browser end-to-end for money features: a bundle set up in two dashboards, the deal on a group page, one checkout for two vendors
// with the bundle discount, paying part of a balance, and a padrino paying through the family link.
//   NODE_PATH=$(npm root -g) node e2e/e2e11.mjs [screenshotDir]
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
  const mo = client(S.base), vo = client(S.base), cust = client(S.base), tio = client(S.base);
  await mo.signup("music@example.com", "Mario Music"); await vo.signup("vendor@example.com", "Vera Vendor"); await cust.signup("rosa@example.com", "Rosa Martinez"); await tio.signup("tio@example.com", "Juan Martinez");
  const d = inDays(24), d2 = inDays(25);
  const mus = await makeGroup(mo, { name: "Mariachi Del Barrio", dates: [d, d2] });
  const tent = (await vo.post("/api/groups", { name: "Carpas La Fiesta", type: "Tents", zip: "60608", members: 3, story: "Tents delivered, staked and taken down by our crew. Rain or shine, the party goes on." })).json.id;
  await vo.patch(`/api/groups/${tent}`, { events: ["Wedding", "Quinceañera"] }); await vo.put(`/api/groups/${tent}/availability`, { dates: { [d]: ["12:00 PM"] } });
  await vo.post(`/api/groups/${tent}/photos`, { data: TINY_PNG }); await vo.post(`/api/groups/${tent}/packages`, { name: "20x40 tent", description: "80 guests", hours: 1, price: 600 }); await vo.post(`/api/groups/${tent}/publish`);

  // ---- the tent company starts a bundle from its dashboard; the mariachi accepts in theirs ----
  const V = await person("vendor");
  await login(V, "vendor@example.com");
  await go(V, `#/dashboard?g=${tent}&tab=extras`); await V.waitForSelector("#bunform");
  await V.fill("#bu-name", "Backyard party: tent + mariachi"); await V.fill("#bu-pct", "10"); await V.fill("#bu-partners", `${S.base}/#/group/${mus}`);
  await V.click("#bunform button[type=submit]"); await V.waitForFunction(() => /Waiting for partners/.test(document.getElementById("bun-list").innerText));
  ok("the bundle is created and waits for the partner", true);
  const M = await person("music");
  await login(M, "music@example.com");
  await go(M, `#/dashboard?g=${mus}&tab=extras`); await M.waitForSelector("[data-bacc]");
  await M.click("[data-bacc]"); await M.waitForFunction(() => /Active/.test(document.getElementById("bun-list").innerText));
  ok("the mariachi accepts and the bundle is active", true);

  // ---- the customer sees the deal on the group page ----
  const R = await person("rosa");
  await login(R, "rosa@example.com");
  await go(R, `#/group/${mus}`); await R.waitForSelector(".deal");
  ok("the group page shows Book together and save 10% with the partner", /Book together and save 10%/.test(await R.locator(".deal").innerText()) && /Carpas La Fiesta/.test(await R.locator(".deal").innerText()));

  // ---- two holds, one checkout, bundle discount ----
  const h1 = (await cust.post("/api/bookings", { groupId: mus, date: d, time: "2:00 PM", hours: 3, event: "Wedding", guests: 80, eventZip: "60608", name: "Rosa", phone: "(312) 555-0142", address: "Backyard", acceptPolicy: true })).json.booking;
  const pkg = (await cust.get(`/api/groups/${tent}`)).json.packages[0].id;
  const h2 = (await cust.post("/api/bookings", { groupId: tent, date: d, time: "12:00 PM", packageId: pkg, event: "Wedding", guests: 80, eventZip: "60608", name: "Rosa", phone: "(312) 555-0142", address: "Backyard", acceptPolicy: true })).json.booking;
  await go(R, "#/bookings"); await R.waitForSelector(".cartbox");
  ok("My bookings offers to pay both deposits at once", /2 deposits waiting/.test(await R.locator(".cartbox").innerText()));
  await R.waitForFunction(() => /You save \$150/.test(document.querySelector(".cartbox").innerText));
  ok("before paying, the button shows the bundle price and the savings", /Pay all at once \(\$(\d+(\.\d+)?)\)/.test(await R.locator("[data-cart]").innerText()) && /You save \$150/.test(await R.locator(".cartbox").innerText()));
  await R.click("[data-cart]"); await R.waitForURL(/#\/pay\/cart\//); await R.waitForSelector("#paybtn");
  ok("the checkout lists both vendors and the bundle savings", /Mariachi Del Barrio/.test(await text(R)) && /Carpas La Fiesta/.test(await text(R)) && /You save \$90/.test(await text(R)) && /You save \$60/.test(await text(R)));
  await shot(R, "cart.png");
  await R.click("#paybtn"); await R.waitForURL(/#\/bookings/); await R.waitForSelector(".req");
  const after = (await cust.get("/api/my/bookings")).json.bookings;
  ok("both deposits are paid and both vendors got the request", after.filter((b) => [h1.id, h2.id].includes(b.id)).every((b) => b.status === "requested" && b.payment_status === "paid"));
  ok("the discounts were applied (mariachi $810, tent $540)", after.find((b) => b.id === h1.id).total_cents === 81000 && after.find((b) => b.id === h2.id).total_cents === 54000);

  // ---- pay part of the balance (payment plan) ----
  await mo.patch(`/api/bookings/${h1.id}`, { action: "accept" });
  await go(R, "#/bookings"); await R.waitForSelector(`[data-part="${h1.id}"]`);
  await R.click(`[data-part="${h1.id}"]`); await R.waitForSelector(".part-form:not([hidden]) form");
  ok("the payment plan suggests 2 or 3 payments", /In 2 payments/.test(await R.locator(".part-form:not([hidden])").innerText()));
  await R.fill(".part-form:not([hidden]) input", "200"); await R.click(".part-form:not([hidden]) button[type=submit]");
  await R.waitForURL(/#\/pay\/part\//); await R.waitForSelector("#paybtn");
  await R.click("#paybtn"); await R.waitForURL(/#\/booking\//); await R.waitForSelector(".req");
  ok("the booking shows the payment and what is left", /You paid \$200/.test(await R.locator(".req").innerText()) && /\$407\.50 left to pay/.test(await R.locator(".req").innerText()));

  // ---- a padrino pays through the family link ----
  const party = (await cust.post("/api/parties", { title: "Boda de Rosa", date: d, zip: "60608" })).json.party;
  const T = await person("tio", { width: 430, height: 900 });
  await T.goto(party.share_url.replace(/^https?:\/\/[^/]+/, S.base)); await T.waitForSelector("[data-padrino]");
  await T.click("[data-padrino]"); await T.waitForURL(/#\/signup/);
  ok("someone not logged in is asked to sign up first", true);
  await login(T, "tio@example.com");
  await T.goto(party.share_url.replace(/^https?:\/\/[^/]+/, S.base)); await T.waitForSelector("[data-padrino]");
  await T.click("[data-padrino]"); await T.waitForSelector(".padform form");
  await T.fill(".padform [name=name]", "Tío Juan"); await T.fill(".padform [name=note]", "Padrino de mariachi"); await T.fill(".padform [name=amount]", "300");
  await T.click(".padform button[type=submit]"); await T.waitForURL(/#\/pay\/part\//); await T.waitForSelector("#paybtn");
  await T.click("#paybtn"); await T.waitForURL(/#\/bookings/);
  await T.goto(party.share_url.replace(/^https?:\/\/[^/]+/, S.base)); await T.waitForSelector(".plist");
  ok("the family page shows Tío Juan as padrino", /Padrinos: Tío Juan/.test(await text(T)));
  await shot(T, "padrino-phone.png");
  await go(R, `#/booking/${h1.id}`); await R.waitForSelector(".req");
  ok("Rosa sees what Tío Juan paid and the new amount left", /Tío Juan paid \$300/.test(await R.locator(".req").innerText()) && /\$107\.50 left/.test(await R.locator(".req").innerText()));
  await go(R, `#/my-party/${party.id}`); await R.waitForSelector(".plist");
  ok("the party page lists the padrino with the amount", /Padrinos: Tío Juan \(\$300\)/.test(await text(R)));
  await go(M, `#/dashboard?g=${mus}&tab=requests`); await M.waitForSelector(".req");
  ok("the mariachi sees who paid and the bundle discount", /Tío Juan paid \$300/.test(await text(M)) && /Bundle discount: \$90/.test(await text(M)));

  // ---- Spanish ----
  await T.click("#navtoggle"); await T.click("#langbtn"); await T.waitForFunction(() => /Ser padrino|Padrinos:/.test(document.body.innerText));
  ok("Spanish: padrinos", /Padrinos: Tío Juan/.test(await text(T)));

  ok("no JavaScript or console errors", problems.length === 0);
  if (problems.length) console.log(problems.slice(0, 8).join("\n"));
} catch (e) { failed++; console.log("CRASH", e.stack.split("\n").slice(0, 3).join("\n")); }
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed ? 1 : 0);
