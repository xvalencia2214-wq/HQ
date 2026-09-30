// Browser end-to-end for saved groups, shortlists, neighborhood landing pages and TikTok/Instagram clips.
//   NODE_PATH=$(npm root -g) node e2e/e2e5.mjs [screenshotDir]
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
const PW = "correct horse battery";
let nav = 0;
const TIKTOK = "https://www.tiktok.com/@mariachi.chi/video/7312345678901234567", INSTA = "https://www.instagram.com/reel/C8aBcDeFgHi/";

async function person(label, viewport = { width: 420, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  for (const host of ["**/*tiktok.com/**", "**/*instagram.com/**"]) await ctx.route(host, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<body style='margin:0;background:#123;color:#fff'>player</body>" }));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} ${x}`); });
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForSelector("#nav a[data-r=account]", { state: "attached" }); };

try {
  const owner = client(S.base), cust = client(S.base);
  await owner.signup("own@example.com", "Owen Owner"); await cust.signup("cus@example.com", "Carla Cliente Lopez");
  const mk = (name, extra = {}) => makeGroup(owner, { name, dates: [inDays(20)], extra: { events: ["Quinceañera", "Wedding"], ...extra } });
  const tik = await mk("TikTok Mariachi", { video_url: TIKTOK }), ig = await mk("Reels Banda", { video_url: INSTA }), plain = await mk("Plain Norteño");

  // ---- clips from TikTok and Instagram ----
  const An = await person("anon", { width: 900, height: 1100 });
  await go(An, `#/group/${tik}`); await An.waitForSelector(".video iframe");
  ok("a TikTok link becomes our own embed, in a tall frame", (await An.locator(".video iframe").getAttribute("src")) === "https://www.tiktok.com/embed/v2/7312345678901234567" && (await An.locator(".video.tall").count()) === 1);
  await go(An, `#/group/${ig}`); await An.waitForSelector(".video iframe");
  ok("an Instagram Reel becomes our own embed too", (await An.locator(".video iframe").getAttribute("src")) === "https://www.instagram.com/reel/C8aBcDeFgHi/embed" && (await An.locator(".video.tall").count()) === 1);
  await go(An, `#/group/${plain}`); await An.waitForSelector("#calbox .cal");
  ok("a group with no clip shows no player", (await An.locator(".video").count()) === 0);
  const bad = await owner.patch(`/api/groups/${plain}`, { video_url: "https://vm.tiktok.com/ZMabc123/" });
  ok("a short TikTok link is refused with a helpful message", bad.status === 400 && /TikTok/.test(bad.json.error));

  // ---- Discover mounts them ----
  const D = await person("discover");
  await go(D, "#/discover"); await D.waitForSelector(".reel");
  const srcs = new Set();
  for (let i = 0; i < 2; i++) {
    await D.evaluate((k) => { const f = document.getElementById("feed"); f.scrollTo({ top: f.clientHeight * k, behavior: "instant" }); }, i);
    await D.waitForSelector(`.reel[data-i='${i}'] iframe`, { timeout: 6000 });
    srcs.add(await D.locator(`.reel[data-i='${i}'] iframe`).getAttribute("src"));
    ok(`reel ${i + 1}: only one player at a time`, (await D.locator("iframe").count()) === 1);
    ok(`reel ${i + 1}: no sound button for players we can't control`, (await D.locator(`.reel[data-i='${i}'] [data-sound]`).count()) === 0);
  }
  ok("Discover plays the TikTok and the Reel from their own embed addresses", [...srcs].some((s) => s.startsWith("https://www.tiktok.com/embed/v2/7312345678901234567?autoplay=1")) && [...srcs].some((s) => s === "https://www.instagram.com/reel/C8aBcDeFgHi/embed"));

  // ---- saved groups and shortlist ----
  const C = await person("customer");
  await login(C, "cus@example.com");
  await go(C, "#/?zip=60608"); await C.waitForSelector(".card .heart");
  ok("every card has a heart, all empty at first", (await C.locator(".card .heart").count()) === 3 && (await C.locator(".card .heart.on").count()) === 0);
  await C.locator(".card", { hasText: "TikTok Mariachi" }).locator(".heart").click();
  await C.waitForSelector(".card .heart.on");
  ok("tapping the heart saves it (and says so)", (await C.locator(".card .heart.on").count()) === 1 && (await C.locator(".card .heart.on").getAttribute("aria-pressed")) === "true");
  await C.locator(".card", { hasText: "Plain Norteño" }).locator(".heart").click(); await C.waitForFunction(() => document.querySelectorAll(".card .heart.on").length === 2);
  await go(C, "#/?zip=60608"); await C.waitForSelector(".card .heart");
  ok("hearts are remembered after a reload", (await C.locator(".card .heart.on").count()) === 2);
  await go(C, `#/group/${ig}`); await C.waitForSelector(".titlebtns .heart");
  await C.click(".titlebtns .heart"); await C.waitForSelector(".titlebtns .heart.on");
  ok("the group page has a heart too", true);
  await go(C, "#/saved"); await C.waitForSelector("#slform");
  ok("the Saved page shows exactly the saved groups", (await C.locator(".card").count()) === 3 && (await C.locator("#nav a[data-r=saved]").count()) === 1);
  await C.fill("#sl-title", "Quince music"); await C.click("#slform button[type=submit]"); await C.waitForSelector("#sl-url");
  const link = await C.locator("#sl-url").inputValue();
  ok("creating a shortlist gives a link", /#\/shortlist\/[\w-]{12,}$/.test(link));
  await shot(C, "saved.png");
  const P = await person("partner");
  await P.goto(link); await P.waitForSelector(".card");
  ok("the partner opens it without an account and sees the title and groups", (await P.locator("h1").innerText()).includes("Quince music") && (await P.locator(".card").count()) === 3 && (await P.locator("#app").innerText()).includes("Carla"));
  ok("the partner only sees the first name, not the surname", !(await P.locator("#app").innerText()).includes("Lopez"));
  await shot(P, "shortlist.png");
  await P.locator(".card .heart").first().click(); await P.waitForSelector("#authform");
  ok("a visitor who taps a heart is asked to log in", P.url().includes("#/login"));
  await go(C, "#/saved"); await C.waitForSelector("[data-revoke]");
  await C.click("[data-revoke]"); await C.waitForFunction(() => !document.querySelector("[data-revoke]"));
  await P.goto(link); await P.reload(); await P.waitForSelector("#app .panel.empty");
  ok("stopping the share kills the link", (await P.locator("#app").innerText()).includes("isn't available"));

  // ---- neighborhood landing pages open the right search inside the app ----
  const L = await person("landing", { width: 900, height: 1100 });
  await L.goto(S.base + "/chicago/pilsen/quinceanera"); await L.waitForSelector(".card");
  ok("a /chicago/<neighborhood>/<event> link opens that search in the app", L.url().includes("#/?zip=60608&event=Quincea%C3%B1era") && (await L.locator(".card").count()) === 3);
  await L.goto(S.base + "/chicago/pilsen"); await L.waitForSelector(".card");
  ok("a plain neighborhood link opens the search for its ZIP", L.url().includes("#/?zip=60608"));
  await L.goto(S.base + "/chicago/nowhere-land");
  ok("an unknown neighborhood is a 404", (await L.locator("body").innerText()).length >= 0 && (await fetch(S.base + "/chicago/nowhere-land")).status === 404);
} catch (e) {
  failed++; console.log("CRASH", e.message.split("\n").slice(0, 6).join(" | "));
}
console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors, no CSP violations, no missing translations");
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed || problems.length ? 1 : 0);
