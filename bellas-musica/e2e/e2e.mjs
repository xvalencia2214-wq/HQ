// Browser end-to-end check. Needs Playwright + Chromium (not part of `npm test`).
//   NODE_PATH=$(npm root -g) node e2e/e2e.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp } from "../test/helpers.js";
import { png } from "./png.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });

const S = await startApp();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let step = 0, failed = 0, O, C;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };

async function newPerson(label, viewport = { width: 900, height: 1100 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await ctx.route("**/*youtube*/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label}: ${x}`); });
  return p;
}
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });

try {
  // ---------------- group manager ----------------
  O = await newPerson("owner");
  await O.goto(S.base + "/#/dashboard");
  await O.waitForSelector("#authform");
  ok("dashboard asks a logged-out visitor to log in", O.url().includes("#/login"));
  await O.click("text=Sign up >> nth=-1");
  await O.fill("#a-name", "Olga Owner"); await O.fill("#a-email", "olga@example.com"); await O.fill("#a-pw", "a long password 1");
  await O.click("#authform button[type=submit]");
  await O.waitForSelector("#cform");
  ok("after signup the manager lands on 'List your group'", O.url().includes("dashboard"));
  await O.fill("#c-name", "E2E Mariachi"); await O.fill("#c-zip", "60608"); await O.fill("#c-rate", "300"); await O.fill("#c-story", "We started in a garage. <b>not bold</b>");
  await O.click("#cform button[type=submit]");
  await O.waitForSelector("#fill");
  ok("new group sees a launch checklist with next steps", (await O.locator(".checklist").innerText()).includes("Get ready to launch") && (await O.locator(".checklist li").count()) >= 5);
  await O.click("#fill");
  await O.waitForSelector(".day.open");
  ok("'open all weekends' opens dates and shows them", (await O.locator(".day.open").count()) >= 2);
  await O.locator(".day.open").first().click();
  await O.locator(".slot.sel").first().click(); // close one slot
  await O.waitForFunction(() => document.querySelectorAll(".slot.sel").length === 4);
  ok("manager can toggle a slot", true);
  await O.click(".tabs >> text=Profile"); await O.waitForSelector("#lform");
  await O.check("input[name=ev][value=Wedding]"); await O.check("input[name=sound]"); await O.fill("#l-guests", "300");
  await O.click("#lform button[type=submit]"); await O.waitForSelector("#toast:not([hidden])");
  await O.click(".tabs >> text=Packages"); await O.waitForSelector("#pkform");
  await O.fill("#k-name", "Serenata"); await O.fill("#k-desc", "3 songs"); await O.fill("#k-h", "1"); await O.fill("#k-p", "200");
  await O.click("#pkform button[type=submit]"); await O.waitForSelector("text=Serenata");
  await O.fill("#songs", "Cielito Lindo\nEl Rey\nLas Mañanitas"); await O.click("#sform2 button[type=submit]");
  await O.waitForSelector("text=Saved");
  await O.click(".tabs >> text=Media"); await O.waitForSelector("#file", { state: "attached" });
  await O.setInputFiles("#file", { name: "band.png", mimeType: "image/png", buffer: png() });
  await O.waitForSelector(".ph-item img");
  ok("photo upload works (resized in the browser)", (await O.locator(".ph-item img").count()) === 1);
  await O.fill("#v-url", "https://youtu.be/dQw4w9WgXcQ"); await O.click("#vform button[type=submit]");
  await O.waitForSelector(".video iframe");
  ok("video link becomes a privacy-friendly embed", (await O.locator(".video iframe").getAttribute("src")).startsWith("https://www.youtube-nocookie.com/embed/"));
  await O.fill("#v-url", "https://evil.example/x"); await O.click("#vform button[type=submit]");
  await O.waitForSelector("#verr:not(:empty)");
  ok("non-YouTube/Vimeo link is refused", /YouTube or Vimeo/.test(await O.locator("#verr").innerText()));

  // ---------------- customer (Spanish) ----------------
  C = await newPerson("customer", { width: 420, height: 900 });
  await C.goto(S.base + "/#/?zip=60608&guests=100");
  await C.waitForSelector(".card");
  ok("search shows the new group in Chicago", (await C.locator(".card h3").allInnerTexts()).includes("E2E Mariachi"));
  ok("no horizontal scroll on a phone", await C.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(C, "1-home-phone.png");
  await C.click(".seg a:has-text('Map')"); await C.waitForSelector(".leaflet-marker-icon");
  ok("map view shows pins", (await C.locator(".leaflet-marker-icon").count()) >= 1);
  await C.click(".seg a:has-text('List')"); await C.waitForSelector(".card");
  await C.locator(".card", { hasText: "E2E Mariachi" }).locator('a[href^="#/group/"]').first().click();
  await C.waitForSelector("#calbox .cal");
  ok("group page: photo, video, songs, package", (await C.locator("#hero-img").count()) === 1 && (await C.locator(".video iframe").count()) === 1 && (await C.locator("#songlist li").count()) === 3 && (await C.locator(".pkg").count()) === 1);
  ok("story is escaped (no injected bold)", (await C.locator(".panel b").count()) === 0);
  await C.fill("#songfilter", "mananitas");
  ok("song filter ignores accents", (await C.locator("#songlist li").allInnerTexts()).join() === "Las Mañanitas");
  ok("logged-out visitor is asked to log in to book", (await C.locator("#bookbox").innerText()).includes("Log in"));
  await C.click("#bookbox >> text=Sign up"); await C.waitForSelector("#authform");
  await C.fill("#a-name", "Carlos Cliente"); await C.fill("#a-email", "carlos@example.com"); await C.fill("#a-pw", "another long pass 2"); await C.fill("#a-phone", "312-555-0142");
  await C.click("#authform button[type=submit]");
  await C.waitForSelector("#calbox .cal");
  ok("after signup the customer returns to the group page", C.url().includes("#/group/e2e-mariachi"));
  const gid = C.url().split("#/group/")[1].split("?")[0];
  for (let i = 0; i < 3 && !(await C.locator(".day.open").count()); i++) await C.click('[data-nav="1"]');
  await C.locator(".day.open").first().click(); await C.locator(".slot").first().click();
  await C.waitForSelector("#bookform");
  await C.fill("#b-guests", "120"); await C.fill("#b-addr", "Casa Blanca Hall, Chicago");
  await C.waitForSelector("#quote .sum");
  const quoteText = await C.locator("#quote").innerText();
  ok("quote shows total, deposit, balance and the policy", /Estimated total/.test(quoteText) && /Deposit today \(25%\)/.test(quoteText) && /Moderate/.test(quoteText));
  await C.click("#bookbtn"); await C.waitForSelector("#bookerr:not(:empty)");
  ok("must accept the policy before paying", /accept/i.test(await C.locator("#bookerr").innerText()));
  await C.check("#b-agree"); await C.click("#bookbtn");
  await C.waitForSelector("#paybtn");
  ok("goes to the (test-mode) payment page", (await C.locator(".note").innerText()).includes("Test mode"));
  await C.click("#paybtn"); await C.waitForSelector(".note.ok");
  ok("deposit received message", (await C.locator(".note.ok").innerText()).includes("Deposit received"));
  await C.goto(S.base + `/#/group/${gid}`); await C.waitForSelector("#chatform");
  await C.fill("#chatin", "Hola! Llamame al 312-555-0142"); await C.click("#chatform button");
  await C.waitForSelector(".msg.me");
  ok("phone number in chat is hidden", (await C.locator(".msg.me").innerText()).includes("hidden until a booking is confirmed"));

  // ---------------- manager accepts ----------------
  await O.goto(S.base + "/#/dashboard?tab=requests"); await O.waitForSelector(".req");
  await O.waitForFunction(() => document.querySelector("#nav a[data-r=dashboard] .dot"));
  ok("manager sees a badge for the request and the unanswered message", Number(await O.locator("#nav a[data-r=dashboard] .dot").innerText()) >= 2);
  ok("requests tab shows a 'Needs your response' section", (await O.locator(".sec-h.hot").innerText()).includes("Needs your response"));
  ok("manager sees the request, phone hidden", (await O.locator(".req").innerText()).includes("Carlos Cliente") && !(await O.locator(".req").innerText()).includes("555"));
  await shot(O, "2-dashboard-requests.png");
  await O.click("[data-act=accept]"); await O.waitForSelector(".req a[href^='tel:']");
  ok("after accepting, the customer's phone is shown", (await O.locator(".req").innerText()).includes("(312) 555-0142"));
  await O.click(".tabs >> text=Messages"); await O.waitForSelector(".thread");
  await O.click(".thread"); await O.waitForSelector("#rform");
  await O.fill("#rin", "Claro que si, tocamos Volver Volver"); await O.click("#rform button"); await O.waitForSelector(".msg.me");
  ok("manager can reply in the thread", (await O.locator(".msg.me").count()) === 1);
  await C.goto(S.base + "/#/messages"); await C.waitForSelector(".thread");
  await C.waitForFunction(() => document.querySelectorAll("#convchat .msg").length >= 2);
  ok("customer inbox lists the conversation and opens the manager's reply", (await C.locator(".thread").innerText()).includes("E2E Mariachi") && (await C.locator("#convchat").innerText()).includes("Volver Volver"));
  await C.waitForFunction(() => !document.querySelector("#nav a[data-r=messages] .dot"));
  ok("reading the reply clears the unread badge", true);

  // ---------------- customer: bookings, Spanish, cancel ----------------
  ok("phone header collapses into a menu", await C.locator("#nav").isHidden());
  await C.goto(S.base + "/#/bookings"); await C.waitForSelector(".req");
  const icsHref = await C.locator("a[href$='/ics']").first().getAttribute("href");
  const icsRes = await C.request.get(S.base + icsHref);
  ok("'Add to calendar' downloads a valid .ics", icsRes.status() === 200 && (await icsRes.text()).startsWith("BEGIN:VCALENDAR") && /text\/calendar/.test(icsRes.headers()["content-type"]));
  ok("customer sees Confirmed and the refund preview", (await C.locator(".req").innerText()).includes("Confirmed") && /get back \$/.test(await C.locator(".req").innerText()));
  await C.click("#navtoggle"); await C.click("#langbtn"); await C.waitForSelector("h2:has-text(\"Mis reservas\")"); await C.click("#navtoggle");
  ok("Spanish toggle translates the page", (await C.locator(".req").innerText()).includes("Confirmada") && (await C.locator("#nav").innerText()).includes("Buscar música"));
  await shot(C, "3-bookings-es-phone.png");
  C.once("dialog", (d) => d.accept());
  await C.click("[data-cancel]"); await C.waitForSelector("text=Reembolsado");
  ok("cancelling refunds the deposit per policy", (await C.locator(".req").innerText()).includes("reembolsados"));
  await C.goto(S.base + `/#/group/${gid}`); await C.waitForSelector("#calbox .cal");
  await shot(C, "4-group-es-phone.png");
  await C.goto(S.base + "/#/best/60608"); await C.waitForSelector(".card");
  ok("'Lo mejor de Chicago' page lists groups", (await C.locator("h2").first().innerText()).includes("Lo mejor de Chicago"));
  const shared = await newPerson("shared-link");
  await shared.goto(S.base + `/g/${gid}`); await shared.waitForSelector("#calbox .cal");
  ok("a shared /g/<id> link opens the group inside the app", shared.url().includes(`#/group/${gid}`) && (await shared.locator("h2").first().innerText()).includes("E2E Mariachi"));
  const waHref = await shared.locator("a:has-text('WhatsApp')").first().getAttribute("href");
  ok("WhatsApp share uses the preview-friendly link", decodeURIComponent(waHref).includes(`/g/${gid}`) && !decodeURIComponent(waHref).includes("#/group"));
  await O.goto(S.base + "/#/dashboard?tab=payments"); await O.waitForSelector("#feature");
  await O.click("#feature"); await O.waitForSelector("#paybtn"); await O.click("#paybtn"); await O.waitForSelector("text=Featured until");
  ok("manager can buy featured placement (test mode)", true);
  await C.goto(S.base + "/#/?zip=60608"); await C.waitForSelector(".card");
  ok("featured group is first with a badge", (await C.locator(".card").first().innerText()).includes("Destacado") && (await C.locator(".card h3").first().innerText()) === "E2E Mariachi");
} catch (e) {
  failed++;
  console.log("CRASH", e.message.split("\n").slice(0, 6).join(" | "));
  for (const [n, pg] of [["owner", O], ["customer", C]]) if (pg) { console.log(`--- ${n} at ${pg.url()}:`, (await pg.locator("#app").innerText().catch(() => "?")).slice(0, 300).replace(/\n+/g, " / ")); if (shots) await pg.screenshot({ path: path.join(shots, `crash-${n}.png`), fullPage: true }); }
}
console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors, no CSP violations, no missing translations");
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed || problems.length ? 1 : 0);
