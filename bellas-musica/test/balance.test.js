import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody, fakeStripe, postWebhook } from "./helpers.js";

// A confirmed booking: 2h x $300 = $600 total, $150 deposit (25%), $450 balance, moderate policy.
async function confirmed(S, owner, cust, gid, date, over = {}) {
  const b = (await cust.post("/api/bookings", bookingBody(gid, date, over))).json.booking;
  if (S.ctx.stripe.live) await postWebhook(S.base, { id: "evt_dep_" + b.id, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: b.deposit_cents, payment_intent: "pi_dep_" + b.id, metadata: { kind: "booking", booking_id: b.id } } } }, "whsec_b");
  else await cust.post(`/api/bookings/${b.id}/simulate-pay`);
  await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
  return b;
}
const row = (S, id) => S.db.get("SELECT status, payment_status, refund_cents, balance_status, balance_refund_cents, balance_pi FROM bookings WHERE id = ?", id);
const extra = (S) => S.db.all("SELECT booking_id, payment_intent, cents, reason FROM extra_refunds").map((e) => ({ ...e }));

test("simulated: balance is payable only after the group confirms, once, and both sides are told", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), cust = client(S.base), other = client(S.base);
    await owner.signup("bl-o@example.com", "Bal Owner"); await cust.signup("bl-c@example.com", "Bal Cust"); await other.signup("bl-x@example.com", "Bal Other");
    const d = inDays(30), d2 = inDays(31);
    const gid = await makeGroup(owner, { name: "Balance Band", dates: [d, d2] });
    const b = (await cust.post("/api/bookings", bookingBody(gid, d))).json.booking;
    assert.equal((await cust.post(`/api/bookings/${b.id}/balance`)).status, 400); // unpaid deposit
    await cust.post(`/api/bookings/${b.id}/simulate-pay`);
    assert.equal((await cust.post(`/api/bookings/${b.id}/balance`)).status, 400); // not confirmed yet
    await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
    let mineView = (await cust.get("/api/my/bookings")).json.bookings.find((x) => x.id === b.id);
    assert.equal(mineView.can_pay_balance, true); assert.equal(mineView.balance_cents, 45000); assert.equal(mineView.balance_status, "unpaid");
    assert.equal((await other.post(`/api/bookings/${b.id}/balance`)).status, 404);
    const pay = await cust.post(`/api/bookings/${b.id}/balance`); assert.equal(pay.json.payment.mode, "simulated"); assert.match(pay.json.payment.url, /#\/pay\/balance\//);
    assert.equal((await other.post(`/api/bookings/${b.id}/simulate-pay-balance`)).status, 404);
    const done = await cust.post(`/api/bookings/${b.id}/simulate-pay-balance`);
    assert.equal(done.json.booking.balance_status, "paid"); assert.equal(done.json.booking.can_pay_balance, false);
    assert.equal((await cust.post(`/api/bookings/${b.id}/balance`)).status, 400); // already paid
    assert.equal((await cust.post(`/api/bookings/${b.id}/simulate-pay-balance`)).status, 200); // a repeat is harmless...
    assert.equal(S.db.all("SELECT * FROM email_log WHERE kind = 'balance.paid.customer'").length, 1); // ...and doesn't email twice
    assert.match(S.db.get("SELECT body FROM email_log WHERE kind = 'balance.paid.group'").body, /paid the \$450 balance/);
    assert.deepEqual(extra(S), []); // a repeat with the same payment id is not a duplicate payment
    // the group's booking view shows it; it can't be marked as received in cash any more
    const ov = (await owner.get(`/api/groups/${gid}/bookings`)).json.bookings.find((x) => x.id === b.id);
    assert.equal(ov.balance_status, "paid"); assert.equal(ov.can_mark_balance_offline, false);
    assert.equal((await owner.post(`/api/bookings/${b.id}/balance-offline`, { received: true })).status, 400);
    // event day is still payable, the day after is not
    const b2 = await confirmed(S, owner, cust, gid, d2, { time: "12:00 PM" });
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-1), b2.id);
    assert.equal((await cust.post(`/api/bookings/${b2.id}/balance`)).status, 400);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), b2.id);
    assert.equal((await cust.post(`/api/bookings/${b2.id}/balance`)).status, 200);
  } finally { await S.close(); }
});

