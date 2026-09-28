import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody, fakeStripe, postWebhook } from "./helpers.js";

const SECRET = "whsec_test_secret";
let S, F, owner, cust, gid, seq = 0;
const day = (n) => inDays(n);

before(async () => {
  F = await fakeStripe();
  S = await startApp({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: F.url, PLATFORM_FEE_PCT: "10", FEATURE_PRICE_CENTS: "4900" });
  owner = client(S.base); cust = client(S.base);
  await owner.signup("so@example.com", "Stripe Owner"); await cust.signup("sc@example.com", "Stripe Customer");
  gid = await makeGroup(owner, { name: "Live Band", dates: [day(30), day(31), day(32), day(33), day(34), day(35)] });
});
after(async () => { await S.close(); await F.close(); });

const evt = (type, object) => ({ id: `evt_${++seq}`, type, data: { object } });
const completed = (b, extra = {}) => evt("checkout.session.completed", { payment_status: "paid", amount_total: b.deposit_cents, payment_intent: "pi_live_" + b.id, metadata: { kind: "booking", booking_id: b.id }, ...extra });
const lastCall = (pred) => [...F.calls].reverse().find(pred);
const state = (id) => S.db.get("SELECT status, payment_status, refund_cents, stripe_payment_intent FROM bookings WHERE id = ?", id);

test("live mode: sample groups and groups without payout setup cannot take deposits", async () => {
  const demo = await cust.post("/api/bookings", bookingBody("dj-fiesta-latina", day(20)));
  assert.equal(demo.status, 400);
  assert.equal((await client(S.base).get("/api/search?zip=77003")).json.results.find((g) => g.id === "dj-fiesta-latina").bookable, false);
  const blocked = await cust.post("/api/bookings", bookingBody(gid, day(30)));
  assert.equal(blocked.status, 400); assert.match(blocked.json.error, /online deposits/);
});

test("payout onboarding uses Stripe Connect Express and checks readiness", async () => {
  const o = await owner.post(`/api/groups/${gid}/stripe/onboard`);
  assert.equal(o.json.url, "https://connect.stripe.test/onboard");
  const acct = lastCall((c) => c.url === "/v1/accounts");
  assert.equal(acct.auth, "Bearer sk_test_abc"); assert.equal(acct.form.type, "express"); assert.equal(acct.form["capabilities[transfers][requested]"], "true");
  const link = lastCall((c) => c.url === "/v1/account_links");
  assert.equal(link.form.account, "acct_test_1"); assert.equal(link.form.type, "account_onboarding");
  F.state.ready = false;
  assert.equal((await owner.post(`/api/groups/${gid}/stripe/refresh`)).json.ready, false);
  F.state.ready = true;
  assert.equal((await owner.post(`/api/groups/${gid}/stripe/refresh`)).json.ready, true);
  assert.equal((await client(S.base).get(`/api/groups/${gid}`)).json.bookable, true);
  assert.equal((await cust.post(`/api/groups/${gid}/stripe/onboard`)).status, 403);
});

