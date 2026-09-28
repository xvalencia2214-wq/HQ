// Browser end-to-end for the launch-market features: password reset, email confirmation, Chicago page, waitlist,
// invite + claim, balance payment, reschedule, quote request + custom offer, review reply, badges, pause/resume.
//   NODE_PATH=$(npm root -g) node e2e/e2e2.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup, bookingBody } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ ADMIN_EMAILS: "boss@example.com" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let step = 0, failed = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";
const pages = {};

async function newPerson(label, viewport = { width: 1000, height: 1200 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} ${x}`); });
  pages[label] = p;
  return p;
}
const login = async (p, email, pw = PW) => {
  await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform");
  await p.fill("#a-email", email); await p.fill("#a-pw", pw); await p.click("#authform button[type=submit]");
  await p.waitForSelector("#nav a[data-r=account]");
};
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
let nav = 0;
const gotoHash = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`); // a changing query forces a real page load; a same-document hash change would not re-run the route
const toggleLang = async (p) => { if (await p.locator("#navtoggle").isVisible()) await p.click("#navtoggle"); await p.click("#langbtn"); };
const mail = (kind, to) => S.db.get("SELECT body FROM email_log WHERE kind = ?" + (to ? " AND to_email = ?" : "") + " ORDER BY id DESC", ...(to ? [kind, to] : [kind])).body;

