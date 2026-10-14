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
