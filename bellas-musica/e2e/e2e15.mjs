// Browser end-to-end for the phone app: the service worker and the offline page, the "Get the app" page, phone
// notifications in Account and the dashboard reminder, the store-app version hiding in-app purchases, the manifest and
// the store verification files.
//   NODE_PATH=$(npm root -g) node e2e/e2e15.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ANDROID_PACKAGE: "com.bellasmusica.app", ANDROID_SHA256: "AA:BB:CC", APP_STORE_URL: "https://apps.apple.com/us/app/id123" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let failed = 0, nav = 0;
const ok = (name, cond) => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";
async function person(label, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::|Failed to fetch|Connection problem|ERR_INTERNET_DISCONNECTED/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  return { p, ctx };
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); };
const text = (p) => p.locator("body").innerText();

try {
  const bo = client(S.base);
  await bo.signup("beto@example.com", "Beto Ramírez");
  const gid = await makeGroup(bo, { name: "DJ Relámpago", dates: [inDays(9)] });

  // ---- files the stores and phones read ----
  const man = await (await fetch(S.base + "/manifest.webmanifest")).json();
  ok("manifest has maskable icons, screenshots and shortcuts", man.icons.some((i) => i.purpose === "maskable") && man.screenshots.length >= 4 && man.shortcuts.length === 3);
  for (const f of [...man.icons.map((i) => i.src), ...man.screenshots.map((s) => s.src), "sw.js", "offline.html"]) if ((await fetch(`${S.base}/${f}`)).status !== 200) problems.push("missing " + f);
  const al = await (await fetch(S.base + "/.well-known/assetlinks.json")).json();
  ok("Android verification file names the app", al[0].target.package_name === "com.bellasmusica.app" && al[0].target.sha256_cert_fingerprints[0] === "AA:BB:CC");

  // ---- a family on a phone: service worker, Get the app, offline ----
  const { p: F, ctx: Fctx } = await person("family");
  await go(F, "#/"); await F.waitForSelector("#foot a[href='#/app']");
  await F.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  await F.waitForFunction(() => navigator.serviceWorker.controller || new Promise((r) => setTimeout(() => r(false), 50)));
  ok("the service worker is installed", await F.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active)));
  await F.click("#foot a[href='#/app']"); await F.waitForSelector(".app-page");
  const appText = await text(F);
  ok("Get the app page explains how to install, with store links", /Bella's Música on your phone/.test(appText) && /Google Play/.test(appText) && /App Store/.test(appText) && /(menu|Share)/.test(appText));
  ok("logged out: asks to log in for notifications", /Log in to turn on notifications/.test(appText));
  await shot(F, "1-get-app.png");
  await F.reload(); await F.waitForSelector(".app-page"); // now controlled by the service worker
  // no connection: the server can't be reached (the browser's offline switch doesn't cover service workers)
  const port = Number(new URL(S.base).port);
  await new Promise((r) => { S.app.server.close(r); S.app.server.closeAllConnections(); });
  await F.goto(S.base + "/?offline=1#/").catch(() => {});
  await F.waitForSelector("text=No hay señal", { timeout: 10000 }).catch(() => {});
  ok("offline: a friendly page in Spanish and English instead of an error", /No hay señal/.test(await text(F)) && /You're offline/.test(await text(F)));
  await shot(F, "2-offline.png");
  await new Promise((r) => S.app.server.listen(port, r));
  await go(F, "#/"); await F.waitForSelector("#app > *");
  ok("back online, the site works again", !/No hay señal/.test(await text(F)));

  // ---- the vendor: notifications in Account and the dashboard reminder ----
  const { p: B } = await person("beto", { permissions: ["notifications"] });
  await login(B, "beto@example.com");
  await go(B, `#/dashboard?g=${gid}`); await B.waitForSelector(".tabs");
  await B.waitForSelector("#pushnudge:not([hidden])");
  ok("dashboard reminds the vendor to turn on notifications", /Get new requests and payments on your phone/.test(await B.locator("#pushnudge").innerText()));
  await B.click("#push-nudge-x");
  ok("'Not now' hides the reminder", await B.locator("#pushnudge").isHidden());
  await go(B, `#/dashboard?g=${gid}`); await B.waitForSelector(".tabs"); await B.waitForTimeout(400);
  ok("...and it stays hidden for a while", await B.locator("#pushnudge").isHidden());
  await go(B, "#/account"); await B.waitForSelector("#pushbox button, #pushbox .note");
  ok("Account has the notifications switch", (await B.locator("#push-on").count()) === 1);
  await shot(B, "3-account.png");

  // ---- the Google Play version: no in-app purchase of upgrades ----
  await go(B, `#/dashboard?g=${gid}&tab=payments`); await B.waitForSelector("#buypro");
  ok("on the website, Pro and Featured can be bought", (await B.locator("#buypro").count()) === 1 && (await B.locator("#feature").count()) === 1);
  await B.goto(`${S.base}/?app=android#/dashboard?g=${gid}&tab=payments`);
  await B.waitForSelector("text=Upgrades for your listing are available on our website");
  ok("in the store app, upgrades say 'on our website' with no buy buttons", (await B.locator("#buypro").count()) === 0 && (await B.locator("#feature").count()) === 0);
  ok("in the store app, no 'Get the app' link", (await B.locator("#foot a[href='#/app']").count()) === 0);
  await go(B, "#/"); await B.waitForSelector("#app > *");
  ok("the store app is remembered while moving around", (await B.locator("#foot a[href='#/app']").count()) === 0);

  // ---- Spanish ----
  await F.evaluate(() => localStorage.setItem("bm_lang", "es"));
  await go(F, "#/app"); await F.waitForSelector(".app-page");
  ok("Spanish: Bella's Música en tu teléfono", /Bella's Música en tu teléfono/.test(await text(F)));
} catch (e) { failed++; console.log("FAIL crashed:", e.message); }
finally {
  for (const p of problems) { console.log("PROBLEM", p); failed++; }
  await browser.close(); await S.close();
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}
