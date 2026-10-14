// The improvement plan of Oct 14, 2026 (docs/improvement-plan.md): each fix proven here, numbered as in the plan.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody, fakeStripe, postWebhook } from "./helpers.js";

// #4: a vendor shows up, takes quote requests and can be booked only where it travels.
test("#4 travel range: hidden beyond the free miles, shown with the fee when it charges one, never booked past it", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("near@example.com", "Nora Near"); await cust.signup("fam@example.com", "Familia");
    const d = inDays(20);
    const free = await makeGroup(owner, { name: "Close To Home", zip: "60608", dates: [d], extra: { travel_miles: 20, travel_fee: 0 } });
    const owner2 = client(S.base); await owner2.signup("far@example.com", "Felipe Far");
    const paid = await makeGroup(owner2, { name: "Goes Further", zip: "60608", dates: [d], extra: { travel_miles: 20, travel_fee: 75 } });
    // Mundelein (60060) is 33 miles from 60608: past both free ranges, inside the paid one (up to 50)
    const near = (await cust.get("/api/search?zip=60609")).json.results.map((g) => g.id);
    assert.ok(near.includes(free) && near.includes(paid));
    const far = (await cust.get("/api/search?zip=60060")).json.results;
    assert.ok(!far.some((g) => g.id === free), "the free-only vendor doesn't travel 33 miles");
    const card = far.find((g) => g.id === paid);
    assert.ok(card, "a vendor with a travel fee still shows");
    assert.equal(card.travel_extra_cents, 7500);
    assert.equal((await cust.get("/api/search?zip=60609")).json.results.find((g) => g.id === paid).travel_extra_cents, 0);
    // booking past the range is refused, in both languages
    const r = await cust.post("/api/quote", bookingBody(free, d, { eventZip: "60060" }));
    assert.equal(r.status, 400); assert.match(r.json.error, /travel area/);
    const es = await cust.raw("POST", "/api/quote", bookingBody(free, d, { eventZip: "60060" }), { "X-Lang": "es" });
    assert.equal(es.json.error, "Este proveedor no viaja hasta ese código postal.");
    assert.equal((await cust.post("/api/quote", bookingBody(paid, d, { eventZip: "60060" }))).json.quote.travel_fee_cents, 7500);
    // Get quotes only asks vendors that can come
    const rq = await cust.post("/api/requests", { event: "Wedding", date: d, guests: 80, zip: "60060", hours: 2 });
    assert.equal(rq.status, 200);
    const asked = rq.json.groups.map((x) => x.id);
    assert.ok(!asked.includes(free) && asked.includes(paid), JSON.stringify(asked));
  } finally { await S.close(); }
});

