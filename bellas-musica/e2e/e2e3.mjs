// Browser end-to-end for the Discover feed.
//   NODE_PATH=$(npm root -g) node e2e/e2e3.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", RATE_FEEDEVENT: "1000" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let step = 0, failed = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const VIDEO = "https://youtube.com/shorts/dQw4w9WgXcQ";

async function person(label, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, ...opts });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  // the real player is not reachable in tests: a stub page stands in for it
  await ctx.route("**/*youtube-nocookie.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<body style='margin:0;background:#123;color:#fff'>clip</body>" }));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} ${x}`); });
  return p;
}
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n) });

try {
  const ids = [];
  for (let i = 0; i < 6; i++) { const o = client(S.base); await o.signup(`d${i}@example.com`, `Owner ${i}`); ids.push(await makeGroup(o, { name: `Discover Band ${i}`, dates: [inDays(20)], extra: { story: `Story number ${i}: we play weddings, quinceañeras and family parties all over Chicagoland.`, ...(i < 3 ? { video_url: VIDEO } : {}) } })); }
  S.db.run("UPDATE groups SET promoted_until = ?, verified = 1 WHERE id = ?", Math.floor(Date.now() / 1000) + 86400, ids[3]);

  const P = await person("phone");
  await P.goto(S.base + "/#/"); await P.waitForSelector("#nav a[data-r=discover], #navtoggle");
  if (await P.locator("#navtoggle").isVisible()) await P.click("#navtoggle");
  await P.click("#nav a[data-r=discover]"); await P.waitForSelector(".reel");
  ok("Discover is in the menu and opens the feed", P.url().endsWith("#/discover") && (await P.locator(".reel").count()) === 6);
  const fh = await P.evaluate(() => { const f = document.getElementById("feed").getBoundingClientRect(); return [Math.round(f.height), window.innerHeight, Math.round(f.top)]; });
  ok("the feed fills the screen under the header (no page scroll needed)", fh[0] + fh[2] <= fh[1] + 12 && fh[0] > 500 && (await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await P.waitForSelector(".reel[data-i='0'] iframe", { timeout: 5000 });
  await P.waitForTimeout(1700); // long enough on the first card for it to count as a view
  ok("the first card's clip starts muted and autoplaying, and only that one loads", (await P.locator("iframe").count()) === 1 && /autoplay=1&mute=1/.test(await P.locator("iframe").getAttribute("src")));
  await shot(P, "discover-phone-1.png");
  const second = P.locator(".reel").nth(1);
  ok("the second card is the labelled, paid one", (await second.locator(".pill.promo").count()) === 1 && (await second.innerText()).includes("Discover Band 3") && (await P.locator(".reel .pill.promo").count()) === 2); // the paid group also comes around again at slot 6
  await P.evaluate(() => document.getElementById("feed").scrollTo({ top: document.getElementById("feed").clientHeight, behavior: "instant" }));
  await P.waitForFunction(() => { const f = document.querySelector("iframe"); return !f || f.closest(".reel")?.dataset.i !== "0"; }, null, { timeout: 5000 });
  await P.waitForTimeout(700);
  ok("scrolling to the next card moves the player (never two at once)", (await P.locator("iframe").count()) <= 1 && (await P.locator(".reel[data-i='0'] iframe").count()) === 0);
  await P.waitForTimeout(1800);
  ok("views are counted after a moment on a card", S.db.get("SELECT COALESCE(SUM(n),0) n FROM stats_daily WHERE key = 'feed_view'").n >= 2);
  await shot(P, "discover-phone-2.png");
  for (let k = 0; k < 6 && !(await P.locator(".reel.end").count()); k++) { await P.evaluate(() => document.getElementById("feed").scrollTo({ top: 99999, behavior: "instant" })); await P.waitForTimeout(700); }
  ok("reaching the end shows the 'that's everyone' card with a way out", (await P.locator(".reel.end").count()) === 1 && (await P.locator(".reel.end a.btn").getAttribute("href")).includes("#/?zip=60608"));
  await shot(P, "discover-phone-end.png");
  await P.evaluate(() => document.getElementById("feed").scrollTo({ top: 0, behavior: "instant" })); await P.waitForTimeout(500);
  await P.locator(".reel[data-i='0'] a:has-text('Message')").click();
  await P.waitForSelector("#calbox .cal");
  ok("Message opens the group's page, and the tap is counted", P.url().includes("?chat=1") && S.db.get("SELECT COALESCE(SUM(n),0) n FROM stats_daily WHERE key = 'feed_tap'").n === 1);
  await P.goBack(); await P.waitForSelector(".reel");

  // change the ZIP to somewhere with nobody: empty state offers the waitlist
  await P.fill("#feed-zip", "90210"); await P.click("#zipform button"); await P.waitForSelector(".waitlist");
  ok("a ZIP with no groups shows the waitlist instead of an empty screen", (await P.locator("#app").innerText()).includes("No groups near"));
  await P.evaluate(() => localStorage.removeItem("bm_zip"));

  // reduced motion: nothing autoplays, the person presses play
  const R = await person("reduced", { reducedMotion: "reduce" });
  await R.goto(S.base + "/#/discover"); await R.waitForSelector(".reel"); await R.waitForTimeout(900);
  ok("with 'reduce motion' on, no clip starts by itself and a play button is offered", (await R.locator("iframe").count()) === 0 && (await R.locator(".reel[data-i='0'] .playbtn").count()) === 1);
  await R.click(".reel[data-i='0'] .playbtn"); await R.waitForSelector(".reel[data-i='0'] iframe");
  ok("pressing play starts that clip", true);

  // tablet/desktop: a centered column with arrow buttons
  const D = await person("desktop", { viewport: { width: 1180, height: 820 } });
  await D.goto(S.base + "/#/discover"); await D.waitForSelector(".reel");
  ok("on a wide screen the feed is a centered column with up/down buttons", (await D.locator(".feed-nav").isVisible()) && (await D.evaluate(() => document.getElementById("feed").getBoundingClientRect().width <= 481)));
  await D.click("#fnext"); await D.waitForTimeout(700);
  ok("the down button advances one card", (await D.evaluate(() => Math.round(document.getElementById("feed").scrollTop / document.getElementById("feed").clientHeight))) === 1);
  await shot(D, "discover-desktop.png");

  // Spanish
  await D.click("#langbtn"); await D.waitForSelector("text=Perfil y reservar");
  ok("the feed is fully translated", (await D.locator("#app").innerText()).includes("Cerca de") && (await D.locator(".pill.promo").first().innerText()).includes("Promocionado"));
} catch (e) {
  failed++; console.log("CRASH", e.message.split("\n").slice(0, 6).join(" | "));
}
console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors, no CSP violations, no missing translations");
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed || problems.length ? 1 : 0);
