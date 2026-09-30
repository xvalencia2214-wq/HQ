import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup } from "./helpers.js";

const page = async (S, p) => { const r = await fetch(S.base + p); return { status: r.status, html: await r.text(), type: r.headers.get("content-type") }; };
const ld = (html) => { const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s); return m ? JSON.parse(m[1]) : null; };

test("landing pages: real groups only, honest counts, escaped, noindex when empty, sitemap only when a real group stands behind them", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const mk = async (email, name, zip, events, extra = {}) => { const o = client(S.base); await o.signup(email, name + " Owner"); return { o, id: await makeGroup(o, { name, zip, dates: [inDays(20)], extra: { events, ...extra } }) }; };
    const pilsen = await mk("l1@example.com", "Pilsen Mariachi", "60608", ["Quinceañera", "Wedding"], { rate: 320 });
    const cicero = await mk("l2@example.com", "Cicero Banda", "60804", ["Wedding"]);
    const aurora = await mk("l3@example.com", "Aurora Norteño", "60505", ["Wedding", "Birthday"]);
    const evil = await mk("l4@example.com", "Evil <script>alert(1)</script> Band", "60608", ["Quinceañera"]);
    // not real or not live: a sample listing, a paused group, a hidden group, a draft
    const sample = await mk("l5@example.com", "Sample Fiesta Group", "60608", ["Quinceañera"]); S.db.run("UPDATE groups SET demo = 1 WHERE id = ?", sample.id);
    const paused = await mk("l6@example.com", "Paused Group", "60608", ["Quinceañera"]); await paused.o.post(`/api/groups/${paused.id}/pause`, { paused: true });
    const hidden = await mk("l7@example.com", "Hidden Group", "60608", ["Quinceañera"]); S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", hidden.id);
    const d = client(S.base); await d.signup("l8@example.com", "Draft Owner"); await makeGroup(d, { name: "Draft Group", zip: "60608", draft: true });

    // neighborhood page
    const p = await page(S, "/chicago/pilsen");
    assert.equal(p.status, 200); assert.match(p.type, /text\/html/);
    assert.match(p.html, /<title>Live mariachi, banda and norteño for your event in Pilsen, Chicago/);
    assert.match(p.html, /<h1>Live Mexican music for your event in Pilsen, Chicago<\/h1>/);
    assert.match(p.html, /<link rel="canonical" href="[^"]*\/chicago\/pilsen">/);
    assert.doesNotMatch(p.html, /noindex/);
    for (const g of [pilsen, cicero]) assert.ok(p.html.includes(`href="/g/${g.id}"`), g.id); // 0 and ~6 miles away
    assert.ok(!p.html.includes(`/g/${aurora.id}`)); // ~35 miles: outside the 20-mile circle
    for (const g of [sample, paused, hidden]) assert.ok(!p.html.includes(g.id), "not live or not real: " + g.id);
    assert.doesNotMatch(p.html, /Sample Fiesta|Paused Group|Hidden Group|Draft Group/);
    // the evil name is escaped in the page and in the JSON data
    assert.ok(!p.html.includes("<script>alert(1)</script>")); assert.match(p.html, /Evil &lt;script&gt;/);
    const data = ld(p.html); assert.equal(data["@type"], "ItemList"); assert.equal(data.itemListElement.length, 3);
    assert.deepEqual(data.itemListElement.map((x) => x.item["@type"]), ["MusicGroup", "MusicGroup", "MusicGroup"]);
    assert.ok(data.itemListElement.every((x) => !x.item.aggregateRating)); // no ratings invented for groups with no reviews
    assert.match(p.html, /3 local groups/);

    // event page: only groups that play that event (or haven't limited theirs)
    const q = await page(S, "/chicago/pilsen/quinceanera");
    assert.equal(q.status, 200); assert.match(q.html, /Live Mexican music for a quinceañera in Pilsen, Chicago/);
    assert.ok(q.html.includes(`/g/${pilsen.id}`) && q.html.includes(`/g/${evil.id}`)); assert.ok(!q.html.includes(`/g/${cicero.id}`)); // Cicero only plays weddings
    const w = await page(S, "/chicago/pilsen/wedding"); assert.ok(w.html.includes(`/g/${cicero.id}`) && w.html.includes(`/g/${pilsen.id}`) && !w.html.includes(`/g/${evil.id}`));
    // another neighborhood sees its own groups
    const au = await page(S, "/chicago/aurora"); assert.ok(au.html.includes(`/g/${aurora.id}`) && !au.html.includes(`/g/${pilsen.id}`));
    // no real group behind it: served (people can still open it) but noindex and no structured data
    const empty = await page(S, "/chicago/waukegan"); assert.equal(empty.status, 200); assert.match(empty.html, /<meta name="robots" content="noindex">/); assert.equal(ld(empty.html), null);
    const emptyEv = await page(S, "/chicago/aurora/quinceanera"); assert.match(emptyEv.html, /noindex/); // Aurora's group doesn't play quinceañeras
    // unknown places or events are plain 404s
    assert.equal((await page(S, "/chicago/nowhere")).status, 404);
    assert.equal((await page(S, "/chicago/pilsen/karaoke")).status, 404);
    // the city page links to neighborhoods
    assert.match((await page(S, "/c/chicago")).html, /href="\/chicago\/pilsen"/);

    // sitemap: pages with a real group behind them, and nothing else
    const sm = (await page(S, "/sitemap.xml")).html;
    for (const u of ["/chicago/pilsen", "/chicago/pilsen/quinceanera", "/chicago/pilsen/wedding", "/chicago/aurora", "/chicago/aurora/wedding", "/chicago/aurora/birthday", "/chicago/cicero/wedding"]) assert.ok(sm.includes(`${S.base}${u}</loc>`), u);
    for (const u of ["/chicago/waukegan", "/chicago/aurora/quinceanera", "/chicago/pilsen/serenata", "/chicago/pilsen/corporate"]) assert.ok(!sm.includes(`${S.base}${u}</loc>`), u);
    assert.ok(!sm.includes(sample.id));
  } finally { await S.close(); }
});