// #5: chargebacks and paused payouts reach the owner (and the vendor) without anyone opening Stripe.
test("#5 Stripe: account.updated pauses a vendor and tells them; a dispute is recorded and alerted, once", async () => {
  const F = await fakeStripe();
  const SECRET = "whsec_main", CONNECT = "whsec_connect";
  const S = await startApp({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT, STRIPE_API_BASE: F.url, ADMIN_EMAILS: "boss@example.com", DEMO_SEED: "0" });
  const alerts = [];
  S.ctx.alert = (m) => alerts.push(m);
  let seq = 0;
  const evt = (type, object) => ({ id: `evt_plan_${++seq}`, type, data: { object } });
  try {
    const owner = client(S.base), cust = client(S.base), boss = client(S.base);
    await owner.signup("pay@example.com", "Paula Pay"); await cust.signup("cb@example.com", "Carla Card"); await boss.signup("boss@example.com", "Boss");
    const gid = await makeGroup(owner, { name: "Paid Up", dates: [inDays(30)] });
    S.db.run("UPDATE groups SET stripe_account_id = 'acct_plan', stripe_ready = 1, id_checked = 1 WHERE id = ?", gid);

    // the Connect endpoint's secret works too; payouts paused → not bookable, alert, the vendor is told
    const off = await postWebhook(S.base, evt("account.updated", { id: "acct_plan", charges_enabled: true, payouts_enabled: false }), CONNECT);
    assert.equal(off.status, 200);
    assert.deepEqual({ ...S.db.get("SELECT stripe_ready, id_checked FROM groups WHERE id = ?", gid) }, { stripe_ready: 0, id_checked: 0 });
    assert.ok(alerts.some((a) => /PAYOUTS PAUSED/.test(a)));
    assert.ok(S.db.get("SELECT COUNT(*) c FROM email_log WHERE kind = 'payouts.off.group'").c >= 1);
    assert.match((await cust.post("/api/bookings", bookingBody(gid, inDays(30)))).json.error, /online deposits/);
    // back on (main secret): bookable again, no second alert
    const n = alerts.length;
    await postWebhook(S.base, evt("account.updated", { id: "acct_plan", charges_enabled: true, payouts_enabled: true }), SECRET);
    assert.equal(S.db.get("SELECT stripe_ready FROM groups WHERE id = ?", gid).stripe_ready, 1);
    assert.equal(alerts.length, n);
    // a wrong signature is still refused
    assert.equal((await postWebhook(S.base, evt("account.updated", { id: "acct_plan" }), "whsec_wrong")).status, 400);

    // a paid deposit, then a chargeback on it
    const b = (await cust.post("/api/bookings", bookingBody(gid, inDays(30)))).json.booking;
    await postWebhook(S.base, evt("checkout.session.completed", { payment_status: "paid", amount_total: b.deposit_cents, payment_intent: "pi_disputed", metadata: { kind: "booking", booking_id: b.id } }), SECRET);
    const due = Math.floor(Date.now() / 1000) + 7 * 86400;
    const created = evt("charge.dispute.created", { id: "dp_1", amount: b.deposit_cents, payment_intent: "pi_disputed", reason: "fraudulent", status: "needs_response", evidence_details: { due_by: due } });
    assert.equal((await postWebhook(S.base, created, SECRET)).status, 200);
    assert.equal((await postWebhook(S.base, created, SECRET)).json.duplicate, true); // Stripe retried: nothing twice
    const row = S.db.get("SELECT * FROM disputes WHERE id = 'dp_1'");
    assert.equal(row.booking_id, b.id); assert.equal(row.group_id, gid); assert.equal(row.status, "needs_response"); assert.equal(row.due_by, due);
    assert.equal(alerts.filter((a) => /CHARGEBACK/.test(a)).length, 1);
    const sum = (await boss.get("/api/admin/summary")).json;
    assert.equal(sum.disputes[0].id, "dp_1"); assert.equal(sum.disputes[0].group_name, "Paid Up");
    await postWebhook(S.base, evt("charge.dispute.closed", { id: "dp_1", amount: b.deposit_cents, payment_intent: "pi_disputed", status: "won" }), SECRET);
    assert.equal(S.db.get("SELECT status FROM disputes WHERE id = 'dp_1'").status, "won");
    assert.ok(alerts.some((a) => /Chargeback WON/.test(a)));

    // the daily check re-reads accounts not seen for a day (a missed webhook)
    const { recheckAccounts } = await import("../server/stripe-events.js");
    S.db.run("UPDATE groups SET stripe_checked_at = 0 WHERE id = ?", gid);
    F.state.ready = false;
    assert.equal(await recheckAccounts(S.ctx), 1);
    assert.equal(S.db.get("SELECT stripe_ready FROM groups WHERE id = ?", gid).stripe_ready, 0);
    assert.equal(await recheckAccounts(S.ctx), 0, "checked once a day");
  } finally { await S.close(); await F.close(); }
});

