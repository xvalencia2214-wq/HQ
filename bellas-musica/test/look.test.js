import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup } from "./helpers.js";

// Spotlight: the paid level above Featured. It is bought like Featured, puts a group first in search, on the home page
// strip and twice as often in Discover, and is always labelled.
test("spotlight: bought in test mode, first in search, on the home strip, twice the Discover turns; admin can comp and clear it", async () => {
  const S = await startApp({ DEMO_SEED: "0", ADMIN_EMAILS: "admin@example.com" });
  try {
    const gs = [];
    for (let i = 0; i < 10; i++) { const o = client(S.base); await o.signup(`sp${i}@example.com`, `Spot Owner ${i}`); gs.push({ o, id: await makeGroup(o, { name: `Spot Band ${i}`, dates: [inDays(20)] }) }); }
    const [spot, feat] = gs;

    // buying: the price comes from the server, the simulated checkout pays it, 30 days are added
    const meta = (await client(S.base).get("/api/meta")).json;
    assert.equal(meta.spotlight_price_cents, 9900);
    const buy = await spot.o.post(`/api/groups/${spot.id}/feature`, { level: "spotlight" });
    assert.equal(buy.status, 200); assert.equal(buy.json.amount_cents, 9900); assert.match(buy.json.url, /#\/pay\/spotlight\/f/);
    assert.equal((await gs[2].o.post(`/api/feature/${buy.json.id}/simulate-pay`)).status, 404); // not someone else's
    assert.equal((await spot.o.post(`/api/feature/${buy.json.id}/simulate-pay`)).status, 200);
    const until = S.db.get("SELECT spotlight_until, promoted_until FROM groups WHERE id = ?", spot.id);
    assert.ok(until.spotlight_until > Date.now() / 1000 + 29 * 86400 && until.promoted_until === 0);
    assert.equal(S.db.get("SELECT kind FROM payments_feature WHERE id = ?", buy.json.id).kind, "spotlight");
    // Featured is still its own, cheaper level
    const f = await feat.o.post(`/api/groups/${feat.id}/feature`, {});
    assert.equal(f.json.amount_cents, 4900); assert.match(f.json.url, /#\/pay\/feature\//);
    await feat.o.post(`/api/feature/${f.json.id}/simulate-pay`);

    // search: Spotlight first, then Featured, both labelled; Spotlight counts as promoted
    const anon = client(S.base);
    const res = (await anon.get("/api/search?zip=60608&sort=price")).json.results;
    assert.equal(res[0].id, spot.id); assert.equal(res[1].id, feat.id);
    assert.ok(res[0].spotlight && res[0].promoted && !res[1].spotlight && res[1].promoted && !res[2].promoted);
    // the group page says so too
    assert.equal((await anon.get(`/api/groups/${spot.id}`)).json.spotlight, true);

    // the home strip: only Spotlight vendors, any category, a bad ZIP falls back to the market
    for (const q of ["", "?zip=60608", "?zip=abc"]) assert.deepEqual((await anon.get("/api/spotlight" + q)).json.results.map((g) => g.id), [spot.id]);

    // Discover: the Spotlight group gets twice the promoted turns of the Featured one, never back to back
    const items = [];
    for (let p = 0; p < 10; p++) { const r = (await anon.get(`/api/feed?zip=60608&seed=s&page=${p}`)).json; items.push(...r.items); if (r.next === null) break; }
    const turns = (id) => items.filter((x) => x.id === id).length;
    assert.ok(turns(spot.id) >= 2 * turns(feat.id) - 1 && turns(spot.id) > turns(feat.id), `${turns(spot.id)} vs ${turns(feat.id)}`);
    for (let i = 1; i < items.length; i++) assert.notEqual(items[i].id, items[i - 1].id);
    for (const g of gs.slice(2)) assert.equal(turns(g.id), 1); // everyone else once
    assert.ok(items.find((x) => x.id === spot.id).spotlight);

    // admin comps and clears Spotlight; the stats count it
    const admin = client(S.base); await admin.signup("admin@example.com", "Admin");
    assert.equal((await admin.post(`/api/admin/groups/${gs[3].id}/feature`, { days: 30, level: "spotlight" })).status, 200);
    assert.equal((await admin.get("/api/admin/summary")).json.groups.spotlight_now, 2);
    await admin.post(`/api/admin/groups/${gs[3].id}/feature`, { days: 0, level: "spotlight" });
    assert.equal(S.db.get("SELECT spotlight_until FROM groups WHERE id = ?", gs[3].id).spotlight_until, 0);
    // a lapsed Spotlight is just a normal listing again
    S.db.run("UPDATE groups SET spotlight_until = ? WHERE id = ?", Math.floor(Date.now() / 1000) - 60, spot.id);
    const after = (await anon.get("/api/search?zip=60608&sort=price")).json.results;
    assert.equal(after[0].id, feat.id); assert.ok(!after.find((g) => g.id === spot.id).promoted);
    assert.deepEqual((await anon.get("/api/spotlight")).json.results, []);
    // paid time never overlaps: Featured bought during a Spotlight starts after it, and Featured days left move after a new Spotlight
    const g4 = gs[4], g5 = gs[5], day = 86400;
    const pay = async (g, level) => { const r = await g.o.post(`/api/groups/${g.id}/feature`, { level }); assert.equal((await g.o.post(`/api/feature/${r.json.id}/simulate-pay`)).status, 200); return S.db.get("SELECT promoted_until p, spotlight_until s FROM groups WHERE id = ?", g.id); };
    let st = await pay(g4, "spotlight"); st = await pay(g4, "feature");
    assert.ok(Math.abs(st.p - (st.s + 30 * day)) <= 2, "Featured starts when the Spotlight ends");
    st = await pay(g4, "feature"); assert.ok(Math.abs(st.p - (st.s + 60 * day)) <= 2, "and a second Featured adds 30 more");
    st = await pay(g5, "feature"); const featuredEnd = st.p;
    st = await pay(g5, "spotlight");
    assert.ok(Math.abs(st.p - (st.s + (featuredEnd - (st.s - 30 * day)))) <= 2 && st.p > st.s, "the Featured days left move to after the new Spotlight");
    st = await pay(g5, "spotlight"); assert.ok(st.p - st.s > 29 * day, "a second Spotlight pushes the Featured days later again");
  } finally { await S.close(); }
});
