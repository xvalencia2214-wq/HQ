// Any start time, short sets, several crews, travel time: who can be booked when.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";
import { cleanEntries, startMinutes, fits } from "../server/schedule.js";
import { timeLabel, isTime } from "../server/pricing.js";

test("schedule helpers: entries, windows, overlaps", () => {
  assert.deepEqual(cleanEntries(["8:00 PM", "5:00 AM", "6:00 PM-11:00 PM", "8:00 PM"]), ["5:00 AM", "6:00 PM-11:00 PM", "8:00 PM"]);
  for (const bad of [["9:07 AM"], ["25:00 PM"], ["11:00 PM-6:00 PM"], ["6:00 PM-6:00 PM"], [5], "2:00 PM"]) assert.throws(() => cleanEntries(bad), /Bad time/, JSON.stringify(bad));
  assert.deepEqual(startMinutes(["7:00 PM-8:30 PM"]).map(timeLabel), ["7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM"]);
  assert.ok(isTime("12:00 AM") && isTime("11:45 PM") && !isTime("0:00 AM") && !isTime("12:10 PM"));
  const taken = [{ s: 600, e: 720 }, { s: 660, e: 780 }];
  assert.equal(fits(taken, 700, 760, 2), false); // both running at 11:40
  assert.equal(fits(taken, 720, 780, 2), true);  // the first ended at 12:00
  assert.equal(fits(taken, 500, 600, 1), true);  // ends exactly when the next starts
});

test("any start time, windows, short serenatas back to back, crews and travel time", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const o = client(S.base), c = client(S.base), c2 = client(S.base), anon = client(S.base);
    await o.signup("sch-o@example.com", "Sched Owner"); await c.signup("sch-c@example.com", "Sched Cust"); await c2.signup("sch-c2@example.com", "Sched Two");
    const d = inDays(20), d2 = inDays(21), d3 = inDays(22);
    const g = await makeGroup(o, { name: "Mariachi Madrugada", dates: [d] });
    const open = async (day, minutes) => (await anon.get(`/api/groups/${g}/availability?month=${day.slice(0, 7)}${minutes ? "&minutes=" + minutes : ""}`)).json.days[day] || [];

    // mañanitas at 5 AM and a window for the evening
    assert.equal((await o.put(`/api/groups/${g}/availability`, { dates: { [d]: ["5:00 AM", "6:00 PM-9:00 PM"] } })).status, 200);
    assert.deepEqual(await open(d), ["5:00 AM", "6:00 PM", "6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM"]);
    const cal = (await o.get(`/api/groups/${g}/calendar?month=${d.slice(0, 7)}`)).json;
    assert.deepEqual(cal.days[d], ["5:00 AM", "6:00 PM-9:00 PM"]);
    const early = await c.post("/api/bookings", bookingBody(g, d, { time: "5:00 AM", hours: 1, event: "Birthday" }));
    assert.equal(early.status, 200); assert.equal(early.json.booking.duration_min, 60);
    assert.ok(!(await open(d)).includes("5:00 AM"));
    // a time inside a window that isn't on a 30-minute step, or outside every window, can't be booked
    assert.equal((await c.post("/api/bookings", bookingBody(g, d, { time: "6:15 PM" }))).status, 409);
    assert.equal((await c.post("/api/bookings", bookingBody(g, d, { time: "10:00 PM" }))).status, 409);
    // a 3-hour booking at 6 PM takes the evening until 9; a 2-hour one can't start at 7
    const eve = await c.post("/api/bookings", bookingBody(g, d, { time: "6:00 PM", hours: 3 }));
    assert.equal(eve.status, 200);
    assert.deepEqual(await open(d), ["9:00 PM"]);
    const q = await c2.post("/api/quote", bookingBody(g, d, { time: "8:30 PM", hours: 2 }));
    assert.equal(q.status, 200); assert.equal(q.json.fits, false);
    assert.match((await c2.post("/api/bookings", bookingBody(g, d, { time: "8:30 PM", hours: 2 }))).json.error, /taken for 2 hours/);

    // 20-minute serenatas booked back to back in a window
    const pk = await o.post(`/api/groups/${g}/packages`, { name: "Serenata", description: "3 songs", minutes: 20, price: 250 });
    assert.equal(pk.status, 200);
    const sere = pk.json.packages.find((p) => p.name === "Serenata");
    assert.equal(sere.minutes, 20);
    assert.equal((await o.post(`/api/groups/${g}/packages`, { name: "Odd", minutes: 25, price: 100 })).status, 400);
    await o.put(`/api/groups/${g}/availability`, { dates: { [d2]: ["7:00 PM-8:00 PM"] } });
    assert.deepEqual(await open(d2, 20), ["7:00 PM", "7:30 PM", "8:00 PM"]);
    const s1 = await c.post("/api/bookings", bookingBody(g, d2, { time: "7:00 PM", packageId: sere.id }));
    assert.equal(s1.status, 200); assert.equal(s1.json.booking.duration_min, 20);
    const s2 = await c2.post("/api/bookings", bookingBody(g, d2, { time: "7:30 PM", packageId: sere.id }));
    assert.equal(s2.status, 200);
    assert.deepEqual(await open(d2, 20), ["8:00 PM"]);
    // travel time: with 15 minutes to get to the next house, the 7:30 stop keeps them busy until 8:05, so 8:00 is gone
    assert.equal((await o.patch(`/api/groups/${g}`, { buffer_min: 15 })).status, 200);
    assert.equal((await o.patch(`/api/groups/${g}`, { buffer_min: 17 })).status, 400);
    assert.deepEqual(await open(d2, 20), []);
    assert.equal((await o.patch(`/api/groups/${g}`, { buffer_min: 0 })).status, 200);
    // the calendar shows the lengths of what's booked
    const cal2 = (await o.get(`/api/groups/${g}/calendar?month=${d2.slice(0, 7)}`)).json;
    assert.deepEqual(cal2.lengths[d2].map((x) => x.minutes), [20, 20]);

    // two lineups: two bookings at the same time, not three; can't go back to one while both are booked
    await o.put(`/api/groups/${g}/availability`, { dates: { [d3]: ["4:00 PM"] } });
    assert.equal((await o.patch(`/api/groups/${g}`, { capacity: 21 })).status, 400);
    assert.equal((await o.patch(`/api/groups/${g}`, { capacity: 2 })).json.capacity, 2);
    const a1 = await c.post("/api/bookings", bookingBody(g, d3, { time: "4:00 PM", hours: 2 }));
    assert.equal(a1.status, 200);
    assert.deepEqual(await open(d3), ["4:00 PM"]); // the second lineup is still free
    const a2 = await c2.post("/api/bookings", bookingBody(g, d3, { time: "4:00 PM", hours: 2 }));
    assert.equal(a2.status, 200);
    assert.deepEqual(await open(d3), []);
    const third = client(S.base); await third.signup("sch-c3@example.com", "Third");
    assert.equal((await third.post("/api/bookings", bookingBody(g, d3, { time: "4:00 PM", hours: 2 }))).status, 409);
    await c.post(`/api/bookings/${a1.json.booking.id}/simulate-pay`); await c2.post(`/api/bookings/${a2.json.booking.id}/simulate-pay`);
    assert.match((await o.patch(`/api/groups/${g}`, { capacity: 1 })).json.error, /2 bookings at the same time/);
  } finally { await S.close(); }
});

