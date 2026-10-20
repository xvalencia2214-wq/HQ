// Security sweep for cross-site scripting: puts booby-trapped text in every field a person can type (names, listings,
// packages, messages, reviews, replies, party plans, guest lists, comments, quote requests, saved lists), then opens every
// screen as a customer, a vendor, the owner (Admin) and a family member with a shared link. A screen fails if the text
// became real page code instead of plain text: an element with class "xss-probe", or an attribute it broke out of.
// The strict CSP would block a script anyway; this checks the screens escape everything in the first place.
//   NODE_PATH=$(npm root -g) node e2e/xss.mjs
import { createRequire } from "node:module";
import { startApp, client, inDays, makeGroup, bookingBody } from "../test/helpers.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const P = (tag) => `${tag}"><b class="xss-probe" data-xss="1">x</b><img src=x class=xss-probe>'`;
const SHORT = (tag) => `${tag}"><b class=xss-probe>x</b>'`; // for fields capped at 60 characters
const S = await startApp({ ADMIN_EMAILS: "boss@xss.test", DEMO_SEED: "0", WEATHER: "0", PAST_REVIEW_IP_CHECK: "0" });
const refused = [];
const tryCall = async (label, p) => { const r = await p; if (r.status >= 400) refused.push(`${label}: ${r.status} ${r.json && r.json.error}`); return r; };
let failed = 0;
const ok = (name, cond) => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };

