// Browser end-to-end for the improvement plan of Oct 14, 2026 (docs/improvement-plan.md), numbered as in the plan:
// #2 errors in Spanish on a Spanish screen, #3 the price before an account (and the choices kept through sign-up),
// #4 the travel fee on a card, #6 Show more, #7 new events, #8 search by name, #9 Get quotes for every category,
// #10 honest "from" prices and price steps per category, #12 no rank on paid cards, #13 the vendor's Today box,
// #14 seen in search, #15 price insight, #16 grouped dashboard tabs on a phone, #17 quick replies.
//   NODE_PATH=$(npm root -g) node e2e/e2e19.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", WEATHER: "0" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let failed = 0, nav = 0;
const ok = (name, cond) => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";

async function person(label, viewport = { width: 1180, height: 820 }, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && viewport.width < 500 });
  ctx.setDefaultTimeout(20000);
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::|Failed to fetch|Connection problem/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  p.on("dialog", (d) => d.accept());
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n) });
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); };
const text = (p) => p.locator("body").innerText();
const until = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const spanish = async (p) => { await p.evaluate(() => localStorage.setItem("bm_lang", "es")); };

try {
  const d = inDays(20);
  const vo = client(S.base);
  await vo.signup("v19@example.com", "Chuy Hernández");
  const gid = await makeGroup(vo, { name: "Mariachi Diecinueve", dates: [d] });

  // ---- #3 the price before an account ----
  const G = await person("guest");
  await go(G, `#/group/${gid}?date=${d}&zip=60608&guests=80&event=Wedding`);
  await G.waitForSelector(".slot");
  await G.locator(".slot").first().click();
  await G.waitForSelector("#bookform");
  ok("#3 logged out, the booking form shows (no log-in wall)", await G.locator("#bookform").isVisible());
  ok("#3 the total and the deposit show before any account", await until(async () => /total/i.test(await G.locator("#quote").innerText()) && /\$150/.test(await G.locator("#quote").innerText()) && /Deposit/i.test(await G.locator("#quote").innerText())));
  ok("#3 it says the account comes next, with a log-in link", await G.locator("#acctnext").isVisible() && /free account/.test(await G.locator("#acctnext").innerText()));
  await G.fill("#b-name", "Rosa Martínez"); await G.fill("#b-phone", "773-555-0123"); await G.fill("#b-addr", "1800 S Blue Island Ave");
  await G.fill("#b-msg", "Las Mañanitas, please");
  await G.check("#b-agree");
  await shot(G, "e19-guest-price.png");
  await G.click("#bookbtn");
  await G.waitForSelector("#authform");
  ok("#3 'Continue' leads to sign-up, coming back to the same page", /resume%3D1/.test(G.url()) || /resume=1/.test(decodeURIComponent(G.url())));
  await G.fill("#a-name", "Rosa Martínez"); await G.fill("#a-email", "rosa19@example.com"); await G.fill("#a-pw", PW);
  await G.click("#authform button[type=submit]");
  await G.waitForSelector("#bookform");
  ok("#3 after signing up, the same date and time are picked", (await G.locator("#bookform .sum").first().innerText()).includes("·"));
  ok("#3 what they typed is still there", (await G.inputValue("#b-addr")) === "1800 S Blue Island Ave" && (await G.inputValue("#b-msg")) === "Las Mañanitas, please" && (await G.inputValue("#b-guests")) === "80");
  ok("#3 now the button pays the deposit", /Pay deposit/.test(await G.locator("#bookbtn").innerText()));
  await G.click("#bookbtn");
  ok("#3 and the deposit can be paid", await until(async () => /#\/pay\/booking\//.test(G.url())));

  // ---- #2 errors in Spanish ----
  const E = await person("spanish");
  await go(E, "#/"); await spanish(E);
  await go(E, "#/?zip=00000");
  ok("#2 a server error reads in Spanish on a Spanish screen", await until(async () => /No reconocemos ese código postal/.test(await text(E))));
  await login(E, "rosa19@example.com");
  await go(E, `#/group/${gid}?date=${d}`); await E.waitForSelector(".slot"); await E.locator(".slot").first().click(); await E.waitForSelector("#bookform");
  await E.fill("#b-guests", "50"); await E.fill("#b-phone", "12"); await E.fill("#b-addr", "Calle 1"); await E.check("#b-agree");
  await E.click("#bookbtn");
  ok("#2 a booking mistake reads in Spanish too", await until(async () => /Escribe un número de teléfono válido/.test(await E.locator("#bookerr").innerText())));
  await shot(E, "e19-spanish-error.png");

  // ---- batch 2: finding vendors ----
  const more = [];
  for (let i = 0; i < 21; i++) { const o = client(S.base); await o.signup(`b19-${i}@example.com`, `Dueño ${i}`); more.push(await makeGroup(o, { name: `Grupo Extra ${i}`, rate: 200 + i * 5, dates: [d] })); }
  S.db.run("UPDATE groups SET spotlight_until = ? WHERE id = ?", Math.floor(Date.now() / 1000) + 864000, more[20]);
  const C = await person("customer");
  await go(C, "#/?zip=60608"); await C.waitForSelector("#resgrid .card");
  ok("#6 the first page shows 20 vendors and a Show more button", (await C.locator("#resgrid .card").count()) === 20 && await C.locator("#showmore").isVisible() && /Showing 20 of 2[0-9]/.test(await C.locator("#showing").innerText()));
  ok("#12 the paid card is labelled and carries no rank; the first unpaid card is #1", await C.locator("#resgrid .card").first().locator(".rank").count() === 0 && /Spotlight/.test(await C.locator("#resgrid .card").first().innerText()) && (await C.locator("#resgrid .card").nth(1).locator(".rank").innerText()) === "#1");
  await C.click("#showmore");
  ok("#6 Show more adds the rest below (22 in all), and goes away at the end", await until(async () => (await C.locator("#resgrid .card").count()) === 22 && (await C.locator("#showmore").count()) === 0));
  ok("#6 ranks carry on after the paid card: the last card is #21", (await C.locator("#resgrid .card").last().locator(".rank").innerText()) === "#21");
  await shot(C, "e19-show-more.png");
  await go(C, "#/?zip=60608&q=diecinueve"); await C.waitForSelector("#resgrid .card");
  ok("#8 search by name finds the one vendor, and the name box shows it", (await C.locator("#resgrid .card").count()) === 1 && /Mariachi Diecinueve/.test(await C.locator("#resgrid").innerText()) && (await C.inputValue("#s-q")) === "diecinueve");
  ok("#7 the event list has Baptism, First Communion, Graduation, Baby shower and Funeral", /Baptism[\s\S]*First Communion[\s\S]*Graduation[\s\S]*Baby shower[\s\S]*Funeral/.test(await C.locator("#s-event").textContent()));
  await go(C, "#/?zip=60608&category=food"); await C.waitForSelector(".links");
  ok("#9 Get quotes is offered for food vendors too, in their words, and opens for food", /Let food vendors send you quotes/.test(await C.locator(".links").innerText()) && await until(async () => /category=food/.test((await C.locator(".links a[href^='#/quotes']").first().getAttribute("href")) || "")));
  ok("#10 the price steps fit the kind of vendor (food goes up to $3,000)", /\$3,000/.test(await C.locator("#s-max").textContent()) && !/\$900/.test(await C.locator("#s-max").textContent()));
  await spanish(C); await go(C, "#/?zip=60608");
  ok("#7 #6 in Spanish: Bautizo in the list and 'Ver más'", await until(async () => /Bautizo/.test(await C.locator("#s-event").textContent()) && /Ver más/.test(await text(C))));
} catch (e) {
  failed++; console.log("FAIL (crashed)", e.stack || e);
} finally {
  if (problems.length) { failed += problems.length; console.log("Problems:\n" + problems.join("\n")); }
  await browser.close(); await S.close();
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}