try {
  // ---------- password reset + email confirmation ----------
  await client(S.base).signup("pat@example.com", "Pat Reset");
  const A = await newPerson("recover");
  await A.goto(S.base + "/#/login"); await A.waitForSelector("#authform");
  await A.click("text=Forgot your password?"); await A.waitForSelector("#fform");
  ok("forgot page warns that test-mode emails aren't really sent", (await A.locator(".note").innerText()).includes("Test mode"));
  await A.fill("#f-email", "pat@example.com"); await A.click("#fform button"); await A.waitForSelector(".note.ok");
  ok("forgot shows the same neutral confirmation", (await A.locator(".note.ok").innerText()).includes("reset link is on its way"));
  const rtok = mail("auth.reset", "pat@example.com").match(/#\/reset\/([\w-]+)/)[1];
  await A.goto(S.base + "/#/reset/" + rtok); await A.waitForSelector("#rform");
  await A.fill("#r-pw", "brand new password"); await A.fill("#r-pw2", "something different"); await A.click("#rform button");
  await A.waitForSelector("#rerr:not(:empty)");
  ok("mismatched passwords are caught before sending", /don't match/.test(await A.locator("#rerr").innerText()));
  await A.fill("#r-pw2", "brand new password"); await A.click("#rform button"); await A.waitForSelector("#authform");
  ok("reset works and sends the person to log in", A.url().includes("#/login"));
  await login(A, "pat@example.com", "brand new password");
  ok("the new password logs in", (await A.locator("#nav a[data-r=account]").innerText()).includes("Pat"));
  await A.goto(S.base + "/#/reset/" + rtok); await A.waitForSelector("#rform");
  await A.fill("#r-pw", "yet another password"); await A.fill("#r-pw2", "yet another password"); await A.click("#rform button");
  await A.waitForSelector("#rerr:not(:empty)");
  ok("a reset link can't be used twice", /invalid or has expired/.test(await A.locator("#rerr").innerText()));
  await client(S.base).signup("verify@example.com", "Vera Verify");
  const vtok = mail("auth.verify", "verify@example.com").match(/#\/verify\/([\w-]+)/)[1];
  const V = await newPerson("verify");
  await V.goto(S.base + "/#/verify/" + vtok); await V.waitForSelector("h1:has-text('Email confirmed')");
  ok("email confirmation link works", S.db.get("SELECT email_verified v FROM users WHERE email = 'verify@example.com'").v === 1);
  await V.goto(S.base + "/#/verify/" + vtok); await V.reload(); await V.waitForSelector(".note.warn");
  ok("a used confirmation link says so", /invalid or has expired/.test(await V.locator(".note.warn").innerText()));
  await A.goto(S.base + "/#/account"); await A.waitForSelector("#pform");
  await A.uncheck("input[name=emailnotify]"); await A.click("#pform button[type=submit]"); await A.waitForSelector("#toast:not([hidden])");
  ok("account page can turn optional emails off", S.db.get("SELECT email_notify n FROM users WHERE email = 'pat@example.com'").n === 0);

  // ---------- Chicago page, neighborhoods, waitlist ----------
  const owner = client(S.base); await owner.signup("own@example.com", "Owen Owner");
  await makeGroup(owner, { name: "Pilsen Test Band", dates: [inDays(20), inDays(21), inDays(22)] });
  const H = await newPerson("home", { width: 420, height: 900 });
  await H.goto(S.base + "/#/chicago"); await H.waitForSelector(".card");
  ok("Chicago page has the headline, 14 neighborhoods, and top groups", (await H.locator("h1").innerText()).includes("Chicago") && (await H.locator(".chip-link").count()) >= 14 && (await H.locator(".card").count()) >= 1);
  ok("no horizontal scroll on the Chicago page on a phone", await H.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(H, "chicago-phone.png");
  await H.click(".chip-link:has-text('Pilsen') >> nth=0"); await H.waitForSelector(".card");
  ok("a neighborhood chip searches its ZIP", H.url().includes("zip=60608"));
  await gotoHash(H, "#/"); await H.waitForSelector(".chip-link");
  ok("the home page offers the same neighborhoods", (await H.locator(".chip-link").count()) >= 14);
  await toggleLang(H); await gotoHash(H, "#/chicago"); await H.waitForSelector("h1:has-text('en vivo en Chicago')");
  ok("Chicago page is in Spanish when asked", (await H.locator("#app").innerText()).includes("Cómo funciona"));
  await toggleLang(H);
  await gotoHash(H, "#/?zip=90210"); await H.waitForSelector(".waitlist");
  await H.fill("#w-email", "beverly@example.com"); await H.click(".waitlist button[type=submit]"); await H.waitForSelector(".waitlist .note.ok");
  ok("a search outside the launch area offers the waitlist and saves the signup", S.db.get("SELECT COUNT(*) c FROM waitlist WHERE zip = '90210' AND email = 'beverly@example.com'").c === 1);

  // ---------- invite + claim ----------
  await client(S.base).signup("boss@example.com", "The Boss");
  const B = await newPerson("boss");
  await login(B, "boss@example.com"); await gotoHash(B, "#/admin"); await B.waitForSelector("#iform");
  await B.fill("#i-name", "Mariachi Invitado"); await B.fill("#i-zip", "60623"); await B.click("#iform button[type=submit]"); await B.waitForSelector("#ilink");
  const claimUrl = await B.locator("#ilink").innerText();
  ok("admin creates an invitation and gets a private link", /#\/claim\/[\w-]{20,}$/.test(claimUrl));
  await shot(B, "admin.png");
  const G = await newPerson("group");
  await G.goto(claimUrl); await G.waitForSelector("h1:has-text(\"You've been invited\")");
  ok("the invitation page names the group and asks them to sign up", (await G.locator("#app").innerText()).includes("Mariachi Invitado"));
  await G.click("#app a:has-text('Sign up')"); await G.waitForSelector("#authform");
  await G.fill("#a-name", "Gabi Grupo"); await G.fill("#a-email", "gabi@example.com"); await G.fill("#a-pw", PW); await G.click("#authform button[type=submit]");
  await G.waitForSelector("#claimbtn");
  ok("after signing up they return to the invitation", G.url().includes("#/claim/"));
  await G.click("#claimbtn"); await G.waitForSelector(".draft");
  ok("claiming lands on their draft listing with the publish steps", G.url().includes("tab=listing") && (await G.locator(".draft").innerText()).includes("Your listing is a draft"));
  await G.goto(claimUrl.replace("/#", "/?again=1#")); await G.waitForSelector(".note.warn");
  ok("the link stops working once claimed", /not valid any more/.test(await G.locator(".note.warn").innerText()));

  // ---------- balance, reschedule, quote + custom offer, review reply, badges, pause ----------
  const cust = client(S.base); await cust.signup("cus@example.com", "Carla Cliente", { phone: "312-555-0142" });
  const dates = [inDays(40), inDays(41), inDays(42), inDays(60)];
  const gid = await makeGroup(owner, { name: "Flow Band", dates });
  const book = async (date, time = "2:00 PM") => { const b = (await cust.post("/api/bookings", bookingBody(gid, date, { time }))).json.booking; await cust.post(`/api/bookings/${b.id}/simulate-pay`); await owner.patch(`/api/bookings/${b.id}`, { action: "accept" }); return b; };
  const bk = await book(dates[0]);
  const Cu = await newPerson("customer"), Ow = await newPerson("owner");
  await login(Cu, "cus@example.com"); await login(Ow, "own@example.com");
  await gotoHash(Cu, "#/bookings"); await Cu.waitForSelector(".req");
  ok("customer sees what is still owed and a Pay balance button", /Balance \$450/.test(await Cu.locator(".req").innerText()) && (await Cu.locator("[data-balance]").count()) === 1);
  await shot(Cu, "bookings-balance.png");
  await Cu.click("[data-balance]"); await Cu.waitForSelector("#paybtn");
  ok("balance payment page (test mode) shows the balance", (await Cu.locator(".sum.strong").innerText()).includes("$450"));
  await Cu.click("#paybtn"); await Cu.waitForSelector(".note.ok");
  ok("paying the balance confirms it", (await Cu.locator(".note.ok").innerText()).includes("Balance paid"));
  await gotoHash(Cu, "#/bookings"); await Cu.waitForSelector(".req");
  ok("bookings list then shows the balance as paid and no pay button", (await Cu.locator(".req").innerText()).includes("Balance paid in the app") && (await Cu.locator("[data-balance]").count()) === 0);
  await gotoHash(Ow, `#/dashboard?g=${gid}&tab=requests`); await Ow.waitForSelector(".req");
  ok("group sees the balance as paid in the app", (await Ow.locator(".req").innerText()).includes("paid in the app"));
  ok("group sees last-30-day numbers", (await Ow.locator(".tiles.small .tile").count()) === 3);

  // reschedule
  await Cu.click("[data-resched]"); await Cu.waitForSelector(".rs-cal .cal");
  // Walk the calendar to a month that has the day: each click re-renders after a fetch, so wait for the heading to change.
  const pickDay = async (p, root, key) => {
    for (let i = 0; i < 5 && !(await p.locator(`${root} .day[data-d="${key}"]:not([disabled])`).count()); i++) {
      const before = await p.locator(`${root} h3`).innerText();
      await p.click(`${root} [data-nav="1"]`);
      await p.waitForFunction(([r, b]) => document.querySelector(`${r} h3`)?.innerText !== b, [root, before]);
    }
    await p.click(`${root} .day[data-d="${key}"]`);
  };
  await pickDay(Cu, ".rs-cal", dates[1]); await Cu.click(".rs-slots .slot:has-text('4:00 PM')");
  await Cu.fill(".resched-form input", "Venue changed the day"); await Cu.click("[data-send]"); await Cu.waitForSelector("[data-unresched]");
  ok("customer sees the request as waiting for the group", (await Cu.locator(".req").innerText()).includes("Waiting for the group to approve"));
  await gotoHash(Ow, `#/dashboard?g=${gid}&tab=requests&r=1`); await Ow.waitForSelector("[data-rs=accept]");
  ok("group sees the request with the reason", (await Ow.locator(".req").innerText()).includes("Venue changed the day"));
  await shot(Ow, "dashboard-reschedule.png");
  await Ow.click("[data-rs=accept]"); await Ow.waitForFunction(() => !document.querySelector("[data-rs=accept]"));
  const moved = S.db.get("SELECT date, time, resched_status s FROM bookings WHERE id = ?", bk.id);
  ok("approving moves the booking and clears the request", moved.date === dates[1] && moved.time === "4:00 PM" && moved.s === "");

  // quote request -> custom offer -> booking at the offer price
  await gotoHash(Cu, `#/group/${gid}`); await Cu.waitForSelector(".quote-req");
  await Cu.click(".quote-req summary"); await Cu.fill("#qr-date", inDays(50)); await Cu.fill("#qr-guests", "80"); await Cu.fill("#qr-note", "Outdoor patio");
  await Cu.click(".quote-req button[type=submit]"); await Cu.waitForSelector(".msg.me:has-text('Quote request')");
  ok("one-tap quote request lands in the chat with the event details", (await Cu.locator(".msg.me").last().innerText()).includes("80 guests"));
  await gotoHash(Ow, `#/dashboard?g=${gid}&tab=messages`); await Ow.waitForSelector(".thread"); await Ow.click(".thread"); await Ow.waitForSelector("#rform");
  ok("group sees the request in the conversation", (await Ow.locator("#convchat").innerText()).includes("Quote request"));
  await Ow.click(".quote-req summary"); await Ow.fill("#of-name", "Quince special"); await Ow.fill("#of-p", "800"); await Ow.fill("#of-h", "3"); await Ow.fill("#of-n", "Includes sound");
  await Ow.click(".quote-req button[type=submit]"); await Ow.waitForSelector("text=Quince special");
  ok("group's open offers list shows the offer", (await Ow.locator("#app").innerText()).includes("Open offers") && (await Ow.locator("[data-wd]").count()) === 1);
  await gotoHash(Cu, `#/group/${gid}?o=1`); await Cu.waitForSelector(".panel.offer");
  ok("customer sees a custom-offer panel; a stranger does not", (await Cu.locator(".panel.offer").innerText()).includes("Quince special"));
  const St = await newPerson("stranger"); await St.goto(S.base + `/#/group/${gid}`); await St.waitForSelector("#calbox .cal");
  ok("other visitors never see the private offer", (await St.locator(".panel.offer").count()) === 0 && !(await St.locator("#app").innerText()).includes("Quince special"));
  await Cu.click(".panel.offer [data-pkg]");
  await pickDay(Cu, "#calbox", dates[3]); await Cu.click("#slotbox .slot >> nth=0"); await Cu.waitForSelector("#bookform");
  await Cu.fill("#b-guests", "80"); await Cu.fill("#b-addr", "Patio, Chicago"); await Cu.waitForSelector("#quote .sum");
  await Cu.waitForFunction(() => /\$800/.test(document.querySelector("#quote")?.innerText || ""));
  ok("booking form prices the offer at exactly the offered total", (await Cu.locator("#b-pkg option:checked").innerText()).includes("Custom offer") && /Estimated total\s*\$800/.test((await Cu.locator("#quote").innerText()).replace(/\n/g, " ")));
  await shot(Cu, "group-offer.png");

  // review reply
  const past = await book(dates[2], "12:00 PM"); S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-3), past.id);
  await cust.post(`/api/bookings/${past.id}/review`, { rating: 5, text: "Wonderful, everyone danced." });
  await gotoHash(Ow, `#/dashboard?g=${gid}&tab=reviews`); await Ow.waitForSelector(".review");
  await Ow.click("[data-edit]"); await Ow.fill(".rv-form textarea", "Gracias Carla! Call 312-555-0199 anytime"); await Ow.click(".rv-form button[type=submit]");
  await Ow.waitForSelector(".reply");
  ok("group replies to a review; contact details are stripped", (await Ow.locator(".reply").innerText()).includes("Gracias Carla") && !(await Ow.locator(".reply").innerText()).includes("555"));
  await gotoHash(Cu, `#/group/${gid}?o=2`); await Cu.waitForSelector(".review .reply");
  ok("the reply shows on the public group page", (await Cu.locator(".review .reply").innerText()).includes("Reply from the group"));

  // badges + pause
  await gotoHash(B, "#/admin"); await B.waitForSelector("tr:has-text('Flow Band')");
  await B.locator("tr", { hasText: "Flow Band" }).locator("[data-badge=verified]").click(); await B.waitForSelector("tr:has-text('Flow Band') .badge:has-text('verified')");
  await B.locator("tr", { hasText: "Flow Band" }).locator("[data-badge=insured]").click(); await B.waitForSelector("tr:has-text('Flow Band') .badge:has-text('insured')");
  await gotoHash(Cu, `#/group/${gid}?o=3`); await Cu.waitForSelector("#calbox .cal");
  ok("verified and insured badges show on the group page", (await Cu.locator("h1 ~ .meta, .meta").first().innerText()).includes("Verified") && (await Cu.locator(".meta").first().innerText()).includes("Insured"));
  await gotoHash(Cu, "#/?zip=60608"); await Cu.waitForSelector(".card");
  ok("and on the search cards", (await Cu.locator(".card", { hasText: "Flow Band" }).innerText()).includes("Verified"));
  await gotoHash(Ow, `#/dashboard?g=${gid}&tab=requests&p=1`); await Ow.waitForSelector("#pause");
  Ow.once("dialog", (d) => d.accept()); await Ow.click("#pause"); await Ow.waitForSelector("#resume");
  ok("pausing shows the paused banner", (await Ow.locator(".note.warn").first().innerText()).includes("Your listing is paused"));
  await gotoHash(Cu, "#/?zip=60608&p=1"); await Cu.waitForSelector(".card");
  ok("a paused group disappears from search", !(await Cu.locator(".card h3").allInnerTexts()).includes("Flow Band"));
  await Ow.click("#resume"); await Ow.waitForSelector("#pause");
  await gotoHash(Cu, "#/?zip=60608&p=2"); await Cu.waitForSelector(".card");
  ok("resuming brings it back", (await Cu.locator(".card h3").allInnerTexts()).includes("Flow Band"));
} catch (e) {
  failed++;
  console.log("CRASH", e.message.split("\n").slice(0, 6).join(" | "));
  for (const [n, pg] of Object.entries(pages)) { console.log(`--- ${n} at ${pg.url()}:`, (await pg.locator("#app").innerText().catch(() => "?")).slice(0, 250).replace(/\n+/g, " / ")); if (shots) await pg.screenshot({ path: path.join(shots, `crash-${n}.png`), fullPage: true }).catch(() => {}); }
}
console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors, no CSP violations, no missing translations");
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed || problems.length ? 1 : 0);
