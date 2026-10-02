// "Monkey" test: wanders every screen as each kind of user, clicking and typing at random, and reports any JavaScript error,
// console error, server 5xx or blank page. It finds what scripted tests don't think to try. Confirm dialogs are dismissed
// (so nothing is deleted), and the log-out button is never pressed.
//   NODE_PATH=$(npm root -g) node e2e/monkey.mjs [actionsPerRole=120] [seed=1]
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup, bookingBody } from "../test/helpers.js";
import { seedMarketplace } from "./seed.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const ACTIONS = Number(process.argv[2] || 120);
let seed = Number(process.argv[3] || 1);
const R = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(R() * a.length)];
const WORDS = ["Hola", "60608", "150", "x".repeat(40), "<b>bold</b>", "' OR 1=1 --", "2030-01-01", "", "-5", "9".repeat(12), "ñandú ♥", "312-555-0142"];

const S = await startApp({ ADMIN_EMAILS: "owner@qa.test", RATE_FEEDEVENT: "100000", RATE_FORGOT: "100000", RATE_AUTH: "100000" });
const { id } = await seedMarketplace(S);
// extras so every view has something to chew on: a second group, a saved list, a quote request, a locked check-in booking
const o2 = client(S.base); await o2.signup("o2@qa.test", "Segundo Dueño");
await makeGroup(o2, { name: "Monkey Norteño", type: "Norteño", dates: [inDays(25), inDays(26)] });
const ana = client(S.base); await ana.post("/api/auth/login", { email: "ana@qa.test", password: "correct horse battery" });
await ana.post(`/api/favorites/${id}`, {}); await ana.post("/api/shortlists", { title: "Monkey list" });
await ana.post("/api/requests", { event: "Wedding", date: inDays(25), guests: 80, hours: 3, zip: "60608" });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = new Map();
const note = (who, kind, msg) => { const k = `${kind}: ${msg}`.slice(0, 300); const e = problems.get(k) || { who: new Set(), n: 0 }; e.who.add(who); e.n++; problems.set(k, e); };

const ROUTES = (gid) => ["#/", "#/?zip=60608", "#/?zip=60608&view=map", "#/?zip=99501", "#/chicago", "#/discover", "#/best/60608", `#/group/${gid}`, "#/quotes", "#/login", "#/signup", "#/forgot", "#/saved", "#/bookings", "#/messages", "#/account", "#/dashboard", `#/dashboard?g=${gid}&tab=requests`, `#/dashboard?g=${gid}&tab=calendar`, `#/dashboard?g=${gid}&tab=listing`, `#/dashboard?g=${gid}&tab=extras`, `#/dashboard?g=${gid}&tab=media`, `#/dashboard?g=${gid}&tab=reviews`, `#/dashboard?g=${gid}&tab=payments`, `#/dashboard?g=${gid}&tab=messages`, "#/admin", "#/nope", "#/reset/abc", "#/verify/abc", "#/claim/abc", "#/shortlist/abc", "#/agreement/abc", "#/pay/booking/abc"];

async function walk(who, email, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await ctx.route(/youtube|vimeo|tiktok|instagram/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<body>player</body>" }));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => note(who, "pageerror", e.message));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::|Failed to fetch|the server responded with a status of (4\d\d)/.test(x)) note(who, "console", x); if (/missing translation/.test(x)) note(who, "i18n", x); });
  p.on("response", (r) => { if (r.status() >= 500) note(who, "http" + r.status(), `${r.request().method()} ${new URL(r.url()).pathname}`); });
  p.on("dialog", (d) => d.dismiss());
  if (email) { await p.goto(S.base + "/#/login"); await p.fill("#a-email", email); await p.fill("#a-pw", "correct horse battery"); await p.click("#authform button[type=submit]"); await p.waitForTimeout(400); }
  const routes = ROUTES(id);
  for (let i = 0; i < ACTIONS; i++) {
    try {
      const roll = R();
      if (roll < 0.22) { await p.goto(`${S.base}/?m=${i}${pick(routes)}`); await p.waitForTimeout(150); continue; }
      // the clickable things on the page right now, minus the ones we never press
      const els = await p.$$("#app button:not([disabled]), #app a[href], #app summary, #nav a, #app .day:not([disabled]), #app .slot");
      const safe = [];
      for (const el of els) { const txt = ((await el.innerText().catch(() => "")) || "").toLowerCase(); const href = (await el.getAttribute("href").catch(() => "")) || ""; if (/log out|delete my account|^delete|download/.test(txt) || /\/ics|\.csv|^http/.test(href)) continue; if (await el.isVisible().catch(() => false)) safe.push(el); }
      if (roll < 0.55 && safe.length) { await pick(safe).click({ timeout: 1500, trial: false }).catch(() => {}); }
      else if (roll < 0.8) { // type junk into a random visible field
        const fields = await p.$$("#app input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([readonly]), #app textarea");
        const vis = []; for (const f of fields) if (await f.isVisible().catch(() => false)) vis.push(f);
        if (vis.length) { const f = pick(vis); const type = await f.getAttribute("type"); await f.fill(type === "date" ? pick(["2031-05-17", "2020-01-01", ""]) : type === "number" ? pick(["5", "-1", "0", "99999999"]) : pick(WORDS)).catch(() => {}); if (R() < 0.5) await f.press("Enter").catch(() => {}); }
      } else if (roll < 0.9) { const sels = await p.$$("#app select"); const vis = []; for (const s of sels) if (await s.isVisible().catch(() => false)) vis.push(s); if (vis.length) { const s = pick(vis); const opts = await s.$$eval("option", (o) => o.map((x) => x.value)); await s.selectOption(pick(opts)).catch(() => {}); } }
      else { await p.goBack().catch(() => {}); }
      await p.waitForTimeout(60);
      const text = await p.locator("#app").innerText().catch(() => "");
      if (!text.trim() && !(await p.locator("#app *").count()) && p.url() !== "about:blank") { // give a slow screen a moment before calling it blank
        await p.waitForTimeout(1200);
        if (!(await p.locator("#app").innerText().catch(() => "")).trim() && !(await p.locator("#app *").count())) note(who, "blank", p.url().replace(S.base, ""));
      }
    } catch (e) { note(who, "script", String(e.message).split("\n")[0]); }
  }
  await ctx.close();
}

const t0 = Date.now();
await walk("visitor", null, { width: 420, height: 900 });
await walk("customer", "ana@qa.test", { width: 420, height: 900 });
await walk("group", "owner@qa.test", { width: 900, height: 1100 });
await walk("admin", "owner@qa.test", { width: 1200, height: 900 });
await walk("new-user", null, { width: 900, height: 1000 });
await browser.close();
// the server must still be healthy, and nothing may have left the data inconsistent
const ok = (await fetch(S.base + "/api/meta")).ok;
const orphan = S.db.get("SELECT COUNT(*) c FROM bookings WHERE status = 'confirmed' AND payment_status = 'unpaid'").c;
await S.close();
console.log(`${ACTIONS * 5} random actions in ${Math.round((Date.now() - t0) / 1000)} s. Server still healthy: ${ok}. Confirmed-but-unpaid bookings: ${orphan}.`);
if (!problems.size) console.log("No JavaScript errors, no console errors, no 5xx, no blank pages.");
else { console.log("PROBLEMS:"); for (const [k, e] of problems) console.log(`  [${[...e.who].join(",")}] x${e.n} ${k}`); }
process.exit(problems.size || !ok || orphan ? 1 : 0);
