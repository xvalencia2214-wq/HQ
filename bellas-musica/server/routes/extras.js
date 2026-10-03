// "¡Otra hora!": something added at the party. The vendor offers one more hour (or an add-on, or anything with a price)
// and the family pays it on their phone right there, or the family asks and the vendor accepts. The vendor can also mark
// it paid in cash. Open from the day before the event to the day after.
import { HttpError, addDays, int, now, oneOf, str, todayStr, withLock } from "../util.js";
import { feePctFor, getGroup, isTeam, newId } from "../shared.js";
import { durationOf } from "../schedule.js";
import { usd } from "../emails.js";

const MAX_OPEN = 5;

export function extrasOf(db, bookingId) {
  return db.all("SELECT id, kind, label, minutes, amount_cents, status, asked_by, created_at, paid_at FROM extras WHERE booking_id = ? ORDER BY created_at", bookingId);
}
export const extrasPaidCents = (db, bookingId) => db.get("SELECT COALESCE(SUM(amount_cents), 0) c FROM extras WHERE booking_id = ? AND status IN ('paid','cash')", bookingId).c;

// Paid through Stripe (or the test button). Idempotent; money for an extra that was cancelled meanwhile goes back.
export async function markExtraPaid(ctx, extraId, paymentIntent) {
  const { db, stripe } = ctx;
  return withLock("extra:" + extraId, async () => {
    const x = db.get("SELECT * FROM extras WHERE id = ?", extraId);
    if (!x) return null;
    if (x.status === "paid" && x.pi) return x;
    if (x.status !== "offered") {
      const marker = `${paymentIntent}#extra`;
      if (!db.get("SELECT 1 AS x FROM extra_refunds WHERE payment_intent = ?", marker)) {
        if (stripe.live && paymentIntent && !paymentIntent.startsWith("sim_")) {
          try { await stripe.refund({ paymentIntent, amountCents: x.amount_cents, key: `stray-extra-${x.id}` }); }
          catch (e) { ctx.alert(`EXTRA REFUND FAILED for ${x.id}: ${e.message}`, "stray-extra-" + x.id); throw e; }
        }
        db.run("INSERT INTO extra_refunds (booking_id, payment_intent, cents, reason, created_at) VALUES (?, ?, ?, ?, ?)", x.booking_id, marker, x.amount_cents, "extra was no longer due when the payment arrived", now());
      }
      return x;
    }
    db.run("UPDATE extras SET status = 'paid', pi = ?, paid_at = ? WHERE id = ?", paymentIntent || "", now(), x.id);
    const b = db.get("SELECT * FROM bookings WHERE id = ?", x.booking_id), g = getGroup(db, b.group_id);
    ctx.notify.toGroup(g, "extra.paid.group", { group: g.name, customer: b.name, extra: x.label, amount: usd(x.amount_cents), date: b.date, url: `${ctx.config.baseUrl}/#/dashboard?g=${g.id}&tab=requests` });
    return db.get("SELECT * FROM extras WHERE id = ?", x.id);
  });
}

