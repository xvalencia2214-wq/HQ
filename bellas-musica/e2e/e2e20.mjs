// Browser end-to-end for Don Chuy, the AI helper (test mode, no key): the button on every screen and above the vendor
// page's bottom bar; the chat with the AI notice, ready-made questions, a real ZIP search with vendor links that open the
// vendor page; Spanish; Bigger text; read aloud and the microphone; the conversation kept while moving around; Escape and
// focus; the phone layout; nothing turned into page code; and hidden when AI_HELPER=0.
//   NODE_PATH=$(npm root -g) node e2e/e2e20.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", SUPPORT_EMAIL: "ayuda@example.com" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let failed = 0, nav = 0;
const ok = (name, cond) => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
async function person(label, viewport = { width: 1180, height: 820 }, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && viewport.width < 500 });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n) });
const until = async (fn, ms = 5000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

try {
  const o = client(S.base); await o.signup("o20@example.com", "Dueño Veinte");
  const gid = await makeGroup(o, { name: "Mariachi Don Chuy Test", dates: [inDays(20)] });

  // ---- the button and the chat on a wide screen ----
  const W = await person("wide");
  await go(W, "#/?zip=60608"); await W.waitForSelector("#chuyfab:not([hidden])");
  const fab = await W.locator("#chuyfab").boundingBox();
  ok("a friendly Don Chuy button sits bottom right, big enough to tap", fab && fab.height >= 60 && fab.x + fab.width > 1100 && (await W.locator("#chuyfab").innerText()).includes("Help?"));
  ok("it says what it is to screen readers", /Don Chuy, the AI helper/.test(await W.locator("#chuyfab").getAttribute("aria-label")));
  await W.click("#chuyfab"); await W.waitForSelector("#chuy:not([hidden])");
  ok("the chat opens with a hello that says he is an AI, the test-mode note, and ready-made questions", /an AI helper/.test(await W.locator("#chuy-log").innerText()) && /Test mode/.test(await W.locator("#chuy-log").innerText()) && (await W.locator(".chuy-chip").count()) >= 4);
  ok("the AI notice is under the title too, with Privacy and Talk to a person", /AI helper · can make mistakes/.test(await W.locator("#chuy-sub").innerText()) && (await W.locator("#chuy-foot a[href='privacy.html']").count()) === 1 && (await W.locator("#chuy-foot a[href='mailto:ayuda@example.com']").count()) === 1);
  ok("the typing box has the keyboard", await W.evaluate(() => document.activeElement.id === "chuy-in"));
  await shot(W, "e20-open.png");
  await W.click(".chuy-chip >> nth=0");
  await until(async () => (await W.locator(".chuy-msg.bot").count()) >= 2);
  ok("a ready-made question is sent and answered", (await W.locator(".chuy-msg.me").count()) === 1 && (await W.locator(".chuy-chip").count()) === 0);
  await W.fill("#chuy-in", "Busco mariachi cerca de 60608");
  await W.keyboard.press("Enter");
  await until(async () => (await W.locator(".chuy-link").count()) > 0);
  ok("a ZIP finds real vendors, shown as gold buttons", /Mariachi Don Chuy Test/.test(await W.locator(".chuy-link").first().innerText()));
  await shot(W, "e20-answer.png");
  await W.click(".chuy-link >> nth=0");
  await W.waitForFunction(() => location.hash.startsWith("#/group/"));
  ok("tapping one opens that vendor's page without reloading, and the chat stays open on a wide screen", W.url().includes(`?n=${nav}#/group/${gid}`) && await W.locator("#chuy").isVisible());
  await W.keyboard.press("Escape");
  ok("Escape closes it and gives the keyboard back to the button", !(await W.locator("#chuy").isVisible()) && await W.evaluate(() => document.activeElement.id === "chuyfab"));
  await W.click("#chuyfab");
  ok("the conversation is still there after moving to another screen", (await W.locator(".chuy-msg.me").count()) === 2);
  await W.click("#chuy-new");
  ok("New conversation starts over with the ready-made questions", (await W.locator(".chuy-msg.me").count()) === 0 && (await W.locator(".chuy-chip").count()) >= 4);
  // read aloud: the switch is remembered on the device
  await W.click("#chuy-voice");
  ok("Read answers aloud can be turned on and is remembered", (await W.locator("#chuy-voice").getAttribute("aria-pressed")) === "true" && await W.evaluate(() => localStorage.getItem("bm_chuy_voice") === "1"));
  await W.click("#chuy-voice");
  // the microphone shows only where the browser can listen
  const canListen = await W.evaluate(() => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
  ok("the microphone button shows only when the device can listen", (await W.locator("#chuy-mic").isVisible()) === canListen);
  // nothing he says becomes page code
  await W.evaluate(async () => { const m = await import("/js/chuy.js"); document.body.insertAdjacentHTML("beforeend", `<div id="fmt">${m.chuyFormat('<img src=x class="xss-probe"> [ok](#/quotes) [bad](javascript:alert(1)) [ext](https://evil.example) **bold**')}</div>`); });
  ok("his text is escaped: only links to the app's own screens become links", (await W.locator("#fmt .xss-probe").count()) === 0 && (await W.locator("#fmt a").count()) === 1 && (await W.locator("#fmt a").getAttribute("href")) === "#/quotes" && (await W.locator("#fmt b").count()) === 1);

  // ---- Spanish and Bigger text on a phone ----
  const P = await person("phone", { width: 390, height: 844 }, true);
  await P.addInitScript(() => { localStorage.setItem("bm_lang", "es"); localStorage.setItem("bm_big", "1"); });
  await go(P, "#/?zip=60608"); await P.waitForSelector("#chuyfab:not([hidden])");
  ok("in Spanish the button says ¿Ayuda?", (await P.locator("#chuyfab").innerText()).includes("¿Ayuda?"));
  await shot(P, "e20-phone-button.png");
  await P.click("#chuyfab"); await P.waitForSelector("#chuy:not([hidden])");
  const box = await P.locator("#chuy").boundingBox();
  ok("on a phone the chat fills the screen", box.x === 0 && box.y === 0 && Math.round(box.width) === 390 && Math.round(box.height) === 844);
  ok("everything is in Spanish, with usted", /ayudante con inteligencia artificial/.test(await P.locator("#chuy-log").innerText()) && /Busco música para mi fiesta/.test(await P.locator("#chuy-chips").innerText()) && (await P.locator("#chuy-in").getAttribute("placeholder")) === "Escriba su pregunta…");
  ok("no sideways scrolling with big text", !(await P.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  const sendBox = await P.locator("#chuy-send").boundingBox(), chip = await P.locator(".chuy-chip").first().boundingBox();
  ok("buttons are big enough to tap (44 px or more)", sendBox.height >= 44 && chip.height >= 44);
  await shot(P, "e20-phone-chat.png");
  await P.fill("#chuy-in", "hola"); await P.click("#chuy-send");
  await until(async () => /modo de prueba/.test(await P.locator("#chuy-log").innerText()));
  ok("he answers in Spanish", /Soy Don Chuy/.test(await P.locator(".chuy-msg.bot").last().innerText()));
  await P.fill("#chuy-in", "mariachi 60608"); await P.click("#chuy-send");
  await until(async () => (await P.locator(".chuy-link").count()) > 0);
  await P.click(".chuy-link >> nth=0"); await P.waitForFunction(() => location.hash.startsWith("#/group/"));
  ok("on a phone, tapping a vendor closes the chat so the page can be seen", !(await P.locator("#chuy").isVisible()) && await P.locator("#chuyfab").isVisible());
  await P.evaluate(() => window.scrollTo(0, 600));
  if (await until(() => P.locator(".cta-bar").isVisible(), 3000)) {
    const bar = await P.locator(".cta-bar").boundingBox(), f2 = await P.locator("#chuyfab").boundingBox();
    ok("on a vendor page the button sits above the Check dates bar, not on it", f2.y + f2.height <= bar.y + 2);
  } else ok("the vendor page's Check dates bar shows on a phone", false);
  await shot(P, "e20-phone-vendor.png");
  // a vendor on the dashboard gets vendor questions
  await P.evaluate(() => sessionStorage.removeItem("bm_chuy"));
  await P.goto(S.base + "/#/login"); await P.fill("#a-email", "o20@example.com"); await P.fill("#a-pw", "correct horse battery"); await P.click("#authform button[type=submit]");
  await P.waitForFunction(() => !location.hash.startsWith("#/login"));
  await go(P, "#/dashboard"); await P.waitForSelector("#chuyfab:not([hidden])");
  await P.click("#chuyfab");
  ok("on the vendor dashboard he offers vendor questions", /¿Cómo consigo más reservas\?/.test(await P.locator("#chuy-chips").innerText()) && /panel/.test(await P.locator("#chuy-log").innerText()));
  await P.click("#chuy-close");

  // ---- he never covers the links at the bottom of a page (phone, wide, and a vendor page with its bottom bar) ----
  const reachable = (p) => p.evaluate(() => [...document.querySelectorAll("footer a, .lp-foot a")].filter((a) => a.offsetParent).every((a) => {
    a.scrollIntoView({ block: "end" }); window.scrollTo(0, document.documentElement.scrollHeight);
    const r = a.getClientRects()[0], hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); // first line of a link that wraps
    return hit && (hit === a || a.contains(hit));
  }));
  for (const [label, page, hash] of [["phone", P, "#/?zip=60608"], ["wide", W, "#/?zip=60608"], ["phone vendor page", P, `#/group/${gid}`], ["phone welcome page", P, "#/welcome"]]) {
    await go(page, hash); await page.waitForSelector("#chuyfab:not([hidden])"); await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); // the welcome page's opening curtain finishes...
    await page.waitForSelector(".lp-curtain", { state: "detached", timeout: 8000 }).catch(() => {}); // ...and leaves first
    ok(`${label}: every link at the bottom can still be tapped with Don Chuy there`, await reachable(page));
  }

  // ---- the server says off: no button at all ----
  const off = await startApp({ DEMO_SEED: "0", AI_HELPER: "0" });
  try {
    const X = await person("off");
    await X.goto(off.base + "/#/?zip=60608"); await X.waitForSelector("#sform");
    ok("with AI_HELPER=0 there is no button", !(await X.locator("#chuyfab").isVisible()));
  } finally { await off.close(); }
} catch (e) { failed++; console.log("FAIL crashed:", e.stack || e.message); }
finally {
  ok(`no JavaScript errors, console errors or missing translations (${problems.slice(0, 3).join(" | ")})`, problems.length === 0);
  await browser.close(); await S.close();
}
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