test("offline balance: the group can record cash/Zelle, which blocks in-app payment until undone", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), cust = client(S.base), other = client(S.base);
    await owner.signup("of-o@example.com", "Off Owner"); await cust.signup("of-c@example.com", "Off Cust"); await other.signup("of-x@example.com", "Off Other");
    const d = inDays(30); const gid = await makeGroup(owner, { name: "Cash Band", dates: [d] });
    const b = await confirmed(S, owner, cust, gid, d);
    assert.equal((await other.post(`/api/bookings/${b.id}/balance-offline`, { received: true })).status, 404);
    assert.equal((await cust.post(`/api/bookings/${b.id}/balance-offline`, { received: true })).status, 404); // customers can't mark themselves paid
    assert.equal((await owner.post(`/api/bookings/${b.id}/balance-offline`, { received: false })).status, 400); // nothing to undo yet
    assert.equal((await owner.post(`/api/bookings/${b.id}/balance-offline`, { received: true })).json.booking.balance_status, "offline");
    assert.equal((await owner.post(`/api/bookings/${b.id}/balance-offline`, { received: true })).status, 400);
    assert.equal((await cust.post(`/api/bookings/${b.id}/balance`)).status, 400); assert.match((await cust.post(`/api/bookings/${b.id}/balance`)).json.error, /already marked/);
    assert.equal((await cust.get("/api/my/bookings")).json.bookings[0].can_pay_balance, false);
    // customer cancels 5 days out: only the deposit was paid in the app, so only it is refunded by the policy (50%)
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(5), b.id);
    const c = await cust.patch(`/api/bookings/${b.id}`, { action: "cancel" });
    assert.equal(c.json.booking.refund_cents, 7500); assert.equal(c.json.booking.balance_refund_cents, 0); assert.equal(row(S, b.id).balance_status, "offline");
    // undo works while confirmed
    const d2 = inDays(32); await owner.put(`/api/groups/${gid}/availability`, { dates: { [d2]: ["12:00 PM"] } });
    const b2 = await confirmed(S, owner, cust, gid, d2, { time: "12:00 PM" });
    await owner.post(`/api/bookings/${b2.id}/balance-offline`, { received: true });
    assert.equal((await owner.post(`/api/bookings/${b2.id}/balance-offline`, { received: false })).json.booking.balance_status, "unpaid");
    assert.equal((await cust.post(`/api/bookings/${b2.id}/balance`)).status, 200);
  } finally { await S.close(); }
});

test("cancelling refunds the policy percentage of EVERYTHING paid in the app; the group cancelling refunds all of it", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("rf-o@example.com", "Ref Owner"); await cust.signup("rf-c@example.com", "Ref Cust");
    const ds = [inDays(40), inDays(41), inDays(42)]; const gid = await makeGroup(owner, { name: "Refund Band", dates: ds });
    const withBalance = async (d, daysOut) => { const b = await confirmed(S, owner, cust, gid, d); await cust.post(`/api/bookings/${b.id}/simulate-pay-balance`); S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(daysOut), b.id); return b; };
    // 5 days out on a Moderate policy = 50% of the $150 deposit and 50% of the $450 balance
    const a = await withBalance(ds[0], 5);
    assert.equal((await cust.get("/api/my/bookings")).json.bookings.find((x) => x.id === a.id).refund_if_cancel_cents, 7500 + 22500); // the preview shows both
    const ca = (await cust.patch(`/api/bookings/${a.id}`, { action: "cancel" })).json.booking;
    assert.deepEqual([ca.refund_cents, ca.balance_refund_cents, ca.payment_status, ca.balance_status], [7500, 22500, "partial_refund", "partial_refund"]);
    // 10 days out = everything back
    const b = await withBalance(ds[1], 10);
    const cb = (await cust.patch(`/api/bookings/${b.id}`, { action: "cancel" })).json.booking;
    assert.deepEqual([cb.refund_cents, cb.balance_refund_cents, cb.payment_status, cb.balance_status], [15000, 45000, "refunded", "refunded"]);
    // 1 day out: nothing back, but the cancellation still goes through
    const c = await withBalance(ds[2], 1);
    const cc = (await cust.patch(`/api/bookings/${c.id}`, { action: "cancel" })).json.booking;
    assert.deepEqual([cc.refund_cents, cc.balance_refund_cents, cc.status, cc.balance_status], [0, 0, "cancelled", "paid"]);
    // the group cancelling gives everything back regardless of timing
    const d4 = inDays(43); await owner.put(`/api/groups/${gid}/availability`, { dates: { [d4]: ["12:00 PM"] } });
    const e = await confirmed(S, owner, cust, gid, d4, { time: "12:00 PM" }); await cust.post(`/api/bookings/${e.id}/simulate-pay-balance`); S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(1), e.id);
    const oe = (await owner.patch(`/api/bookings/${e.id}`, { action: "cancel" })).json.booking;
    assert.deepEqual([oe.refund_cents, oe.balance_refund_cents, oe.payment_status, oe.balance_status], [15000, 45000, "refunded", "refunded"]);
    assert.match(S.db.get("SELECT body FROM email_log WHERE kind = 'booking.cancelled.customer'").body, /\$600/); // the email states the whole refund
  } finally { await S.close(); }
});

