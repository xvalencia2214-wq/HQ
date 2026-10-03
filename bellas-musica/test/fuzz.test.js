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
  for (const b of db.all("SELECT * FROM bookings")) {
    const owed = b.total_cents - b.deposit_cents, paidIn = b.balance_parts_cents > 0 ? b.balance_parts_cents : owed;
    if (b.balance_refund_cents < 0 || b.balance_refund_cents > owed) fail("balance refund out of range", b);
    // balance paid in parts (installments, padrinos): the booking's totals equal the sum of its parts
    const pt = db.get("SELECT COALESCE(SUM(amount_cents), 0) paid, COALESCE(SUM(refund_cents), 0) ref, COALESCE(SUM(refund_cents > amount_cents), 0) bad FROM balance_parts WHERE booking_id = ? AND status IN ('paid','partial_refund','refunded')", b.id);
    if (pt.paid !== b.balance_parts_cents) fail("balance parts don't add up", { b, pt });
    if (b.balance_parts_cents > owed) fail("more than the balance was collected in parts", b);
    if (pt.bad) fail("a part refunded more than it paid", b);
    if (b.balance_parts_cents > 0 && pt.ref !== b.balance_refund_cents) fail("part refunds don't add up", { b, pt });
    if (b.balance_parts_cents > 0 && b.balance_pi !== "") fail("paid both in one payment and in parts", b);
    if (b.balance_status === "unpaid" && b.balance_parts_cents >= owed && owed > 0) fail("balance fully paid in parts but still marked unpaid", b);
    if (["unpaid", "offline"].includes(b.balance_status) && (b.balance_refund_cents !== 0 || b.balance_pi !== "")) fail("balance not paid but has a payment or refund", b);
    if (b.balance_status === "paid" && b.balance_refund_cents !== 0) fail("balance paid but has refund", b);
    if (b.balance_status === "partial_refund" && !(b.balance_refund_cents > 0 && b.balance_refund_cents < paidIn)) fail("bad partial balance refund", b);
    if (b.balance_status === "refunded" && b.balance_refund_cents !== paidIn) fail("balance refunded amount mismatch", b);
    if (["paid", "partial_refund", "refunded"].includes(b.balance_status) && ((!b.balance_pi && !b.balance_parts_cents) || b.payment_status === "unpaid")) fail("balance paid without a payment or before the deposit", b);
    if (b.balance_status !== "unpaid" && !["confirmed", "cancelled"].includes(b.status)) fail("balance touched on a booking that was never confirmed", b);
    if (b.status === "cancelled" && b.balance_status === "paid" && b.refund_cents === b.deposit_cents && b.payment_status === "refunded") fail("cancelled with everything refunded but the balance was left paid", b);
  }
  for (const b of db.all("SELECT * FROM bookings WHERE noshow_status != '' OR checked_in_at > 0")) { // show-up guarantee
    if (b.checked_in_at > 0 && b.noshow_status !== "") fail("a no-show was reported on a booking the group checked in to", b);
    if (b.noshow_status === "reported" && b.status !== "confirmed") fail("open no-show report on a booking that isn't confirmed", b);
    if (b.noshow_status === "refunded" && (b.payment_status !== "refunded" || ["paid", "partial_refund"].includes(b.balance_status))) fail("no-show refund left money behind", b);
    if (b.noshow_status === "rejected" && b.payment_status === "refunded") fail("no-show rejected but everything was refunded", b);
  }
  if (db.get("SELECT 1 AS x FROM extra_refunds WHERE cents <= 0")) fail("empty stray refund", {});
  const dup = db.get(`SELECT group_id, date, time, COUNT(*) c FROM bookings WHERE status IN ('pending_payment','requested','confirmed') GROUP BY group_id, date, time HAVING c > 1`);
  if (dup) fail("double-booked slot", dup);
  if (db.get("SELECT 1 AS x FROM reviews GROUP BY booking_id HAVING COUNT(*) > 1")) fail("duplicate review", {});
  if (fake) { // every cent we recorded as refunded was actually refunded by Stripe exactly once, on the payment it belongs to
    const byPi = new Map();
    for (const r of fake.state.refunded) byPi.set(r.pi, (byPi.get(r.pi) || 0) + r.amount);
    const ours = new Map(), add = (pi, n) => { if (pi) ours.set(pi, (ours.get(pi) || 0) + n); };
    for (const b of db.all("SELECT stripe_payment_intent dpi, refund_cents dr, balance_pi bpi, balance_refund_cents br FROM bookings")) { add(b.dpi, b.dr); add(b.bpi, b.br); }
    for (const e of db.all("SELECT payment_intent pi, cents FROM extra_refunds")) add(e.pi.split("#")[0], e.cents); // cart strays are recorded as "<pi>#<booking>"
    for (const p of db.all("SELECT pi, refund_cents FROM balance_parts WHERE status != 'stray'")) add(p.pi, p.refund_cents);
    // one checkout: each vendor got one transfer, and never more was taken back than it got
    for (const b of db.all("SELECT id, stripe_transfer_id t FROM bookings WHERE stripe_transfer_id != ''")) {
      const tr = (fake.state.transfers || []).filter((x) => x.id === b.t);
      if (tr.length !== 1) fail("cart booking transfer missing or doubled", { b, tr });
      const back = (fake.state.reversals || []).filter((x) => x.transfer === b.t).reduce((n, x) => n + x.amount, 0);
      if (back > Number(tr[0].amount)) fail("reversed more than was transferred", { b, back, tr });
      const row = db.get("SELECT * FROM bookings WHERE id = ?", b.id);
      const should = Math.max(0, Math.round(((row.deposit_cents - row.refund_cents) * (row.deposit_cents - row.platform_fee_cents)) / row.deposit_cents));
      if (Number(tr[0].amount) - back !== should) fail("the vendor doesn't hold exactly its share of what was kept", { row, back, should });
    }
    for (const pi of new Set([...byPi.keys(), ...ours.keys()])) {
      if ((byPi.get(pi) || 0) !== (ours.get(pi) || 0)) fail("Stripe refunds do not match our records", { pi, stripe: byPi.get(pi) || 0, ours: ours.get(pi) || 0 });
    }
  }
}