test("past midnight, moving a date, and a late payment for a time someone else took", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const o = client(S.base), c = client(S.base), c2 = client(S.base);
    await o.signup("mid-o@example.com", "Mid Owner"); await c.signup("mid-c@example.com", "Mid Cust"); await c2.signup("mid-c2@example.com", "Mid Two");
    const d = inDays(15), next = inDays(16), d4 = inDays(18);
    const g = await makeGroup(o, { name: "Trio Medianoche", dates: [d] });
    await o.put(`/api/groups/${g}/availability`, { dates: { [d]: ["10:00 PM"], [next]: ["12:00 AM", "12:30 AM", "1:00 AM"], [d4]: ["2:00 PM", "4:00 PM"] } });
    const late = await c.post("/api/bookings", bookingBody(g, d, { time: "10:00 PM", hours: 3 })); // 10 PM to 1 AM
    assert.equal(late.status, 200);
    const nextOpen = (await c2.get(`/api/groups/${g}/availability?month=${next.slice(0, 7)}`)).json.days[next] || [];
    assert.deepEqual(nextOpen, ["1:00 AM"]); // 12:00 and 12:30 AM run into the gig from the night before
    assert.equal((await c2.post("/api/bookings", bookingBody(g, next, { time: "12:30 AM", hours: 1 }))).status, 409);
    await c.post(`/api/bookings/${late.json.booking.id}/simulate-pay`);
    await o.patch(`/api/bookings/${late.json.booking.id}`, { action: "accept" });

    // moving a 3-hour booking to 2 PM on d4 is refused once someone holds 4 PM (2-5 PM would run into it)
    const other = await c2.post("/api/bookings", bookingBody(g, d4, { time: "4:00 PM", hours: 1 }));
    assert.equal(other.status, 200);
    assert.equal((await c.post(`/api/bookings/${late.json.booking.id}/reschedule`, { date: d4, time: "2:00 PM" })).status, 409);

    // an unpaid hold expires, someone else takes the time, then the first payment arrives late: it is refunded
    const h = await c.post("/api/bookings", bookingBody(g, d4, { time: "2:00 PM", hours: 1 }));
    assert.equal(h.status, 200);
    S.db.run("UPDATE bookings SET created_at = created_at - 3600 WHERE id = ?", h.json.booking.id);
    const taker = await c2.post("/api/bookings", bookingBody(g, d4, { time: "2:00 PM", hours: 1 }));
    assert.equal(taker.status, 200); // the hold expired, so the time was free again
    await c.post(`/api/bookings/${h.json.booking.id}/simulate-pay`);
    const row = S.db.get("SELECT status, payment_status FROM bookings WHERE id = ?", h.json.booking.id);
    assert.equal(row.payment_status, "refunded");
    assert.notEqual(row.status, "requested");
  } finally { await S.close(); }
});
