// Browser end-to-end for the features that answer the big booking sites: the founding offer, signing the agreement,
// asking a past client for a review (and the client writing it), the guest list with an RSVP from a phone, the court of
// honor, the held deposit note, and the Spanish search page.
//   NODE_PATH=$(npm root -g) node e2e/e2e17.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup, bookingBody } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", FOUNDING_SLOTS: "25", HOLD_NEW_VENDOR_EVENTS: "3", PAST_REVIEW_IP_CHECK: "0" });
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
const until = async (fn, ms = 4000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

try {
  const vo = client(S.base), fa = client(S.base);
  await vo.signup("v17@example.com", "Chuy Hernández"); await fa.signup("f17@example.com", "Rosa Martínez", { phone: "312-555-0142" });
  await client(S.base).signup("c17@example.com", "Lucía Herrera");

  // ---- the founding offer on the new-listing form (before anyone takes a spot) ----
  const N = await person("newvendor");
  await client(S.base).signup("n17@example.com", "New Vendor");
  await login(N, "n17@example.com"); await go(N, "#/dashboard?new=1"); await N.waitForSelector("#cform");
  ok("the founding offer shows on the new-listing form", /Founding offer: 5% fee for your first 6 months\. 25 of 25 spots left/.test(await text(N)));

  const gid = await makeGroup(vo, { name: "Mariachi Diecisiete", dates: [inDays(30), inDays(31)] });
  ok("the first listing to go live is founding vendor #1", S.db.get("SELECT founding_no FROM groups WHERE id = ?", gid).founding_no === 1);

  // a confirmed booking: the family's deposit is held for this new vendor
  const b = (await fa.post("/api/bookings", bookingBody(gid, inDays(30)))).json.booking;
  await fa.post(`/api/bookings/${b.id}/simulate-pay`); await vo.patch(`/api/bookings/${b.id}`, { action: "accept" });

  // ---- the family: held deposit note, signing the agreement ----
  const F = await person("family");
  await login(F, "f17@example.com"); await go(F, "#/bookings"); await F.waitForSelector(".req");
  ok("the family sees its deposit is held until check-in", /keeps your deposit safe until they check in/.test(await text(F)));
  await F.click(`a[href="#/agreement/${b.id}"]`); await F.waitForSelector("#signform");
  await F.check("#sg-ok"); await F.click("#signform button[type=submit]");
  ok("the family signs the agreement", await until(() => S.db.get("SELECT name FROM agreement_signs WHERE booking_id = ? AND side = 'customer'", b.id)?.name === "Rosa Martínez"));
  await F.waitForSelector("#agr-sign td");
  ok("the agreement shows who signed", /Signed by Rosa Martínez/.test(await text(F)));

  // ---- the vendor: held share, signs too, asks a past client for a review ----
  const V = await person("vendor");
  await login(V, "v17@example.com"); await go(V, `#/dashboard?g=${gid}&tab=requests`); await V.waitForSelector(".req");
  ok("the vendor sees its share waits for check-in", /is sent when you check in at the party/.test(await text(V)));
  await go(V, `#/agreement/${b.id}?g=${gid}`); await V.waitForSelector("#signform");
  await V.fill("#sg-name", "Chuy Hernández"); await V.check("#sg-ok"); await V.click("#signform button[type=submit]");
  ok("both sides signed", await until(async () => /Signed by both sides/.test(await text(V))));
  await shot(V, "e17-agreement.png");
  await go(V, `#/dashboard?g=${gid}&tab=reviews`); await V.waitForSelector("#prinv");
  await V.fill("#pi-name", "Lucía Herrera"); await V.selectOption("#pi-event", "Wedding"); await V.click("#prinv button[type=submit]");
  await V.waitForSelector("#prurl");
  const link = await V.inputValue("#prurl");
  ok("the vendor gets a review link to send by WhatsApp", /#\/review\/[\w-]{20,}/.test(link) && await V.locator("#prlink a[href^='https://wa.me/']").count() === 1);
  await shot(V, "e17-dash-reviews.png");

  // ---- the past client writes the review on a phone ----
  const C = await person("client", { width: 390, height: 844 });
  await C.goto(link.replace(/^https?:\/\/[^/]+/, S.base)); await C.waitForSelector(".panel");
  ok("logged out, the client is asked to sign up or log in", /Log in or create a free account/.test(await text(C)));
  await login(C, "c17@example.com");
  await C.goto(link.replace(/^https?:\/\/[^/]+/, S.base) + "?again"); await C.goto(link.replace(/^https?:\/\/[^/]+/, S.base)); await C.waitForSelector("#prform");
  await C.click("label[for=pr-s4]"); await C.fill("#pr-text", "They played our wedding and everyone danced all night long.");
  await C.click("#prform button[type=submit]");
  ok("the review is sent", await until(async () => /Thank you! Your review is on their page now/.test(await text(C))));
  await go(C, `#/group/${gid}`); await C.waitForSelector(".review");
  ok("it shows on the group page with the Past client label and 4 stars", /Lucía H\.\s*Past client · Wedding/.test(await text(C)) && S.db.get("SELECT rating FROM client_reviews WHERE status = 'done'").rating === 4);

  // ---- the guest list and an RSVP from a phone ----
  const party = (await fa.post("/api/parties", { title: "Quince de Sofía", event: "Quinceañera", date: inDays(30), zip: "60608", guests: 100 })).json.party;
  await go(F, `#/my-party/${party.id}`); await F.waitForSelector("#gl-add");
  await F.fill("#ga-name", "Tía Carmen"); await F.fill("#ga-seats", "4"); await F.fill("#ga-side", "Familia de mamá"); await F.fill("#ga-phone", "773-555-0101");
  await F.click("#gl-add button[type=submit]");
  await F.waitForSelector(".guest");
  await F.click("#pp-guests details:not(.gl-open) summary"); await F.fill("#gl-lines", "Padrino Juan, 2\nFamilia Soto, 5, Vecinos"); await F.click("#gl-bulk button[type=submit]");
  ok("guests added one by one and as a pasted list", await until(async () => (await F.locator(".guest").count()) === 3));
  ok("each guest has a WhatsApp invitation with their own link", /wa\.me\/17735550101\?text=.*%23%2Frsvp%2F/.test(await F.locator(".guest").filter({ hasText: "Tía Carmen" }).locator("a").first().getAttribute("href")));
  await F.locator(".court-row .c-role").first().fill("Chambelán de honor"); await F.locator(".court-row .c-name").first().fill("Diego");
  await F.click("#court-save");
  ok("the court of honor is saved", await until(() => S.db.get("SELECT name FROM party_court WHERE role = 'Chambelán de honor'")?.name === "Diego"));
  const carmenUrl = S.db.get("SELECT token FROM party_guests WHERE name = 'Tía Carmen'").token;
  const G = await person("guest", { width: 390, height: 844 });
  await G.goto(`${S.base}/#/rsvp/${carmenUrl}`); await G.waitForSelector("#rsvpform");
  ok("the invitation shows the party and greets the guest", /Rosa invites you to[\s\S]*Quince de Sofía[\s\S]*Hi Tía!/.test(await text(G)));
  await G.click("input[name=rsvp][value=yes]"); await G.fill("#rv-coming", "3"); await G.fill("#rv-note", "Sin cebolla"); await G.click("#rsvpform button[type=submit]");
  ok("the guest answers yes for 3", await until(async () => /See you at the party/.test(await text(G))) && S.db.get("SELECT coming FROM party_guests WHERE token = ?", carmenUrl).coming === 3);
  await shot(G, "e17-rsvp.png");
  await go(F, `#/my-party/${party.id}`); await F.waitForSelector(".guest");
  ok("the host sees the answer and the totals", /3 coming · 2 haven't answered/.test(await text(F)) && /“Sin cebolla”/.test(await text(F)));
  await F.click("#gl-count");
  ok("the host uses the answers as the guest count", await until(() => S.db.get("SELECT guests FROM parties WHERE id = ?", party.id).guests === 3));
  await shot(F, "e17-guests.png");
  // the open link from the family chat: a cousin types her name
  const openTok = S.db.get("SELECT rsvp_token FROM parties WHERE id = ?", party.id).rsvp_token;
  const G2 = await person("cousin", { width: 390, height: 844 });
  await G2.goto(`${S.base}/#/rsvp/${openTok}`); await G2.waitForSelector("#rv-name");
  await G2.fill("#rv-name", "Prima Daniela"); await G2.click("input[name=rsvp][value=maybe]"); await G2.click("#rsvpform button[type=submit]");
  ok("from the open link the cousin gets her own link to change the answer", await until(async () => /change your answer/.test(await text(G2))) && !G2.url().includes(openTok));

  // ---- Spanish ----
  await F.evaluate(() => localStorage.setItem("bm_lang", "es"));
  await go(F, `#/my-party/${party.id}`); await F.waitForSelector("#pp-guests");
  ok("Spanish: the guest list and the court", /Lista de invitados y confirmaciones/.test(await text(F)) && /Corte de honor y padrinos/.test(await text(F)));
  await G.evaluate(() => localStorage.setItem("bm_lang", "es")); await G.goto(`${S.base}/?x=1#/rsvp/${carmenUrl}`); await G.waitForSelector(".rsvp");
  ok("Spanish: the invitation", /Rosa te invita a/.test(await text(G)));
  const E = await person("spanish-page");
  await E.goto(`${S.base}/es/chicago/pilsen/quinceanera`); await E.waitForTimeout(800);
  ok("the Spanish search page opens the app in Spanish", (await E.evaluate(() => document.documentElement.lang)) === "es");
} catch (e) { failed++; console.log("FAIL crashed:", e.message); }
finally {
  for (const p of problems) { console.log("PROBLEM", p); failed++; }
  await browser.close(); await S.close();
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}
