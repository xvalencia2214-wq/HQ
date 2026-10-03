// Browser end-to-end for vendor tools: Pro, referral link, free website, license upload + admin approval, earnings,
// calendar sync, weather policy, WhatsApp setting, review photos, partner link sign-up, quotes for tents.
//   NODE_PATH=$(npm root -g) node e2e/e2e12.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup, bookingBody } from "../test/helpers.js";
import { png } from "./png.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const d = inDays(18);
const icsSrv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/calendar" }); res.end(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${d.replace(/-/g, "")}\r\nSUMMARY:Busy\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`); });
await new Promise((r) => icsSrv.listen(0, r));
const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss@example.com", ICS_ALLOW_HTTP: "1", TWILIO_WHATSAPP_FROM: "+15550002222" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let step = 0, failed = 0, nav = 0;
const ok = (name, cond) => { step++; if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";
const TMP = fs.mkdtempSync(path.join(S.dir, "files-"));
const pdfFile = path.join(TMP, "insurance.pdf"); fs.writeFileSync(pdfFile, "%PDF-1.4\n% certificate of insurance\n");
const photoFile = path.join(TMP, "party.png"); fs.writeFileSync(photoFile, png(320, 240, [200, 80, 60]));

async function person(label, viewport = { width: 1000, height: 1100 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::|Failed to fetch|Connection problem/.test(x)) problems.push(`${label} console: ${x}`); if (/missing translation/.test(x)) problems.push(`${label} i18n: ${x}`); });
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++nav}${hash}`);
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); };
const text = (p) => p.locator("body").innerText();

try {
  const vo = client(S.base), cust = client(S.base), boss = client(S.base);
  await vo.signup("vendor@example.com", "Vera Vendor"); await cust.signup("rosa@example.com", "Rosa Martinez"); await boss.signup("boss@example.com", "The Boss");
  const gid = await makeGroup(vo, { name: "Mariachi Pro", dates: [d, inDays(19), inDays(20)] });

  // ---- Payments tab: Pro, referral link, website, documents, earnings ----
  const V = await person("vendor");
  await login(V, "vendor@example.com");
  await go(V, `#/dashboard?g=${gid}&tab=payments`); await V.waitForSelector("#buypro");
  ok("the vendor sees its current fee and the Pro offer", /Your fee right now: 10%/.test(await text(V)) && /6% platform fee instead of 10%/.test(await text(V)));
  await V.click("#buypro"); await V.waitForURL(/#\/pay\/pro\//); await V.waitForSelector("#paybtn");
  await V.click("#paybtn"); await V.waitForURL(/tab=payments/); await V.waitForSelector("#buypro");
  ok("after paying, Pro is active and the fee is 6%", /Pro until/.test(await text(V)) && /Your fee right now: 6%/.test(await text(V)));
  ok("the referral link is shown", /ref=[A-Z0-9x]+/.test(await V.inputValue("#reflink")));
  ok("the free website link is shown", (await V.inputValue("#sitelink")).endsWith(`/v/${gid}`));
  await V.setInputFiles("#doc-file", pdfFile);
  await V.waitForFunction(() => /Being checked/.test(document.body.innerText));
  ok("uploading the insurance shows it as being checked", true);
  await shot(V, "vendor-payments.png");

  // ---- the website page ----
  const W = await person("visitor", { width: 430, height: 900 });
  await W.goto(`${S.base}/v/${gid}`); await W.waitForSelector(".site-hero");
  ok("the website page shows the name, the Pro badge and a book button", /Mariachi Pro/.test(await text(W)) && /★ Pro/.test(await text(W)) && (await W.locator("a.btn", { hasText: "See dates" }).count()) === 1);
  await shot(W, "website-phone.png");

  // ---- the site owner approves the insurance; the badge appears ----
  const A = await person("admin");
  await login(A, "boss@example.com");
  await go(A, "#/admin"); await A.waitForSelector("[data-docok]");
  await A.click("[data-docok]"); await A.waitForFunction(() => /Nothing waiting/.test(document.getElementById("docs").innerText));
  await go(W, `#/group/${gid}`); await W.waitForSelector(".meta");
  ok("the group page shows Insured and Pro after approval", /Insured/.test(await text(W)) && /★ Pro/.test(await text(W)));

  // ---- calendar sync blocks a day ----
  await go(V, `#/dashboard?g=${gid}&tab=calendar`); await V.waitForSelector("#calimp");
  await V.fill("#cal-url", `http://127.0.0.1:${icsSrv.address().port}/me.ics`); await V.click("#calimp button[type=submit]");
  await V.waitForFunction(() => /Working: 1 busy day/.test(document.body.innerText), null, { timeout: 10000 });
  ok("connecting a calendar blocks the busy day", (await (await fetch(`${S.base}/api/groups/${gid}/availability?month=${d.slice(0, 7)}`)).json()).days[d] === undefined);
  await V.click("#cal-new"); await V.waitForSelector("#cal-feed");
  ok("a private calendar feed link can be made", /\/api\/cal\/[\w-]+\.ics$/.test(await V.inputValue("#cal-feed")));

  // ---- weather policy ----
  await go(V, `#/dashboard?g=${gid}&tab=listing`); await V.waitForSelector("#l-wp");
  await V.fill("#l-wp", "If it rains we play under your tent or move inside."); await V.click("#lform button[type=submit]");
  await V.waitForTimeout(400);
  await go(W, `#/group/${gid}`); await W.waitForSelector(".meta");
  ok("the weather policy shows on the group page", /If it rains we play under your tent/.test(await text(W)));

  // ---- WhatsApp setting ----
  const R = await person("rosa");
  await login(R, "rosa@example.com");
  await go(R, "#/account"); await R.waitForSelector("fieldset.chan");
  await R.check("input[name=channel][value=whatsapp]"); await R.click("#pform button[type=submit]"); await R.waitForTimeout(800);
  const me = await cust.get("/api/me");
  ok("the customer can choose WhatsApp for alerts, and it stays chosen", me.json.user.notify_channel === "whatsapp" && await R.isChecked("input[name=channel][value=whatsapp]"));

  // ---- review with a photo after the event ----
  const bk = (await cust.post("/api/bookings", bookingBody(gid, inDays(19)))).json.booking;
  await cust.post(`/api/bookings/${bk.id}/simulate-pay`); await vo.patch(`/api/bookings/${bk.id}`, { action: "accept" });
  S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-2), bk.id);
  await go(R, "#/bookings"); await R.waitForSelector(`[data-review="${bk.id}"]`);
  await R.click(`[data-review="${bk.id}"]`); await R.waitForSelector(".review-form form");
  await R.fill(".review-form textarea", "¡Cantaron hermoso!"); await R.setInputFiles(".review-form input[type=file]", photoFile);
  await R.click(".review-form button[type=submit]"); await R.waitForFunction(() => !document.querySelector(".review-form form"));
  await go(W, `#/group/${gid}`); await W.waitForSelector(".rphotos img");
  ok("the review shows its photo on the group page", (await W.locator(".rphotos img").count()) === 1);

  // ---- earnings ----
  await go(V, `#/dashboard?g=${gid}&tab=payments`); await V.waitForSelector("table.earn");
  ok("the earnings table counts the event", /Total/.test(await V.locator("table.earn").innerText()) && (await V.locator("table.earn tfoot td").first().innerText()) === "1");
  const [dl] = await Promise.all([V.waitForEvent("download"), V.click("text=Download CSV")]);
  ok("the earnings CSV downloads", /earnings-\d{4}\.csv/.test(dl.suggestedFilename()));

  // ---- a partner link and a referral sign-up ----
  const refUrl = (await vo.get("/api/my/referral")).json.url;
  const N = await person("newvendor");
  await N.goto(`${S.base}/?src=iglesia-san-pio${refUrl.slice(refUrl.indexOf("#"))}`); await N.waitForSelector("#authform");
  await N.fill("#a-name", "Tacos Nuevos"); await N.fill("#a-email", "nuevo@example.com"); await N.fill("#a-pw", PW);
  await N.click("#authform button[type=submit]"); await N.waitForFunction(() => location.hash.startsWith("#/dashboard"));
  const nu = S.db.get("SELECT referred_by, signup_source FROM users WHERE email = 'nuevo@example.com'");
  ok("the sign-up records the partner and the vendor who referred them", nu.signup_source === "iglesia-san-pio" && nu.referred_by === S.db.get("SELECT id FROM users WHERE email = 'vendor@example.com'").id);
  await go(A, "#/admin"); await A.waitForSelector("#srcform");
  ok("the admin page counts sign-ups by partner", /iglesia-san-pio/.test(await text(A)));

  // ---- quotes for tents ----
  await go(R, "#/quotes"); await R.waitForSelector("#rqcats .catchip");
  await R.click('#rqcats .catchip:has-text("Rentals")');
  ok("Get quotes can be for rentals", (await R.locator("#rqcats .catchip.on").innerText()).includes("Rentals"));

  ok("no JavaScript or console errors", problems.length === 0);
  if (problems.length) console.log(problems.slice(0, 8).join("\n"));
} catch (e) { failed++; console.log("CRASH", e.stack.split("\n").slice(0, 3).join("\n")); }
console.log(failed ? `${failed} FAILED` : `all ${step} checks passed`);
await browser.close(); await S.close(); icsSrv.close();
process.exit(failed ? 1 : 0);
