import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

async function setup() {
  const S = await startApp();
  const owner = client(S.base), a = client(S.base), b = client(S.base), other = client(S.base);
  await owner.signup("rs-o@example.com", "Res Owner"); await a.signup("rs-a@example.com", "Res A"); await b.signup("rs-b@example.com", "Res B"); await other.signup("rs-x@example.com", "Res X");
  const ds = [inDays(40), inDays(41), inDays(42), inDays(43)];
  const gid = await makeGroup(owner, { name: "Move Band", dates: ds });
  const confirmed = async (c, d, time = "2:00 PM") => { const bk = (await c.post("/api/bookings", bookingBody(gid, d, { time }))).json.booking; await c.post(`/api/bookings/${bk.id}/simulate-pay`); await owner.patch(`/api/bookings/${bk.id}`, { action: "accept" }); return bk; };
  const open = async (d) => (await client(S.base).get(`/api/groups/${gid}/availability?month=${d.slice(0, 7)}`)).json.days[d] || [];
  const state = (id) => S.db.get("SELECT date, time, resched_status, resched_date, resched_time, resched_count, reminder7_sent, reminder1_sent, deposit_cents, payment_status FROM bookings WHERE id = ?", id);
  return { S, owner, a, b, other, ds, gid, confirmed, open, state };
}

test("reschedule: request, hold, accept moves the booking and frees the old slot; price and payment are untouched", async () => {
  const { S, owner, a, b, other, ds, gid, confirmed, open, state } = await setup();
  try {
    const bk = await confirmed(a, ds[0]);
    // validation
    const req = (body) => a.post(`/api/bookings/${bk.id}/reschedule`, body);
    assert.equal((await req({ date: ds[1], time: "8:00 PM" })).status, 409); // a real slot the group does not offer that day
    assert.equal((await req({ date: ds[1], time: "9:00 AM" })).status, 409); // a real time, not offered that day
    assert.equal((await req({ date: ds[1], time: "9:07 AM" })).status, 400); // not a time at all
    assert.equal((await req({ date: "2020-01-01", time: "2:00 PM" })).status, 400);
    assert.equal((await req({ date: ds[0], time: "2:00 PM" })).status, 400); // same time
    assert.equal((await req({ date: inDays(200), time: "2:00 PM" })).status, 409); // the group is not open then
    assert.equal((await b.post(`/api/bookings/${bk.id}/reschedule`, { date: ds[1], time: "2:00 PM" })).status, 404); // someone else's booking
    const ok = await req({ date: ds[1], time: "4:00 PM", note: "Grandma can't do Saturday" });
    assert.equal(ok.status, 200); assert.deepEqual(ok.json.booking.reschedule, { date: ds[1], time: "4:00 PM", note: "Grandma can't do Saturday" });
    assert.equal((await req({ date: ds[2], time: "4:00 PM" })).status, 400); // one request at a time
    assert.match(S.db.get("SELECT body FROM email_log WHERE kind = 'resched.requested.group'").body, /Grandma can't do Saturday/);
    // the requested slot is held: hidden from the public calendar and unbookable by others; the old slot stays taken until the group answers
    assert.ok(!(await open(ds[1])).includes("4:00 PM")); assert.ok((await open(ds[1])).includes("2:00 PM"));
    assert.equal((await other.post("/api/bookings", bookingBody(gid, ds[1], { time: "4:00 PM" }))).status, 409);
    assert.ok((await owner.get(`/api/groups/${gid}/calendar?month=${ds[1].slice(0, 7)}`)).json.booked[ds[1]].includes("4:00 PM")); // the owner's calendar shows it as held
    // only the group can answer
    assert.equal((await a.post(`/api/bookings/${bk.id}/reschedule/respond`, { accept: true })).status, 404);
    assert.equal((await other.post(`/api/bookings/${bk.id}/reschedule/respond`, { accept: true })).status, 404);
    const ov = (await owner.get(`/api/groups/${gid}/bookings`)).json.bookings.find((x) => x.id === bk.id); assert.equal(ov.can_respond_reschedule, true); assert.equal(ov.reschedule.date, ds[1]);
    // accept
    S.db.run("UPDATE bookings SET reminder7_sent = 1, reminder1_sent = 1 WHERE id = ?", bk.id);
    const acc = await owner.post(`/api/bookings/${bk.id}/reschedule/respond`, { accept: true });
    assert.equal(acc.status, 200); assert.equal(acc.json.booking.date, ds[1]); assert.equal(acc.json.booking.time, "4:00 PM"); assert.equal(acc.json.booking.reschedule, null);
    const st = state(bk.id); assert.deepEqual([st.resched_count, st.reminder7_sent, st.reminder1_sent, st.deposit_cents, st.payment_status, st.resched_status], [1, 0, 0, 15000, "paid", ""]);
    assert.ok((await open(ds[0])).includes("2:00 PM")); // the slot they left is free again
    assert.ok(!(await open(ds[1])).includes("4:00 PM")); // and the new one is theirs
    assert.match(S.db.get("SELECT subject FROM email_log WHERE kind = 'resched.accepted.customer'").subject, /New date confirmed/);
    assert.equal((await owner.post(`/api/bookings/${bk.id}/reschedule/respond`, { accept: true })).status, 400); // nothing left to answer
    // a booking can be moved twice, not three times
    assert.equal((await req({ date: ds[2], time: "4:00 PM" })).status, 200); await owner.post(`/api/bookings/${bk.id}/reschedule/respond`, { accept: true });
    assert.equal((await req({ date: ds[3], time: "4:00 PM" })).status, 400); assert.match((await req({ date: ds[3], time: "4:00 PM" })).json.error, /at most 2 times/);
    // the refund policy now counts from the NEW date
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(5), bk.id);
    assert.equal((await a.patch(`/api/bookings/${bk.id}`, { action: "cancel" })).json.booking.refund_cents, 7500);
  } finally { await S.close(); }
});