async function run(mode, seed, steps) {
  const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)];
  const fake = mode === "live" ? await fakeStripe() : null;
  const S = await startApp({ ADMIN_EMAILS: "fz-admin@example.com", ...(mode === "live" ? { STRIPE_SECRET_KEY: "sk_test_f", STRIPE_WEBHOOK_SECRET: "whsec_f", STRIPE_API_BASE: fake.url } : {}) });
  const log = [];
  try {
    const owners = [client(S.base), client(S.base)], custs = [0, 1, 2, 3].map(() => client(S.base));
    await Promise.all([...owners.map((o, i) => o.signup(`fo${i}@example.com`, `Owner ${i}`)), ...custs.map((c, i) => c.signup(`fc${i}@example.com`, `Cust ${i} Name`))]);
    const admin = client(S.base); await admin.signup("fz-admin@example.com", "Fuzz Admin");
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
      if (b && R() < 0.09) { // part of the balance: the customer or a padrino, sometimes the rest, sometimes too much, sometimes two at once
        const conf = S.db.all("SELECT id FROM bookings WHERE status = 'confirmed' AND balance_status = 'unpaid'").map((x) => x.id);
        const pb = (conf.length && R() < 0.85 ? bookings.find((x) => x.id === pick(conf)) : null) || b;
        const payer = R() < 0.6 ? pb.cust : pick(custs);
        const left = S.db.get("SELECT total_cents - deposit_cents - balance_parts_cents l FROM bookings WHERE id = ?", pb.id).l;
        const body = R() < 0.3 ? { rest: true } : { amount: Math.max(1, Math.round((left / 100) * R() * 1.2)) };
        what = `part ${pb.id} ${JSON.stringify(body)}`;
        let start;
        if (payer === pb.cust) start = ok(await payer.post(`/api/bookings/${pb.id}/parts`, body), what);
        else {
          const bk = S.db.get("SELECT date, customer_id FROM bookings WHERE id = ?", pb.id);
          let party = S.db.get("SELECT share_token FROM parties WHERE customer_id = ? AND date = ?", bk.customer_id, bk.date);
          if (!party) { const made = await pb.cust.post("/api/parties", { date: bk.date, zip: "60608" }); party = made.status === 200 ? { share_token: made.json.party.share_url.split("/fp/")[1] } : null; }
          start = party ? ok(await payer.post(`/api/fp/${party.share_token}/padrino`, { ...body, bookingId: pb.id, name: "Padrino" }), what + " (padrino)") : { status: 400 };
        }
        if (start.status === 200) {
          const amt = S.db.get("SELECT amount_cents a FROM balance_parts WHERE id = ?", start.json.part_id).a;
          const pay = async () => (fake
            ? postWebhook(S.base, { id: `evt_p_${Math.floor(R() * 1e9)}`, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: amt, payment_intent: "pi_part_" + start.json.part_id, metadata: { kind: "part", part_id: start.json.part_id } } } }, "whsec_f")
            : payer.post(`/api/parts/${start.json.part_id}/simulate-pay`));
          if (R() < 0.15) (await Promise.all([pay(), pay()])).forEach((r) => ok(r, what + " double pay")); else ok(await pay(), what + " pay");
        }
        log.push(what); checkInvariants(S.db, fake, log); continue;
      }
      if (R() < 0.03) { // one checkout for several unpaid holds of one customer
        const ci = Math.floor(R() * custs.length), c = custs[ci];
        const ids = S.db.all("SELECT b.id FROM bookings b JOIN users u ON u.id = b.customer_id WHERE b.status = 'pending_payment' AND u.email = ?", `fc${ci}@example.com`).map((x) => x.id).slice(0, 3);
        what = `cart ${ids.join(",")}`;
        const r = ok(await c.post("/api/cart", { bookingIds: ids }), what);
        if (r.status === 200) {
          if (R() < 0.3) { const id = ids[0]; ok(fake ? await postWebhook(S.base, completed(id, S.db.get("SELECT deposit_cents d FROM bookings WHERE id = ?", id).d), "whsec_f") : await c.post(`/api/bookings/${id}/simulate-pay`), what + " (one paid on its own first)"); }
          if (fake) ok(await postWebhook(S.base, { id: `evt_c_${Math.floor(R() * 1e9)}`, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: r.json.amount_cents, payment_intent: "pi_cart_" + r.json.cart_id, metadata: { kind: "cart", cart_id: r.json.cart_id } } } }, "whsec_f"), what + " pay");
          else ok(await c.post(`/api/carts/${r.json.cart_id}/simulate-pay`), what + " pay");
        }
        log.push(what); checkInvariants(S.db, fake, log); continue;
      }
      if (b && R() < 0.05) { // show-up guarantee: the event passes, the customer may report a no-show, the admin decides (sometimes twice at once)
        what = `no-show ${b.id}`;
        if (R() < 0.6) S.db.run("UPDATE bookings SET date = ? WHERE id = ? AND status = 'confirmed'", inDays(-1), b.id);
        if (R() < 0.2) await b.cust.post(`/api/bookings/${b.id}/arrived`, {}); // the customer confirming an arrival (only valid on the day, so mostly refused)
        ok(await b.cust.post(`/api/bookings/${b.id}/noshow`, { note: "Nobody came at all" }), what);
        if (R() < 0.7) {
          const refund = R() < 0.7; if (fake) fake.state.failRefunds = R() < 0.25;
          if (R() < 0.25) (await Promise.all([admin.post(`/api/admin/bookings/${b.id}/noshow`, { refund }), admin.post(`/api/admin/bookings/${b.id}/noshow`, { refund })])).forEach((r) => ok(r, what + " double decide"));
          else ok(await admin.post(`/api/admin/bookings/${b.id}/noshow`, { refund }), what + ` decide refund=${refund}`);
          if (fake) fake.state.failRefunds = false;
        }
        log.push(what); checkInvariants(S.db, fake, log); continue;
      }
      if (roll < 22 || !b) { // create
        const g = pick(groups), c = pick(custs);
        const body = bookingBody(g.id, pick(dates), { time: pick(["12:00 PM", "2:00 PM", "4:00 PM"]), hours: pick([1, 2, 3]), eventZip: pick(["60608", "77003"]) });
        what = `create ${g.id} ${body.date} ${body.time}`;
        const r = ok(await c.post("/api/bookings", body), what);
        if (r.status === 200) bookings.push({ id: r.json.booking.id, group: g, cust: c, deposit: r.json.booking.deposit_cents });
      } else if (roll < 42) { // pay the deposit (a webhook may repeat, or arrive late for an expired/cancelled booking)
        what = `pay ${b.id}`;
        if (fake) {
          const dep = S.db.get("SELECT deposit_cents d FROM bookings WHERE id = ?", b.id).d;
          const ev = completed(b.id, dep);
          ok(await postWebhook(S.base, ev, "whsec_f"), what);
          if (R() < 0.3) ok(await postWebhook(S.base, ev, "whsec_f"), what + " (replay)");
        } else ok(await b.cust.post(`/api/bookings/${b.id}/simulate-pay`), what);
      } else if (roll < 56) { // pay the balance: normally once, sometimes twice (a second payment id), sometimes at a bad time
        what = `pay balance ${b.id}`;
        if (fake) {
          const owed = S.db.get("SELECT total_cents - deposit_cents d FROM bookings WHERE id = ?", b.id).d;
          const suffix = R() < 0.25 ? "_second" : "";
          const ev = { id: `evt_b_${Math.floor(R() * 1e9)}`, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: owed, payment_intent: `pi_fzb_${b.id}${suffix}`, metadata: { kind: "balance", booking_id: b.id } } } };
          ok(await postWebhook(S.base, ev, "whsec_f"), what + suffix);
          if (R() < 0.3) ok(await postWebhook(S.base, ev, "whsec_f"), what + " (replay)");
        } else { ok(await b.cust.post(`/api/bookings/${b.id}/balance`), what); ok(await b.cust.post(`/api/bookings/${b.id}/simulate-pay-balance`), what + " (sim)"); }
      } else if (roll < 65) { what = `accept ${b.id}`; ok(await b.group.owner.patch(`/api/bookings/${b.id}`, { action: "accept" }), what); }
      else if (roll < 69) { const rec = R() < 0.7; what = `balance offline=${rec} ${b.id}`; ok(await b.group.owner.post(`/api/bookings/${b.id}/balance-offline`, { received: rec }), what); }
      else if (roll < 74) { what = `decline ${b.id}`; if (fake) fake.state.failRefunds = R() < 0.25; ok(await b.group.owner.patch(`/api/bookings/${b.id}`, { action: "decline" }), what + (fake?.state.failRefunds ? " [refund fails]" : "")); if (fake) fake.state.failRefunds = false; }
      else if (roll < 83) { what = `cancel(cust) ${b.id}`; if (fake) fake.state.failRefunds = R() < 0.2; ok(await b.cust.patch(`/api/bookings/${b.id}`, { action: "cancel" }), what); if (fake) fake.state.failRefunds = false; }
      else if (roll < 86) { what = `cancel(owner) ${b.id}`; if (fake) fake.state.failRefunds = R() < 0.2; ok(await b.group.owner.patch(`/api/bookings/${b.id}`, { action: "cancel" }), what); if (fake) fake.state.failRefunds = false; }
      else if (roll < 89) { what = `expire hold ${b.id}`; S.db.run("UPDATE bookings SET created_at = created_at - 4000 WHERE id = ? AND status = 'pending_payment'", b.id); ok(await b.cust.get("/api/my/bookings"), what); }
      else if (roll < 91) { what = `time passes ${b.id}`; S.db.run("UPDATE bookings SET date = ? WHERE id = ? AND status = 'confirmed'", inDays(-2), b.id); }
      else if (roll < 93) { what = `review ${b.id}`; ok(await b.cust.post(`/api/bookings/${b.id}/review`, { rating: 1 + Math.floor(R() * 5), text: "ok" }), what); }
      else if (roll < 96) { // reschedule: ask, answer, withdraw. Refusals are fine; a 500 or a double-booked slot is not.
        const sub = pick(["request", "request", "accept", "decline", "withdraw"]);
        // aim at bookings where the action can actually happen, so the success paths get exercised too
        const want = sub === "request" ? "status = 'confirmed' AND resched_status = ''" : "status = 'confirmed' AND resched_status = 'pending'";
        const ids = S.db.all(`SELECT id FROM bookings WHERE ${want}`).map((x) => x.id);
        const rb = (ids.length && R() < 0.85 ? bookings.find((x) => x.id === pick(ids)) : null) || b;
        if (sub === "request") { const d = pick(dates), t = pick(["12:00 PM", "2:00 PM", "4:00 PM"]); what = `resched request ${rb.id} ${d} ${t}`; ok(await rb.cust.post(`/api/bookings/${rb.id}/reschedule`, { date: d, time: t }), what); }
        else if (sub === "withdraw") { what = `resched withdraw ${rb.id}`; ok(await rb.cust.del(`/api/bookings/${rb.id}/reschedule`), what); }
        else { what = `resched ${sub} ${rb.id}`; ok(await rb.group.owner.post(`/api/bookings/${rb.id}/reschedule/respond`, { accept: sub === "accept" }), what); }
      } else if (roll < 98) { // two identical requests at once (double-tap)
        const act = pick(["cancel", "cancel", "accept", "decline", "balance"]); const who = act === "cancel" || act === "balance" ? b.cust : b.group.owner;
        what = `double ${act} ${b.id}`;
        if (fake) fake.state.refundDelay = 30;
        const call = () => (act === "balance" ? (fake ? who.post(`/api/bookings/${b.id}/balance`) : who.post(`/api/bookings/${b.id}/simulate-pay-balance`)) : who.patch(`/api/bookings/${b.id}`, { action: act }));
        const rs = await Promise.all([call(), call()]);
        if (fake) fake.state.refundDelay = 0;
        rs.forEach((r) => ok(r, what));
        if (act !== "balance") assert.ok(rs.filter((r) => r.status === 200).length <= 1, `both double-${act} requests succeeded: ${b.id}`);
      } else if (roll < 99) { // a custom offer: the customer writes, the group offers a price, the customer books exactly that price
        const g = b.group, c = b.cust, uid = (await c.get("/api/me")).json.user.id, price = 100 * (5 + Math.floor(R() * 20));
        what = `offer ${g.id} $${price}`;
        ok(await c.post(`/api/groups/${g.id}/messages`, { text: "Can you send me a price?" }), what);
        const o = ok(await g.owner.post(`/api/groups/${g.id}/offers`, { customerId: uid, name: "Fuzz offer", hours: 2, price }), what);
        if (o.status === 200) {
          const r = ok(await c.post("/api/bookings", bookingBody(g.id, pick(dates), { time: pick(["12:00 PM", "2:00 PM", "4:00 PM"]), packageId: o.json.offer_id })), what + " (book)");
          if (r.status === 200) { assert.equal(r.json.booking.total_cents, price * 100, `offer booked at the wrong price ${JSON.stringify(r.json.booking)}`); bookings.push({ id: r.json.booking.id, group: g, cust: c, deposit: r.json.booking.deposit_cents }); }
        }
      } else { what = `chat ${b.group.id}`; ok(await b.cust.post(`/api/groups/${b.group.id}/messages`, { text: "Hola, tocan Volver Volver?" }), what); }
      log.push(what);
      checkInvariants(S.db, fake, log);
    }
    // the public calendar never offers a slot that is already taken
    for (const g of groups) for (const m of new Set(dates.map((d) => d.slice(0, 7)))) {
      const days = (await client(S.base).get(`/api/groups/${g.id}/availability?month=${m}`)).json.days;
      for (const [d, slots] of Object.entries(days)) for (const t of slots) assert.equal(S.db.get("SELECT COUNT(*) c FROM bookings WHERE group_id = ? AND date = ? AND time = ? AND status IN ('pending_payment','requested','confirmed')", g.id, d, t).c, 0, `offered a taken slot ${g.id} ${d} ${t}`);
    }
    // a slot that someone asked to move into is held: the public calendar must not offer it
    for (const r of S.db.all("SELECT group_id, resched_date d, resched_time t FROM bookings WHERE resched_status = 'pending' AND status = 'confirmed'")) {
      const days = (await client(S.base).get(`/api/groups/${r.group_id}/availability?month=${r.d.slice(0, 7)}`)).json.days;
      assert.ok(!(days[r.d] || []).includes(r.t), `held reschedule slot is still public: ${JSON.stringify(r)}`);
    }
    const stats = S.db.all("SELECT status, COUNT(*) c FROM bookings GROUP BY status").map((r) => `${r.status}:${r.c}`).join(" ");
    const extra = S.db.get("SELECT COALESCE(SUM(resched_count), 0) moved, SUM(resched_status = 'pending') held, (SELECT COUNT(*) FROM packages WHERE private_customer_id IS NOT NULL) offers, SUM(balance_status = 'paid') bal, (SELECT COUNT(*) FROM balance_parts WHERE status IN ('paid','partial_refund','refunded')) parts, (SELECT COUNT(*) FROM balance_parts WHERE status = 'stray') strays, (SELECT COUNT(*) FROM carts WHERE status = 'paid') carts FROM bookings");
    return `${stats} | moved:${extra.moved} held:${extra.held} offers:${extra.offers} balances:${extra.bal} parts:${extra.parts} stray-parts:${extra.strays} carts:${extra.carts}`;
  } finally { await S.close(); if (fake) await fake.close(); }
}

for (const mode of ["simulated", "live"]) {
  test(`stress: ${mode} payments, 3 seeds x 250 random steps (deposits and balances) keep every invariant`, { timeout: 240_000 }, async () => {
    for (const seed of [7, 2024, 987654]) {
      const stats = await run(mode, seed, 250);
      console.log(`  ${mode} seed ${seed}: ${stats}`);
    }
  });
}
