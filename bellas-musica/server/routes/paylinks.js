// Payment links for a vendor's own clients: a gig the vendor found on WhatsApp, Facebook or by word of mouth gets the same
// deposit, agreement, reminders and records as one booked through the site. The vendor fills in the details and price and
// sends the link; the time is held until the link expires; the client signs in and pays the deposit, and the booking is
// confirmed right away (the vendor already agreed). The fee is lower than for a client the site found.
import crypto from "node:crypto";
import { HttpError, addDays, int, isDate, isZip, now, oneOf, rid, safeJson, str, todayStr } from "../util.js";
import { EVENT_TYPES, MAX_HOURS, POLICIES, SHORT_MINUTES, isTime } from "../pricing.js";
import { lookupZip } from "../geo.js";
import { normalizePhone } from "../sms.js";
import { dollarsToCents } from "./groups.js";
import { expirePending, feePctFor, getGroup, isBookable, isTeam, markBookingPaid, newId, requireOwner } from "../shared.js";
import { assertStart } from "../schedule.js";

const hash = (t) => crypto.createHash("sha256").update("paylink:" + String(t)).digest("hex");
const MAX_OPEN = 30;

export default function payLinkRoutes(ctx, add) {
  const { db, stripe, config, notify } = ctx;

  const linkState = (l) => (l.status === "open" && l.expires_at <= now() ? "expired" : l.status);
  const ownerView = (l) => {
    const b = l.booking_id ? db.get("SELECT status, payment_status FROM bookings WHERE id = ?", l.booking_id) : null;
    return {
      id: l.id, client_name: l.client_name, title: l.title, date: l.date, time: l.time, minutes: l.minutes, event_type: l.event_type, guests: l.guests,
      total_cents: l.total_cents, deposit_cents: l.deposit_cents, status: linkState(l), expires_at: l.expires_at, booking_id: l.booking_id,
      booking_status: b ? (b.payment_status === "unpaid" ? "unpaid" : b.status) : ""
    };
  };

  add("POST", "/api/groups/:id/paylinks", ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    if (!isBookable(ctx, g)) throw new HttpError(400, "Set up payouts first (Payments tab), so the deposit can reach you.");
    if (db.get("SELECT COUNT(*) c FROM pay_links WHERE group_id = ? AND status = 'open' AND expires_at > ?", g.id, now()).c >= MAX_OPEN) throw new HttpError(400, `You have ${MAX_OPEN} open links. Cancel some first.`);
    const date = body.date;
    if (!isDate(date) || date <= todayStr() || date > addDays(todayStr(), 730)) throw new HttpError(400, "Pick a future date");
    if (!isTime(body.time)) throw new HttpError(400, "Pick a start time");
    const minutes = body.minutes !== undefined && body.minutes !== "" && Number(body.minutes) < 60
      ? Number(oneOf(Number(body.minutes), "Length", SHORT_MINUTES))
      : int(body.hours, "Hours", { min: 1, max: MAX_HOURS }) * 60;
    const clientName = str(body.clientName, "Client's name", { required: true, min: 2, max: 80 });
    const event = oneOf(body.event, "Event", EVENT_TYPES);
    const guests = int(body.guests, "Guests", { min: 1, max: 5000 });
    const zip = str(body.eventZip, "Event ZIP", { required: true, max: 5 });
    if (!isZip(zip) || !lookupZip(zip)) throw new HttpError(400, "Enter the event's 5-digit ZIP code");
    const total = dollarsToCents(body.total, "Total price", { min: 20, max: 50000 });
    const pct = int(body.depositPct ?? g.deposit_pct, "Deposit %", { min: 10, max: 100 });
    const deposit = Math.min(total, Math.max(1000, Math.round((total * pct) / 100)));
    const days = int(body.days ?? 3, "Days the link stays open", { min: 1, max: 14 });
    expirePending(db);
    assertStart(db, g, date, body.time, minutes, { ignoreCalendar: true }); // the vendor decides the time, but not two places at once
    const token = rid(24), id = newId("pl");
    db.run(`INSERT INTO pay_links (id, group_id, created_by, token_hash, client_name, title, date, time, minutes, event_type, guests, event_zip, address, note, total_cents, deposit_cents, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, g.id, user.id, hash(token), clientName,
      str(body.title, "What it's for", { max: 80 }) || event, date, body.time, minutes, event, guests, zip,
      str(body.address, "Event location", { max: 160 }), str(body.note, "Note", { max: 300 }), total, deposit, now() + days * 86400, now());
    const url = `${config.baseUrl}/#/pay-link/${token}`;
    return { link: ownerView(db.get("SELECT * FROM pay_links WHERE id = ?", id)), url };
  }, { auth: true });

  add("GET", "/api/groups/:id/paylinks", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    return { links: db.all("SELECT * FROM pay_links WHERE group_id = ? ORDER BY created_at DESC LIMIT 50", g.id).map(ownerView), fee_pct: config.directFeePct };
  }, { auth: true });

  add("DELETE", "/api/paylinks/:lid", ({ params, user }) => {
    const l = db.get("SELECT * FROM pay_links WHERE id = ?", String(params.lid));
    if (!l || !isTeam(db, user, getGroup(db, l.group_id))) throw new HttpError(404, "Not found");
    const b = l.booking_id ? db.get("SELECT id, status, payment_status FROM bookings WHERE id = ?", l.booking_id) : null;
    // an open link, or one the client opened but never paid (its unpaid booking holds the time until the link's deadline)
    const unpaidHold = l.status === "used" && b && b.status === "pending_payment" && b.payment_status === "unpaid";
    if (l.status !== "open" && !unpaidHold) throw new HttpError(400, "This link was already paid or cancelled");
    db.tx(() => {
      db.run("UPDATE pay_links SET status = 'cancelled' WHERE id = ?", l.id);
      if (unpaidHold) db.run("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ? AND payment_status = 'unpaid'", now(), b.id);
    });
    return { link: ownerView(db.get("SELECT * FROM pay_links WHERE id = ?", l.id)) };
  }, { auth: true });

  // ---- the client's side ----
  const findLink = (token) => {
    const l = /^[\w-]{20,64}$/.test(String(token)) ? db.get("SELECT * FROM pay_links WHERE token_hash = ?", hash(token)) : null;
    if (!l) throw new HttpError(404, "This payment link isn't valid. Ask for a new one.");
    return l;
  };
  add("GET", "/api/pay-link/:token", ({ params, user }) => {
    const l = findLink(params.token), g = getGroup(db, l.group_id);
    const b = l.booking_id ? db.get("SELECT id, customer_id, status, payment_status FROM bookings WHERE id = ?", l.booking_id) : null;
    const photo = db.get("SELECT file FROM photos WHERE group_id = ? ORDER BY position, created_at LIMIT 1", g.id);
    return {
      link: {
        group: { id: g.id, name: g.name, type: g.type, photo: photo ? "/uploads/" + photo.file : null },
        client_name: l.client_name, title: l.title, date: l.date, time: l.time, minutes: l.minutes, event_type: l.event_type, guests: l.guests,
        address: l.address, note: l.note, total_cents: l.total_cents, deposit_cents: l.deposit_cents, balance_cents: l.total_cents - l.deposit_cents,
        policy: { key: g.cancel_policy, text: POLICIES[g.cancel_policy].text, rows: POLICIES[g.cancel_policy].rows.map(([days, pct]) => ({ days, pct })) },
        status: linkState(l), expires_at: l.expires_at, needs: safeJson(g.needs_json, []),
        // after paying, the client goes straight to the booking
        booking_id: b && user && b.customer_id === user.id ? b.id : "", paid: Boolean(b && b.payment_status !== "unpaid")
      }
    };
  });

  add("POST", "/api/pay-link/:token/book", async ({ params, body, user }) => {
    const l = findLink(params.token), g = getGroup(db, l.group_id);
    if (isTeam(db, user, g)) throw new HttpError(400, "This is your own link: send it to your client.");
    if (!isBookable(ctx, g)) throw new HttpError(400, "This vendor can't take payments in the app right now. Ask them about it.");
    if (body.acceptPolicy !== true) throw new HttpError(400, "Please accept the deposit and cancellation policy");
    if (ctx.email.live && !user.email_verified) throw new HttpError(403, "Please confirm your email address first. We sent you a link; you can ask for another from the banner at the top.", { code: "verify_email" });
    expirePending(db);
    let b = l.booking_id ? db.get("SELECT * FROM bookings WHERE id = ?", l.booking_id) : null;
    if (b && b.customer_id !== user.id) throw new HttpError(409, "This link was already used by someone else. Ask for a new one.");
    if (b && b.payment_status !== "unpaid") return { booking_id: b.id, paid: true };
    if (!b || b.status !== "pending_payment") {
      if (l.status === "cancelled") throw new HttpError(410, "The vendor cancelled this link. Ask them for a new one.");
      if (l.expires_at <= now()) throw new HttpError(410, "This link has expired. Ask the vendor for a new one.");
      const phone = normalizePhone(str(body.phone, "Phone", { required: true, max: 30 }));
      if (!phone) throw new HttpError(400, "Enter a valid US phone number");
      const address = str(body.address || l.address, "Event location", { required: true, max: 160 });
      const needs = safeJson(g.needs_json, []);
      if (needs.length && body.acceptNeeds !== true) throw new HttpError(400, "Please confirm you can provide what they need");
      assertStart(db, g, l.date, l.time, l.minutes, { ignoreCalendar: true, exceptLink: l.id });
      // The lower fee is for clients the vendor brought; a family that found them here (they messaged, asked for a quote or
      // booked through the site before) pays the regular fee, so sending a link doesn't route around it.
      const foundHere = db.get(`SELECT 1 AS x FROM messages WHERE group_id = ? AND customer_id = ?
        UNION SELECT 1 FROM bookings WHERE group_id = ? AND customer_id = ? AND direct = 0 AND status != 'expired'
        UNION SELECT 1 FROM event_request_groups x JOIN event_requests r ON r.id = x.request_id WHERE x.group_id = ? AND r.customer_id = ? LIMIT 1`, g.id, user.id, g.id, user.id, g.id, user.id);
      const fee = Math.min(Math.round((l.total_cents * (foundHere ? feePctFor(g, config) : config.directFeePct)) / 100), l.deposit_cents);
      const id = newId("b"), t = now();
      db.tx(() => {
        db.run(`INSERT INTO bookings (id, group_id, customer_id, date, time, hours, duration_min, needs_json, package_id, package_name, event_type, guests, event_zip, name, phone, address, message,
            subtotal_cents, travel_fee_cents, total_cents, deposit_cents, platform_fee_cents, policy, status, direct, link_id, hold_until, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'pending_payment', 1, ?, ?, ?, ?)`,
          id, g.id, user.id, l.date, l.time, Math.max(1, Math.ceil(l.minutes / 60)), l.minutes, JSON.stringify(needs), l.title, l.event_type, l.guests, l.event_zip,
          str(body.name || l.client_name, "Name", { required: true, max: 80 }), phone, address, l.note,
          l.total_cents, l.total_cents, l.deposit_cents, fee, g.cancel_policy, l.id, l.expires_at, t, t);
        db.run("UPDATE pay_links SET status = 'used', booking_id = ? WHERE id = ?", id, l.id);
      });
      b = db.get("SELECT * FROM bookings WHERE id = ?", id);
    }
    if (!stripe.live) return { booking_id: b.id, payment: { mode: "simulated", url: `${config.baseUrl}/#/pay/booking/${b.id}` } };
    // Close the checkout from an earlier try first, so the deposit can't be paid twice. One that can't be closed was paid.
    if (b.stripe_session_id) {
      try { await stripe.expireCheckoutSession(b.stripe_session_id); }
      catch {
        const s = await stripe.getCheckoutSession(b.stripe_session_id).catch(() => null);
        if (s && s.payment_status === "paid") {
          if (s.amount_total === b.deposit_cents) await markBookingPaid(ctx, b.id, String(s.payment_intent || ""));
          return { booking_id: b.id, paid: true };
        }
      }
    }
    const session = await stripe.checkoutForBooking({ booking: b, group: g, attempt: String(now()), successUrl: `${config.baseUrl}/#/booking/${b.id}?paid=1`, cancelUrl: `${config.baseUrl}/#/pay-link/${params.token}` });
    db.run("UPDATE bookings SET stripe_session_id = ? WHERE id = ?", session.id, b.id);
    return { booking_id: b.id, payment: { mode: "stripe", url: session.url } };
  }, { auth: true });
}
