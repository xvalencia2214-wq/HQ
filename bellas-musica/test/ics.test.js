import test from "node:test";
import assert from "node:assert/strict";
import { bookingToIcs, parseTime } from "../server/ics.js";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

test("ics: times, end time, escaping and 75-byte folding", () => {
  assert.deepEqual([parseTime("12:00 PM"), parseTime("12:00 AM"), parseTime("2:00 PM"), parseTime("8:00 PM")], [[12, 0], [0, 0], [14, 0], [20, 0]]);
  const long = "Ana, Ñandú; comes \\ and\nnewline " + "x".repeat(200);
  const ics = bookingToIcs({ id: "b1", date: "2026-12-31", time: "8:00 PM", hours: 5, summary: "New Year's, Party", location: "Hall; Room 2", description: long, status: "confirmed" });
  assert.ok(ics.endsWith("\r\n") && !ics.includes("\n\n"));
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line.length}`);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /DTSTART:20261231T200000\r\n/);
  assert.match(unfolded, /DTEND:20270101T010000\r\n/); // crosses midnight into the new year
  assert.match(unfolded, /SUMMARY:New Year's\\, Party\r\n/);
  assert.match(unfolded, /LOCATION:Hall\; Room 2\r\n/);
  assert.match(unfolded, /DESCRIPTION:Ana\\, Ñandú\; comes \\\\ and\\nnewline x+\r\n/);
  assert.match(unfolded, /STATUS:CONFIRMED/);
  assert.match(bookingToIcs({ id: "b2", date: "2026-01-01", time: "2:00 PM", hours: 1, summary: "s", location: "l", description: "d", status: "requested" }), /STATUS:TENTATIVE/);
});

test("ics endpoint: customer and group can download an active booking; strangers and cancelled ones cannot", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), cust = client(S.base), stranger = client(S.base);
    await owner.signup("ics-o@example.com", "Ics Owner"); await cust.signup("ics-c@example.com", "Ics Cust"); await stranger.signup("ics-s@example.com", "Ics Other");
    const d = inDays(30);
    const gid = await makeGroup(owner, { name: "Calendar Band", dates: [d] });
    const b = (await cust.post("/api/bookings", bookingBody(gid, d, { time: "4:00 PM", address: "Casa, Chicago; back gate" }))).json.booking;
    await cust.post(`/api/bookings/${b.id}/simulate-pay`);
    const r = await fetch(S.base + `/api/bookings/${b.id}/ics`, { headers: { Cookie: await cookieOf(cust) } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/calendar/); assert.match(r.headers.get("content-disposition"), /attachment; filename="bellas-musica-\d{4}-\d{2}-\d{2}\.ics"/);
    const text = (await r.text()).replace(/\r\n /g, "");
    assert.match(text, /LOCATION:Casa\\, Chicago\; back gate/); assert.match(text, /STATUS:TENTATIVE/);
    assert.doesNotMatch(text, /555-0142|\+1312555/); // the group's copy hides the customer's phone until confirmed, the customer's copy never needs it
    assert.equal((await stranger.get(`/api/bookings/${b.id}/ics`)).status, 404);
    assert.equal((await client(S.base).get(`/api/bookings/${b.id}/ics`)).status, 401);
    await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
    const own = await (await fetch(S.base + `/api/bookings/${b.id}/ics`, { headers: { Cookie: await cookieOf(owner) } })).text();
    assert.match(own.replace(/\r\n /g, ""), /STATUS:CONFIRMED/); assert.match(own.replace(/\r\n /g, ""), /Phone: \+13125550142/);
    await cust.patch(`/api/bookings/${b.id}`, { action: "cancel" });
    assert.equal((await cust.get(`/api/bookings/${b.id}/ics`)).status, 400);
  } finally { await S.close(); }
});

// helper: log in again to read a raw cookie for fetch()
async function cookieOf(c) { const r = await c.raw("GET", "/api/me"); void r; return c.cookie(); }
