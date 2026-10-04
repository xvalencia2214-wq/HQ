// Browser end-to-end for the welcome page: the front door for new visitors, its search and links into the app, leaving
// nothing behind when you move on, Spanish, the party budget, real groups, the calm version for "reduce motion", and the
// 3D scene and fanfare running without errors.
//   NODE_PATH=$(npm root -g) node e2e/e2e16.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ WEATHER: "0" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const problems = [];
let failed = 0;
const ok = (name, cond) => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
async function person(label, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...opts });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::|Failed to fetch|Connection problem|GPU stall|WebGL/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  return p;
}
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n) });
const text = (p) => p.locator("body").innerText();

try {
  const u = client(S.base); await u.signup("lp@example.com", "Lupita Prueba");

  // ---- a new visitor at the bare address gets the welcome page ----
  const V = await person("visitor");
  await V.goto(S.base + "/"); await V.waitForSelector(".lp-h1");
  ok("a new visitor lands on the welcome page, with the app's own header hidden", await V.locator("header.top").isHidden() && /Que/.test(await V.locator(".lp-h1").innerText()));
  await V.waitForFunction(() => document.querySelector("#lp-3d.ready") || document.querySelector(".lp-3d-fallback:not([hidden])"), null, { timeout: 15000 });
  ok("the 3D sombrero (or its picture) appears", true);
  await V.waitForFunction(() => document.querySelectorAll(".lcard").length > 3, null, { timeout: 15000 });
  ok("real groups load into the carousel", (await V.locator(".lcard").count()) > 3);
  ok("genre cards show real 'from' prices", /from \$\d/.test(await V.locator("#lp-track").innerText()));
  await shot(V, "1-hero.png");
  // the fanfare plays and stops
  await V.click("#lp-play"); await V.waitForTimeout(600);
  ok("the fanfare starts", (await V.getAttribute("#lp-play", "aria-pressed")) === "true");
  await V.click("#lp-play"); await V.waitForTimeout(300);
  ok("...and stops", (await V.getAttribute("#lp-play", "aria-pressed")) === "false");
  await V.click("#lp-3d", { position: { x: 900, y: 500 } }); await V.waitForTimeout(300);
  ok("tapping the sombrero throws confetti", (await V.locator(".lp-confetti i").count()) > 10);
  // the party budget
  await V.evaluate(() => document.getElementById("lp-build").scrollIntoView()); await V.waitForTimeout(900);
  const t0 = await V.locator("#lp-total").innerText();
  await V.click(".chip[data-cat='rentals']"); await V.waitForTimeout(900);
  const t1 = await V.locator("#lp-total").innerText();
  ok("adding tents raises the estimate", Number(t1.replace(/\D/g, "")) > Number(t0.replace(/\D/g, "")));
  await V.fill("#lp-guests", "300"); await V.dispatchEvent("#lp-guests", "input"); await V.waitForTimeout(900);
  ok("more guests cost more, and the plan link carries the guests", Number((await V.locator("#lp-total").innerText()).replace(/\D/g, "")) > Number(t1.replace(/\D/g, "")) && (await V.getAttribute("#lp-plan", "href")) === "#/party?guests=300");
  await shot(V, "2-budget.png");
  // the search goes into the app, and the page leaves nothing behind
  await V.evaluate(() => scrollTo(0, 0)); await V.waitForTimeout(400);
  await V.selectOption("#lp-ev", "Wedding"); await V.fill("#lp-zip", "60623"); await V.click("#lp-search button");
  await V.waitForFunction(() => location.hash.startsWith("#/?zip=60623"));
  await V.waitForSelector("header.top", { state: "visible" });
  ok("the search opens the app's results for that ZIP and event", /event=Wedding/.test(V.url()));
  ok("leaving removes every trace (body class, cursor, canvases, styles stay harmless)", await V.evaluate(() => !document.body.classList.contains("is-landing") && !document.querySelector(".cur-dot, .cur-ring, .lp, #lp-3d")));
  await V.goto(S.base + "/#/welcome"); await V.waitForSelector(".lp-h1");
  await V.click(".lp-nav a[href='#/party']"); await V.waitForFunction(() => location.hash === "#/party");
  ok("nav links lead into the app", await V.locator("header.top").isVisible());

  // ---- logged in: the bare address is the app, #/welcome still shows the page ----
  const L = await person("member");
  await L.goto(S.base + "/#/login"); await L.fill("#a-email", "lp@example.com"); await L.fill("#a-pw", "correct horse battery"); await L.click("#authform button[type=submit]");
  await L.waitForFunction(() => !location.hash.startsWith("#/login"));
  await L.goto(S.base + "/"); await L.waitForSelector("header.top");
  ok("a logged-in person at the bare address gets the app, not the welcome page", (await L.locator(".lp").count()) === 0);
  await L.goto(S.base + "/#/welcome"); await L.waitForSelector(".lp-h1");
  ok("#/welcome shows it anyway, with their name in the nav", /Lupita/.test(await L.locator(".lp-nav").innerText()));

  // ---- Spanish ----
  await V.goto(S.base + "/#/welcome"); await V.waitForSelector(".lp-h1");
  await V.click("#lp-lang"); await V.waitForFunction(() => /Buscar música/.test(document.body.innerText));
  await V.waitForTimeout(1200);
  const es = await text(V);
  ok("Spanish: the whole page switches", /Mariachi, banda, norteño, DJs, taqueros, carpas/.test(es) && /¿Quién toca en tu fiesta\?/.test(es));
  if (!/¿Quién toca en tu fiesta\?/.test(es)) console.log("   ", (es.match(/.{0,40}toca.{0,40}/) || [es.slice(0, 300)])[0]);
  await V.click("#lp-lang");

  // ---- reduce motion and a phone ----
  const R = await person("calm", { reducedMotion: "reduce", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await R.goto(S.base + "/"); await R.waitForSelector(".lp-h1");
  ok("reduce motion: no intro curtain and no custom cursor", (await R.locator(".lp-curtain, .cur-ring").count()) === 0);
  ok("reduce motion: the story text is fully readable at once", (await R.locator("#lp-mtext .w.lit").count()) === (await R.locator("#lp-mtext .w").count()));
  ok("phone: nothing wider than the screen", await R.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await shot(R, "3-phone.png");
} catch (e) { failed++; console.log("FAIL crashed:", e.message); }
finally {
  for (const p of problems) { console.log("PROBLEM", p); failed++; }
  await browser.close(); await S.close();
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}
