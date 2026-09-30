import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup } from "./helpers.js";
import { MARKET, inMarket } from "../server/market.js";
import { lookupZip } from "../server/geo.js";

test("Chicago market: every quick-pick ZIP is real and inside the service area; far cities are outside", () => {
  assert.ok(MARKET.neighborhoods.length >= 12);
  for (const n of MARKET.neighborhoods) { assert.ok(lookupZip(n.zip), n.name); assert.equal(lookupZip(n.zip).state, "IL", n.name); assert.ok(inMarket(n.zip), `${n.name} ${n.zip} should be in the market`); }
  assert.equal(new Set(MARKET.neighborhoods.map((n) => n.id)).size, MARKET.neighborhoods.length);
  for (const z of ["77003", "90022", "85003", "10001", "53202" /* Milwaukee */]) assert.equal(inMarket(z), false, z);
  assert.equal(inMarket("00000"), false);
});

test("sample groups are all in Chicagoland, fictional-looking, badged as samples, and bookable in test mode", async () => {
  const S = await startApp();
  try {
    const c = client(S.base);
    const rows = S.db.all("SELECT id, zip, demo, hidden FROM groups WHERE demo = 1");
    assert.ok(rows.length >= 12);
    for (const r of rows) { assert.ok(inMarket(r.zip), `${r.id} (${r.zip}) is outside Chicagoland`); assert.equal(r.hidden, 0); }
    const all = (await c.get("/api/search?zip=60608&radius=60&limit=50")).json;
    assert.equal(all.in_market, true); assert.ok(all.results.length >= 12); assert.ok(all.results.every((g) => g.demo));
    const types = new Set(all.results.map((g) => g.type)); for (const t of ["Mariachi", "Banda", "Norteño", "Trío romántico", "DJ"]) assert.ok(types.has(t), t);
    for (const n of MARKET.neighborhoods) assert.ok((await c.get(`/api/search?zip=${n.zip}&radius=25`)).json.results.length >= 1, `nobody near ${n.name}`); // no dead neighborhoods
    const far = (await c.get("/api/search?zip=77003")).json; assert.equal(far.in_market, false); assert.equal(far.results.length, 0); // Houston: nothing yet
    const meta = (await c.get("/api/meta")).json; assert.equal(meta.market.name, "Chicago"); assert.equal(meta.market.neighborhoods.length, MARKET.neighborhoods.length);
  } finally { await S.close(); }
});

test("retired sample groups from an older database are removed, or hidden if anyone used them", async () => {
  const S = await startApp();
  try {
    const { seedDemo } = await import("../server/seed.js");
    for (const id of ["old-houston-band", "old-used-band"]) S.db.run("INSERT INTO groups (id, demo, name, type, zip, rate_cents, created_at) VALUES (?, 1, 'Old', 'Mariachi', '77003', 30000, 1)", id);
    const u = client(S.base); await u.signup("old@example.com", "Old User");
    S.db.run("INSERT INTO messages (group_id, customer_id, sender, text, created_at) VALUES ('old-used-band', (SELECT id FROM users LIMIT 1), 'customer', 'hi', 1)");
    seedDemo(S.db);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM groups WHERE id = 'old-houston-band'").c, 0);
    assert.equal(S.db.get("SELECT hidden h FROM groups WHERE id = 'old-used-band'").h, 1);
    assert.ok(S.db.get("SELECT COUNT(*) c FROM groups WHERE demo = 1 AND hidden = 0").c >= 12);
    seedDemo(S.db); // running it twice changes nothing
    assert.equal(S.db.get("SELECT COUNT(*) c FROM groups WHERE id = 'los-gallos-de-oro'").c, 1);
  } finally { await S.close(); }
});

test("waitlist: stores one row per person and place, emails a confirmation, admin sees demand by city and a safe CSV", async () => {
  const S = await startApp({ ADMIN_EMAILS: "wl-admin@example.com" });
  try {
    const a = client(S.base), admin = client(S.base);
    await admin.signup("wl-admin@example.com", "Wl Admin");
    assert.equal((await a.post("/api/waitlist", { email: "not-an-email", zip: "77003" })).status, 400);
    assert.equal((await a.post("/api/waitlist", { email: "x@example.com", zip: "1234" })).status, 400);
    assert.equal((await a.post("/api/waitlist", { email: "x@example.com", zip: "00000" })).status, 400);
    const r = await a.post("/api/waitlist", { email: "Maria@Example.com", zip: "77003", lang: "es" });
    assert.deepEqual(r.json, { ok: true, city: "Houston", state: "TX", in_market: false });
    await a.post("/api/waitlist", { email: "maria@example.com", zip: "77003" }); // same person, same place: no duplicate row, no second email
    await a.post("/api/waitlist", { email: "maria@example.com", zip: "90022" }); // different place counts
    await a.post("/api/waitlist", { email: "=HYPERLINK(\"http://evil\",\"x\")@example.com", zip: "77003", kind: "group" }); // hostile-looking cell
    assert.equal(S.db.get("SELECT COUNT(*) c FROM waitlist WHERE zip = '77003'").c, 2);
    const mails = S.db.all("SELECT subject FROM email_log WHERE kind = 'waitlist.joined' AND to_email = 'maria@example.com'");
    assert.equal(mails.length, 2); assert.match(mails[0].subject, /Estás en la lista para Houston/); // Spanish, once per city
    const sum = (await admin.get("/api/admin/summary")).json.waitlist;
    assert.equal(sum.total, 3); assert.deepEqual(sum.by_city[0], { place: "Houston, TX", customers: 1, groups: 1 });
    assert.equal((await a.get("/api/admin/waitlist.csv")).status, 404); // not for the public
    const res = await fetch(S.base + "/api/admin/waitlist.csv", { headers: { Cookie: admin.cookie() } });
    assert.match(res.headers.get("content-type"), /text\/csv/); const csv = await res.text();
    assert.match(csv, /^email,zip,city,state,kind,language,signed_up\n/); assert.match(csv, /maria@example.com,77003,Houston,TX,customer,es,/);
    assert.doesNotMatch(csv, /(^|,)=HYPERLINK/m); // formulas are neutralised so opening it in a spreadsheet is safe
    assert.ok(S.db.get("SELECT 1 x FROM admin_log WHERE action = 'download waitlist'"));
    const rl = await startApp({ RATE_WAITLIST: "2" }); let last;
    for (let i = 0; i < 4; i++) last = await client(rl.base).post("/api/waitlist", { email: `a${i}@example.com`, zip: "77003" });
    assert.equal(last.status, 429); await rl.close();
  } finally { await S.close(); }
});

test("the Chicago landing page is server-rendered for search engines and link previews", async () => {
  const S = await startApp();
  try {
    const html = await (await fetch(S.base + "/c/chicago")).text();
    assert.match(html, /<title>Live Mexican music in Chicago/); assert.match(html, /og:title" content="Live Mexican music in Chicago/);
    assert.match(html, /<h1>Live Mexican music for your Chicago fiesta<\/h1>/); assert.match(html, /<a href="\/chicago\/pilsen">Pilsen<\/a>, <a href="\/chicago\/little-village">Little Village<\/a>/); // neighborhoods link to their own landing pages assert.match(html, /How does the deposit work\?/);
    const map = await (await fetch(S.base + "/sitemap.xml")).text(); assert.match(map, /\/c\/chicago</);
    assert.match(await (await fetch(S.base + "/c/nowhere")).text(), /og:title" content="Bella&#39;s Música/); // unknown pages fall back to the generic page
  } finally { await S.close(); }
});