// #6 Show more, #8 search by name, #10 honest "from" prices, #12 fair paid spots, #7 new events, #11 pages for every kind of vendor.
test("discovery: pages of results, name search, honest prices, paid spots that respect the family's sort, new events, category pages", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const d = inDays(25);
    const ids = [];
    for (let i = 0; i < 24; i++) {
      const o = client(S.base); await o.signup(`m${i}@example.com`, `Owner ${i}`);
      ids.push(await makeGroup(o, { name: i === 7 ? "Mariachi Los Gallos de Jalisco" : `Grupo Número ${i}`, rate: 200 + i * 10, dates: [d] }));
    }
    const c = client(S.base);
    // #6 two pages, nothing twice
    const p0 = (await c.get("/api/search?zip=60608")).json, p1 = (await c.get("/api/search?zip=60608&page=1")).json;
    assert.equal(p0.results.length, 20); assert.equal(p0.total, 24); assert.equal(p0.more, true);
    assert.equal(p1.results.length, 4); assert.equal(p1.more, false);
    assert.equal(new Set([...p0.results, ...p1.results].map((g) => g.id)).size, 24);
    // #8 by name, accents and case ignored, in any category
    const o2 = client(S.base); await o2.signup("taco@example.com", "Taco Owner");
    const tacos = await makeGroup(o2, { name: "Tacos El Güero", dates: [d] });
    S.db.run("UPDATE groups SET type = 'Food truck', hourly = 0 WHERE id = ?", tacos);
    S.db.run("INSERT INTO packages (group_id, name, description, hours, price_cents) VALUES (?, 'Taco party', '', 2, 65000)", tacos);
    assert.deepEqual((await c.get("/api/search?zip=60608&q=gallos")).json.results.map((g) => g.id), [ids[7]]);
    assert.deepEqual((await c.get("/api/search?zip=60608&q=GUERO")).json.results.map((g) => g.id), [tacos]);
    // #10 "from" is what can really be booked: $250/hour with a 3-hour minimum starts at $750
    S.db.run("UPDATE groups SET rate_cents = 25000, min_hours = 3 WHERE id = ?", ids[0]);
    const card = (await c.get("/api/search?zip=60608&q=Número 0")).json.results[0];
    assert.equal(card.from_cents, 75000);
    assert.ok(!(await c.get("/api/search?zip=60608&max=500")).json.results.some((g) => g.id === ids[0]), "a $750 minimum is not 'up to $500'");
    // #12 two paid listings, both expensive
    const future = Math.floor(Date.now() / 1000) + 86400 * 10;
    S.db.run("UPDATE groups SET spotlight_until = ? WHERE id = ?", future, ids[23]);
    S.db.run("UPDATE groups SET promoted_until = ? WHERE id IN (?, ?)", future, ids[22], ids[21]);
    const best = (await c.get("/api/search?zip=60608")).json.results.map((g) => g.id);
    assert.equal(best[0], ids[23]); assert.ok(best.slice(1, 3).includes(ids[22]) && best.slice(1, 3).includes(ids[21]), "best match: every paid spot first");
    const cheap = (await c.get("/api/search?zip=60608&sort=price")).json.results;
    assert.equal(cheap[0].id, ids[23], "lowest price: Spotlight still first"); assert.ok([ids[22], ids[21]].includes(cheap[1].id));
    assert.equal(cheap.slice(2).filter((g) => g.promoted || g.spotlight).length, 0, "only 2 paid on top");
    const rest = cheap.slice(2).map((g) => g.from_cents);
    assert.deepEqual(rest, [...rest].sort((a, b) => a - b), "everyone else in price order");
    assert.ok(cheap.slice(2).length >= 18);
    // #7 the new events: searchable and bookable
    for (const e of ["Baptism", "First Communion", "Graduation", "Baby shower", "Funeral / Memorial"]) assert.equal((await c.get(`/api/search?zip=60608&event=${encodeURIComponent(e)}`)).status, 200, e);
    await c.signup("bautizo@example.com", "Familia Bautizo");
    const q = await c.post("/api/quote", bookingBody(ids[1], d, { event: "Baptism" }));
    assert.equal(q.status, 200);
    const { eventLabel } = await import("../server/emails.js");
    assert.equal(eventLabel("Baptism", "es"), "bautizo"); assert.equal(eventLabel("Funeral / Memorial", "es"), "funeral o misa");
    // #11 a catering page for Pilsen, English and Spanish, in the sitemap
    S.db.run("UPDATE groups SET zip = '60608' WHERE id = ?", tacos);
    S.db.run(`UPDATE groups SET events = '["Baptism","Wedding"]' WHERE id = ?`, ids[1]);
    const en = await fetch(S.base + "/chicago/pilsen/catering"), es = await fetch(S.base + "/es/chicago/pilsen/comida");
    const enHtml = await en.text(), esHtml = await es.text();
    assert.equal(en.status, 200); assert.match(enHtml, /Catering and food in Pilsen/); assert.match(enHtml, /Tacos El Güero/); assert.doesNotMatch(enHtml, /Los Gallos/);
    assert.match(esHtml, /Comida para fiestas en Pilsen/); assert.match(esHtml, /lang="es"/);
    assert.doesNotMatch(enHtml, /noindex/);
    const empty = await (await fetch(S.base + "/chicago/pilsen/venues")).text();
    assert.match(empty, /noindex/, "no venue yet: served but not indexed");
    const map = await (await fetch(S.base + "/sitemap.xml")).text();
    assert.match(map, /\/chicago\/pilsen\/catering</); assert.match(map, /\/es\/chicago\/pilsen\/comida</); assert.doesNotMatch(map, /pilsen\/venues</);
    assert.match(map, /\/chicago\/pilsen\/baptism</, "music for the new events too");
  } finally { await S.close(); }
});

