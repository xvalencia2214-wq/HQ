import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody, fakeStripe, postWebhook } from "./helpers.js";

// A confirmed booking: 2h x $300 = $600 total, $150 deposit, $450 balance.
async function confirmed(S, owner, cust, gid, date, { balance = false, time = "2:00 PM" } = {}) {
  const b = (await cust.post("/api/bookings", bookingBody(gid, date, { time }))).json.booking;
  if (S.ctx.stripe.live) await postWebhook(S.base, { id: "evt_dep_" + b.id, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: b.deposit_cents, payment_intent: "pi_dep_" + b.id, metadata: { kind: "booking", booking_id: b.id } } } }, "whsec_s");
  else await cust.post(`/api/bookings/${b.id}/simulate-pay`);
  await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
  if (balance) {
    if (S.ctx.stripe.live) await postWebhook(S.base, { id: "evt_bal_" + b.id, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: 45000, payment_intent: "pi_bal_" + b.id, metadata: { kind: "balance", booking_id: b.id } } } }, "whsec_s");
    else await cust.post(`/api/bookings/${b.id}/simulate-pay-balance`);
  }
  return b;
}
const setDate = (S, id, d) => S.db.run("UPDATE bookings SET date = ? WHERE id = ?", d, id);
const mails = (S, kind) => S.db.all("SELECT to_email, subject, body FROM email_log WHERE kind = ? ORDER BY id", kind).map((m) => ({ ...m }));
const custView = async (c, id) => (await c.get("/api/my/bookings")).json.bookings.find((x) => x.id === id);
const ownView = async (o, gid, id) => (await o.get(`/api/groups/${gid}/bookings`)).json.bookings.find((x) => x.id === id);

