// Browser end-to-end check. Needs Playwright + Chromium (not part of `npm test`).
//   NODE_PATH=$(npm root -g) node e2e/e2e.mjs [screenshotDir]
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });

function png(w = 48, h = 48) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = 200; raw[i + 1] = 150 + x; raw[i + 2] = 40 + y; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

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
  await O.click("#fill");
  await O.waitForSelector(".day.open");
  ok("'open all weekends' opens dates and shows them", (await O.locator(".day.open").count()) >= 2);
  await O.locator(".day.open").first().click();
  await O.locator(".slot.sel").first().click(); // close one slot
  await O.waitForFunction(() => document.querySelectorAll(".slot.sel").length === 4);
  ok("manager can toggle a slot", true);
  await O.click("text=Listing"); await O.waitForSelector("#lform");
  await O.check("input[name=ev][value=Wedding]"); await O.check("input[name=sound]"); await O.fill("#l-guests", "300");
  await O.click("#lform button[type=submit]"); await O.waitForSelector("#toast:not([hidden])");
  await O.click("text=Packages & songs"); await O.waitForSelector("#pkform");
  await O.fill("#k-name", "Serenata"); await O.fill("#k-desc", "3 songs"); await O.fill("#k-h", "1"); await O.fill("#k-p", "200");
  await O.click("#pkform button[type=submit]"); await O.waitForSelector("text=Serenata");
  await O.fill("#songs", "Cielito Lindo\nEl Rey\nLas Mañanitas"); await O.click("#sform2 button[type=submit]");
  await O.waitForSelector("text=Saved");
  await O.click("text=Photos & video"); await O.waitForSelector("#file", { state: "attached" });
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
  ok("manager sees the request, phone hidden", (await O.locator(".req").innerText()).includes("Carlos Cliente") && !(await O.locator(".req").innerText()).includes("555"));
  await shot(O, "2-dashboard-requests.png");
  await O.click("[data-act=accept]"); await O.waitForSelector(".req a[href^='tel:']");
  ok("after accepting, the customer's phone is shown", (await O.locator(".req").innerText()).includes("+13125550142"));
  await O.click("text=Messages"); await O.waitForSelector(".thread");
  await O.click(".thread"); await O.waitForSelector("#rform");
  await O.fill("#rin", "Claro que si, tocamos Volver Volver"); await O.click("#rform button"); await O.waitForSelector(".msg.me");
  ok("manager can reply in the thread", (await O.locator(".msg.me").count()) === 1);

  // ---------------- customer: bookings, Spanish, cancel ----------------
  await C.goto(S.base + "/#/bookings"); await C.waitForSelector(".req");
  ok("customer sees Confirmed and the refund preview", (await C.locator(".req").innerText()).includes("Confirmed") && /get back \$/.test(await C.locator(".req").innerText()));
  await C.click("#langbtn"); await C.waitForSelector("text=Mis reservas");
  ok("Spanish toggle translates the page", (await C.locator(".req").innerText()).includes("Confirmada") && (await C.locator("#nav").innerText()).includes("Buscar música"));
  await shot(C, "3-bookings-es-phone.png");
  C.once("dialog", (d) => d.accept());
  await C.click("[data-cancel]"); await C.waitForSelector("text=Reembolsado");
  ok("cancelling refunds the deposit per policy", (await C.locator(".req").innerText()).includes("reembolsados"));
  await C.goto(S.base + `/#/group/${gid}`); await C.waitForSelector("#calbox .cal");
  await shot(C, "4-group-es-phone.png");
  await C.goto(S.base + "/#/best/60608"); await C.waitForSelector(".card");
  ok("'Lo mejor de Chicago' page lists groups", (await C.locator("h2").first().innerText()).includes("Lo mejor de Chicago"));
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
