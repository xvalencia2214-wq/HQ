// Browser end-to-end for Mi Oficina, the owner's AI office (test mode, no key): only the owner sees it (menu, Admin
// link, the page); the five rooms around the shared memory; Run now (working, then a report); drafts: edit and approve a
// vendor email (it is emailed, as edited), approve a post (ready to copy), reject, done; owner notes in the memory;
// the chat; vendor text never becomes page code; the phone layout.
//   NODE_PATH=$(npm root -g) node e2e/e2e21.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss21@example.com" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = [];
let failed = 0;
const ok = (name, cond) => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const PW = "correct horse battery";
async function person(label, viewport = { width: 1180, height: 820 }, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && viewport.width < 500 });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on("console", (m) => { const x = m.text(); if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(x)) problems.push(`${label} console: ${x}`); });
  p.on("dialog", (d) => d.accept());
  return p;
}
const login = async (p, email) => { await p.goto(S.base + "/#/login"); await p.waitForSelector("#authform"); await p.fill("#a-email", email); await p.fill("#a-pw", PW); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); };
const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n), fullPage: true });
const until = async (fn, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

try {
  const boss = client(S.base), o = client(S.base), o2 = client(S.base);
  await boss.signup("boss21@example.com", "Boss");
  await o.signup("o21@example.com", "Dueño Veintiuno");
  await o2.signup("o21b@example.com", "Otro Dueño");
  const evil = `Los <img src=x onerror="window.__pwned=1"> Bad`;
  const gid = await makeGroup(o, { name: "Mariachi Oficina", dates: [inDays(20)] });
  const g2 = await makeGroup(o2, { name: evil, dates: [inDays(25)] });
  S.db.run("UPDATE groups SET story = '' WHERE id IN (?, ?)", gid, g2); // both need a nudge from Vendor quality

  // ---- a vendor doesn't see it ----
  const V = await person("vendor");
  await login(V, "o21@example.com");
  await V.click("#navtoggle");
  ok("a vendor's menu has no Mi Oficina", (await V.locator('#nav a[data-r="office"]').count()) === 0);
  await V.goto(S.base + "/#/office"); await V.waitForSelector(".panel.empty");
  ok("and the page says Not found", (await V.locator(".panel.empty").innerText()).includes("Not found"));

  // ---- the owner ----
  const B = await person("owner");
  await login(B, "boss21@example.com");
  ok("the owner's menu has Mi Oficina", (await B.locator('#nav a[data-r="office"]').count()) === 1);
  await B.goto(S.base + "/#/admin"); await B.waitForSelector('a[href="#/office"].btn');
  await B.click('a[href="#/office"].btn'); await B.waitForSelector(".of-floor");
  ok("the office: six rooms and the shared memory", (await B.locator(".of-room").count()) === 6 && (await B.locator(".of-brain").count()) === 1);
  ok("the memory runs across the middle", await B.evaluate(() => { const b = document.querySelector(".of-brain").getBoundingClientRect(), r = [...document.querySelectorAll(".of-room")].map((x) => x.getBoundingClientRect()); return r.slice(0, 3).every((x) => x.bottom <= b.top + 1) && r.slice(3).every((x) => x.top >= b.bottom - 1) && b.width > r[0].width * 2.5; }));
  ok("Don Chuy steps aside here (the office has its own chat)", await B.locator("#chuyfab").isHidden());
  ok("it says nothing goes out without the owner", (await B.locator(".lead").innerText()).includes("nothing goes out until you approve it"));
  ok("test mode is explained", (await B.locator(".note").innerText()).includes("Test mode"));
  const wide = await B.locator(".of-room").evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect().top));
  ok("three rooms per row on a wide screen", new Set(wide.map(Math.round)).size === 2);
  await shot(B, "office-wide.png");

  // Vendor quality: run, report, two drafts
  await B.click('.of-room[data-desk="quality"]');
  ok("tapping a room opens its desk", (await B.locator("#ofpanel h2").innerText()).includes("Vendor quality"));
  await B.click("#ofrun");
  ok("the desk writes its report", await until(async () => (await B.locator(".of-report").count()) === 1 && (await B.locator(".of-report").innerText()).includes("Vendors who need a nudge")));
  ok("its light says the report is ready", (await B.locator('.of-room[data-desk="quality"] .of-light').innerText()).includes("Report ready"));
  ok("and the badge counts its drafts", (await B.locator('.of-room[data-desk="quality"] .of-badge [aria-hidden]').innerText()) === "2");
  ok("vendor text stays text", !(await B.evaluate(() => window.__pwned)) && (await B.locator("#ofpanel img").count()) === 0 && (await B.locator("#ofpanel").innerText()).includes("<img"));
  await shot(B, "office-quality.png");

  // edit one and send it
  const card = B.locator(".of-draft", { hasText: "Mariachi Oficina" });
  await card.locator(".of-body").fill("Hola Mariachi Oficina:\nAgregue su historia, por favor.\n— Bella's Fiestas");
  await card.locator('[data-act="approve"]').click();
  ok("approving sends it", await until(async () => (await B.locator("#toast").innerText()).includes("Sent")));
  const mail = S.db.get("SELECT * FROM email_log WHERE kind = 'office.message' ORDER BY id DESC LIMIT 1");
  ok("the vendor gets the edited email", mail && mail.to_email === "o21@example.com" && mail.body.includes("Agregue su historia"));
  ok("the badge goes down", (await B.locator('.of-room[data-desk="quality"] .of-badge [aria-hidden]').innerText()) === "1");
  await B.locator(".of-draft").first().locator('[data-act="reject"]').click();
  ok("reject removes the other", await until(async () => (await B.locator(".of-draft").count()) === 0 && (await B.locator('.of-room[data-desk="quality"] .of-badge').count()) === 0));
  ok("and nothing else was emailed", S.db.get("SELECT COUNT(*) c FROM email_log WHERE kind = 'office.message'").c === 1);
  ok("every decision is in the admin log", S.db.get("SELECT COUNT(*) c FROM admin_log WHERE action LIKE 'office %'").c === 1);

  // Social media: a post is approved, then ready to copy, then done
  await B.click('.of-room[data-desk="social"]'); await B.click("#ofrun");
  ok("the social desk drafts welcome posts", await until(async () => (await B.locator(".of-draft").count()) === 2));
  await B.locator(".of-draft").first().locator('[data-act="approve"]').click();
  ok("an approved post is ready to copy", await until(async () => (await B.locator(".of-draft .badge", { hasText: "ready to copy" }).count()) === 1));
  await B.locator(".of-draft", { hasText: "ready to copy" }).locator('[data-act="done"]').click();
  ok("done removes it", await until(async () => (await B.locator(".of-draft").count()) === 1));

  // Money & taxes
  await B.click('.of-room[data-desk="money"]'); await B.click("#ofrun");
  ok("the money desk reports earnings and a tax set-aside", await until(async () => (await B.locator(".of-report").count()) === 1 && /This year so far[\s\S]*Set aside for taxes/.test(await B.locator(".of-report").innerText())));
  const csvHref = await B.locator("#ofcsv").getAttribute("href");
  ok("with a spreadsheet for the accountant", /^\/api\/admin\/office\/money\.csv\?year=\d{4}$/.test(csvHref || ""));
  const csv = await B.evaluate(async (h) => { const r = await fetch(h); return { s: r.status, t: await r.text() }; }, csvHref);
  ok("that downloads", csv.s === 200 && csv.t.startsWith("month,income,"));
  await shot(B, "office-money.png");

  // the shared memory
  await B.click(".of-brain");
  await B.fill("#ofmemtext", "Focus on Cicero this month"); await B.click("#ofmem button");
  ok("the owner's note is saved and shown first", await until(async () => (await B.locator(".of-mem li").first().innerText()).includes("Focus on Cicero")));
  await B.locator(".of-mem li").first().locator("[data-forget]").click();
  ok("and can be deleted", await until(async () => (await B.locator(".of-mem li", { hasText: "Cicero" }).count()) === 0));

  // the chat
  await B.fill("#ofq", "How did we do this week?"); await B.press("#ofq", "Enter");
  ok("the office answers (test mode)", await until(async () => (await B.locator(".of-msg.assistant").count()) === 1 && (await B.locator(".of-msg.assistant").innerText()).includes("Test mode")));
  await shot(B, "office-chat.png");
  await B.click("#navtoggle"); await B.click('#nav a[data-r="admin"]'); await B.waitForSelector(".hero-fig");
  ok("Don Chuy is back on the other screens", await until(async () => B.locator("#chuyfab").isVisible()));

  // the phone
  const P = await person("phone", { width: 390, height: 844 }, true);
  await login(P, "boss21@example.com");
  await P.goto(S.base + "/#/office"); await P.waitForSelector(".of-floor");
  const cols = await P.locator(".of-room").evaluateAll((rs) => new Set(rs.map((r) => Math.round(r.getBoundingClientRect().left))).size);
  ok("two rooms per row on a phone", cols === 2);
  ok("the memory sits on top", await P.evaluate(() => document.querySelector(".of-brain").getBoundingClientRect().top < document.querySelector(".of-room").getBoundingClientRect().top));
  ok("no sideways scrolling", await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await P.click('.of-room[data-desk="briefing"]'); await P.click("#ofrun");
  ok("the briefing works on the phone", await until(async () => (await P.locator(".of-report").count()) === 1 && (await P.locator(".of-report").innerText()).includes("Users:")));
  await shot(P, "office-phone.png");
} catch (e) { failed++; console.log("FAIL crashed: " + (e.stack || e)); }
finally {
  ok("no page errors", problems.length === 0); if (problems.length) console.log(problems.join("\n"));
  await browser.close(); await S.close();
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}