test("check-in: the customer's 4-digit code appears only around the event, only the group can use it, once, on the day", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), cust = client(S.base), other = client(S.base);
    await owner.signup("ci-o@example.com", "Ci Owner"); await cust.signup("ci-c@example.com", "Ci Cust"); await other.signup("ci-x@example.com", "Ci Other");
    const gid = await makeGroup(owner, { name: "Checkin Band", dates: [inDays(30), inDays(31)] });
    const b = await confirmed(S, owner, cust, gid, inDays(30));
    assert.equal((await custView(cust, b.id)).checkin_code, undefined); // a month away: no code yet
    const chk = (c, body) => c.post(`/api/bookings/${b.id}/checkin`, body);
    setDate(S, b.id, inDays(1));
    const tomorrow = (await custView(cust, b.id)).checkin_code; assert.match(tomorrow, /^\d{4}$/); // the day before: the customer can already see it
    assert.equal((await ownView(owner, gid, b.id)).can_checkin, false); assert.equal((await ownView(owner, gid, b.id)).checkin_code, undefined); // the group never sees the code
    assert.equal((await chk(owner, { code: tomorrow })).status, 400); // ...and can't check in early
    setDate(S, b.id, inDays(0));
    const code = (await custView(cust, b.id)).checkin_code; assert.equal(code, tomorrow); // stable, not regenerated
    assert.equal((await ownView(owner, gid, b.id)).can_checkin, true);
    assert.equal((await chk(cust, { code })).status, 404); // the customer can't check the group in
    assert.equal((await chk(other, { code })).status, 404);
    assert.equal((await chk(client(S.base), { code })).status, 401);
    const wrong = String((Number(code) % 9000) + 1000 + 1).slice(0, 4);
    const bad = await chk(owner, { code: wrong === code ? "0000" : wrong }); assert.equal(bad.status, 400); assert.match(bad.json.error, /isn't right/);
    assert.equal((await chk(owner, {})).status, 400);
    assert.equal(S.db.get("SELECT checked_in_at c FROM bookings WHERE id = ?", b.id).c, 0);
    const ok = await chk(owner, { code });
    assert.equal(ok.status, 200); assert.equal(ok.json.booking.checked_in, true); assert.equal(ok.json.booking.can_checkin, false);
    assert.match(mails(S, "checkin.customer")[0].subject, /checked in/);
    assert.equal((await chk(owner, { code })).status, 400); // once
    const cv = await custView(cust, b.id); assert.equal(cv.checked_in, true); assert.equal(cv.checkin_code, undefined); // the code is retired
    assert.equal(cv.can_report_noshow, false);
    // an unconfirmed booking can't be checked in, and code guessing is capped
    const b2 = (await cust.post("/api/bookings", bookingBody(gid, inDays(31), { time: "4:00 PM" }))).json.booking; setDate(S, b2.id, inDays(0));
    assert.equal((await owner.post(`/api/bookings/${b2.id}/checkin`, { code: "1234" })).status, 400);
    await cust.post(`/api/bookings/${b2.id}/simulate-pay`); await owner.patch(`/api/bookings/${b2.id}`, { action: "accept" });
    const real = (await custView(cust, b2.id)).checkin_code, miss = real === "1111" ? "2222" : "1111";
    // guessing is hard-capped: 3 wrong codes lock this booking's check-in, and even the RIGHT code is refused while locked
    const tries = [];
    for (let i = 0; i < 3; i++) tries.push(await owner.post(`/api/bookings/${b2.id}/checkin`, { code: miss }));
    assert.deepEqual(tries.map((r) => r.status), [400, 400, 400]);
    assert.match(tries[0].json.error, /2 tries left/); assert.match(tries[2].json.error, /locked/);
    const locked = await owner.post(`/api/bookings/${b2.id}/checkin`, { code: real });
    assert.equal(locked.status, 429); assert.match(locked.json.error, /The group arrived/);
    assert.equal(S.db.get("SELECT checked_in_at c FROM bookings WHERE id = ?", b2.id).c, 0);
    const ov2 = await ownView(owner, gid, b2.id); assert.deepEqual([ov2.checkin_locked, ov2.can_checkin], [true, false]);
    // the lock is stored with the booking (a restart or a different IP doesn't reset it) and ends after 3 hours
    assert.ok(S.db.get("SELECT checkin_locked_until u FROM bookings WHERE id = ?", b2.id).u > Math.floor(Date.now() / 1000) + 3 * 3600 - 60);
    S.db.run("UPDATE bookings SET checkin_locked_until = ? WHERE id = ?", Math.floor(Date.now() / 1000) - 1, b2.id);
    assert.equal((await owner.post(`/api/bookings/${b2.id}/checkin`, { code: miss })).status, 400); // unlocked again: the next miss counts from zero
    assert.equal((await owner.post(`/api/bookings/${b2.id}/checkin`, { code: real })).status, 200);
    // the way out for a locked-out honest group: the customer confirms the arrival in their own app (event day only, theirs only)
    const b3 = (await cust.post("/api/bookings", bookingBody(gid, inDays(31), { time: "12:00 PM" }))).json.booking;
    await cust.post(`/api/bookings/${b3.id}/simulate-pay`); await owner.patch(`/api/bookings/${b3.id}`, { action: "accept" });
    const arrived = (c, id) => c.post(`/api/bookings/${id}/arrived`, {});
    assert.equal((await arrived(cust, b3.id)).status, 400); // not the event day yet
    setDate(S, b3.id, inDays(0));
    assert.equal((await custView(cust, b3.id)).can_confirm_arrival, true);
    assert.equal((await arrived(owner, b3.id)).status, 404); assert.equal((await arrived(client(S.base), b3.id)).status, 401); // only the customer
    const done = await arrived(cust, b3.id); assert.equal(done.status, 200); assert.deepEqual([done.json.booking.checked_in, done.json.booking.can_confirm_arrival], [true, false]);
    assert.equal((await arrived(cust, b3.id)).status, 400); // once
    assert.equal(S.db.get("SELECT checked_in_at c FROM bookings WHERE id = ?", b3.id).c > 0, true);
    setDate(S, b3.id, inDays(-1)); assert.equal((await custView(cust, b3.id)).can_report_noshow, false); // and a confirmed arrival blocks a no-show report, like a code check-in
  } finally { await S.close(); }
});