test("reschedule: decline, withdraw, cancel, ignore and removed-slot all release the held slot cleanly", async () => {
  const { S, owner, a, b, ds, gid, confirmed, open, state } = await setup();
  try {
    const bk = await confirmed(a, ds[0]);
    const ask = (d, t = "4:00 PM") => a.post(`/api/bookings/${bk.id}/reschedule`, { date: d, time: t });
    // decline: nothing changes, the customer is told, the slot is released
    await ask(ds[1]); assert.ok(!(await open(ds[1])).includes("4:00 PM"));
    const dec = await owner.post(`/api/bookings/${bk.id}/reschedule/respond`, { accept: false });
    assert.equal(dec.json.booking.date, ds[0]); assert.equal(state(bk.id).resched_count, 0); assert.ok((await open(ds[1])).includes("4:00 PM"));
    assert.match(S.db.get("SELECT subject FROM email_log WHERE kind = 'resched.declined.customer'").subject, /can't move your booking/);
    // withdraw
    await ask(ds[1]); assert.equal((await b.del(`/api/bookings/${bk.id}/reschedule`)).status, 404);
    assert.equal((await a.del(`/api/bookings/${bk.id}/reschedule`)).status, 200); assert.ok((await open(ds[1])).includes("4:00 PM"));
    assert.equal((await a.del(`/api/bookings/${bk.id}/reschedule`)).status, 400);
    // the booking is cancelled while a request is pending: the held slot comes back
    await ask(ds[1]); await a.patch(`/api/bookings/${bk.id}`, { action: "cancel" }); assert.ok((await open(ds[1])).includes("4:00 PM"));
    // a request the group ignores lapses after 3 days
    const bk2 = await confirmed(b, ds[2]);
    await b.post(`/api/bookings/${bk2.id}/reschedule`, { date: ds[3], time: "2:00 PM" }); assert.ok(!(await open(ds[3])).includes("2:00 PM"));
    S.db.run("UPDATE bookings SET resched_at = resched_at - ? WHERE id = ?", 73 * 3600, bk2.id);
    assert.ok((await open(ds[3])).includes("2:00 PM")); // released even before the hourly job runs
    assert.equal((await owner.post(`/api/bookings/${bk2.id}/reschedule/respond`, { accept: true })).status, 400);
    const { housekeeping } = await import("../server/jobs.js"); housekeeping(S.ctx); assert.equal(state(bk2.id).resched_status, "");
    // the group removed that slot from its calendar before answering
    await b.post(`/api/bookings/${bk2.id}/reschedule`, { date: ds[3], time: "4:00 PM" });
    await owner.put(`/api/groups/${gid}/availability`, { dates: { [ds[3]]: ["12:00 PM"] } });
    const gone = await owner.post(`/api/bookings/${bk2.id}/reschedule/respond`, { accept: true });
    assert.equal(gone.status, 409); assert.match(gone.json.error, /no longer on your calendar/); assert.equal(state(bk2.id).date, ds[2]);
    // too close to the event, and only confirmed bookings can move
    S.db.run("UPDATE bookings SET date = ?, resched_status = '' WHERE id = ?", inDays(1), bk2.id);
    assert.equal((await b.post(`/api/bookings/${bk2.id}/reschedule`, { date: ds[3], time: "12:00 PM" })).status, 400);
    assert.match((await b.post(`/api/bookings/${bk2.id}/reschedule`, { date: ds[3], time: "12:00 PM" })).json.error, /too close/);
    const pending = (await a.post("/api/bookings", bookingBody(gid, ds[1], { time: "12:00 PM" }))).json.booking;
    assert.equal((await a.post(`/api/bookings/${pending.id}/reschedule`, { date: ds[2], time: "12:00 PM" })).status, 400);
  } finally { await S.close(); }
});

test("two customers asking for the same slot at once: exactly one gets it", async () => {
  const { S, a, b, ds, confirmed, state } = await setup();
  try {
    const ba = await confirmed(a, ds[0], "12:00 PM"), bb = await confirmed(b, ds[1], "12:00 PM");
    const [r1, r2] = await Promise.all([a.post(`/api/bookings/${ba.id}/reschedule`, { date: ds[2], time: "4:00 PM" }), b.post(`/api/bookings/${bb.id}/reschedule`, { date: ds[2], time: "4:00 PM" })]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM bookings WHERE resched_status = 'pending'").c, 1);
    void state;
  } finally { await S.close(); }
});