test("live Stripe: the balance is charged to the group with no extra fee and refunded on its own payment", async () => {
  const F = await fakeStripe();
  const S = await startApp({ STRIPE_SECRET_KEY: "sk_test_b", STRIPE_WEBHOOK_SECRET: "whsec_b", STRIPE_API_BASE: F.url, PLATFORM_FEE_PCT: "10" });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("lb-o@example.com", "Lb Owner"); await cust.signup("lb-c@example.com", "Lb Cust");
    const d = inDays(40); const gid = await makeGroup(owner, { name: "Live Balance Band", dates: [d] });
    const b = await confirmed(S, owner, cust, gid, d);
    const before = F.calls.length;
    const pay = await cust.post(`/api/bookings/${b.id}/balance`);
    assert.equal(pay.json.payment.mode, "stripe");
    const c = F.calls.slice(before).find((x) => x.url === "/v1/checkout/sessions" && x.method === "POST");
    assert.equal(c.form["line_items[0][price_data][unit_amount]"], "45000"); // the $450 balance
    assert.equal(c.form["payment_intent_data[transfer_data][destination]"], "acct_test_1");
    assert.equal(c.form["payment_intent_data[application_fee_amount]"], undefined); // the fee was already taken from the deposit
    assert.equal(c.form["metadata[kind]"], "balance"); assert.match(c.idem, /^checkout-balance-/);
    assert.equal((await cust.post(`/api/bookings/${b.id}/simulate-pay-balance`)).status, 400); // simulated payments are off
    // webhook: wrong amount ignored, right one accepted once, replay harmless
    const ev = (over = {}) => ({ id: "evt_bal_" + Math.random().toString(36).slice(2), type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: 45000, payment_intent: "pi_bal_1", metadata: { kind: "balance", booking_id: b.id }, ...over } } });
    await postWebhook(S.base, ev({ amount_total: 100 }), "whsec_b"); assert.equal(row(S, b.id).balance_status, "unpaid");
    await postWebhook(S.base, ev(), "whsec_b"); assert.deepEqual([row(S, b.id).balance_status, row(S, b.id).balance_pi], ["paid", "pi_bal_1"]);
    await postWebhook(S.base, ev(), "whsec_b"); assert.deepEqual(extra(S), []);
    // cancel 5 days out: the balance is refunded on ITS payment (not the deposit's), without touching an app fee
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(5), b.id);
    F.state.refunded.length = 0;
    const cx = (await cust.patch(`/api/bookings/${b.id}`, { action: "cancel" })).json.booking;
    assert.deepEqual(F.state.refunded.map((r) => [r.pi, r.amount]).sort(), [["pi_bal_1", 22500], ["pi_dep_" + b.id, 7500]].sort());
    const balRefund = [...F.calls].reverse().find((x) => x.url === "/v1/refunds" && x.form.payment_intent === "pi_bal_1");
    assert.equal(balRefund.form.reverse_transfer, "true"); assert.equal(balRefund.form.refund_application_fee, undefined); assert.match(balRefund.idem, /^refund-bal-/);
    const depRefund = [...F.calls].reverse().find((x) => x.url === "/v1/refunds" && x.form.payment_intent === "pi_dep_" + b.id);
    assert.equal(depRefund.form.refund_application_fee, "true");
    assert.deepEqual([cx.refund_cents, cx.balance_refund_cents], [7500, 22500]);
  } finally { await S.close(); await F.close(); }
});

