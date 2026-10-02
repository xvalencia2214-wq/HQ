// Browser end-to-end for "Get quotes": request, group answers with an offer, customer sees and books it.
//   NODE_PATH=$(npm root -g) node e2e/e2e6.mjs [screenshotDir]
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
let step = 0, failed = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";
let nav = 0;
async function person(label, viewport = { width: 420, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} ${x}`); });
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForSelector("#nav a[data-r=account]", { state: "attached" }); };

try {
  const date = inDays(35);
  const owners = [];
  for (let i = 0; i < 3; i++) { const o = client(S.base); await o.signup(`o${i}@example.com`, `Owner ${i}`); owners.push({ o, id: await makeGroup(o, { name: `Quote Band ${i}`, dates: [date], extra: { events: ["Quinceañera"], max_guests: 300 } }) }); }
  const cc = client(S.base); await cc.signup("cus@example.com", "Carla Cliente");

  const C = await person("customer");
  await login(C, "cus@example.com");
  await go(C, "#/quotes"); await C.waitForSelector("#rqform");
  ok("the Get quotes page explains who the request goes to", (await C.locator(".rq-promise").innerText()).includes("free that day") && (await C.locator("#app").innerText()).includes("up to 5 groups"));
  await shot(C, "quotes-form.png");
  await C.fill("#rq-date", date); await C.fill("#rq-guests", "150"); await C.fill("#rq-note", "Outdoor patio. Call 312-555-0199");
  await C.click("#rqform button[type=submit]"); await C.waitForSelector(".rq-card");
  ok("sending shows the request with all 3 matching groups waiting", (await C.locator(".rq-card .req").count()) === 3 && (await C.locator(".rq-card").innerText()).includes("Waiting for a reply") && (await C.locator(".rq-card").innerText()).includes("sent to 3"));
  ok("the customer's phone number was masked in what groups received", !S.db.all("SELECT text FROM messages").some((m) => /555/.test(m.text)));
  await shot(C, "quotes-sent.png");

  // a group answers with an offer
  const uid = S.db.get("SELECT id FROM users WHERE email = 'cus@example.com'").id;
  const w = owners[1];
  await w.o.post(`/api/groups/${w.id}/offers`, { customerId: uid, name: "Quince package", hours: 3, price: 850, note: "Sound included" });
  await go(C, "#/quotes"); await C.waitForSelector(".rq-card .note.ok");
  ok("the offer shows on the quotes page with its price and a Book button", (await C.locator(".rq-card .note.ok").innerText()).includes("$850") && (await C.locator(".rq-card .btn:not(.ghost)", { hasText: "Book this offer" }).count()) === 1);
  await shot(C, "quotes-offer.png");

  // the group's side
  const O = await person("owner", { width: 900, height: 1000 });
  await login(O, "o1@example.com");
  await go(O, `#/dashboard?g=${w.id}&tab=messages`); await O.waitForSelector(".thread");
  await O.click(".thread"); await O.waitForSelector("#convchat");
  ok("the group sees the event request in its inbox with the details", (await O.locator("#convchat").innerText()).includes("Event request: Quinceañera"));

  // book the offer from the quotes page
  await C.click(".rq-card .btn:not(.ghost)"); await C.waitForSelector("#calbox .cal");
  ok("Book this offer opens the group page with the event details carried over", C.url().includes(`date=${date}`) && C.url().includes("guests=150"));
  ok("the private offer is on the group page for this customer", (await C.locator(".panel.offer").innerText()).includes("Quince package"));

  // a customer with no match gets a useful message, not silence
  const N = await person("nomatch"); const n = client(S.base); await n.signup("far@example.com", "Far Away"); await login(N, "far@example.com");
  await go(N, "#/quotes"); await N.waitForSelector("#rqform");
  await N.fill("#rq-date", date); await N.fill("#rq-guests", "50"); await N.fill("#rq-zip", "99501"); await N.click("#rqform button[type=submit]");
  await N.waitForSelector("#rqresult .note");
  ok("with no group free near that ZIP the page says so and offers a wider search", (await N.locator("#rqresult").innerText()).includes("No group that fits"));

  // Spanish
  await C.goto(`${S.base}/?n=${++nav}#/quotes`); await C.waitForSelector("#rqform");
  await C.click("#navtoggle"); await C.click("#langbtn"); await C.waitForSelector("text=Pide cotizaciones");
  ok("the quotes page is in Spanish", (await C.locator("#app").innerText()).includes("Tus solicitudes"));
} catch (e) {
  failed++; console.log("CRASH", e.message.split("\n").slice(0, 6).join(" | "));
}
console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors, no CSP violations, no missing translations");
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed || problems.length ? 1 : 0);
