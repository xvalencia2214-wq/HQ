import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

async function withReview(S, owner, cust, name) {
  const gid = await makeGroup(owner, { name, dates: [inDays(20)] });
  const bk = (await cust.post("/api/bookings", bookingBody(gid, inDays(20)))).json.booking;
  await cust.post(`/api/bookings/${bk.id}/simulate-pay`); await owner.patch(`/api/bookings/${bk.id}`, { action: "accept" });
  S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-2), bk.id);
  assert.equal((await cust.post(`/api/bookings/${bk.id}/review`, { rating: 5, text: "Great" })).status, 200);
  return gid;
}

test("review replies: only the group, one per review, contact details masked, editable and removable", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), other = client(S.base), cust = client(S.base), anon = client(S.base);
    await owner.signup("rv-o@example.com", "Rev Owner"); await other.signup("rv-x@example.com", "Other Mgr"); await cust.signup("rv-c@example.com", "Rita Cliente");
    const gid = await withReview(S, owner, cust, "Reply Band");
    const rid = (await anon.get(`/api/groups/${gid}`)).json.recent_reviews[0].id;
    assert.equal((await cust.post(`/api/reviews/${rid}/reply`, { text: "thanks me" })).status, 404); // the reviewer can't reply to themself
    assert.equal((await other.post(`/api/reviews/${rid}/reply`, { text: "not mine" })).status, 404);
    assert.equal((await anon.post(`/api/reviews/${rid}/reply`, { text: "who am i" })).status, 401);
    assert.equal((await owner.post(`/api/reviews/${rid}/reply`, { text: "x" })).status, 400);
    assert.equal((await owner.post(`/api/reviews/99999/reply`, { text: "Gracias!" })).status, 404);
    const ok = await owner.post(`/api/reviews/${rid}/reply`, { text: "Gracias Rita! Call me at 312-555-0142" });
    assert.equal(ok.status, 200); assert.doesNotMatch(ok.json.reply.text, /312/);
    let rev = (await anon.get(`/api/groups/${gid}`)).json.recent_reviews[0]; assert.match(rev.reply.text, /Gracias Rita/);
    await owner.post(`/api/reviews/${rid}/reply`, { text: "Edited thanks" });
    rev = (await anon.get(`/api/groups/${gid}`)).json.recent_reviews[0]; assert.equal(rev.reply.text, "Edited thanks");
    assert.equal((await other.del(`/api/reviews/${rid}/reply`)).status, 404);
    assert.equal((await owner.del(`/api/reviews/${rid}/reply`)).status, 200);
    assert.equal((await anon.get(`/api/groups/${gid}`)).json.recent_reviews[0].reply, null);
  } finally { await S.close(); }
});

test("badges: only an admin can grant verified/insured; they show on the public page and search cards", async () => {
  const S = await startApp({ ADMIN_EMAILS: "boss@example.com" });
  try {
    const owner = client(S.base), boss = client(S.base), anon = client(S.base);
    await owner.signup("bd-o@example.com", "Badge Owner"); await boss.signup("boss@example.com", "The Boss");
    const gid = await makeGroup(owner, { name: "Badge Band" });
    assert.equal((await owner.post(`/api/admin/groups/${gid}/badges`, { verified: true })).status, 404); // not an admin: looks like it doesn't exist
    assert.equal((await boss.post(`/api/admin/groups/nope/badges`, { verified: true })).status, 404);
    let g = (await anon.get(`/api/groups/${gid}`)).json; assert.deepEqual([g.verified, g.insured], [false, false]);
    assert.equal((await boss.post(`/api/admin/groups/${gid}/badges`, { verified: true })).status, 200);
    g = (await anon.get(`/api/groups/${gid}`)).json; assert.deepEqual([g.verified, g.insured], [true, false]); // insured left alone
    await boss.post(`/api/admin/groups/${gid}/badges`, { insured: true });
    const card = (await anon.get("/api/search?zip=60608&radius=50")).json.results.find((x) => x.id === gid);
    assert.deepEqual([card.verified, card.insured], [true, true]);
    await boss.post(`/api/admin/groups/${gid}/badges`, { verified: false });
    assert.equal((await anon.get(`/api/groups/${gid}`)).json.verified, false);
    assert.ok(S.db.get("SELECT 1 AS x FROM admin_log WHERE action = 'badges'"));
    assert.equal((await boss.get("/api/admin/summary")).json.groups_list.find((x) => x.id === gid).insured, true);
  } finally { await S.close(); }
});

test("response time: needs 3 answered conversations, uses the median, hidden for sample groups", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), anon = client(S.base);
    await owner.signup("rt-o@example.com", "Resp Owner");
    const gid = await makeGroup(owner, { name: "Fast Band" });
    const t = Math.floor(Date.now() / 1000) - 5 * 86400;
    const mk = (i, waitSec, replied = true) => {
      const u = S.db.run("INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, 'x', ?)", `rt${i}@example.com`, `Cust ${i}`, t).lastInsertRowid;
      S.db.run("INSERT INTO messages (group_id, customer_id, sender, text, created_at) VALUES (?, ?, 'customer', 'hi', ?)", gid, u, t + i * 10);
      if (replied) S.db.run("INSERT INTO messages (group_id, customer_id, sender, text, created_at) VALUES (?, ?, 'group', 'hello', ?)", gid, u, t + i * 10 + waitSec);
    };
    const resp = async () => (await anon.get(`/api/groups/${gid}`)).json.response;
    mk(1, 600); mk(2, 900);
    assert.equal(await resp(), null); // only two samples
    mk(3, 1200, false); assert.equal(await resp(), null); // an unanswered thread is not a sample
    mk(4, 1200); assert.deepEqual(await resp(), { bucket: "hour", samples: 3 });
    mk(5, 2 * 3600); mk(6, 3 * 3600); mk(7, 3 * 3600); // median now 2-3 h
    assert.equal((await resp()).bucket, "hours");
    for (let i = 8; i < 20; i++) mk(i, 3 * 86400); // mostly slow: nothing flattering to show
    assert.equal(await resp(), null);
    S.db.run("UPDATE groups SET demo = 1 WHERE id = ?", gid);
    assert.equal(await resp(), null);
  } finally { await S.close(); }
});
