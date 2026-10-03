// Money and booking rules that must hold after every step of the stress test and the marketplace simulation.
import assert from "node:assert/strict";

export function checkInvariants(db, fake, log) {
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
  // No listing ever has more bookings running at the same moment than it has crews/trucks/lineups (capacity).
  const byGroup = new Map();
  for (const b of db.all(`SELECT b.id, b.group_id, b.date, b.time, b.hours, b.duration_min, g.capacity FROM bookings b JOIN groups g ON g.id = b.group_id WHERE b.status IN ('pending_payment','requested','confirmed')`)) {
    const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(b.time);
    const s = (Date.parse(b.date + "T00:00:00Z") / 60000) + ((Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + Number(m[2]);
    const e = s + (b.duration_min > 0 ? b.duration_min : b.hours * 60);
    if (!byGroup.has(b.group_id)) byGroup.set(b.group_id, { cap: Math.max(1, b.capacity || 1), iv: [] });
    byGroup.get(b.group_id).iv.push({ s, e, id: b.id });
  }
  for (const [gid, { cap, iv }] of byGroup) for (const a of iv) {
    const at = iv.filter((x) => x.s <= a.s && x.e > a.s);
    if (at.length > cap) fail("double-booked: more bookings at once than the listing can serve", { gid, cap, at: at.map((x) => x.id) });
  }
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