test("checkout: deposit amount, platform fee and destination are set by the server", async () => {
  const before = F.calls.length;
  const r = await cust.post("/api/bookings", bookingBody(gid, day(30), { amount: 1, deposit_cents: 1 })); // client-supplied amounts are ignored
  assert.equal(r.status, 200); assert.equal(r.json.payment.mode, "stripe");
  assert.match(r.json.payment.url, /^https:\/\/checkout\.stripe\.test\/pay\//);
  const c = F.calls.slice(before).find((x) => x.url === "/v1/checkout/sessions");
  assert.equal(c.form.mode, "payment");
  assert.equal(c.form["line_items[0][price_data][unit_amount]"], "15000"); // 25% of 2h x $300
  assert.equal(c.form["line_items[0][price_data][currency]"], "usd");
  assert.equal(c.form["payment_intent_data[application_fee_amount]"], "6000"); // 10% of $600
  assert.equal(c.form["payment_intent_data[transfer_data][destination]"], "acct_test_1");
  assert.equal(c.form["metadata[booking_id]"], r.json.booking.id);
  assert.match(c.idem, /^checkout-booking-/);
  assert.equal(state(r.json.booking.id).status, "pending_payment");
  // a Stripe outage frees the slot instead of leaving it stuck
  const saved = S.ctx.config.stripeApi; S.ctx.config.stripeApi = "http://127.0.0.1:1";
  const down = await cust.post("/api/bookings", bookingBody(gid, day(31)));
  S.ctx.config.stripeApi = saved;
  assert.equal(down.status, 502);
  assert.equal((await cust.post("/api/bookings", bookingBody(gid, day(31)))).status, 200);
});

test("webhook: rejects bad signatures, accepts good ones once, ignores mismatched amounts", async () => {
  const b = (await cust.post("/api/bookings", bookingBody(gid, day(32)))).json.booking;
  const ok = completed(b);
  assert.equal((await postWebhook(S.base, ok, "whsec_WRONG")).status, 400);
  assert.equal((await postWebhook(S.base, ok, SECRET, { header: "t=1,v1=deadbeef" })).status, 400);
  assert.equal((await postWebhook(S.base, ok, SECRET, { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400);
  assert.equal(state(b.id).payment_status, "unpaid");
  // wrong amount is ignored
  assert.equal((await postWebhook(S.base, completed(b, { amount_total: 100 }), SECRET)).status, 200);
  assert.equal(state(b.id).payment_status, "unpaid");
  // unpaid session is ignored
  assert.equal((await postWebhook(S.base, completed(b, { payment_status: "unpaid" }), SECRET)).status, 200);
  assert.equal(state(b.id).payment_status, "unpaid");
  // good event marks it paid and stores the payment intent
  assert.equal((await postWebhook(S.base, ok, SECRET)).status, 200);
  assert.deepEqual({ ...state(b.id) }, { status: "requested", payment_status: "paid", refund_cents: 0, stripe_payment_intent: "pi_live_" + b.id });
  // replaying the same event id is a no-op
  assert.equal((await postWebhook(S.base, ok, SECRET)).json.duplicate, true);
  // unknown event types are acknowledged
  assert.equal((await postWebhook(S.base, evt("customer.created", {}), SECRET)).status, 200);
  // returning from Stripe also works without the webhook
  const b2 = (await cust.post("/api/bookings", bookingBody(gid, day(33)))).json.booking;
  const open = (await cust.post(`/api/bookings/${b2.id}/refresh`)).json.booking;
  assert.equal(open.payment_status, "unpaid");
  assert.equal(open.pay_url, "https://checkout.stripe.test/resume"); // customer can return to checkout
  F.state.sessionPaid = true; F.state.sessionAmount = 999;
  assert.equal((await cust.post(`/api/bookings/${b2.id}/refresh`)).json.booking.payment_status, "unpaid"); // wrong amount
  F.state.sessionAmount = b2.deposit_cents;
  assert.equal((await cust.post(`/api/bookings/${b2.id}/refresh`)).json.booking.status, "requested");
  F.state.sessionPaid = false;
});

test("refunds: reverse the transfer and app fee; a failed refund changes nothing", async () => {
  const b = (await cust.post("/api/bookings", bookingBody(gid, day(34)))).json.booking;
  await postWebhook(S.base, completed(b), SECRET);
  F.state.failRefunds = true;
  const bad = await owner.patch(`/api/bookings/${b.id}`, { action: "decline" });
  assert.equal(bad.status, 502);
  assert.deepEqual(state(b.id).status, "requested"); assert.equal(state(b.id).refund_cents, 0);
  F.state.failRefunds = false;
  const ok = await owner.patch(`/api/bookings/${b.id}`, { action: "decline" });
  assert.equal(ok.status, 200); assert.equal(ok.json.booking.payment_status, "refunded");
  const r = lastCall((c) => c.url === "/v1/refunds");
  assert.equal(r.form.payment_intent, "pi_live_" + b.id); assert.equal(r.form.amount, "15000");
  assert.equal(r.form.reverse_transfer, "true"); assert.equal(r.form.refund_application_fee, "true");
  assert.match(r.idem, /^refund-/);
  // customer cancel inside the policy window refunds the right partial amount
  const b2 = (await cust.post("/api/bookings", bookingBody(gid, day(35)))).json.booking;
  await postWebhook(S.base, completed(b2), SECRET);
  S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(5), b2.id); // 5 days out on a moderate policy = 50%
  const c = await cust.patch(`/api/bookings/${b2.id}`, { action: "cancel" });
  assert.equal(c.json.booking.refund_cents, 7500);
  assert.equal(lastCall((x) => x.url === "/v1/refunds").form.amount, "7500");
});

test("live mode: re-clicking Pay returns the same open Stripe checkout instead of creating a second", async () => {
  const d = day(80);
  await owner.put(`/api/groups/${gid}/availability`, { dates: { [d]: ["12:00 PM"] } });
  const before = F.calls.filter((c) => c.url === "/v1/checkout/sessions" && c.method === "POST").length;
  const a = await cust.post("/api/bookings", bookingBody(gid, d, { time: "12:00 PM" }));
  const b = await cust.post("/api/bookings", bookingBody(gid, d, { time: "12:00 PM" }));
  assert.equal(b.json.booking.id, a.json.booking.id);
  assert.equal(b.json.payment.url, "https://checkout.stripe.test/resume"); // the still-open session from Stripe
  assert.equal(F.calls.filter((c) => c.url === "/v1/checkout/sessions" && c.method === "POST").length - before, 1);
  await cust.patch(`/api/bookings/${a.json.booking.id}`, { action: "cancel" });
});

test("double-tapping cancel while a refund is in flight refunds and records exactly once", async () => {
  const d = day(70);
  await owner.put(`/api/groups/${gid}/availability`, { dates: { [d]: ["12:00 PM"] } });
  const b = (await cust.post("/api/bookings", bookingBody(gid, d, { time: "12:00 PM" }))).json.booking;
  await postWebhook(S.base, completed(b), SECRET);
  const refundsBefore = F.calls.filter((c) => c.url === "/v1/refunds").length;
  F.state.refundDelay = 200;
  const [r1, r2] = await Promise.all([cust.patch(`/api/bookings/${b.id}`, { action: "cancel" }), cust.patch(`/api/bookings/${b.id}`, { action: "cancel" })]);
  F.state.refundDelay = 0;
  assert.deepEqual([r1.status, r2.status].sort(), [200, 400]); // second one is told it's already cancelled
  assert.equal(F.calls.filter((c) => c.url === "/v1/refunds").length - refundsBefore, 1);
  assert.equal(state(b.id).refund_cents, 15000); assert.equal(state(b.id).payment_status, "refunded");
  // a webhook racing with the return-from-checkout refresh marks it paid once
  const b2 = (await cust.post("/api/bookings", bookingBody(gid, d, { time: "12:00 PM" }))).json.booking;
  F.state.sessionPaid = true; F.state.sessionAmount = b2.deposit_cents;
  await Promise.all([cust.post(`/api/bookings/${b2.id}/refresh`), postWebhook(S.base, completed(b2), SECRET), cust.post(`/api/bookings/${b2.id}/refresh`)]);
  F.state.sessionPaid = false;
  assert.equal(state(b2.id).status, "requested"); assert.equal(state(b2.id).payment_status, "paid"); assert.equal(state(b2.id).refund_cents, 0);
});

test("late payments: revive the booking if the slot is free, otherwise refund", async () => {
  const d = day(60);
  await owner.put(`/api/groups/${gid}/availability`, { dates: { [d]: ["12:00 PM", "2:00 PM"] } });
  // A holds the slot, hold lapses, A's payment arrives late and nobody else took the slot: booking is revived
  const a = (await cust.post("/api/bookings", bookingBody(gid, d, { time: "12:00 PM" }))).json.booking;
  S.db.run("UPDATE bookings SET created_at = created_at - 4000 WHERE id = ?", a.id);
  (await cust.get("/api/my/bookings")); // triggers expiry
  await postWebhook(S.base, completed(a), SECRET);
  assert.equal(state(a.id).status, "requested"); assert.equal(state(a.id).payment_status, "paid");
  // C holds a slot, it lapses, D books the same slot, then C's money arrives: C is refunded, D keeps the slot
  const other = client(S.base); await other.signup("late@example.com", "Late Payer");
  const c = (await cust.post("/api/bookings", bookingBody(gid, d, { time: "2:00 PM" }))).json.booking;
  S.db.run("UPDATE bookings SET created_at = created_at - 4000 WHERE id = ?", c.id);
  const dBook = await other.post("/api/bookings", bookingBody(gid, d, { time: "2:00 PM" }));
  assert.equal(dBook.status, 200);
  await postWebhook(S.base, completed(c), SECRET);
  assert.equal(state(c.id).payment_status, "refunded"); assert.notEqual(state(c.id).status, "requested");
  assert.equal(state(dBook.json.booking.id).status, "pending_payment");
  assert.equal(lastCall((x) => x.url === "/v1/refunds").form.payment_intent, "pi_live_" + c.id);
});

test("featured placement in live mode: platform charge, no transfer, webhook activates it", async () => {
  const before = F.calls.length;
  const f = await owner.post(`/api/groups/${gid}/feature`);
  assert.equal(f.status, 200); assert.equal(f.json.simulated, undefined);
  const c = F.calls.slice(before).find((x) => x.url === "/v1/checkout/sessions");
  assert.equal(c.form["line_items[0][price_data][unit_amount]"], "4900");
  assert.equal(c.form["payment_intent_data[transfer_data][destination]"], undefined);
  assert.equal((await owner.post(`/api/feature/${f.json.id}/simulate-pay`)).status, 400);
  assert.equal(S.db.get("SELECT promoted_until p FROM groups WHERE id = ?", gid).p, 0);
  await postWebhook(S.base, evt("checkout.session.completed", { payment_status: "paid", amount_total: 4900, metadata: { kind: "feature", feature_id: f.json.id } }), SECRET);
  assert.ok(S.db.get("SELECT promoted_until p FROM groups WHERE id = ?", gid).p > Date.now() / 1000 + 29 * 86400);
});

test("webhook is refused when no secret is configured", async () => {
  const T = await startApp({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_API_BASE: F.url });
  const res = await fetch(T.base + "/api/stripe/webhook", { method: "POST", headers: { "Stripe-Signature": "t=1,v1=00" }, body: "{}" });
  assert.equal(res.status, 503);
  await T.close();
});