test("no-show: reportable only after the day, within 3 days, never after a check-in; the group can answer once; an admin decides", async () => {
  const S = await startApp({ ADMIN_EMAILS: "boss@example.com" });
  try {
    const owner = client(S.base), cust = client(S.base), other = client(S.base), boss = client(S.base);
    await owner.signup("ns-o@example.com", "Ns Owner"); await cust.signup("ns-c@example.com", "Ns Cust"); await other.signup("ns-x@example.com", "Ns Other"); await boss.signup("boss@example.com", "Boss");
    const gid = await makeGroup(owner, { name: "Noshow Band", dates: [inDays(30), inDays(31), inDays(32), inDays(33)] });
    const rep = (c, id, note = "Nobody came and nobody answered my messages") => c.post(`/api/bookings/${id}/noshow`, { note });
    const a = await confirmed(S, owner, cust, gid, inDays(30), { balance: true, time: "12:00 PM" });
    assert.equal((await rep(cust, a.id)).status, 400); // event hasn't happened
    setDate(S, a.id, inDays(0)); assert.equal((await rep(cust, a.id)).status, 400); // not until the day has passed
    setDate(S, a.id, inDays(-5)); const late = await rep(cust, a.id); assert.equal(late.status, 400); assert.match(late.json.error, /within 3 days/);
    setDate(S, a.id, inDays(-1));
    assert.equal((await custView(cust, a.id)).can_report_noshow, true);
    assert.equal((await rep(other, a.id)).status, 404); // someone else's booking
    assert.equal((await rep(cust, a.id, "no")).status, 400); // a real explanation is needed
    assert.equal((await rep(client(S.base), a.id)).status, 401);
    const done = await rep(cust, a.id); assert.equal(done.status, 200); assert.equal(done.json.booking.noshow.status, "reported"); assert.equal(done.json.booking.can_report_noshow, false);
    assert.equal((await rep(cust, a.id)).status, 400); // once
    assert.match(mails(S, "noshow.reported.group")[0].body, /did not show up/);
    // the group answers once; nobody else can
    const reply = (c, id, text = "We were there at 6 and the venue was locked") => c.post(`/api/bookings/${id}/noshow/reply`, { reply: text });
    assert.equal((await reply(cust, a.id)).status, 404); assert.equal((await reply(other, a.id)).status, 404);
    assert.equal((await reply(owner, a.id, "x")).status, 400);
    assert.equal((await ownView(owner, gid, a.id)).can_reply_noshow, true);
    assert.equal((await reply(owner, a.id)).status, 200); assert.equal((await reply(owner, a.id)).status, 400);
    assert.equal((await ownView(owner, gid, a.id)).noshow.reply, "We were there at 6 and the venue was locked");
    // a checked-in booking can't be reported
    const c = await confirmed(S, owner, cust, gid, inDays(31)); setDate(S, c.id, inDays(0));
    await owner.post(`/api/bookings/${c.id}/checkin`, { code: (await custView(cust, c.id)).checkin_code });
    setDate(S, c.id, inDays(-1)); const blocked = await rep(cust, c.id); assert.equal(blocked.status, 400); assert.match(blocked.json.error, /checked in/);
    // a report on a booking that wasn't paid or confirmed is refused
    const u = (await cust.post("/api/bookings", bookingBody(gid, inDays(32), { time: "4:00 PM" }))).json.booking; setDate(S, u.id, inDays(-1));
    assert.equal((await rep(cust, u.id)).status, 400);
    // admin: only the boss sees and decides
    assert.equal((await owner.post(`/api/admin/bookings/${a.id}/noshow`, { refund: true })).status, 404);
    const s = (await boss.get("/api/admin/summary")).json;
    assert.equal(s.noshow_reports.length, 1);
    assert.deepEqual({ id: s.noshow_reports[0].id, group: s.noshow_reports[0].group_name, paid: s.noshow_reports[0].paid_cents, reply: s.noshow_reports[0].noshow_reply }, { id: a.id, group: "Noshow Band", paid: 60000, reply: "We were there at 6 and the venue was locked" });
    assert.equal((await boss.post(`/api/admin/bookings/${u.id}/noshow`, { refund: true })).status, 400); // nothing to decide
    assert.equal((await boss.post(`/api/admin/bookings/nope/noshow`, { refund: true })).status, 404);
    const r = await boss.post(`/api/admin/bookings/${a.id}/noshow`, { refund: true });
    assert.deepEqual([r.status, r.json.status, r.json.refunded_cents], [200, "refunded", 60000]);
    const after = S.db.get("SELECT payment_status, refund_cents, balance_status, balance_refund_cents, noshow_status FROM bookings WHERE id = ?", a.id);
    assert.deepEqual({ ...after }, { payment_status: "refunded", refund_cents: 15000, balance_status: "refunded", balance_refund_cents: 45000, noshow_status: "refunded" });
    assert.match(mails(S, "noshow.refunded.customer")[0].subject, /\$600/);
    assert.equal((await custView(cust, a.id)).status, "cancelled"); assert.equal((await ownView(owner, gid, a.id)).status, "cancelled"); // not "Completed": the event didn't happen
    assert.equal((await boss.post(`/api/admin/bookings/${a.id}/noshow`, { refund: true })).status, 400); // decided once
    assert.equal((await custView(cust, a.id)).can_review, false); // no review for an event that didn't happen
    assert.ok(S.db.get("SELECT 1 AS x FROM admin_log WHERE action = 'no-show refund'"));
    assert.equal((await boss.get("/api/admin/summary")).json.noshow_reports.length, 0);
    // rejecting leaves the money alone and tells the customer
    const d = await confirmed(S, owner, cust, gid, inDays(33), { time: "12:00 PM" }); setDate(S, d.id, inDays(-2)); await rep(cust, d.id, "They did not come at all");
    const rj = await boss.post(`/api/admin/bookings/${d.id}/noshow`, { refund: false });
    assert.deepEqual([rj.status, rj.json.status], [200, "rejected"]);
    assert.equal(S.db.get("SELECT payment_status p FROM bookings WHERE id = ?", d.id).p, "paid");
    assert.match(mails(S, "noshow.rejected.customer")[0].body, /could not confirm/);
    assert.equal((await custView(cust, d.id)).noshow.status, "rejected");
  } finally { await S.close(); }
});

