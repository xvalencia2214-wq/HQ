// Browser end-to-end for "Get quotes" (step-by-step): request, group offer, booking the offer, no-match, account-last, Spanish.
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
const stepText = (p) => p.locator(".wiz-step").innerText();
const next = async (p) => { const before = await stepText(p); await p.click("#wnext"); await p.waitForFunction((b) => document.querySelector(".wiz-step")?.innerText !== b, before); };
// Answers whatever step is showing, until the account step or the last step is reached. Returns true when it stopped on the account step.
async function answer(p, v, { until = 99 } = {}) {
  for (let k = 0; k < 12 && k < until; k++) {
    const has = (s) => p.locator(s).count().then((n) => n > 0);
    if (await has("#f-name") || await has("#f-email")) return true;
    if (await has("#f-date")) await p.fill("#f-date", v.date);
    else if (await has("#f-time") && v.time) await p.selectOption("#f-time", v.time);
    else if (await has("#f-zip")) await p.fill("#f-zip", v.zip);
    else if (await has("#f-guests")) await p.fill("#f-guests", v.guests);
    else if (await has("#f-size") && v.size) await p.selectOption("#f-size", v.size);
    else if (await has("#f-bmin")) { await p.fill("#f-bmin", v.bmin || ""); await p.fill("#f-bmax", v.bmax || ""); }
    else if (await has("#f-stage")) { if (v.stage) await p.selectOption("#f-stage", v.stage); await p.fill("#f-note", v.note || ""); }
    const label = await p.locator("#wnext").innerText();
    if (/send/i.test(label)) { await p.click("#wnext"); return false; }
    await next(p);
  }
  return false;
}