test("live Stripe: a payment that must not stand is refunded in full and recorded (second payment, after cancel, after cash)", async () => {
  const F = await fakeStripe();
  const S = await startApp({ STRIPE_SECRET_KEY: "sk_test_b", STRIPE_WEBHOOK_SECRET: "whsec_b", STRIPE_API_BASE: F.url });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("st-o@example.com", "St Owner"); await cust.signup("st-c@example.com", "St Cust");
    const ds = [inDays(40), inDays(41), inDays(42)]; const gid = await makeGroup(owner, { name: "Stray Band", dates: ds });
    const hook = async (b, pi, amount = 45000) => postWebhook(S.base, { id: "evt_" + pi, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: amount, payment_intent: pi, metadata: { kind: "balance", booking_id: b.id } } } }, "whsec_b");
    // 1) the customer paid the balance twice (two checkout sessions): the second payment goes back
    const a = await confirmed(S, owner, cust, gid, ds[0]);
    await hook(a, "pi_first"); await hook(a, "pi_second");
    assert.equal(row(S, a.id).balance_pi, "pi_first"); assert.deepEqual(F.state.refunded.filter((r) => r.pi === "pi_second"), [{ pi: "pi_second", amount: 45000 }]);
    assert.deepEqual(extra(S).filter((e) => e.booking_id === a.id), [{ booking_id: a.id, payment_intent: "pi_second", cents: 45000, reason: "second payment of the balance" }]);
    // 2) money arrives after the booking was cancelled
    const b = await confirmed(S, owner, cust, gid, ds[1]);
    await cust.patch(`/api/bookings/${b.id}`, { action: "cancel" });
    await hook(b, "pi_late");
    assert.equal(row(S, b.id).balance_status, "unpaid"); assert.ok(F.state.refunded.some((r) => r.pi === "pi_late" && r.amount === 45000));
    assert.match(extra(S).find((e) => e.payment_intent === "pi_late").reason, /booking is cancelled/);
    // 3) the group marked the balance as received in cash while the customer's checkout was open: it is closed, and a payment that still lands is refunded
    const c = await confirmed(S, owner, cust, gid, ds[2]);
    await cust.post(`/api/bookings/${c.id}/balance`);
    const calls = F.calls.length;
    assert.equal((await owner.post(`/api/bookings/${c.id}/balance-offline`, { received: true })).status, 200);
    assert.ok(F.calls.slice(calls).some((x) => /\/expire$/.test(x.url))); // the open checkout was expired
    await hook(c, "pi_race");
    assert.equal(row(S, c.id).balance_status, "offline"); assert.ok(F.state.refunded.some((r) => r.pi === "pi_race"));
    assert.match(extra(S).find((e) => e.payment_intent === "pi_race").reason, /already marked received/);
    // 4) returning from checkout without the webhook also completes a payment
    S.db.run("UPDATE bookings SET balance_status = 'unpaid' WHERE id = ?", c.id);
    F.state.sessionPaid = true; F.state.sessionAmount = 45000;
    await cust.post(`/api/bookings/${c.id}/refresh`);
    assert.equal(row(S, c.id).balance_status, "paid"); F.state.sessionPaid = false;
  } finally { await S.close(); await F.close(); }
});

test("event reminders say whether a balance is still due", async () => {
  const S = await startApp();
  try {
    const { sendEventReminders } = await import("../server/jobs.js");
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("rb-o@example.com", "Rb Owner"); await cust.signup("rb-c@example.com", "Rb Cust");
    const ds = [inDays(40), inDays(41)]; const gid = await makeGroup(owner, { name: "Reminder Bal Band", dates: ds });
    const due = await confirmed(S, owner, cust, gid, ds[0]), paid = await confirmed(S, owner, cust, gid, ds[1], { time: "12:00 PM" });
    await cust.post(`/api/bookings/${paid.id}/simulate-pay-balance`);
    S.db.run("UPDATE bookings SET date = ?", inDays(1)); // both tomorrow (test shortcut; same group, different times don't matter for reminders)
    sendEventReminders(S.ctx, { hour: 12 });
    const mails = S.db.all("SELECT body FROM email_log WHERE kind = 'event.reminder.customer'").map((m) => m.body);
    assert.ok(mails.some((m) => /Balance still due: \$450/.test(m))); assert.ok(mails.some((m) => /Your balance is paid/.test(m)));
    void due;
  } finally { await S.close(); }
});

test("the same stray payment reported twice (checkout return + webhook) is refunded and recorded once", async () => {
  const F = await fakeStripe();
  const S = await startApp({ STRIPE_SECRET_KEY: "sk_test_b", STRIPE_WEBHOOK_SECRET: "whsec_b", STRIPE_API_BASE: F.url });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("sr-o@example.com", "Sr Owner"); await cust.signup("sr-c@example.com", "Sr Cust");
    const d = inDays(40); const gid = await makeGroup(owner, { name: "Stray Twice Band", dates: [d] });
    const b = await confirmed(S, owner, cust, gid, d);
    await cust.patch(`/api/bookings/${b.id}`, { action: "cancel" });
    const ev = (id) => ({ id, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: 45000, payment_intent: "pi_dup", metadata: { kind: "balance", booking_id: b.id } } } });
    await postWebhook(S.base, ev("evt_1"), "whsec_b"); await postWebhook(S.base, ev("evt_2"), "whsec_b"); // two different events for one payment
    assert.equal(extra(S).filter((e) => e.payment_intent === "pi_dup").length, 1);
    assert.equal(F.state.refunded.filter((r) => r.pi === "pi_dup").length, 1);
  } finally { await S.close(); await F.close(); }
});
