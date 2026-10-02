// iPad-style touch check (emulated in Chromium, not real Safari): real swipe gestures on the Discover feed, taps instead of
// clicks, and a measurement of every button and link on the main screens. Apple recommends tap targets of 44 px; WCAG's minimum is 24 px.
//   NODE_PATH=$(npm root -g) node e2e/touch.mjs
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
import { seedMarketplace } from "./seed.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const S = await startApp({ RATE_FEEDEVENT: "100000" });
const { id } = await seedMarketplace(S);
const o2 = client(S.base); await o2.signup("t2@qa.test", "Otro Dueño Dos");
for (const n of ["Touch Norteño A", "Touch Banda B", "Touch Trío C"]) await makeGroup(o2, { name: n, dates: [inDays(25)], extra: { video_url: "https://youtu.be/dQw4w9WgXcQ" } }).catch(() => {});
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const UA = "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
let step = 0, failed = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
// (No deviceScaleFactor: in Chromium emulation it makes synthetic touch drags land in the wrong place, which is a test-harness quirk, not an app problem.)
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, userAgent: UA });
await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
await ctx.route(/youtube|vimeo|tiktok|instagram/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<body>player</body>" }));
const p = await ctx.newPage();
const errors = []; p.on("pageerror", (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(p);
// a real finger drag: touch down, move in small steps, lift
const drag = async (y0, y1) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 410, y: y0 }] });
  for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 410, y: y0 + ((y1 - y0) * i) / 10 }] }); await p.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await p.waitForTimeout(800);
};
try {
  // ---- Discover: a real finger swipe moves exactly one card and the clip follows ----
  await p.goto(S.base + "/#/discover"); await p.waitForSelector(".reel");
  const h = await p.evaluate(() => document.getElementById("feed").clientHeight);
  const top0 = await p.evaluate(() => document.getElementById("feed").scrollTop);
  await drag(800, 300);
  const top1 = await p.evaluate(() => document.getElementById("feed").scrollTop);
  console.log("   scroll", top0, "->", top1, "card height", h);
  ok("a finger swipe on Discover snaps to the next card (one card, not between two)", top0 === 0 && Math.abs(top1 - h) < 3);
  await p.waitForFunction(() => document.querySelector(".reel[data-i='1'] iframe, .reel[data-i='1'] .reel-media"), null, { timeout: 4000 });
  ok("only one clip player exists after the swipe", (await p.locator("iframe").count()) <= 1);
  await drag(300, 800);
  ok("swiping back down returns to the first card", Math.abs(await p.evaluate(() => document.getElementById("feed").scrollTop)) < 3);
  // tapping the heart and Message with a finger
  await p.locator(".reel[data-i='0'] .heart").tap(); await p.waitForSelector(".reel[data-i='0'] .heart"); // logged out: goes to log in
  ok("tapping a heart while logged out opens the log-in screen", p.url().includes("#/login"));

  // ---- tap target sizes on the main screens ----
  await p.goto(S.base + "/#/login"); await p.fill("#a-email", "ana@qa.test"); await p.fill("#a-pw", "correct horse battery"); await p.tap("#authform button[type=submit]"); await p.waitForTimeout(600);
  const screens = [["home results", "#/?zip=60608"], ["group page", `#/group/${id}`], ["Discover", "#/discover"], ["Get quotes", "#/quotes"], ["bookings", "#/bookings"], ["saved", "#/saved"], ["messages", "#/messages"]];
  const report = [];
  for (const [name, hash] of screens) {
    await p.goto(`${S.base}/?t=${Math.random()}${hash}`); await p.waitForTimeout(900);
    const small = await p.evaluate(() => [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, summary, textarea")]
      .filter((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[hidden]") && !e.disabled && !e.classList.contains("sr-only") && !(e.type === "checkbox"); })
      .map((e) => { const r = e.getBoundingClientRect(); return { text: (e.innerText || e.getAttribute("aria-label") || e.placeholder || e.tagName).trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height), inline: e.tagName === "A" && getComputedStyle(e).display === "inline" }; })
      .filter((x) => !x.inline && (x.h < 44 || x.w < 44)));
    report.push([name, small]);
    const tooSmall = small.filter((x) => x.h < 24 || x.w < 24);
    ok(`${name}: no tap target under 24 px (the WCAG minimum)`, tooSmall.length === 0);
    if (small.length) console.log(`   ${small.length} under 44 px: ${small.slice(0, 6).map((x) => `"${x.text}" ${x.w}x${x.h}`).join(", ")}${small.length > 6 ? ", ..." : ""}`);
  }
  ok("no JavaScript errors during the touch run", errors.length === 0);
} catch (e) { failed++; console.log("CRASH", e.message.split("\n")[0]); }
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed ? 1 : 0);
