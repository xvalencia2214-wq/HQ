// Randomized stress test: many random actions, invariants checked after every step.
// Reproduce a failure by re-running with the printed seed.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody, fakeStripe, postWebhook } from "./helpers.js";

const rng = (seed) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

function checkInvariants(db, fake, log) {
  const fail = (msg, extra) => assert.fail(`${msg} ${JSON.stringify(extra)}\nlast actions:\n  ${log.slice(-12).join("\n  ")}`);
  for (const b of db.all("SELECT * FROM bookings")) {
    if (b.refund_cents < 0 || b.refund_cents > b.deposit_cents) fail("refund out of range", b);
    if (b.payment_status === "unpaid" && b.refund_cents !== 0) fail("unpaid but refunded", b);
    if (b.payment_status === "paid" && b.refund_cents !== 0) fail("paid but has refund", b);
    if (b.payment_status === "partial_refund" && !(b.refund_cents > 0 && b.refund_cents < b.deposit_cents)) fail("bad partial refund", b);
    if (b.payment_status === "refunded" && b.refund_cents !== b.deposit_cents) fail("refunded amount mismatch", b);
    if ((b.status === "requested" || b.status === "confirmed") && b.payment_status !== "paid") fail("live booking without a paid deposit", b);
    if (b.status === "declined" && b.payment_status !== "refunded") fail("declined but not fully refunded", b);
    if (b.status === "pending_payment" && b.payment_status !== "unpaid") fail("pending but paid", b);
    if (b.platform_fee_cents > b.deposit_cents || b.deposit_cents > b.total_cents) fail("money ordering broken", b);
  }
  const dup = db.get(`SELECT group_id, date, time, COUNT(*) c FROM bookings WHERE status IN ('pending_payment','requested','confirmed') GROUP BY group_id, date, time HAVING c > 1`);
  if (dup) fail("double-booked slot", dup);
  if (db.get("SELECT 1 AS x FROM reviews GROUP BY booking_id HAVING COUNT(*) > 1")) fail("duplicate review", {});
  if (fake) { // every cent we recorded as refunded was actually refunded by Stripe exactly once
    const byPi = new Map();
    for (const r of fake.state.refunded) byPi.set(r.pi, (byPi.get(r.pi) || 0) + r.amount);
    for (const b of db.all("SELECT stripe_payment_intent pi, SUM(refund_cents) r FROM bookings WHERE stripe_payment_intent != '' GROUP BY stripe_payment_intent")) {
      if ((byPi.get(b.pi) || 0) !== b.r) fail("Stripe refunds do not match our records", { pi: b.pi, stripe: byPi.get(b.pi) || 0, ours: b.r });
    }
  }
}

