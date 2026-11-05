// Browser check for Alterations, its own kind of vendor (dress and suit fittings): the search page's heading and chip,
// the sample listing, Spanish words, the party checklist and the welcome page, on a phone with no sideways scroll.
//   NODE_PATH=$(npm root -g) node e2e/e2e23.mjs [screenshotDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] || "";
if (out) fs.mkdirSync(out, { recursive: true });
const S = await startApp({ WEATHER: "0" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const problems = []; let failed = 0;
const ok = (n, c) => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"} ${n}`); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
const P = await ctx.newPage();
P.on("pageerror", (e) => problems.push(e.message));
P.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::/.test(m.text())) problems.push(m.text()); });
let n = 0; const go = (h) => P.goto(`${S.base}/?n=${++n}${h}`);
await go("#/?zip=60608&category=alterations"); await P.waitForSelector("#results .card, #results a", { timeout: 15000 });
await P.waitForTimeout(600);
const body = await P.locator("body").innerText();
ok("search page: its own heading", /A perfect fit for the big day/.test(body));
ok("search page: the sample seamstress", /Aguja de Oro Arreglos/.test(body));
ok("chip row has Alterations", /Alterations/.test(await P.locator(".catrow").first().innerText()));
const over = await P.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok("no sideways scroll on a phone", over <= 0);
if (out) await P.screenshot({ path: path.join(out, "1-search-en.png") });
if (out) await P.locator(".catrow").first().screenshot({ path: path.join(out, "2-chips.png") });
await P.click("#navtoggle"); await P.click("#langbtn");
await P.waitForFunction(() => document.documentElement.lang === "es");
await go("#/?zip=60608&category=alterations"); await P.waitForSelector("#results a"); await P.waitForTimeout(600);
const es = await P.locator("body").innerText();
ok("Spanish heading", /Que el vestido quede perfecto/.test(es));
ok("Spanish chip", /Arreglos y costura/.test(es));
ok("Spanish type on card", /Arreglos de vestidos/.test(es));
if (out) await P.screenshot({ path: path.join(out, "3-search-es.png") });
// the vendor page
await P.click("text=Aguja de Oro Arreglos"); await P.waitForTimeout(1200);
const gp = await P.locator("body").innerText();
ok("vendor page opens in Spanish with a package", /Vestido de quince|Quinceañera dress/.test(gp) || /\$140/.test(gp));
if (out) await P.screenshot({ path: path.join(out, "4-vendor-es.png"), fullPage: false });
// plan a party: quince checklist includes alterations
await go("#/party"); await P.waitForTimeout(1200);
const party = await P.locator("body").innerText();
ok("party checklist offers alterations", /Arreglos y costura/.test(party));
// welcome page budget chips
await go("#/welcome"); await P.waitForTimeout(1500);
ok("welcome page has the Costura chip", (await P.locator('#lp-cats .chip[data-cat="alterations"]').count()) === 1);
// a venue's virtual tour (still in Spanish): on its page with a full-screen link, as a tag on its card, and the venue's own box to add it
S.db.run("UPDATE groups SET tour_provider = 'matterport', tour_id = 'SxQL3iGyoDo' WHERE id = 'salon-los-arcos-cicero'");
await ctx.route("https://my.matterport.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>tour</p>" }));
await go("#/?zip=60804&category=venues"); await P.waitForSelector("#results a"); await P.waitForTimeout(500);
ok("venue card shows the 360° tour tag", /Recorrido 360°/.test(await P.locator("#results").innerText()));
await go("#/group/salon-los-arcos-cicero"); await P.waitForSelector("section.tour iframe");
ok("venue page shows the virtual tour", (await P.locator('section.tour iframe[src="https://my.matterport.com/show/?m=SxQL3iGyoDo"]').count()) === 1 && /Recorrido virtual/.test(await P.locator("section.tour").innerText()));
ok("with a full-screen link that opens in a new tab", (await P.locator('section.tour a[target="_blank"][href="https://my.matterport.com/show/?m=SxQL3iGyoDo"]').count()) === 1);
const hall = client(S.base); await hall.signup("hall23@example.com", "Hall Owner");
const hg = (await hall.post("/api/groups", { name: "Salón Prueba", type: "Party hall", zip: "60608", members: 2, story: "Party hall for 200 guests with a dance floor and parking." })).json.id;
await P.goto(S.base + "/#/login"); await P.waitForSelector("#authform"); await P.fill("#a-email", "hall23@example.com"); await P.fill("#a-pw", "correct horse battery"); await P.click("#authform button[type=submit]"); await P.waitForFunction(() => !location.hash.startsWith("#/login"));
await go(`#/dashboard?g=${hg}&tab=media`); await P.waitForSelector("#tform");
await P.fill("#t-url", "https://example.com/tour"); await P.click("#tform button[type=submit]"); await P.waitForFunction(() => document.getElementById("terr")?.textContent.length > 0);
ok("a wrong link explains itself in Spanish", /recorrido virtual/.test(await P.locator("#terr").innerText()));
await P.fill("#t-url", "https://my.matterport.com/show/?m=SxQL3iGyoDo"); await P.click("#tform button[type=submit]");
await P.waitForSelector('#tform ~ .video iframe[src*="matterport"], .video iframe[src*="matterport"]');
ok("the venue saves its tour and sees it in the dashboard", (await hall.get(`/api/groups/${hg}`)).json.tour?.provider === "matterport");
if (out) await P.screenshot({ path: path.join(out, "5-tour-es.png") });
ok("no page errors", problems.length === 0); if (problems.length) console.log(problems.join("\n"));
await browser.close(); await S.close();
console.log(failed ? `${failed} FAILED` : "ALL PASS"); process.exit(failed ? 1 : 0);
