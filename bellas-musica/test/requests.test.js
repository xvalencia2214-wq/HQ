import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

const body = (over = {}) => ({ event: "Quinceañera", date: inDays(30), guests: 120, hours: 3, zip: "60608", note: "Outdoor, Saturday", ...over });

test("get quotes: an event request goes only to groups that can really do it, max 5, nothing to groups that can't", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const cust = client(S.base), anon = client(S.base);
    await cust.signup("rq-c@example.com", "Rita Cliente");
    const d = inDays(30);
    const mk = async (i, name, extra = {}, dates = [d], zip = "60608") => { const o = client(S.base); await o.signup(`rq${i}@example.com`, `Owner ${i}`); return { o, id: await makeGroup(o, { name, zip, dates, extra: { events: ["Quinceañera", "Wedding"], ...extra } }) }; };
    const good = [];
    for (let i = 0; i < 7; i++) good.push(await mk(i, `Good Band ${i}`, i === 0 ? { max_guests: 500 } : { max_guests: 400 }));
    const wrongEvent = await mk(20, "Weddings Only", { events: ["Wedding"] });
    const tooSmall = await mk(21, "Small Trio", { max_guests: 60 });
    const busy = await mk(22, "Busy Band", {}, [inDays(31)]);                      // free, but not that day
    const far = await mk(23, "LA Band", {}, [d], "90210");
    const paused = await mk(24, "Paused Band"); await paused.o.post(`/api/groups/${paused.id}/pause`, { paused: true });
    const hidden = await mk(25, "Hidden Band"); S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", hidden.id);
    const draftOwner = client(S.base); await draftOwner.signup("rq-d@example.com", "Draft O"); const draft = await makeGroup(draftOwner, { name: "Draft Band", draft: true });
    const unclaimed = (await (async () => { const b = client(S.base); await b.signup("rq-b@example.com", "Boss"); return null; })());
    S.db.run("INSERT INTO groups (id, owner_id, invited, name, type, zip, rate_cents, members, story, created_at) VALUES ('invited-1', NULL, 1, 'Unclaimed', 'Mariachi', '60608', 30000, 5, 'x', 1)");
    // a group that already has a booking for the date isn't free
    const booked = await mk(26, "Booked Band"); const other = client(S.base); await other.signup("rq-o@example.com", "Other");
    for (const t of ["12:00 PM", "2:00 PM", "4:00 PM"]) await other.post("/api/bookings", bookingBody(booked.id, d, { time: t }));

    assert.equal((await anon.post("/api/requests", body())).status, 401);
    for (const bad of [{ event: "Nope" }, { date: "2020-01-01" }, { date: "x" }, { guests: 0 }, { hours: 99 }, { zip: "abc" }, { zip: "00000" }]) assert.equal((await cust.post("/api/requests", body(bad))).status, 400, JSON.stringify(bad));

    const r = await cust.post("/api/requests", body({ note: "Call me at 312-555-0199" }));
    assert.equal(r.status, 200); assert.equal(r.json.sent, 5);
    const sent = new Set(r.json.groups.map((g) => g.id));
    assert.equal(sent.size, 5);
    for (const g of [wrongEvent, tooSmall, busy, far, paused, hidden, booked]) assert.ok(!sent.has(g.id), "must not receive: " + g.id);
    assert.ok(!sent.has(draft) && !sent.has("invited-1"));
    for (const id of sent) assert.ok(good.some((g) => g.id === id));
    // every chosen group got the message in its inbox, with contact details masked, and an email (not a text: nobody opted in)
    for (const id of sent) {
      const m = S.db.get("SELECT text FROM messages WHERE group_id = ? AND sender = 'customer'", id).text;
      assert.match(m, /Event request: Quinceañera on .*120 guests, 3 hr, near Chicago, IL/); assert.doesNotMatch(m, /555/);
    }
    assert.equal(S.db.all("SELECT 1 FROM email_log WHERE kind = 'request.group'").length, 5);
    // the group owner can answer with an offer straight away (they are in a conversation with the customer)
    const winner = good.find((g) => sent.has(g.id)); const uid = (await cust.get("/api/me")).json.user.id;
    assert.equal((await winner.o.post(`/api/groups/${winner.id}/offers`, { customerId: uid, name: "Quince special", hours: 3, price: 900 })).status, 200);

    // the quotes page: who got it, who answered, the offers
    const mine = (await cust.get("/api/my/requests")).json.requests;
    assert.equal(mine.length, 1); assert.equal(mine[0].groups.length, 5);
    const w = mine[0].groups.find((g) => g.id === winner.id);
    assert.deepEqual([w.replied, w.offers.length, w.offers[0].price_cents], [true, 1, 90000]);
    assert.ok(mine[0].groups.filter((g) => g.id !== winner.id).every((g) => !g.replied && g.offers.length === 0));
    assert.ok(Number.isInteger(w.reply_minutes));
    assert.deepEqual((await anon.get("/api/my/requests")).status, 401);
    assert.deepEqual((await other.get("/api/my/requests")).json.requests, []); // private

    // limits: 3 a day
    assert.equal((await cust.post("/api/requests", body({ guests: 100 }))).json.sent, 5);
    assert.equal((await cust.post("/api/requests", body({ event: "Wedding" }))).json.sent, 5);
    const fourth = await cust.post("/api/requests", body({ guests: 90 })); assert.equal(fourth.status, 429); assert.match(fourth.json.error, /3 event requests a day/);
    // a request nobody can serve stores nothing
    const nobody = client(S.base); await nobody.signup("rq-n@example.com", "Nobody");
    const none = await nobody.post("/api/requests", body({ zip: "99501", date: inDays(40) })); // Anchorage
    assert.deepEqual([none.status, none.json.sent, none.json.id], [200, 0, null]);
    assert.equal((await nobody.get("/api/my/requests")).json.requests.length, 0);
    // a group owner never gets their own group asked
    const own = await winner.o.post("/api/requests", body()); assert.equal(own.status, 200); assert.ok(!own.json.groups.some((g) => g.id === winner.id));
    // account deletion removes the requests
    assert.equal((await cust.post("/api/me/delete", { password: "correct horse battery" })).status, 200);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM event_requests WHERE customer_id = ?", uid).c, 0);
    void unclaimed;
  } finally { await S.close(); }
});

