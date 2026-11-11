// Browser check for the November 2026 lift: artwork on listings without photos, a listing shown in the reader's
// language with the original one tap away, Show / Hide on password boxes and the hint after a wrong login, a login that
// forgives a stray space, Don Chuy's button shrinking while scrolling, and the fitting questions for alterations.
//   NODE_PATH=$(npm root -g) node e2e/e2e24.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { startApp, client } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] || "";
if (out) fs.mkdirSync(out, { recursive: true });

// a stand-in for Anthropic's API that answers with the translation we script
const script = [];
const fake = http.createServer(async (req, res) => {
  for await (const _ of req) { /* read the body */ }
  const next = script.shift() || { stop_reason: "end_turn", content: [{ type: "text", text: "nonsense" }] };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_details: null, usage: { input_tokens: 100, output_tokens: 50 }, ...next }));
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const S = await startApp({ WEATHER: "0", AI_TRANSLATE: "1", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = []; let failed = 0, n = 0;
const ok = (name, c) => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"} ${name}`); };
async function phone(lang) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await ctx.addInitScript((l) => { try { localStorage.setItem("bm_lang", l); } catch { /* storage blocked */ } }, lang);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${lang} pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::/.test(m.text())) problems.push(`${lang} console: ${m.text()}`); });
  return p;
}
const go = (p, hash) => p.goto(`${S.base}/?n=${++n}${hash}`);
const shot = (p, name) => (out ? p.screenshot({ path: path.join(out, name) }) : null);