try {
  const date = inDays(35);
  const owners = [];
  for (let i = 0; i < 3; i++) { const o = client(S.base); await o.signup(`o${i}@example.com`, `Owner ${i}`); owners.push({ o, id: await makeGroup(o, { name: `Quote Band ${i}`, dates: [date], extra: { events: ["Quinceañera"], max_guests: 300, members: 6 } }) }); }
  const cc = client(S.base); await cc.signup("cus@example.com", "Carla Cliente");

  // ---- logged-in customer: nine screens, one question each ----
  const C = await person("customer");
  await login(C, "cus@example.com");
  await go(C, "#/quotes"); await C.waitForSelector("#wiz");
  ok("it starts on step 1 of 9 with a progress ring and one question", (await stepText(C)) === "Step 1 of 9" && (await C.locator(".ring").count()) === 1 && (await C.locator("#wiz-h").innerText()).includes("What kind of event"));
  ok("there is no Back button on the first step", (await C.locator("#wback").count()) === 0);
  await C.click("#wnext"); await C.waitForSelector("#f-date");
  await C.click("#wnext");
  ok("a required question can't be skipped, and says why", /answer this one/.test(await C.locator("#rqerr").innerText()));
  await shot(C, "wizard-step2.png");
  await C.fill("#f-date", date); await next(C);
  ok("start time is asked, with a 'not sure yet' option", (await C.locator("#f-time option").first().innerText()).includes("Not sure"));
  await C.click("#wback"); await C.waitForSelector("#f-date");
  ok("Back keeps the answer you gave", (await C.locator("#f-date").inputValue()) === date);
  await next(C);
  await answer(C, { date, time: "6:00 PM", zip: "60608", guests: "150", size: "small", bmin: "500", bmax: "1500" }, { until: 6 }); // time, hours, ZIP, guests, size, budget
  ok("the last screen says 'Send' (the account step is skipped when you're logged in)", (await stepText(C)) === "Step 9 of 9" && /Send to the best groups/.test(await C.locator("#wnext").innerText()));
  await C.selectOption("#f-stage", "ready"); await C.fill("#f-note", "Outdoor patio. Call 312-555-0199");
  await C.click("#wnext"); await C.waitForSelector(".rq-card");
  ok("sending shows the request with all 3 matching groups waiting", (await C.locator(".rq-card .req").count()) === 3 && (await C.locator(".rq-card").innerText()).includes("Waiting for a reply") && (await C.locator(".rq-card").innerText()).includes("sent to 3"));
  const sent = S.db.get("SELECT text FROM messages WHERE sender = 'customer' LIMIT 1").text;
  ok("the group received start time, size, budget and stage, with the phone number masked", /at 6:00 PM/.test(sent) && /4 to 6 musicians/.test(sent) && /Budget \$500 to \$1500/.test(sent) && /ready to book/.test(sent) && !/555/.test(sent));
  await shot(C, "quotes-sent.png");

  // ---- a group answers with an offer; the customer books it ----
  const uid = S.db.get("SELECT id FROM users WHERE email = 'cus@example.com'").id;
  const w = owners[1];
  await w.o.post(`/api/groups/${w.id}/offers`, { customerId: uid, name: "Quince package", hours: 3, price: 850, note: "Sound included" });
  await go(C, "#/quotes"); await C.waitForSelector(".rq-card .note.ok");
  ok("the offer shows on the quotes page with its price and a Book button", (await C.locator(".rq-card .note.ok").innerText()).includes("$850") && (await C.locator(".rq-card .btn:not(.ghost)", { hasText: "Book this offer" }).count()) === 1);
  const O = await person("owner", { width: 900, height: 1000 });
  await login(O, "o1@example.com");
  await go(O, `#/dashboard?g=${w.id}&tab=messages`); await O.waitForSelector(".thread");
  await O.click(".thread"); await O.waitForSelector("#convchat");
  ok("the group sees the event request in its inbox with the details", (await O.locator("#convchat").innerText()).includes("Event request: Quinceañera"));
  await C.click(".rq-card .btn:not(.ghost)"); await C.waitForSelector("#calbox .cal");
  ok("Book this offer opens the group page with the event details carried over", C.url().includes(`date=${date}`) && C.url().includes("guests=150"));
  ok("the private offer is on the group page for this customer", (await C.locator(".panel.offer").innerText()).includes("Quince package"));

  // ---- a visitor with no account: answers first, account last, answers survive a refresh ----
  const V = await person("visitor");
  await go(V, "#/quotes"); await V.waitForSelector("#wiz");
  ok("a visitor isn't asked to log in first: there are 10 steps, the last one is the account", (await stepText(V)) === "Step 1 of 10");
  await answer(V, { date, zip: "60608", guests: "80" }, { until: 4 });
  await go(V, "#/quotes"); await V.waitForSelector("#wiz");
  ok("after a page reload the visitor is still on step 5 with their earlier answers", (await stepText(V)) === "Step 5 of 10");
  await V.click("#wback"); await V.waitForSelector("#f-hours"); await V.click("#wback"); await V.waitForSelector("#f-time"); await V.click("#wback"); await V.waitForSelector("#f-date");
  ok("their date was kept", (await V.locator("#f-date").inputValue()) === date);
  const atAccount = await answer(V, { date, zip: "60608", guests: "80" });
  ok("the flow ends on the account step, which promises privacy", atAccount && (await stepText(V)) === "Step 10 of 10" && (await V.locator("#wiz").innerText()).includes("never share your phone or email"));
  await shot(V, "wizard-account.png");
  await V.click("#wnext"); await V.waitForSelector("#rqerr:not(:empty)");
  await V.fill("#f-name", "Vera Visitante"); await V.fill("#f-email", "vera@example.com"); await V.fill("#f-pw", PW);
  await V.click("#wnext"); await V.waitForSelector(".rq-card");
  ok("creating the account sends the request in one go", S.db.get("SELECT COUNT(*) c FROM users WHERE email = 'vera@example.com'").c === 1 && S.db.get("SELECT COUNT(*) c FROM event_requests WHERE customer_id = (SELECT id FROM users WHERE email = 'vera@example.com')").c === 1 && (await V.locator("#nav a[data-r=account]").count()) === 1);
  ok("the saved answers are cleared once sent", (await V.evaluate(() => sessionStorage.getItem("bm_rq"))) === null);
  // an existing customer can log in on the last step instead
  const E = await person("existing"); await client(S.base).signup("back@example.com", "Beto Regreso");
  await go(E, "#/quotes"); await E.waitForSelector("#wiz");
  await answer(E, { date, zip: "60608", guests: "60" });
  await E.click("#swap"); await E.waitForSelector("#f-email");
  ok("'I already have an account' switches to log in (no name field)", (await E.locator("#f-name").count()) === 0);
  await E.fill("#f-email", "back@example.com"); await E.fill("#f-pw", PW); await E.click("#wnext"); await E.waitForSelector(".rq-card");
  ok("logging in on the last step sends the request too", S.db.get("SELECT COUNT(*) c FROM event_requests WHERE customer_id = (SELECT id FROM users WHERE email = 'back@example.com')").c === 1);

  // ---- no group fits ----
  const N = await person("nomatch"); const n = client(S.base); await n.signup("far@example.com", "Far Away"); await login(N, "far@example.com");
  await go(N, "#/quotes"); await N.waitForSelector("#wiz");
  await answer(N, { date, zip: "99501", guests: "50" });
  await N.waitForSelector("#rqresult .note");
  ok("with no group free near that ZIP the page says so and offers a wider search", (await N.locator("#rqresult").innerText()).includes("No group that fits"));

  // ---- Spanish ----
  await go(C, "#/quotes"); await C.waitForSelector("#wiz");
  await C.click("#navtoggle"); await C.click("#langbtn"); await C.waitForSelector("text=Paso 1 de 9");
  ok("the flow is in Spanish", (await C.locator("#wiz-h").innerText()).includes("¿Qué tipo de evento es?"));
} catch (e) {
  failed++; console.log("CRASH", e.message.split("\n").slice(0, 6).join(" | "));
}
console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors, no CSP violations, no missing translations");
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed || problems.length ? 1 : 0);
