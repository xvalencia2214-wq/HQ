// Visual QA: seeds a realistic marketplace and screenshots every screen at iPad and phone sizes.
//   NODE_PATH=$(npm root -g) node e2e/qa.mjs <outdir>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp } from "../test/helpers.js";
import { seedMarketplace } from "./seed.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const out = process.argv[2] || "qa-shots";
fs.mkdirSync(out, { recursive: true });
const S = await startApp();

const { id } = await seedMarketplace(S);

// ---- screenshots ----
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const VP = { land: { width: 1024, height: 768 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } };
async function person(vp, login) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await ctx.route("**/*youtube*/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<meta charset=utf-8><body style='margin:0;background:#222;color:#ccc;display:flex;align-items:center;justify-content:center;height:100vh;font:20px sans-serif'>▶ video</body>" }));
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load|net::/.test(m.text())) errs.push(m.text()); });
  p.errs = errs;
  if (login) { await p.goto(S.base + "/#/login"); await p.fill("#a-email", login); await p.fill("#a-pw", "correct horse battery"); await p.click("#authform button[type=submit]"); await p.waitForTimeout(500); }
  return p;
}
async function shoot(p, vpName, name, hash, ready = ".panel, .card, h2") {
  await p.goto(S.base + "/" + hash); await p.waitForSelector(ready, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, `${vpName}-${name}.png`), fullPage: true });
}
const problems = [];
for (const [vpName, vp] of Object.entries(VP)) {
  const anon = await person(vp), cust = await person(vp, "ana@qa.test"), own = await person(vp, "owner@qa.test");
  await shoot(anon, vpName, "home", "#/?zip=60608&event=Quincea%C3%B1era&guests=150", ".card");
  await shoot(anon, vpName, "map", "#/?zip=60608&view=map", ".leaflet-marker-icon");
  await shoot(anon, vpName, "best", "#/best/60608", ".card");
  await shoot(anon, vpName, "group-anon", `#/group/${id}`, "#calbox .cal");
  await shoot(anon, vpName, "login", "#/login", "#authform");
  await shoot(cust, vpName, "bookings", "#/bookings", ".req");
  await cust.goto(S.base + `/#/group/${id}`); await cust.waitForSelector("#calbox .cal");
  for (let i = 0; i < 4 && !(await cust.locator(".day.open").count()); i++) await cust.click('[data-nav="1"]');
  await cust.locator(".day.open").first().click(); await cust.locator(".slot").first().click(); await cust.waitForSelector("#b-guests");
  await cust.fill("#b-guests", "120"); await cust.waitForSelector("#quote .sum"); await cust.waitForTimeout(400);
  await cust.screenshot({ path: path.join(out, `${vpName}-group-booking.png`), fullPage: true });
  await shoot(cust, vpName, "account", "#/account", "#pform");
  for (const tab of ["requests", "calendar", "listing", "extras", "media", "reviews", "payments", "messages"]) await shoot(own, vpName, `dash-${tab}`, `#/dashboard?g=${id}&tab=${tab}`, `.tabs`);
  for (const p of [anon, cust, own]) p.errs.forEach((e) => problems.push(`${vpName}: ${e}`));
}
console.log(problems.length ? "PAGE ERRORS:\n" + [...new Set(problems)].join("\n") : "no page errors while browsing");
console.log(fs.readdirSync(out).length + " screenshots in " + out);
await browser.close(); await S.close();