export default function extrasRoutes(ctx, add) {
  const { db, stripe, config, notify } = ctx;

  const load = (user, id) => {
    const b = db.get("SELECT * FROM bookings WHERE id = ?", String(id));
    if (!b) throw new HttpError(404, "Booking not found");
    const g = getGroup(db, b.group_id);
    const side = isTeam(db, user, g) ? "group" : b.customer_id === user.id ? "customer" : "";
    if (!side) throw new HttpError(404, "Booking not found");
    return { b, g, side };
  };
  const onTheDay = (b) => { const t = todayStr(); return b.status === "confirmed" && b.payment_status !== "unpaid" && t >= addDays(b.date, -1) && t <= addDays(b.date, 1) && !b.noshow_status; };
  const feeFor = (b, g, amount) => Math.round((amount * (b.direct ? config.directFeePct : feePctFor(g, config))) / 100);
  const list = (b) => ({ extras: extrasOf(db, b.id) });

  add("GET", "/api/bookings/:id/extras", ({ params, user }) => { const { b } = load(user, params.id); return list(b); }, { auth: true });

  add("POST", "/api/bookings/:id/extras", ({ params, body, user }) => withLock("booking:" + params.id, async () => {
    const { b, g, side } = load(user, params.id);
    if (!onTheDay(b)) throw new HttpError(400, "Extras can be added from the day before the event to the day after.");
    if (db.get("SELECT COUNT(*) c FROM extras WHERE booking_id = ? AND status IN ('asked','offered')", b.id).c >= MAX_OPEN) throw new HttpError(400, "Finish the open extras first");
    const kind = oneOf(body.kind, "What to add", ["hour", "addon", "other"]);
    let label, minutes = 0, amount;
    if (kind === "hour") {
      const hours = int(body.hours ?? 1, "Hours", { min: 1, max: 4 });
      minutes = hours * 60;
      label = hours === 1 ? "One more hour" : `${hours} more hours`;
      amount = g.rate_cents * hours;
    } else if (kind === "addon") {
      const a = db.get("SELECT * FROM addons WHERE id = ? AND group_id = ?", int(body.addonId, "Add-on", { min: 1 }), g.id);
      if (!a) throw new HttpError(400, "That add-on isn't offered by this vendor");
      label = a.name; amount = a.price_cents;
    } else {
      if (side !== "group") throw new HttpError(403, "Ask the vendor to add it");
      label = str(body.label, "What it is", { required: true, min: 2, max: 60 });
    }
    // the vendor can always set the price; the family's request uses the listed price (the vendor confirms it)
    if (side === "group" && body.amount !== undefined && body.amount !== "") amount = int(Math.round(Number(body.amount) * 100), "Price", { min: 100, max: 500000 });
    if (!(amount >= 100) && side === "group") throw new HttpError(400, "Set a price for it");
    amount = amount || 0;
    const id = newId("x");
    db.run("INSERT INTO extras (id, booking_id, kind, label, minutes, amount_cents, fee_cents, status, asked_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, b.id, kind, label, minutes, amount, feeFor(b, g, amount), side === "group" ? "offered" : "asked", side, now());
    const v = { group: g.name, customer: b.name, extra: label, amount: amount ? usd(amount) : "", date: b.date };
    if (side === "group") notify.to(b.customer_id, "extra.offered.customer", { ...v, url: `${config.baseUrl}/#/booking/${b.id}` });
    else notify.toGroup(g, "extra.asked.group", { ...v, url: `${config.baseUrl}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
    return list(b);
  }), { auth: true });

  const loadExtra = (user, id) => {
    const x = db.get("SELECT * FROM extras WHERE id = ?", String(id));
    if (!x) throw new HttpError(404, "Not found");
    return { x, ...load(user, x.booking_id) };
  };
  // The vendor accepts the family's request (setting or confirming the price): it then waits for payment.
  add("POST", "/api/extras/:eid/accept", ({ params, body, user }) => {
    const { x, b, g, side } = loadExtra(user, params.eid);
    if (side !== "group") throw new HttpError(403, "Only the vendor can accept");
    if (x.status !== "asked") throw new HttpError(400, "This isn't waiting for you");
    const amount = body.amount !== undefined && body.amount !== "" ? int(Math.round(Number(body.amount) * 100), "Price", { min: 100, max: 500000 }) : x.amount_cents;
    if (amount < 100) throw new HttpError(400, "Set a price for it");
    db.run("UPDATE extras SET status = 'offered', amount_cents = ?, fee_cents = ? WHERE id = ? AND status = 'asked'", amount, feeFor(b, g, amount), x.id);
    notify.to(b.customer_id, "extra.offered.customer", { group: g.name, extra: x.label, amount: usd(amount), date: b.date, url: `${config.baseUrl}/#/booking/${b.id}` });
    return list(b);
  }, { auth: true });
  // Either side says no / takes it back before it is paid.
  add("POST", "/api/extras/:eid/cancel", ({ params, user }) => withLock("extra:" + params.eid, async () => {
    const { x, b } = loadExtra(user, params.eid);
    if (!["asked", "offered"].includes(x.status)) throw new HttpError(400, "This can't be cancelled any more");
    db.run("UPDATE extras SET status = 'cancelled' WHERE id = ?", x.id);
    return list(b);
  }), { auth: true });
  // Paid outside the app (cash, Zelle): the vendor marks it.
  add("POST", "/api/extras/:eid/cash", ({ params, user }) => withLock("extra:" + params.eid, async () => {
    const { x, b, side } = loadExtra(user, params.eid);
    if (side !== "group") throw new HttpError(403, "Only the vendor can mark this");
    if (!["asked", "offered"].includes(x.status) || x.amount_cents < 100) throw new HttpError(400, "This can't be marked paid");
    db.run("UPDATE extras SET status = 'cash', fee_cents = 0, paid_at = ? WHERE id = ?", now(), x.id);
    return list(b);
  }), { auth: true });
  // The family pays it in the app.
  add("POST", "/api/extras/:eid/pay", async ({ params, user }) => {
    const { x, b, g, side } = loadExtra(user, params.eid);
    if (side !== "customer") throw new HttpError(403, "Only the family pays this");
    if (x.status !== "offered") throw new HttpError(400, x.status === "asked" ? "The vendor hasn't confirmed it yet" : "This isn't waiting for payment");
    if (!stripe.live) return { payment: { mode: "simulated", url: `${config.baseUrl}/#/pay/extra/${x.id}` } };
    if (!g.stripe_ready) throw new HttpError(400, "This vendor can't take payments in the app right now. Pay them directly.");
    const session = await stripe.checkoutForExtra({ extra: x, booking: b, group: g, successUrl: `${config.baseUrl}/#/booking/${b.id}?extra=1`, cancelUrl: `${config.baseUrl}/#/booking/${b.id}` });
    db.run("UPDATE extras SET session_id = ? WHERE id = ?", session.id, x.id);
    return { payment: { mode: "stripe", url: session.url } };
  }, { auth: true });
  add("GET", "/api/extras/:eid", ({ params, user }) => {
    const { x, b, g } = loadExtra(user, params.eid);
    return { extra: { id: x.id, label: x.label, amount_cents: x.amount_cents, status: x.status, booking_id: b.id, group_name: g.name, date: b.date, minutes: durationOf(b) } };
  }, { auth: true });
  add("POST", "/api/extras/:eid/simulate-pay", async ({ params, user }) => {
    if (stripe.live) throw new HttpError(400, "Simulated payments are off");
    const { x, side } = loadExtra(user, params.eid);
    if (side !== "customer") throw new HttpError(403, "Only the family pays this");
    await markExtraPaid(ctx, x.id, "sim_extra_" + x.id);
    return { ok: true };
  }, { auth: true });
}