async function run(mode, seed, steps) {
  const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)];
  const fake = mode === "live" ? await fakeStripe() : null;
  const S = await startApp(mode === "live" ? { STRIPE_SECRET_KEY: "sk_test_f", STRIPE_WEBHOOK_SECRET: "whsec_f", STRIPE_API_BASE: fake.url } : {});
  const log = [];
  try {
    const owners = [client(S.base), client(S.base)], custs = [0, 1, 2, 3].map(() => client(S.base));
    await Promise.all([...owners.map((o, i) => o.signup(`fo${i}@example.com`, `Owner ${i}`)), ...custs.map((c, i) => c.signup(`fc${i}@example.com`, `Cust ${i} Name`))]);
    const dates = [12, 13, 14, 19, 20].map(inDays);
    const groups = [];
    for (const [i, o] of owners.entries()) for (const pol of ["flexible", "moderate", "strict"].slice(i, i + 2)) {
      const id = await makeGroup(o, { name: `Fuzz ${i} ${pol}`, dates, extra: { cancel_policy: pol } });
      if (fake) { await o.post(`/api/groups/${id}/stripe/onboard`); await o.post(`/api/groups/${id}/stripe/refresh`); }
      groups.push({ id, owner: o });
    }
    const bookings = []; // { id, group, cust }
    const ok = (r, what) => { if (r.status >= 500 && !(fake && fake.state.failRefunds && r.status === 502)) assert.fail(`${what} -> ${r.status} ${JSON.stringify(r.json)}\n  ${log.slice(-10).join("\n  ")}`); return r; };
    const pi = (b) => "pi_fz_" + b.id;
    const completed = (id, amount) => ({ id: `evt_${Math.floor(R() * 1e9)}`, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: amount, payment_intent: "pi_fz_" + id, metadata: { kind: "booking", booking_id: id } } } });

    for (let i = 0; i < steps; i++) {
      const roll = R() * 100, b = bookings.length ? pick(bookings) : null;
      let what;
      if (roll < 28 || !b) { // create
        const g = pick(groups), c = pick(custs);
        const body = bookingBody(g.id, pick(dates), { time: pick(["12:00 PM", "2:00 PM", "4:00 PM"]), hours: pick([1, 2, 3]), eventZip: pick(["60608", "77003"]) });
        what = `create ${g.id} ${body.date} ${body.time}`;
        const r = ok(await c.post("/api/bookings", body), what);
        if (r.status === 200) bookings.push({ id: r.json.booking.id, group: g, cust: c, deposit: r.json.booking.deposit_cents });
      } else if (roll < 50) { // pay (a webhook may repeat, or arrive late for an expired/cancelled booking)
        what = `pay ${b.id}`;
        if (fake) {
          const dep = S.db.get("SELECT deposit_cents d FROM bookings WHERE id = ?", b.id).d;
          const ev = completed(b.id, dep);
          ok(await postWebhook(S.base, ev, "whsec_f"), what);
          if (R() < 0.3) ok(await postWebhook(S.base, ev, "whsec_f"), what + " (replay)");
        } else ok(await b.cust.post(`/api/bookings/${b.id}/simulate-pay`), what);
      } else if (roll < 60) { what = `accept ${b.id}`; ok(await b.group.owner.patch(`/api/bookings/${b.id}`, { action: "accept" }), what); }
      else if (roll < 67) { what = `decline ${b.id}`; if (fake) fake.state.failRefunds = R() < 0.25; ok(await b.group.owner.patch(`/api/bookings/${b.id}`, { action: "decline" }), what + (fake?.state.failRefunds ? " [refund fails]" : "")); if (fake) fake.state.failRefunds = false; }
      else if (roll < 77) { what = `cancel(cust) ${b.id}`; if (fake) fake.state.failRefunds = R() < 0.2; ok(await b.cust.patch(`/api/bookings/${b.id}`, { action: "cancel" }), what); if (fake) fake.state.failRefunds = false; }
      else if (roll < 81) { what = `cancel(owner) ${b.id}`; ok(await b.group.owner.patch(`/api/bookings/${b.id}`, { action: "cancel" }), what); }
      else if (roll < 86) { what = `expire hold ${b.id}`; S.db.run("UPDATE bookings SET created_at = created_at - 4000 WHERE id = ? AND status = 'pending_payment'", b.id); ok(await b.cust.get("/api/my/bookings"), what); }
      else if (roll < 90) { what = `time passes ${b.id}`; S.db.run("UPDATE bookings SET date = ? WHERE id = ? AND status = 'confirmed'", inDays(-2), b.id); }
      else if (roll < 94) { what = `review ${b.id}`; ok(await b.cust.post(`/api/bookings/${b.id}/review`, { rating: 1 + Math.floor(R() * 5), text: "ok" }), what); }
      else if (roll < 97) { // two identical requests at once (double-tap)
        const act = pick(["cancel", "cancel", "accept", "decline"]); const who = act === "cancel" ? b.cust : b.group.owner;
        what = `double ${act} ${b.id}`;
        if (fake) fake.state.refundDelay = 30;
        const rs = await Promise.all([who.patch(`/api/bookings/${b.id}`, { action: act }), who.patch(`/api/bookings/${b.id}`, { action: act })]);
        if (fake) fake.state.refundDelay = 0;
        rs.forEach((r) => ok(r, what));
        assert.ok(rs.filter((r) => r.status === 200).length <= 1 || act === "accept" && false, `both double-${act} requests succeeded: ${b.id}`);
      } else { what = `chat ${b.group.id}`; ok(await b.cust.post(`/api/groups/${b.group.id}/messages`, { text: "Hola, tocan Volver Volver?" }), what); }
      log.push(what);
      checkInvariants(S.db, fake, log);
    }
    // the public calendar never offers a slot that is already taken
    for (const g of groups) for (const m of new Set(dates.map((d) => d.slice(0, 7)))) {
      const days = (await client(S.base).get(`/api/groups/${g.id}/availability?month=${m}`)).json.days;
      for (const [d, slots] of Object.entries(days)) for (const t of slots) assert.equal(S.db.get("SELECT COUNT(*) c FROM bookings WHERE group_id = ? AND date = ? AND time = ? AND status IN ('pending_payment','requested','confirmed')", g.id, d, t).c, 0, `offered a taken slot ${g.id} ${d} ${t}`);
    }
    const stats = S.db.all("SELECT status, COUNT(*) c FROM bookings GROUP BY status").map((r) => `${r.status}:${r.c}`).join(" ");
    return stats;
  } finally { await S.close(); if (fake) await fake.close(); }
}

for (const mode of ["simulated", "live"]) {
  test(`stress: ${mode} payments, 3 seeds x 250 random steps keep every invariant`, { timeout: 240_000 }, async () => {
    for (const seed of [7, 2024, 987654]) {
      const stats = await run(mode, seed, 250);
      console.log(`  ${mode} seed ${seed}: ${stats}`);
    }
  });
}
