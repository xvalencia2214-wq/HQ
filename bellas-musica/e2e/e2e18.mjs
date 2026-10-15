// Browser end-to-end for the white-and-gold look and its features: the menu drawer that slides out from the left (on a
// wide screen and on a phone) behind the button with three lines and the word Menu, the Bigger text button, Spotlight (bought by a vendor, then shown first, on the home strip and
// on the group page), the Apple Pay note under the pay buttons, and the 48-hour rule in the terms.
//   NODE_PATH=$(npm root -g) node e2e/e2e18.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss18@example.com" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let failed = 0, nav = 0;
const ok = (name, cond) => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";

async function person(label, viewport = { width: 1180, height: 820 }, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && viewport.width < 500 });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::|Failed to fetch|Connection problem|Problema de conexión/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  p.on("dialog", (d) => d.accept());
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n) });
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); };
const text = (p) => p.locator("body").innerText();
const until = async (fn, ms = 4000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

try {
  const vo = client(S.base), other = client(S.base);
  await vo.signup("v18@example.com", "Chuy Hernández"); await other.signup("o18@example.com", "Otro Grupo");
  await client(S.base).signup("f18@example.com", "Rosa Martínez");
  const gid = await makeGroup(vo, { name: "Mariachi Dieciocho", dates: [inDays(20)] });
  const gid2 = await makeGroup(other, { name: "Banda Normal", dates: [inDays(20)] });

  // ---- the look: white page, navy writing ----
  const W = await person("wide");
  await go(W, "#/"); await W.waitForSelector("#sform");
  const look = await W.evaluate(() => { const b = getComputedStyle(document.body); return { bg: b.backgroundColor, ink: b.color }; });
  ok("the page is white with navy writing", look.bg === "rgb(253, 251, 246)" && look.ink === "rgb(11, 24, 56)");
  // ---- the menu drawer ----
  ok("on a wide screen too the menu waits behind a button with three lines and the word Menu", !(await W.locator("#nav").isVisible()) && (await W.locator("#navtoggle .burger i").count()) === 3 && (await W.locator("#navtoggle").innerText()).includes("Menu") && (await W.locator("#navtoggle").boundingBox()).height >= 47);
  await W.click("#navtoggle");
  await W.waitForFunction(() => document.getElementById("nav").getBoundingClientRect().left === 0);
  const drawer = await W.locator("#nav").boundingBox();
  ok("it slides out from the left, full height and narrow, over a dimmed page", drawer.y === 0 && Math.round(drawer.height) === 820 && drawer.width <= 330 && (await W.evaluate(() => getComputedStyle(document.getElementById("navshade")).opacity)) === "1" && (await W.locator("#navtoggle").getAttribute("aria-expanded")) === "true");
  ok("logged out, the menu has its sections in order", (await W.locator("#nav .nav-h").allInnerTexts()).map((x) => x.toLowerCase()).join("|") === "find and plan|for businesses|you");
  const box = await W.locator("#nav a[data-r=home]").boundingBox();
  ok("each row is big enough to tap easily (48 px)", box && box.height >= 47);
  ok("the page you are on is marked", (await W.locator("#nav a.on").getAttribute("data-r")) === "home");
  ok("the Close button has the keyboard, so Tab starts inside the menu", await W.evaluate(() => document.activeElement && document.activeElement.id === "navclose"));
  await W.keyboard.press("Shift+Tab");
  ok("Tab goes round inside the menu, not to the page behind it", await W.evaluate(() => document.getElementById("nav").contains(document.activeElement)));
  await shot(W, "e18-drawer.png");
  await W.mouse.click(1000, 400);
  ok("tapping the dimmed page closes it and the page is left as it was", await until(async () => !(await W.locator("#nav").isVisible())) && (await W.locator("#navtoggle").getAttribute("aria-expanded")) === "false" && !(await W.evaluate(() => document.body.classList.contains("nav-open"))));

  // ---- the vendor buys Spotlight ----
  const V = await person("vendor");
  await login(V, "v18@example.com");
  ok("logged in, the menu adds My party", (await V.locator("#nav .nav-h").allTextContents()).map((x) => x.toLowerCase()).join("|") === "find and plan|my party|for businesses|you");
  await go(V, `#/dashboard?g=${gid}&tab=payments`); await V.waitForSelector("#spotlight");
  ok("Payments shows Featured and Spotlight side by side, with their prices", /Featured\s*\$49/.test(await text(V)) && /Spotlight\s*\$99/.test(await text(V)) && /Most seen/.test(await text(V)));
  await shot(V, "e18-get-seen.png");
  await V.click("#spotlight"); await V.waitForSelector("#paybtn");
  ok("the test checkout says Spotlight and shows the ways to pay", /Spotlight \(30 days\)/.test(await text(V)) && (await V.locator(".payways .pw").allInnerTexts()).join(",") === "Apple Pay,Google Pay,Card");
  await V.click("#paybtn");
  ok("paid: in the spotlight for 30 days", await until(async () => /In the spotlight until/.test(await text(V))));

  // ---- families see it ----
  await go(W, "#/"); await W.waitForSelector(".spotstrip .card");
  ok("the home page shows the Spotlight vendor in its own labelled strip", /In the spotlight\s*Promoted/.test(await W.locator(".spotstrip h2").innerText()) && (await W.locator(".spotstrip h3").allInnerTexts()).join() === "Mariachi Dieciocho");
  await go(W, "#/?zip=60608"); await W.waitForSelector("#results .card");
  ok("in search it comes first with a Spotlight badge; the other group has none", (await W.locator("#results .card h3").first().innerText()) === "Mariachi Dieciocho" && (await W.locator("#results .card").first().locator(".feat.spot").count()) === 1 && (await W.locator("#results .card", { hasText: "Banda Normal" }).locator(".feat").count()) === 0);
  await shot(W, "e18-search.png");
  await go(W, `#/group/${gid}`); await W.waitForSelector(".feat.spot");
  ok("the group page has the badge", /Spotlight/.test(await W.locator("h1 .feat.spot").innerText()));

  // ---- the Apple Pay note on the booking form ----
  const F = await person("family");
  await login(F, "f18@example.com");
  await go(F, `#/group/${gid2}`); await F.waitForSelector(".day[data-d]"); await F.click(`.day[data-d="${inDays(20)}"]`); await F.click(".slot"); await F.waitForSelector("#bookform");
  ok("under the deposit button: Apple Pay, Google Pay or a card", /Apple Pay\s*Google Pay\s*Card\s*Pay with Apple Pay, Google Pay or any card/.test(await F.locator("#bookform .payways").innerText()));

  // ---- the phone: Menu button, sections, bigger text ----
  const P = await person("phone", { width: 390, height: 844 }, true);
  await login(P, "f18@example.com");
  await go(P, "#/bookings"); await P.waitForSelector("#navtoggle");
  ok("on a phone the menu is hidden behind the big Menu button with the word on it", !(await P.locator("#nav").isVisible()) && (await P.locator("#navtoggle").innerText()).includes("Menu") && (await P.locator("#navtoggle").boundingBox()).height >= 47);
  await P.evaluate(() => window.scrollTo(0, 400));
  await P.click("#navtoggle");
  await P.waitForFunction(() => document.getElementById("nav").getBoundingClientRect().left === 0);
  const menuBox = await P.locator("#nav").boundingBox();
  ok("Menu slides the same sections out from the left, top to bottom, even scrolled down, leaving a strip of page to tap", await P.locator("#nav").isVisible() && menuBox.y === 0 && Math.round(menuBox.height) === 844 && menuBox.width < 390 - 40 && (await P.locator("#nav .nav-h").count()) === 4);
  ok("the page behind does not scroll while the menu is open", await P.evaluate(() => getComputedStyle(document.body).overflow === "hidden"));
  await P.evaluate(() => window.dispatchEvent(new Event("bm:attention"))); await P.waitForTimeout(600);
  ok("the badges refreshing in the background leave the open menu open", await P.locator("#nav").isVisible() && (await P.locator("#navtoggle").getAttribute("aria-expanded")) === "true");
  await shot(P, "e18-phone-menu.png");
  await P.keyboard.press("Escape");
  ok("Escape closes it and puts the keyboard back on the Menu button", await until(async () => !(await P.locator("#nav").isVisible())) && (await P.locator("#navtoggle").getAttribute("aria-expanded")) === "false" && await P.evaluate(() => document.activeElement.id === "navtoggle"));
  await P.click("#navtoggle"); await P.click("#navclose");
  ok("the Close button closes it too", await until(async () => !(await P.locator("#nav").isVisible())));
  await P.click("#navtoggle");
  const before = await P.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  await P.click("#textbtn");
  const after = await P.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  ok("Bigger text makes the writing bigger and shows it is on", after >= before * 1.15 && (await P.locator("#textbtn").getAttribute("aria-pressed")) === "true");
  await P.click("#nav a[data-r=home]"); await P.waitForSelector("#sform");
  ok("tapping a row goes there and closes the menu", await until(async () => !(await P.locator("#nav").isVisible())));
  await P.reload(); await P.waitForSelector("#sform");
  ok("bigger text is remembered on the device", await P.evaluate(() => document.documentElement.classList.contains("big")));
  await shot(P, "e18-phone-big.png");
  await P.click("#navtoggle"); await P.click("#textbtn");
  ok("and can be turned off again", !(await P.evaluate(() => document.documentElement.classList.contains("big"))));
  await P.click("#langbtn"); await P.waitForFunction(() => document.documentElement.lang === "es" || /Buscar/.test(document.body.innerText));
  await P.click("#navtoggle");
  ok("Spanish: the sections and the buttons", /BUSCAR Y PLANEAR|Buscar y planear/i.test(await P.locator("#nav").innerText()) && /Letra más grande/.test(await P.locator("#nav").innerText()) && /English/.test(await P.locator("#langbtn").innerText()));

  // ---- each category has its own words ----
  const tacos = client(S.base); await tacos.signup("t18@example.com", "Don Güero");
  const tid = (await tacos.post("/api/groups", { name: "Tacos El Dieciocho", type: "Taquería / taco catering", zip: "60608", members: 3, hourly: false, story: "Tacos al pastor, asada and aguas frescas for parties of every size, all made fresh on site." })).json.id;
  await tacos.post(`/api/groups/${tid}/packages`, { name: "Taquiza for 100", description: "Three meats", hours: 3, price: 900 });
  await tacos.patch(`/api/groups/${tid}`, { events: ["Wedding", "Quinceañera"] });
  await tacos.post(`/api/groups/${tid}/photos`, { data: "data:image/png;base64," + fs.readFileSync(path.join(process.cwd(), "public", "icon-192.png")).toString("base64") }).catch(() => {});
  await go(W, "#/?zip=60608&category=food"); await W.waitForSelector("#results h2");
  ok("food: its own heading, and the list says food vendors, not groups", /Food that brings everyone to the table/.test(await W.locator(".hero h1").innerText()) && /Top food vendors near/.test(await W.locator("#results h2").innerText()));
  await go(W, "#/?zip=60608&category=venues"); await W.waitForSelector("#results");
  ok("venues: its own heading and words", /The perfect place to celebrate/.test(await W.locator(".hero h1").innerText()) && await until(async () => /venues/i.test(await W.locator("#results").innerText())));
  await go(W, "#/?zip=60608"); await W.waitForSelector("#results h2");
  ok("music keeps groups", /Top groups near/.test(await W.locator("#results h2").innerText()));

  // ---- owners make and edit their own page ----
  const T = await person("tacos");
  await login(T, "t18@example.com");
  await go(T, `#/dashboard?g=${tid}`); await T.waitForSelector(".setup-steps");
  const steps = await T.locator(".setup-steps li").allInnerTexts();
  ok("a draft shows its setup as numbered steps, the done ones ticked", steps.length >= 5 && /✓ Name, type and ZIP code/.test(steps[0]) && (await T.locator(".setup-steps li.done").count()) >= 3 && (await T.locator(".setup-steps li a").count()) >= 1);
  await go(T, `#/group/${tid}`); await T.waitForSelector("a[href*='tab=listing']");
  ok("on its own page the owner gets an Edit your page button", /Edit your page/.test(await T.locator("a[href*='tab=listing']").innerText()));
  await T.click("a[href*='tab=listing']"); await T.waitForSelector("#app form");
  ok("…which opens the profile to edit", /tab=listing/.test(T.url()));
  await client(S.base).signup("boss18@example.com", "The Boss");
  const A = await person("admin");
  await login(A, "boss18@example.com"); await go(A, "#/admin"); await A.waitForSelector("#joinlink");
  const join = await A.inputValue("#joinlink");
  ok("the owner page has a sign-up link to send a business, which makes its own page", /\?src=vendor-invite#\/signup\?next=%23%2Fdashboard%3Fnew%3D1$/.test(join) && /make your free page/.test(await A.locator("#app").innerText()));

  // ---- the 48-hour rule is in the terms ----
  const terms = await (await fetch(S.base + "/terms.html")).text();
  ok("the terms say a last-minute cancel (within 48 hours) keeps the deposit", /last 3 calendar days before the event, which covers the final 48 hours/.test(terms));
} catch (e) { failed++; console.log("FAIL crashed:", e.message); }
finally {
  for (const p of problems) { console.log("PROBLEM", p); failed++; }
  await browser.close(); await S.close();
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}