test("live Stripe: a no-show refund sends back the deposit (reversing the payout and fee) and the balance on its own payment; a Stripe failure changes nothing", async () => {
  const F = await fakeStripe();
  const S = await startApp({ STRIPE_SECRET_KEY: "sk_test_b", STRIPE_WEBHOOK_SECRET: "whsec_s", STRIPE_API_BASE: F.url, ADMIN_EMAILS: "boss@example.com", PLATFORM_FEE_PCT: "10" });
  try {
    const owner = client(S.base), cust = client(S.base), boss = client(S.base);
    await owner.signup("nl-o@example.com", "Nl Owner"); await cust.signup("nl-c@example.com", "Nl Cust"); await boss.signup("boss@example.com", "Boss");
    const gid = await makeGroup(owner, { name: "Live Noshow Band", dates: [inDays(30)] });
    const b = await confirmed(S, owner, cust, gid, inDays(30), { balance: true });
    setDate(S, b.id, inDays(-1));
    assert.equal((await cust.post(`/api/bookings/${b.id}/noshow`, { note: "Nobody showed up at all" })).status, 200);
    F.state.refunded.length = 0; F.state.failRefunds = true;
    const failed = await boss.post(`/api/admin/bookings/${b.id}/noshow`, { refund: true });
    assert.ok(failed.status >= 500, `expected a server error, got ${failed.status}`);
    assert.equal(S.db.get("SELECT noshow_status s FROM bookings WHERE id = ?", b.id).s, "reported"); // still open, retryable
    F.state.failRefunds = false;
    const ok = await boss.post(`/api/admin/bookings/${b.id}/noshow`, { refund: true });
    assert.equal(ok.status, 200);
    assert.deepEqual(F.state.refunded.map((r) => [r.pi, r.amount]).sort(), [["pi_bal_" + b.id, 45000], ["pi_dep_" + b.id, 15000]].sort());
    const dep = [...F.calls].reverse().find((x) => x.url === "/v1/refunds" && x.form.payment_intent === "pi_dep_" + b.id);
    assert.equal(dep.form.reverse_transfer, "true"); assert.equal(dep.form.refund_application_fee, "true");
    const bal = [...F.calls].reverse().find((x) => x.url === "/v1/refunds" && x.form.payment_intent === "pi_bal_" + b.id);
    assert.equal(bal.form.reverse_transfer, "true"); assert.equal(bal.form.refund_application_fee, undefined);
  } finally { await S.close(); await F.close(); }
});