test("get quotes: start time, group size, budget and planning stage are validated, shown to the group, and shape who is asked", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const cust = client(S.base);
    await cust.signup("rx-c@example.com", "Rita Cliente");
    const d = inDays(30);
    const mk = async (i, name, rate, members, dates = [d]) => { const o = client(S.base); await o.signup(`rx${i}@example.com`, `Owner ${i}`); return { o, id: await makeGroup(o, { name, dates, rate, extra: { events: ["Quinceañera"], max_guests: 400, members } }) }; };
    const cheap = await mk(1, "Cheap Trio", 150, 3), mid = await mk(2, "Mid Mariachi", 300, 8), pricey = await mk(3, "Pricey Banda", 1500, 14);
    const base = { event: "Quinceañera", date: d, guests: 100, hours: 3, zip: "60608" };
    for (const bad of [{ time: "9:00 AM" }, { size: "huge" }, { stage: "maybe" }, { budgetMax: -5 }, { budgetMin: 900, budgetMax: 400 }, { budgetMax: "abc" }]) assert.equal((await cust.post("/api/requests", { ...base, ...bad })).status, 400, JSON.stringify(bad));
    // a budget of $1000 for 3 hours: Pricey Banda ($4,500) is far out of range and is not asked; the other two are
    const r = await cust.post("/api/requests", { ...base, time: "2:00 PM", size: "small", budgetMin: 500, budgetMax: 1000, stage: "ready", note: "Patio" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.groups.map((g) => g.id).sort(), [cheap.id, mid.id].sort());
    const msg = S.db.get("SELECT text FROM messages WHERE group_id = ? AND sender = 'customer'", mid.id).text;
    assert.match(msg, /on .* at 2:00 PM, about 100 guests, 3 hr, near Chicago, IL\. Looking for 4 to 6 musicians\. Budget \$500 to \$1000\. Planning: ready to book\. Patio/);
    const row = S.db.get("SELECT start_time, budget_min, budget_max, stage, size FROM event_requests");
    assert.deepEqual({ ...row }, { start_time: "2:00 PM", budget_min: 500, budget_max: 1000, stage: "ready", size: "small" });
    // everything stays optional: the old minimal request still works and mentions none of the extras
    const cust2 = client(S.base); await cust2.signup("rx-c2@example.com", "Sam Cliente");
    const min = await cust2.post("/api/requests", base); assert.equal(min.status, 200); assert.equal(min.json.sent, 3);
    assert.doesNotMatch(S.db.get("SELECT text FROM messages WHERE customer_id = (SELECT id FROM users WHERE email = 'rx-c2@example.com') LIMIT 1").text, /Budget|Planning|Looking for| at \d/);
    void pricey;
  } finally { await S.close(); }
});

test("'booked here' count: only confirmed, past, still-paid events; a refunded no-show doesn't count", async () => {
  const S = await startApp({ DEMO_SEED: "0", ADMIN_EMAILS: "boss@example.com" });
  try {
    const owner = client(S.base), cust = client(S.base), boss = client(S.base), anon = client(S.base);
    await owner.signup("bd-o@example.com", "Bd Owner"); await cust.signup("bd-c@example.com", "Bd Cust"); await boss.signup("boss@example.com", "Boss");
    const gid = await makeGroup(owner, { name: "Count Band", dates: [inDays(20), inDays(21), inDays(22)] });
    const done = async (date, time) => { const b = (await cust.post("/api/bookings", bookingBody(gid, date, { time }))).json.booking; await cust.post(`/api/bookings/${b.id}/simulate-pay`); await owner.patch(`/api/bookings/${b.id}`, { action: "accept" }); return b; };
    const count = async () => (await anon.get(`/api/groups/${gid}`)).json.events_done;
    assert.equal(await count(), 0);
    const a = await done(inDays(20), "12:00 PM"), b = await done(inDays(21), "2:00 PM"), c = await done(inDays(22), "4:00 PM");
    assert.equal(await count(), 0); // upcoming events don't count
    for (const x of [a, b, c]) S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-3), x.id);
    assert.equal(await count(), 3);
    // a reported no-show that was refunded drops out
    await cust.post(`/api/bookings/${a.id}/noshow`, { note: "Nobody came at all" });
    assert.equal((await boss.post(`/api/admin/bookings/${a.id}/noshow`, { refund: true })).status, 200);
    assert.equal(await count(), 2);
    S.db.run("UPDATE bookings SET status = 'cancelled' WHERE id = ?", b.id);
    assert.equal(await count(), 1);
    assert.equal((await anon.get("/api/search?zip=60608")).json.results.find((g) => g.id === gid).events_done, 1);
  } finally { await S.close(); }
});