// #13 Today box, #14 seen in search, #15 price insight.
test("vendor dashboard: Today (requests, next party, money to come), seen in search, typical prices nearby", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const d1 = inDays(10), d2 = inDays(12);
    const owner = client(S.base); await owner.signup("today@example.com", "Toño Today");
    const gid = await makeGroup(owner, { name: "Mariachi Hoy", rate: 300, dates: [d1, d2] });
    const mine = async () => (await owner.get("/api/my/groups")).json.groups.find((g) => g.id === gid);
    let g = await mine();
    assert.deepEqual({ ...g.today, answer_by: 0 }, { next_gig: null, requests_waiting: 0, answer_by: 0, unread_messages: 0, gigs_30d: 0, to_collect_cents: 0, held_cents: 0 });
    assert.equal(g.price_insight, null, "fewer than 3 others nearby: nothing to say");
    // a family books two dates; one is accepted
    const fam = client(S.base); await fam.signup("hoyfam@example.com", "Rosa Familia");
    const b1 = (await fam.post("/api/bookings", bookingBody(gid, d1))).json.booking; await fam.post(`/api/bookings/${b1.id}/simulate-pay`);
    const b2 = (await fam.post("/api/bookings", bookingBody(gid, d2))).json.booking; await fam.post(`/api/bookings/${b2.id}/simulate-pay`);
    await fam.post(`/api/groups/${gid}/messages`, { text: "Hola, ¿tocan El Rey?" });
    g = await mine();
    assert.equal(g.today.requests_waiting, 2); assert.ok(g.today.answer_by > Date.now() / 1000);
    assert.equal(g.today.unread_messages, 1);
    await owner.patch(`/api/bookings/${b1.id}`, { action: "accept" });
    g = await mine();
    assert.equal(g.today.requests_waiting, 1);
    assert.equal(g.today.next_gig.id, b1.id); assert.equal(g.today.next_gig.customer, bookingBody(gid, d1).name.split(" ")[0]); assert.equal(g.today.gigs_30d, 1);
    assert.equal(g.today.to_collect_cents, b1.total_cents - b1.deposit_cents);
    // #14 each search that shows the listing counts once
    const c = client(S.base);
    for (let i = 0; i < 3; i++) await c.get("/api/search?zip=60608");
    await c.get("/api/search?zip=60608&q=nobody-by-this-name");
    assert.equal((await mine()).stats_30d.seen, 3);
    // #15 three other real mariachis within 30 miles, one far away and a different type: they don't count
    for (const [i, rate, zip, type] of [[1, 250, "60623", "Mariachi"], [2, 400, "60632", "Mariachi"], [3, 600, "60609", "Mariachi"], [4, 100, "61820", "Mariachi"], [5, 90, "60608", "Banda"]]) {
      const o = client(S.base); await o.signup(`pi${i}@example.com`, `Owner ${i}`);
      const id = await makeGroup(o, { name: `Price ${i}`, rate, zip, dates: [d1] });
      if (type !== "Mariachi") S.db.run("UPDATE groups SET type = ? WHERE id = ?", type, id);
    }
    const p = (await mine()).price_insight;
    assert.equal(p.count, 3); assert.equal(p.type, "Mariachi");
    assert.equal(p.low_cents, 25000); assert.equal(p.median_cents, 40000); assert.equal(p.high_cents, 60000);
    assert.equal(p.yours_cents, 30000);
    // a helper sees the same box; a stranger sees nothing of it
    assert.equal((await c.get(`/api/groups/${gid}`)).json.today, undefined);
  } finally { await S.close(); }
});
