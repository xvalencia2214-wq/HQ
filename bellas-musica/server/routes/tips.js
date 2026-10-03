// Propinas: after the party the family can leave the vendor a tip in the app. It goes to the vendor's account like the
// deposit; Bella's Música keeps no fee (only the card processing cost, so the platform doesn't pay to move it).
import { HttpError, addDays, int, now, str, todayStr, withLock } from "../util.js";
import { getGroup, isTeam, newId } from "../shared.js";
import { maskContact } from "./messages.js";
import { usd } from "../emails.js";

const TIP_DAYS = 60; // open from the event day to 60 days after

export const tipsOf = (db, bookingId) => db.all("SELECT id, amount_cents, fee_cents, note, status, paid_at FROM tips WHERE booking_id = ? AND status = 'paid' ORDER BY paid_at", bookingId);
export const tipsPaidCents = (db, bookingId) => db.get("SELECT COALESCE(SUM(amount_cents), 0) c FROM tips WHERE booking_id = ? AND status = 'paid'", bookingId).c;
export const canTip = (b, today = todayStr()) => b.status === "confirmed" && b.payment_status !== "unpaid" && !b.noshow_status && today >= b.date && today <= addDays(b.date, TIP_DAYS);
const processing = (cents) => Math.min(cents - 1, Math.round(cents * 0.029) + 30);

// Paid through Stripe (or the test button). The same payment twice is fine; a different payment for a tip that is
// already paid goes back.
export async function markTipPaid(ctx, tipId, paymentIntent) {
  const { db, stripe } = ctx;
  return withLock("tip:" + tipId, async () => {
    const tp = db.get("SELECT * FROM tips WHERE id = ?", tipId);
    if (!tp) return null;
    if (tp.status === "paid") {
      if (!paymentIntent || tp.pi === paymentIntent) return tp;
      const marker = `${paymentIntent}#tip`;
      if (!db.get("SELECT 1 AS x FROM extra_refunds WHERE payment_intent = ?", marker)) {
        if (stripe.live && !paymentIntent.startsWith("sim_")) {
          try { await stripe.refund({ paymentIntent, amountCents: tp.amount_cents, key: `stray-tip-${tp.id}-${paymentIntent}` }); }
          catch (e) { ctx.alert(`TIP REFUND FAILED for ${tp.id}: ${e.message}`, "stray-tip-" + tp.id); throw e; }
        }
        db.run("INSERT INTO extra_refunds (booking_id, payment_intent, cents, reason, created_at) VALUES (?, ?, ?, ?, ?)", tp.booking_id, marker, tp.amount_cents, "second payment of the same tip", now());
      }
      return tp;
    }
    db.run("UPDATE tips SET status = 'paid', pi = ?, paid_at = ? WHERE id = ?", paymentIntent || "", now(), tp.id);
    const b = db.get("SELECT * FROM bookings WHERE id = ?", tp.booking_id), g = getGroup(db, b.group_id);
    const v = { group: g.name, customer: b.name, amount: usd(tp.amount_cents), note: tp.note, date: b.date };
    ctx.notify.toGroup(g, "tip.paid.group", { ...v, url: `${ctx.config.baseUrl}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
    ctx.notify.to(b.customer_id, "tip.paid.customer", { ...v, url: `${ctx.config.baseUrl}/#/booking/${b.id}` });
    return db.get("SELECT * FROM tips WHERE id = ?", tp.id);
  });
}

export default function tipRoutes(ctx, add) {
  const { db, stripe, config } = ctx;

  add("POST", "/api/bookings/:id/tips", async ({ params, body, user }) => {
    const b = db.get("SELECT * FROM bookings WHERE id = ?", String(params.id));
    if (!b || b.customer_id !== user.id) throw new HttpError(404, "Booking not found");
    if (!canTip(b)) throw new HttpError(400, "Tips open on the day of the event, for a booking that took place.");
    const g = getGroup(db, b.group_id);
    if (isTeam(db, user, g)) throw new HttpError(400, "You can't tip your own group");
    const amount = int(Math.round(Number(body.amount) * 100), "Tip", { min: 500, max: 200000 });
    const note = maskContact(str(body.note, "Note", { max: 200 })).text;
    const fee = config.tipsCoverProcessing && stripe.live ? processing(amount) : 0;
    const id = newId("t");
    db.run("INSERT INTO tips (id, booking_id, customer_id, amount_cents, fee_cents, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, b.id, user.id, amount, fee, note, now());
    if (!stripe.live) return { tip_id: id, payment: { mode: "simulated", url: `${config.baseUrl}/#/pay/tip/${id}` } };
    if (!g.stripe_ready) throw new HttpError(400, "This group can't take payments in the app right now. You can tip them directly.");
    const tip = db.get("SELECT * FROM tips WHERE id = ?", id);
    const session = await stripe.checkoutForTip({ tip, booking: b, group: g, successUrl: `${config.baseUrl}/#/booking/${b.id}?tip=1`, cancelUrl: `${config.baseUrl}/#/booking/${b.id}` });
    db.run("UPDATE tips SET session_id = ? WHERE id = ?", session.id, id);
    return { tip_id: id, payment: { mode: "stripe", url: session.url } };
  }, { auth: true });

  add("GET", "/api/tips/:tid", ({ params, user }) => {
    const tp = db.get("SELECT t.*, b.date, b.group_id FROM tips t JOIN bookings b ON b.id = t.booking_id WHERE t.id = ?", String(params.tid));
    if (!tp || tp.customer_id !== user.id) throw new HttpError(404, "Not found");
    return { tip: { id: tp.id, amount_cents: tp.amount_cents, status: tp.status, booking_id: tp.booking_id, date: tp.date, group_name: getGroup(db, tp.group_id).name } };
  }, { auth: true });

  add("POST", "/api/tips/:tid/simulate-pay", async ({ params, user }) => {
    if (stripe.live) throw new HttpError(400, "Simulated payments are off");
    const tp = db.get("SELECT * FROM tips WHERE id = ?", String(params.tid));
    if (!tp || tp.customer_id !== user.id) throw new HttpError(404, "Not found");
    await markTipPaid(ctx, tp.id, "sim_tip_" + tp.id);
    return { ok: true, booking_id: tp.booking_id };
  }, { auth: true });
}
