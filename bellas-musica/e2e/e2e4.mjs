// Browser end-to-end for the show-up guarantee and the printable agreement.
//   NODE_PATH=$(npm root -g) node e2e/e2e4.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup, bookingBody } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", ADMIN_EMAILS: "boss@example.com" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let step = 0, failed = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";
let nav = 0;
async function person(label) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} ${x}`); });
  return p;
}
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForSelector("#nav a[data-r=account]"); };
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });

try {
  const owner = client(S.base), cust = client(S.base), boss = client(S.base);
  await owner.signup("own@example.com", "Owen Owner"); await cust.signup("cus@example.com", "Carla Cliente", { phone: "312-555-0142" }); await boss.signup("boss@example.com", "The Boss");
  const dates = [inDays(30), inDays(31), inDays(32)];
  const gid = await makeGroup(owner, { name: "Guarantee Band", dates });
  const make = async (date, time) => { const b = (await cust.post("/api/bookings", bookingBody(gid, date, { time }))).json.booking; await cust.post(`/api/bookings/${b.id}/simulate-pay`); await owner.patch(`/api/bookings/${b.id}`, { action: "accept" }); return b; };
  const today = await make(dates[0], "2:00 PM"); S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), today.id);
  const missed = await make(dates[1], "12:00 PM"); S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-1), missed.id);
  const Cu = await person("customer"), Ow = await person("owner"), Bo = await person("boss");
  await login(Cu, "cus@example.com"); await login(Ow, "own@example.com"); await login(Bo, "boss@example.com");

  await go(Cu, "#/bookings"); await Cu.waitForSelector(".bigcode");
  const code = await Cu.locator(".bigcode").innerText();
  ok("on the event day the customer sees a 4-digit arrival code", /^\d{4}$/.test(code));
  await shot(Cu, "customer-code.png");
  ok("the past, unattended booking offers 'Report a no-show'", (await Cu.locator("[data-noshow]").count()) === 1);

  await go(Ow, `#/dashboard?g=${gid}&tab=requests`); await Ow.waitForSelector("[data-checkin]");
  await Ow.click("[data-checkin]"); await Ow.fill(".ci-slot input", code === "0000" ? "1111" : "0000" === code ? "1111" : String((Number(code) % 8999) + 1001)); await Ow.click(".ci-slot button[type=submit]");
  await Ow.waitForSelector(".ci-slot .err:not(:empty)");
  ok("the group entering a wrong code is told no", /isn't right/.test(await Ow.locator(".ci-slot .err").innerText()));
  await Ow.fill(".ci-slot input", code); await Ow.click(".ci-slot button[type=submit]"); await Ow.waitForSelector("text=The group checked in");
  ok("entering the right code checks the group in", (await Ow.locator("[data-checkin]").count()) === 0);
  await go(Cu, "#/bookings"); await Cu.waitForSelector(".req");
  ok("the customer sees that the group checked in and the code is gone", (await Cu.locator("#app").innerText()).includes("The group checked in") && (await Cu.locator(".bigcode").count()) === 0);

  await Cu.click("[data-noshow]"); await Cu.fill(".review-form textarea", "Nobody came to the hall at all"); await Cu.click(".review-form button[type=submit]");
  await Cu.waitForSelector("text=No-show report under review");
  ok("the customer's report goes to review", (await Cu.locator("[data-noshow]").count()) === 0);
  await go(Ow, `#/dashboard?g=${gid}&tab=requests&r=1`); await Ow.waitForSelector("[data-nsreply]");
  ok("the group sees the report and can answer it", (await Ow.locator("#app").innerText()).includes("Nobody came to the hall"));
  await Ow.click("[data-nsreply]"); await Ow.fill(".ci-slot textarea", "We were there, the door was locked"); await Ow.click(".ci-slot button[type=submit]");
  await Ow.waitForSelector("text=Your answer:");
  await go(Bo, "#/admin"); await Bo.waitForSelector("[data-ns=refund]");
  ok("admin sees both sides in the review queue", (await Bo.locator("#app").innerText()).includes("We were there, the door was locked") && (await Bo.locator("#app").innerText()).includes("Nobody came to the hall"));
  await shot(Bo, "admin-noshow.png");
  Bo.once("dialog", (d) => d.accept()); await Bo.click("[data-ns=refund]"); await Bo.waitForSelector("[data-ns=refund]", { state: "detached" });
  ok("admin refunds, and the booking shows as refunded", S.db.get("SELECT noshow_status s, payment_status p FROM bookings WHERE id = ?", missed.id).s === "refunded");
  await go(Cu, "#/bookings"); await Cu.waitForSelector(".req");
  ok("the customer sees the outcome", (await Cu.locator("#app").innerText()).includes("No-show confirmed: refunded"));

  // a group that mistypes the code 3 times is locked out; the customer confirms the arrival instead
  const third = await make(dates[2], "4:00 PM"); S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), third.id);
  await go(Ow, `#/dashboard?g=${gid}&tab=requests&lk=1`); await Ow.waitForSelector(`[data-checkin="${third.id}"]`);
  for (let k = 0; k < 3; k++) {
    await Ow.click(`[data-checkin="${third.id}"]`); await Ow.fill(".ci-slot input", "0000"); await Ow.click(".ci-slot button[type=submit]");
    await Ow.waitForSelector(".ci-slot .err:not(:empty)");
    if (k < 2) await Ow.reload().then(() => Ow.waitForSelector(`[data-checkin="${third.id}"]`)); 
  }
  await go(Ow, `#/dashboard?g=${gid}&tab=requests&lk=2`); await Ow.waitForSelector(".note.warn.small");
  ok("after 3 wrong codes the group sees that check-in is locked, with the way out", (await Ow.locator("#app").innerText()).includes("locked after 3 wrong codes") && (await Ow.locator(`[data-checkin="${third.id}"]`).count()) === 0);
  await go(Cu, "#/bookings"); await Cu.waitForSelector(`[data-arrived="${third.id}"]`);
  Cu.once("dialog", (d) => d.accept()); await Cu.click(`[data-arrived="${third.id}"]`); await Cu.waitForFunction(() => !document.querySelector("[data-arrived]"));
  ok("the customer confirms the arrival in their own app", S.db.get("SELECT checked_in_at c FROM bookings WHERE id = ?", third.id).c > 0);

  // agreement
  await Cu.click(`a[href="#/agreement/${today.id}"]`); await Cu.waitForSelector(".agreement");
  const text = await Cu.locator(".agreement").innerText();
  ok("the agreement shows parties, event, price, policy and the guarantee", /Guarantee Band/.test(text) && /Carla Cliente/.test(text) && /\$600/.test(text) && /Moderate/.test(text) && /Show-up guarantee/.test(text));
  ok("the customer's agreement doesn't expose anyone's phone number", !/555/.test(text));
  await shot(Cu, "agreement.png");
  await go(Ow, `#/agreement/${today.id}?g=${gid}`); await Ow.waitForSelector(".agreement");
  ok("the group can open it too and sees the customer's phone (confirmed booking)", (await Ow.locator(".agreement").innerText()).includes("(312) 555-0142"));
  await Bo.goto(`${S.base}/?n=${++nav}#/agreement/${today.id}`); await Bo.waitForSelector("#app .panel.empty");
  ok("a stranger can't open someone else's agreement", (await Bo.locator("#app").innerText()).toLowerCase().includes("not found"));
  await Cu.emulateMedia({ media: "print" });
  ok("printing hides the site chrome", !(await Cu.locator(".top").isVisible()));
} catch (e) {
  failed++; console.log("CRASH", e.message.split("\n").slice(0, 6).join(" | "));
}
console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors, no CSP violations, no missing translations");
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close();
process.exit(failed || problems.length ? 1 : 0);
