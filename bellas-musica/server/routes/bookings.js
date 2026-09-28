import { HttpError, addDays, int, isDate, isZip, now, oneOf, str, todayStr, daysBetween, withLock } from "../util.js";
import { EVENT_TYPES, POLICIES, buildQuote, refundForCancel, refundPercent, SLOTS } from "../pricing.js";
import { lookupZip, miles } from "../geo.js";
import { normalizePhone } from "../sms.js";
import { verifyWebhook } from "../stripe.js";
import { displayStatus, expirePending, getGroup, isBookable, markBookingPaid, markFeaturePaid, newId, openSlots, refundBooking, requireOwner } from "../shared.js";


export default function bookingRoutes(ctx, add) {
  const { db, stripe, sms, config, limiters } = ctx;

  // Validate the request and price it. Used for the quote shown before paying and again when booking.
  function priceRequest(body, { requireSlot }) {
    const group = getGroup(db, str(body.groupId, "Group", { required: true, max: 80 }));
    const date = body.date;
    if (!isDate(date) || date <= todayStr() || date > addDays(todayStr(), 730)) throw new HttpError(400, "Pick a future date");
    const time = oneOf(body.time, "Time", SLOTS);
    const event = oneOf(body.event, "Event", EVENT_TYPES);
    const guests = int(body.guests, "Guests", { min: 1, max: 5000 });
    if (guests > group.max_guests) throw new HttpError(400, `${group.name} plays best for up to ${group.max_guests} guests`);
    const eventZip = str(body.eventZip, "Event ZIP", { required: true, max: 5 });
    const ez = isZip(eventZip) ? lookupZip(eventZip) : null;
    if (!ez) throw new HttpError(400, "Enter the event's 5-digit ZIP code");
    let pkg = null;
    if (body.packageId !== undefined && body.packageId !== null && body.packageId !== "") {
      pkg = db.get("SELECT * FROM packages WHERE id = ? AND group_id = ?", int(body.packageId, "Package", { min: 1 }), group.id);
      if (!pkg) throw new HttpError(400, "That package isn't offered by this group");
    }
    const hours = pkg ? pkg.hours : int(body.hours, "Hours", { min: 1, max: 8 });
    if (requireSlot && !openSlots(db, group.id, date).includes(time)) throw new HttpError(409, "That time isn't available");
    const quote = buildQuote({ group, pkg, hours, distanceMiles: miles(lookupZip(group.zip), ez), feePct: config.platformFeePct });
    return { group, pkg, date, time, event, guests, eventZip, quote };
  }

  const policyInfo = (key) => ({ key, text: POLICIES[key].text, rows: POLICIES[key].rows.map(([days, pct]) => ({ days, pct })) });

  add("POST", "/api/quote", ({ body }) => {
    const r = priceRequest(body, { requireSlot: false });
    const { platform_fee_cents, ...quote } = r.quote; // customers don't need the fee breakdown
    return { quote, policy: policyInfo(r.quote.policy), bookable: isBookable(ctx, r.group), payments: stripe.mode };
  });

  // ---- views ----
  function view(b, role) {
    const status = displayStatus(b);
    const today = todayStr();
    const out = {
      id: b.id, group_id: b.group_id, group_name: b.group_name, date: b.date, time: b.time, hours: b.hours, package_name: b.package_name,
      event_type: b.event_type, guests: b.guests, event_zip: b.event_zip, address: b.address, message: b.message,
      subtotal_cents: b.subtotal_cents, travel_fee_cents: b.travel_fee_cents, total_cents: b.total_cents, deposit_cents: b.deposit_cents,
      balance_cents: b.total_cents - b.deposit_cents, policy: b.policy, status, payment_status: b.payment_status, refund_cents: b.refund_cents, created_at: b.created_at
    };
    if (role === "customer") {
      out.can_cancel = ["requested", "confirmed", "pending_payment"].includes(b.status) && b.date > today;
      out.refund_if_cancel_cents = b.status === "pending_payment" ? 0 : refundForCancel(b, today);
      out.refund_percent_now = refundPercent(b.policy, daysBetween(today, b.date));
      out.can_review = b.status === "confirmed" && b.date < today && b.payment_status !== "unpaid" && !b.reviewed;
      out.reviewed = Boolean(b.reviewed);
      out.pay_url = b.status === "pending_payment" && !stripe.live ? `${config.baseUrl}/#/pay/booking/${b.id}` : undefined;
    } else {
      out.customer_name = b.name;
      out.phone = b.status === "confirmed" ? b.phone : ""; // shared only once the group has accepted
      out.platform_fee_cents = b.platform_fee_cents;
      out.payout_cents = Math.max(0, b.deposit_cents - b.platform_fee_cents);
      out.can_respond = b.status === "requested";
    }
    return out;
  }
  const BOOKING_SELECT = `SELECT b.*, g.name AS group_name, (SELECT 1 FROM reviews r WHERE r.booking_id = b.id) AS reviewed FROM bookings b JOIN groups g ON g.id = b.group_id`;

  add("GET", "/api/my/bookings", ({ user }) => {
    expirePending(db);
    const rows = db.all(`${BOOKING_SELECT} WHERE b.customer_id = ? AND b.status != 'expired' ORDER BY b.date DESC, b.created_at DESC`, user.id);
    return { bookings: rows.map((b) => view(b, "customer")) };
  }, { auth: true });

  add("GET", "/api/groups/:id/bookings", ({ params, user }) => {
    requireOwner(db, user, params.id);
    const rows = db.all(`${BOOKING_SELECT} WHERE b.group_id = ? AND b.status IN ('requested','confirmed','declined','cancelled') ORDER BY b.date DESC`, params.id);
    return { bookings: rows.map((b) => view(b, "owner")) };
  }, { auth: true });

  const mine = (user, id) => {
    const b = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, id);
    if (!b || b.customer_id !== user.id) throw new HttpError(404, "Booking not found");
    return b;
  };

  // ---- create ----
  add("POST", "/api/bookings", async ({ body, user, ip }) => {
    if (!limiters.booking.check(`${ip}|${user.id}`)) throw new HttpError(429, "Too many booking attempts. Try again later.");
    if (body.acceptPolicy !== true) throw new HttpError(400, "Please accept the deposit and cancellation policy");
    const target = getGroup(db, str(body.groupId, "Group", { required: true, max: 80 }));
    if (target.owner_id === user.id) throw new HttpError(400, "You can't book your own group");
    if (!isBookable(ctx, target)) throw new HttpError(400, "This group isn't taking online deposits yet. Send them a message instead.");
    const r = priceRequest(body, { requireSlot: true });
    const phone = normalizePhone(str(body.phone, "Phone", { required: true, max: 30 }));
    if (!phone) throw new HttpError(400, "Enter a valid US phone number");
    const id = newId("b"), q = r.quote, t = now();
    try {
      db.run(
        `INSERT INTO bookings (id, group_id, customer_id, date, time, hours, package_id, package_name, event_type, guests, event_zip, name, phone, address, message,
           subtotal_cents, travel_fee_cents, total_cents, deposit_cents, platform_fee_cents, policy, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)`,
        id, r.group.id, user.id, r.date, r.time, q.hours, r.pkg?.id ?? null, r.pkg?.name ?? "", r.event, r.guests, r.eventZip,
        str(body.name, "Name", { required: true, max: 80 }), phone, str(body.address, "Event location", { required: true, max: 160 }), str(body.message, "Message", { max: 500 }),
        q.subtotal_cents, q.travel_fee_cents, q.total_cents, q.deposit_cents, q.platform_fee_cents, q.policy, t, t);
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, "That time was just taken. Please pick another.");
      throw e;
    }
    const b = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, id);
    if (!stripe.live) return { booking: view(b, "customer"), payment: { mode: "simulated", url: `${config.baseUrl}/#/pay/booking/${id}` } };
    try {
      const session = await stripe.checkoutForBooking({
        booking: b, group: r.group,
        successUrl: `${config.baseUrl}/#/booking/${id}?paid=1`, cancelUrl: `${config.baseUrl}/#/booking/${id}?cancelled=1`
      });
      db.run("UPDATE bookings SET stripe_session_id = ? WHERE id = ?", session.id, id);
      return { booking: view(b, "customer"), payment: { mode: "stripe", url: session.url } };
    } catch (e) {
      db.run("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), id); // free the slot again
      throw e;
    }
  }, { auth: true });

  // ---- payment completion ----
  add("POST", "/api/bookings/:id/simulate-pay", async ({ params, user }) => {
    if (stripe.live) throw new HttpError(400, "Simulated payments are off");
    const b = mine(user, params.id);
    await markBookingPaid(ctx, b.id, "sim_" + b.id);
    return { booking: view(mine(user, b.id), "customer") };
  }, { auth: true });

  // Called when the customer returns from Stripe, so they don't have to wait for the webhook.
  add("POST", "/api/bookings/:id/refresh", async ({ params, user }) => {
    const b = mine(user, params.id);
    let resume;
    if (stripe.live && b.payment_status === "unpaid" && b.stripe_session_id) {
      const s = await stripe.getCheckoutSession(b.stripe_session_id);
      if (s.payment_status === "paid" && s.amount_total === b.deposit_cents) await markBookingPaid(ctx, b.id, String(s.payment_intent || ""));
      else if (s.status === "open" && typeof s.url === "string" && s.url.startsWith("https://")) resume = s.url; // lets the customer go back to checkout
    }
    const out = view(mine(user, b.id), "customer");
    if (resume && out.status === "pending_payment") out.pay_url = resume;
    return { booking: out };
  }, { auth: true });

  // ---- accept / decline / cancel ----
  add("PATCH", "/api/bookings/:id", ({ params, body, user }) => withLock("booking:" + params.id, async () => {
    const action = oneOf(body.action, "action", ["accept", "decline", "cancel"]);
    const b = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, params.id);
    if (!b) throw new HttpError(404, "Booking not found");
    const g = getGroup(db, b.group_id);
    const isOwner = g.owner_id === user.id, isCustomer = b.customer_id === user.id;
    if (!isOwner && !isCustomer) throw new HttpError(404, "Booking not found");
    const customer = db.get("SELECT phone, sms_opt_in FROM users WHERE id = ?", b.customer_id);
    const today = todayStr();
    const setStatus = (s) => db.run("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?", s, now(), b.id);

    if (action === "accept") {
      if (!isOwner) throw new HttpError(403, "Only the group can accept");
      if (b.status !== "requested" || b.payment_status !== "paid") throw new HttpError(400, "This request can't be accepted");
      setStatus("confirmed");
      sms.notifyPhone(customer.phone, customer.sms_opt_in, `Bella's Música: ${g.name} confirmed your booking for ${b.date} at ${b.time}.`);
    } else if (action === "decline") {
      if (!isOwner) throw new HttpError(403, "Only the group can decline");
      if (b.status !== "requested") throw new HttpError(400, "This request can't be declined");
      await refundBooking(ctx, b, b.deposit_cents - b.refund_cents); // refund first: if it fails nothing else changes
      setStatus("declined");
      sms.notifyPhone(customer.phone, customer.sms_opt_in, `Bella's Música: ${g.name} can't take your ${b.date} booking. Your deposit is being refunded.`);
    } else {
      if (!["pending_payment", "requested", "confirmed"].includes(b.status)) throw new HttpError(400, "This booking can't be cancelled");
      if (b.date <= today) throw new HttpError(400, "This event has already started or passed");
      // The group cancelling always refunds in full; a customer's refund follows the policy they accepted.
      const cents = isOwner ? b.deposit_cents - b.refund_cents : refundForCancel(b, today) - b.refund_cents;
      await refundBooking(ctx, b, Math.max(0, cents));
      setStatus("cancelled");
      if (isOwner) sms.notifyPhone(customer.phone, customer.sms_opt_in, `Bella's Música: ${g.name} cancelled your ${b.date} booking. Your deposit is being refunded in full.`);
      else if (g.owner_id) {
        const owner = db.get("SELECT phone, sms_opt_in FROM users WHERE id = ?", g.owner_id);
        sms.notifyPhone(g.contact_phone || owner?.phone, owner?.sms_opt_in, `Bella's Música: the ${b.date} ${b.time} booking was cancelled by the customer.`);
      }
    }
    return { booking: view(db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id), isOwner ? "owner" : "customer") };
  }), { auth: true });

  // ---- Stripe webhook (signature verified; each event id is processed once) ----
  add("POST", "/api/stripe/webhook", async ({ req, body }) => {
    if (!config.stripeWebhookSecret) throw new HttpError(503, "Webhook not configured");
    const event = verifyWebhook(body, req.headers["stripe-signature"], config.stripeWebhookSecret);
    if (db.run("INSERT OR IGNORE INTO webhook_events (id, created_at) VALUES (?, ?)", String(event.id), now()).changes === 0) return { received: true, duplicate: true };
    try {
      const obj = event.data?.object || {};
      if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && obj.payment_status === "paid") {
        const kind = obj.metadata?.kind;
        if (kind === "booking") {
          const b = db.get("SELECT deposit_cents FROM bookings WHERE id = ?", String(obj.metadata.booking_id));
          if (b && obj.amount_total === b.deposit_cents) await markBookingPaid(ctx, String(obj.metadata.booking_id), String(obj.payment_intent || ""));
          else console.error("webhook: amount mismatch or unknown booking", obj.metadata?.booking_id);
        } else if (kind === "feature") {
          const f = db.get("SELECT amount_cents FROM payments_feature WHERE id = ?", String(obj.metadata.feature_id));
          if (f && obj.amount_total === f.amount_cents) markFeaturePaid(ctx, String(obj.metadata.feature_id));
        }
      }
    } catch (e) {
      db.run("DELETE FROM webhook_events WHERE id = ?", String(event.id)); // let Stripe retry
      throw e;
    }
    return { received: true };
  }, { raw: true });
}
