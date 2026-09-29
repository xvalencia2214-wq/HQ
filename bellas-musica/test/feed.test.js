import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup } from "./helpers.js";

const ids = (items) => items.map((i) => i.id);
async function pages(c, qs, n = 12) {
  const out = [];
  for (let p = 0; p < n; p++) {
    const r = await c.get(`/api/feed?${qs}&page=${p}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    out.push(...r.json.items);
    if (r.json.next === null) return { items: out, last: r.json };
  }
  return { items: out, last: null };
}

test("discover feed: only live nearby groups; promoted groups take every 4th slot and are labelled; expired promotion isn't", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const anon = client(S.base);
    const gs = [];
    for (let i = 0; i < 12; i++) { const o = client(S.base); await o.signup(`fd${i}@example.com`, `Feed Owner ${i}`); gs.push({ o, id: await makeGroup(o, { name: `Feed Band ${i}`, dates: [inDays(20)] }) }); }
    // not live: a draft, a paused group, a hidden group, and one far away (Los Angeles)
    const d = client(S.base); await d.signup("fdraft@example.com", "Draft Owner"); const draft = await makeGroup(d, { name: "Draft Band", draft: true });
    await gs[10].o.post(`/api/groups/${gs[10].id}/pause`, { paused: true });
    S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", gs[11].id);
    const far = client(S.base); await far.signup("far@example.com", "Far Owner"); const farId = await makeGroup(far, { name: "LA Band", zip: "90210", dates: [inDays(20)] });
    // two paid, one lapsed
    const soon = Math.floor(Date.now() / 1000) + 86400;
    S.db.run("UPDATE groups SET promoted_until = ? WHERE id IN (?, ?)", soon, gs[0].id, gs[1].id);
    S.db.run("UPDATE groups SET promoted_until = ? WHERE id = ?", Math.floor(Date.now() / 1000) - 60, gs[2].id);

    const { items, last } = await pages(anon, "zip=60608&seed=abc");
    const live = gs.slice(0, 10).map((g) => g.id); // 8 organic (2..9) + 2 promoted
    assert.deepEqual([...new Set(ids(items))].sort(), [...live].sort()); // live, nearby, and nothing else
    for (const bad of [draft, gs[10].id, gs[11].id, farId]) assert.ok(!ids(items).includes(bad), bad);
    assert.equal(last.next, null);
    items.forEach((it, i) => assert.equal(it.position, i));
    // rhythm: with 8 organic groups the promoted slots are 1, 5 and 9 (the paid groups come around: 3 slots for 2 groups); everyone else is unlabelled
    assert.deepEqual(items.map((it, i) => (it.promoted ? i : -1)).filter((i) => i >= 0), [1, 5, 9]);
    assert.equal(items.length, 11);
    assert.deepEqual([...new Set(items.filter((x) => x.promoted).map((x) => x.id))].sort(), [gs[0].id, gs[1].id].sort());
    for (let i = 1; i < items.length; i++) assert.notEqual(items[i].id, items[i - 1].id); // never the same group twice in a row
    // every organic group appears exactly once
    for (const g of gs.slice(2, 10)) assert.equal(items.filter((x) => x.id === g.id).length, 1);
    // card content is what the app needs, and nothing private
    const c = items[0]; assert.ok(c.name && c.city === "Chicago" && c.state === "IL" && Number.isInteger(c.from_cents) && c.distance_miles >= 0);
    assert.deepEqual(Object.keys(c).filter((k) => /owner|phone|stripe|email|token/i.test(k)), []);
    // few groups: paid ones still get shown once each, and a feed of one is fine
    S.db.run("UPDATE groups SET hidden = 1 WHERE id NOT IN (?, ?)", gs[0].id, gs[3].id);
    const small = await pages(anon, "zip=60608&seed=q"); assert.deepEqual(ids(small.items).sort(), [gs[0].id, gs[3].id].sort());
    S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", gs[3].id);
    const solo = await pages(anon, "zip=60608&seed=q"); assert.deepEqual(ids(solo.items), [gs[0].id]);
  } finally { await S.close(); }
});

test("discover feed: stable per seed, different across seeds, pages don't overlap, clips come first, bad input is refused", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const anon = client(S.base);
    const made = [];
    for (let i = 0; i < 9; i++) { const o = client(S.base); await o.signup(`sd${i}@example.com`, `Seed Owner ${i}`); made.push(await makeGroup(o, { name: `Seed Band ${i}`, dates: [inDays(20)], extra: i < 3 ? { video_url: "https://youtube.com/shorts/dQw4w9WgXcQ" } : {} })); }
    const one = (await anon.get("/api/feed?zip=60608&seed=s1&page=0")).json, again = (await anon.get("/api/feed?zip=60608&seed=s1&page=0")).json;
    assert.deepEqual(ids(one.items), ids(again.items)); // same seed, same order
    const orders = new Set(); for (const s of ["a", "b", "c", "d", "e", "f"]) orders.add(ids((await anon.get(`/api/feed?zip=60608&seed=${s}&page=0`)).json.items).join());
    assert.ok(orders.size > 1, "different seeds should give different orders");
    const { items } = await pages(anon, "zip=60608&seed=s1");
    for (let p = 0; p < 10; p++) { const r = (await anon.get(`/api/feed?zip=60608&seed=s1&page=${p}`)).json; r.items.forEach((it, j) => assert.equal(it.position, p * 6 + j)); }
    // groups with a clip lead the organic order, and carry an embed we built ourselves
    const firstNine = items.slice(0, 3);
    assert.ok(firstNine.every((x) => x.video && x.video.provider === "youtube" && x.video.embed === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), JSON.stringify(firstNine.map((x) => x.video)));
    assert.equal(items.find((x) => !x.video).video, null);
    // input validation
    for (const q of ["zip=abc", "zip=00000", "zip=60608&page=-1", "zip=60608&page=x", "zip=60608&radius=1", "zip=60608&seed=" + "x".repeat(50)]) assert.equal((await anon.get("/api/feed?" + q)).status, q.startsWith("zip=00000") ? 404 : 400, q);
    // a ZIP with nobody nearby is an empty feed, not an error
    const empty = (await anon.get("/api/feed?zip=90210&seed=z")).json; assert.deepEqual([empty.items.length, empty.next], [0, null]);
    // no ZIP means the launch city
    assert.equal((await anon.get("/api/feed")).json.origin.city, "Chicago");
  } finally { await S.close(); }
});

test("discover feed: view/tap counters are anonymous, capped per visitor, only for live groups, and reach the group's dashboard and admin", async () => {
  const S = await startApp({ DEMO_SEED: "0", ADMIN_EMAILS: "boss@example.com" });
  try {
    const owner = client(S.base), anon = client(S.base), boss = client(S.base);
    await owner.signup("fe-o@example.com", "Feed Owner"); await boss.signup("boss@example.com", "Boss");
    const gid = await makeGroup(owner, { name: "Counted Band", dates: [inDays(20)] });
    const ev = (b) => anon.post("/api/feed/event", b);
    assert.equal((await ev({ kind: "boom", groupId: gid })).status, 400);
    assert.equal((await ev({ kind: "view" })).status, 400);
    assert.deepEqual((await ev({ kind: "view", groupId: "nope" })).json, { ok: true, counted: false });
    for (let i = 0; i < 6; i++) await ev({ kind: "view", groupId: gid }); // one visitor hammering: only 3 count
    await ev({ kind: "tap", groupId: gid });
    const mine = (await owner.get("/api/my/groups")).json.groups[0].stats_30d;
    assert.deepEqual([mine.feed_views, mine.feed_taps], [3, 1]);
    S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", gid);
    assert.equal((await ev({ kind: "tap", groupId: gid })).json.counted, false); // a hidden group can't collect counts
    const f = (await boss.get("/api/admin/summary")).json.funnel_30d; assert.deepEqual([f.feed_views, f.feed_taps], [3, 1]);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM stats_daily WHERE key LIKE 'feed_%' AND ref != ?", gid).c, 0); // counters carry the group id only: no IP, no user
  } finally { await S.close(); }
});