try {
  // the sample mariachi's story is in English: translate it to Spanish the way the server would
  const gid = "los-gallos-de-oro";
  const pk = S.db.get("SELECT id FROM packages WHERE group_id = ? ORDER BY id LIMIT 1", gid);
  script.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ source_lang: "en", story: "Empezamos en 2011, cuando tres primos tocaban por propinas en la calle 26. Hoy toda la familia toca en bodas y quinceañeras.", packages: pk ? [{ id: pk.id, name: "Serenata corta", description: "3 canciones, unos 20 minutos" }] : [] }) }] });
  ok("the listing was translated", (await S.ctx.translate.ensure(gid)) === "translated");

  // ---- Spanish reader ----
  const ES = await phone("es");
  await go(ES, "#/?zip=60608"); await ES.waitForSelector("#results .card");
  ok("cards without a photo show artwork for their kind of business", (await ES.locator("#results .card .photo.art .art-i").count()) > 0 && (await ES.locator('#results .card .photo img[src="logo.svg"]').count()) === 0);
  ok("the card shows the story in Spanish", /Empezamos en 2011/.test(await ES.locator("#results").innerText()));
  ok("the Help button is full size at the top of the page", !(await ES.locator("#chuyfab").evaluate((e) => e.classList.contains("mini"))));
  await ES.evaluate(() => window.scrollTo(0, 600)); await ES.waitForFunction(() => document.getElementById("chuyfab").classList.contains("mini"));
  await ES.waitForTimeout(450); // the button eases to its small size
  const box = await ES.locator("#chuyfab").boundingBox();
  ok("and shrinks to a round button while scrolling (still easy to tap)", box.width <= 60 && box.width >= 44 && box.height >= 44);
  await shot(ES, "1-cards-es.png");
  await ES.evaluate(() => window.scrollTo(0, 0)); await ES.waitForFunction(() => !document.getElementById("chuyfab").classList.contains("mini"));
  ok("and comes back at the top", true);

  await go(ES, `#/group/${gid}`); await ES.waitForSelector("#g-story");
  ok("the vendor page shows the story in Spanish, marked as a translation", /Empezamos en 2011/.test(await ES.locator("#g-story").innerText()) && /Traducido automáticamente del inglés/.test(await ES.locator(".trnote").innerText()));
  ok("a page without photos shows wide artwork", (await ES.locator(".gp .photo.art").count()) === 1);
  if (pk) ok("the package is in Spanish too", /Serenata corta/.test(await ES.locator(".pkgs").innerText()) && /3 canciones/.test(await ES.locator(".pkgs").innerText()));
  await shot(ES, "2-vendor-es.png");
  await ES.click("#tr-toggle");
  ok("one tap shows the vendor's own words", /Started in 2011/.test(await ES.locator("#g-story").innerText()) && /Ver la traducción/.test(await ES.locator("#tr-toggle").innerText()) && (await ES.locator("#tr-toggle").getAttribute("aria-pressed")) === "true");
  await ES.click("#tr-toggle");
  ok("and one more brings the translation back", /Empezamos en 2011/.test(await ES.locator("#g-story").innerText()) && /Ver el original/.test(await ES.locator("#tr-toggle").innerText()));

  // ---- English reader: the original, no note ----
  const EN = await phone("en");
  await go(EN, `#/group/${gid}`); await EN.waitForSelector("#g-story");
  ok("an English reader sees the original with no translation note", /Started in 2011/.test(await EN.locator("#g-story").innerText()) && (await EN.locator(".trnote").count()) === 0);

  // ---- passwords ----
  await client(S.base).signup("eye24@example.com", "Ana Ojo");
  await go(EN, "#/login"); await EN.waitForSelector("#authform .pweye");
  await EN.fill("#a-email", "eye24@example.com"); await EN.fill("#a-pw", "Correct horse battery");
  ok("the password box has a Show button", (await EN.locator("#authform .pweye").innerText()) === "Show" && (await EN.locator("#a-pw").getAttribute("type")) === "password");
  await EN.click("#authform .pweye");
  ok("Show reveals what was typed, and the button becomes Hide", (await EN.locator("#a-pw").getAttribute("type")) === "text" && (await EN.locator("#a-pw").inputValue()) === "Correct horse battery" && (await EN.locator("#authform .pweye").innerText()) === "Hide");
  await EN.click("#authform button[type=submit]"); await EN.waitForFunction(() => document.getElementById("autherr").textContent.length > 0);
  ok("a wrong password says what to check", /Wrong email or password/.test(await EN.locator("#autherr").innerText()) && /capital letter or an extra space/.test(await EN.locator("#autherr").innerText()));
  await shot(EN, "3-login.png");
  await EN.fill("#a-pw", "correct horse battery "); await EN.click("#authform button[type=submit]");
  await EN.waitForFunction(() => !location.hash.startsWith("#/login"));
  ok("a stray space at the end still logs in", true);

  // ---- alterations: a fitting, not a party ----
  await go(EN, "#/group/aguja-de-oro-arreglos"); await EN.waitForSelector("#calbox .day.open");
  ok("an alterations page doesn't talk about guests", !/Best for/.test(await EN.locator(".facts").innerText()));
  await EN.locator("#calbox .day.open").first().click(); await EN.locator("#slotbox .slot").first().click(); await EN.waitForSelector("#bookform");
  const form = await EN.locator("#bookform").innerText();
  ok("the form asks about the fitting", /How many dresses or suits\?/.test(form) && /Your ZIP code/.test(form) && /Where is the fitting\?/.test(form) && /What needs to be done\?/.test(form));
  ok("with sensible answers already filled in", (await EN.locator("#b-guests").inputValue()) === "1" && (await EN.locator("#b-addr").inputValue()) === "At the shop");
  ok("and no weekly repeat", !(await EN.locator("#b-weeks").isVisible()));
  const over = await EN.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok("no sideways scroll on a phone", over <= 0);
  await shot(EN, "4-fitting.png");
  // a mariachi still gets the party questions
  await go(EN, `#/group/${gid}`); await EN.waitForSelector("#calbox .day.open");
  await EN.locator("#calbox .day.open").first().click(); await EN.locator("#slotbox .slot").first().click(); await EN.waitForSelector("#bookform");
  ok("a music booking still asks about guests and the party's place", /Guests/.test(await EN.locator("#bookform").innerText()) && (await EN.locator("#b-weeks").isVisible()) && (await EN.locator("#b-addr").inputValue()) === "");

  ok("no page errors", problems.length === 0); if (problems.length) console.log(problems.join("\n"));
} catch (e) { failed++; console.log("CRASH " + String(e.message).split("\n").slice(0, 4).join(" | ")); }
await browser.close(); await S.close(); fake.close();
console.log(failed ? `${failed} FAILED` : "ALL PASS"); process.exit(failed ? 1 : 0);
