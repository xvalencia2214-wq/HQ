// Automated accessibility audit (axe-core) of every screen.
//   AXE=/path/to/axe.min.js NODE_PATH=$(npm root -g) node e2e/a11y.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
import { startApp, client, inDays } from "../test/helpers.js";
import { seedMarketplace } from "./seed.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const axeSrc = fs.readFileSync(process.env.AXE, "utf8");

const S = await startApp({ ADMIN_EMAILS: "owner@qa.test" });
const { id } = await seedMarketplace(S);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

async function person(login, vp = { width: 900, height: 1100 }) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await ctx.route("**/*youtube*/**", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<title>video</title><body>video</body>" }));
  const p = await ctx.newPage();
  if (login) { await p.goto(S.base + "/#/login"); await p.fill("#a-email", login); await p.fill("#a-pw", "correct horse battery"); await p.click("#authform button[type=submit]"); await p.waitForTimeout(500); }
  return p;
}
const pairs = new Map(); // "fg on bg" -> {ratio, need, count, sample}
const found = new Map(); // rule -> { impact, help, count, pages:Set, sample }
async function audit(p, name, hash, ready) {
  await p.goto(S.base + "/" + hash); await p.waitForSelector(ready, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(500);
  await p.evaluate(axeSrc);
  const r = await p.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } }));
  for (const v of r.violations) {
    if (v.id === "color-contrast") for (const n of v.nodes) {
      const d = n.any[0]?.data; if (!d) continue;
      const k = `${d.fgColor} on ${d.bgColor}`; const e = pairs.get(k) || { ratio: d.contrastRatio, need: d.expectedContrastRatio, size: `${d.fontSize} ${d.fontWeight}`, count: 0, sample: n.target.join(" ").slice(0, 70) };
      e.count++; pairs.set(k, e);
    }
    const e = found.get(v.id) || { impact: v.impact, help: v.help, count: 0, pages: new Set(), sample: [] };
    e.count += v.nodes.length; e.pages.add(name);
    if (e.sample.length < 3) e.sample.push(v.nodes[0].html.slice(0, 140) + "  ⟵ " + (v.nodes[0].failureSummary || "").split("\n").slice(1, 2).join(" ").trim().slice(0, 120));
    found.set(v.id, e);
  }
  return r.violations.length;
}

const anon = await person(null), cust = await person("ana@qa.test"), own = await person("owner@qa.test");
// a saved party with a shortlist, a timeline and the credits page turned on
const ana = client(S.base); await ana.post("/api/auth/login", { email: "ana@qa.test", password: "correct horse battery" });
const party = (await ana.post("/api/parties", { title: "Quince de Sofía", event: "Quinceañera", date: inDays(30), zip: "60608", guests: 120, budget: 8000, template: "quince" })).json.party;
await ana.put(`/api/parties/${party.id}/timeline`, { items: [{ at: "18:00", label: "Guests arrive" }, { at: "19:30", label: "Waltz" }] });
await ana.post(`/api/parties/${party.id}/picks`, { groupId: id });
await ana.patch(`/api/parties/${party.id}`, { credits_public: true });
const famToken = party.share_url.split("/fp/")[1];
const screens = [
  [anon, "home", "#/", ".hero"], [anon, "results", "#/?zip=60608&event=Quincea%C3%B1era&guests=150&more=1&song=cielito", ".card"],
  [anon, "map", "#/?zip=60608&view=map", ".leaflet-marker-icon"], [anon, "best", "#/best/60608", ".card"], [anon, "group", `#/group/${id}`, "#calbox .cal"],
  [anon, "chicago", "#/chicago", ".card"], [anon, "discover", "#/discover", ".reel"], [anon, "waitlist", "#/?zip=90210", ".waitlist"], [anon, "forgot", "#/forgot", "#fform"], [anon, "reset", "#/reset/abc", "#rform"], [anon, "login", "#/login", "#authform"], [anon, "signup", "#/signup", "#authform"],
  [cust, "bookings", "#/bookings", ".req"], [cust, "saved", "#/saved", ".panel"], [cust, "quotes", "#/quotes", "#wiz"], [cust, "messages", "#/messages", ".thread"], [cust, "account", "#/account", "#pform"],
  [own, "dash-requests", `#/dashboard?g=${id}&tab=requests`, ".tabs"], [own, "dash-calendar", `#/dashboard?g=${id}&tab=calendar`, ".cal"], [own, "dash-listing", `#/dashboard?g=${id}&tab=listing`, "#lform"],
  [own, "dash-extras", `#/dashboard?g=${id}&tab=extras`, "#pkform"], [own, "dash-media", `#/dashboard?g=${id}&tab=media`, "#vform"], [own, "dash-payments", `#/dashboard?g=${id}&tab=payments`, "#feature"],
  [own, "dash-reviews", `#/dashboard?g=${id}&tab=reviews`, ".review"], [own, "dash-messages", `#/dashboard?g=${id}&tab=messages`, ".thread"], [own, "admin", "#/admin", ".hero-fig"],
  [anon, "results-rentals", "#/?zip=60608&category=rentals", ".catrow"], [cust, "plan-party", `#/party?zip=60608&date=${inDays(30)}&tpl=quince`, ".party-cat"],
  [cust, "my-party", `#/my-party/${party.id}`, "#pp-picks"], [cust, "party-sign", `#/my-party/${party.id}/sign`, "#qr svg"], [anon, "family-link", `#/fp/${famToken}`, ".pick"], [anon, "thanks", `#/thanks/${party.id}`, ".panel"]
];
for (const [p, name, hash, ready] of screens) console.log(String(await audit(p, name, hash, ready)).padStart(2), "violation types on", name);
// same screens in Spanish and on a phone
await anon.evaluate(() => localStorage.setItem("bm_lang", "es")); await cust.evaluate(() => localStorage.setItem("bm_lang", "es"));
for (const [p, name, hash, ready] of [[anon, "es-home", "#/?zip=60608", ".card"], [anon, "es-group", `#/group/${id}`, "#calbox .cal"], [cust, "es-bookings", "#/bookings", ".req"]]) await audit(p, name, hash, ready);
const phone = await person("ana@qa.test", { width: 390, height: 844 });
for (const [name, hash, ready] of [["phone-home", "#/?zip=60608", ".card"], ["phone-group", `#/group/${id}`, "#calbox .cal"], ["phone-bookings", "#/bookings", ".req"]]) await audit(phone, name, hash, ready);

console.log("\n=== distinct problems ===");
for (const [rule, e] of [...found].sort((a, b) => ({ critical: 0, serious: 1, moderate: 2, minor: 3 }[a[1].impact] - { critical: 0, serious: 1, moderate: 2, minor: 3 }[b[1].impact]))) {
  console.log(`[${e.impact}] ${rule}: ${e.help}  (${e.count} elements on ${[...e.pages].join(", ")})`);
  for (const x of e.sample) console.log("    ", x);
}
if (!found.size) console.log("none");
if (pairs.size) { console.log("\n=== failing color pairs ==="); for (const [k, e] of [...pairs].sort((a, b) => b[1].count - a[1].count)) console.log(`${String(e.count).padStart(3)}x ${k}  ratio ${e.ratio} (need ${e.need}, ${e.size})  e.g. ${e.sample}`); }
await browser.close(); await S.close();