try {
  const owner = client(S.base), fam = client(S.base), boss = client(S.base);
  await owner.signup("owner@xss.test", P("Vendor"), { phone: "312-555-0111" });
  await fam.signup("fam@xss.test", P("Family"), { phone: "312-555-0142" });
  await boss.signup("boss@xss.test", "Boss");
  const gid = await makeGroup(owner, { name: P("Grupo").slice(0, 80), dates: [inDays(20), inDays(21), inDays(22)] });
  await tryCall("story", owner.patch(`/api/groups/${gid}`, { story: P("Story ") + " Eight musicians who play every weekend in Pilsen and love it.", songs: [SHORT("Song")], weather_policy: P("Weather") }));
  await tryCall("package", owner.post(`/api/groups/${gid}/packages`, { name: P("Pkg").slice(0, 60), description: P("Desc"), hours: 2, price: 500 }));
  await tryCall("addon", owner.post(`/api/groups/${gid}/addons`, { name: P("Addon").slice(0, 60), price: 50 }));
  // a booking with a message, paid and accepted; then a past one with a review and a reply
  const b = (await tryCall("booking", fam.post("/api/bookings", bookingBody(gid, inDays(20), { message: P("Booking msg"), name: P("Contact") })))).json.booking;
  if (b) { await fam.post(`/api/bookings/${b.id}/simulate-pay`); await owner.patch(`/api/bookings/${b.id}`, { action: "accept" }); }
  const past = (await tryCall("past booking", fam.post("/api/bookings", bookingBody(gid, inDays(21), { event: "Birthday" })))).json.booking;
  if (past) {
    await fam.post(`/api/bookings/${past.id}/simulate-pay`); await owner.patch(`/api/bookings/${past.id}`, { action: "accept" });
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-5), past.id);
    const rv = await tryCall("review", fam.post(`/api/bookings/${past.id}/review`, { rating: 5, text: P("Review") + " They were wonderful all night long." }));
    const rid = S.db.get("SELECT id FROM reviews WHERE booking_id = ?", past.id);
    if (rv.status < 400 && rid) await tryCall("reply", owner.post(`/api/reviews/${rid.id}/reply`, { text: P("Reply") }));
  }
  await tryCall("message", fam.post(`/api/groups/${gid}/messages`, { text: P("Chat") }));
  const cid = (await owner.get(`/api/groups/${gid}/threads`)).json.threads?.[0]?.customer_id;
  if (cid) await tryCall("vendor message", owner.post(`/api/groups/${gid}/threads/${cid}`, { text: P("Answer") }));
  await tryCall("quote request", fam.post("/api/requests", { event: "Wedding", date: inDays(22), guests: 80, hours: 3, zip: "60608", note: P("Note") }));
  await fam.post(`/api/favorites/${gid}`, {});
  await tryCall("shortlist", fam.post("/api/shortlists", { title: SHORT("List") }));
  const party = (await tryCall("party", fam.post("/api/parties", { title: P("Party").slice(0, 80), event: "Quinceañera", date: inDays(30), zip: "60608", guests: 100 }))).json;
  const pid = party && (party.id || party.party?.id);
  let fpToken = "";
  if (pid) {
    await tryCall("guests", fam.post(`/api/parties/${pid}/guests`, { lines: `${SHORT("Guest")}, 2\nPrima Ana` }));
    await tryCall("party comment", fam.post(`/api/parties/${pid}/comments`, { name: P("Tía").slice(0, 40), text: P("Comment") }));
    const sh = await fam.post(`/api/parties/${pid}/share`);
    fpToken = sh.json && (sh.json.token || String(sh.json.url || "").split("/").pop());
    if (fpToken) await tryCall("family comment", client(S.base).post(`/api/fp/${fpToken}/comments`, { name: P("Primo").slice(0, 40), text: P("FamComment") }));
  }
  console.log("refused by the server (safe):", refused.length ? "\n  " + refused.join("\n  ") : "none");

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const bad = [], shown = [];
  async function sweep(who, email, routes) {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.route("**/tile.openstreetmap.org/**", (r) => r.abort());
    const p = await ctx.newPage();
    p.on("dialog", (d) => { bad.push(`${who}: a dialog opened (${d.message()})`); d.dismiss(); });
    if (email) { await p.goto(S.base + "/#/login"); await p.fill("#a-email", email); await p.fill("#a-pw", "correct horse battery"); await p.click("#authform button[type=submit]"); await p.waitForFunction(() => !location.hash.startsWith("#/login")); }
    for (const [i, r] of routes.entries()) {
      await p.goto(`${S.base}/?x=${i}${r}`); await p.waitForTimeout(700);
      // open every tab and disclosure on the screen too, so hidden parts are rendered
      for (const s of await p.$$("details:not([open]) > summary")) await s.click().catch(() => {});
      const hit = await p.evaluate(() => document.querySelectorAll(".xss-probe, [data-xss]").length);
      if (hit) bad.push(`${who} ${r}: ${hit} injected element(s)`);
      if (await p.evaluate(() => /class="?xss-probe/.test(document.body.innerText))) shown.push(`${who} ${r}`);
    }
    await ctx.close();
  }
  const g = `#/group/${gid}`, d = (tab) => `#/dashboard?g=${gid}&tab=${tab}`;
  await sweep("visitor", "", ["#/", "#/?zip=60608", "#/?zip=60608&q=Grupo", "#/chicago", "#/discover", "#/best/60608", g, "#/quotes", "#/signup"]);
  await sweep("family", "fam@xss.test", ["#/?zip=60608", g, "#/saved", "#/bookings", b ? `#/booking/${b.id}` : "#/bookings", past ? `#/booking/${past.id}` : "#/bookings", "#/messages", `#/messages?g=${gid}`, "#/quotes", "#/account", "#/party", pid ? `#/my-party/${pid}` : "#/party", b ? `#/agreement/${b.id}` : "#/"]);
  await sweep("vendor", "owner@xss.test", ["#/dashboard", d("requests"), d("calendar"), d("listing"), d("extras"), d("business"), d("media"), d("reviews"), d("payments"), d("messages"), g, "#/account"]);
  // Mi Oficina: every desk works (test mode), so its reports and drafts carry the vendors' and families' text; plus an owner note
  for (const desk of S.ctx.office.deskIds) await S.ctx.office.runDesk(desk);
  S.ctx.office.remember("owner", P("Note"));
  await sweep("owner (Admin)", "boss@xss.test", ["#/admin", g, "#/office", ...S.ctx.office.deskIds.map((k) => `#/office?desk=${k}`), "#/office?desk=memory"]);
  if (fpToken) await sweep("family link", "", [`#/fp/${fpToken}`]);
  // the server-made pages: share card, vendor web page, Spanish Google page
  for (const path of [`/g/${gid}`, `/v/${gid}`, "/es/", "/chicago"]) {
    const r = await fetch(S.base + path); if (r.status !== 200) continue;
    const html = await r.text();
    // escaped text shows as &lt;b ... &quot; — only a raw tag or a raw attribute means the payload got through
    if (/<b class="?xss-probe|<img src=x class=xss-probe|[^;]data-xss="1"/.test(html)) bad.push(`server page ${path}: payload not escaped`);
  }
  await browser.close();
  console.log(`the test text showed up, safely as plain text, on ${shown.length} screens`);
  ok("the sweep really reached the screens (the test text is visible as plain text on most of them)", shown.length >= 20);
  ok(`no screen turned typed text into page code (${bad.length ? bad.join("; ") : "all clean"})`, bad.length === 0);
} catch (e) { failed++; console.log("FAIL crashed:", e.stack || e.message); }
finally { await S.close(); }
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
