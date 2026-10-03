import crypto from "node:crypto";
import { HttpError, addDays, int, isDate, isZip, now, oneOf, safeJson, str, todayStr, daysBetween, withLock } from "../util.js";
import { EVENT_TYPES, categoryOf, MAX_ADDONS, MAX_HOURS, POLICIES, buildQuote, refundForCancel, refundParts, balanceCents, balanceLeft, balancePaidInApp, refundPercent, isTime } from "../pricing.js";
import { assertStart, checkStart, durationOf, packageMinutes } from "../schedule.js";
import { extrasOf, extrasPaidCents, markExtraPaid } from "./extras.js";
import { lookupZip, miles } from "../geo.js";
import { normalizePhone } from "../sms.js";
import { bookingToIcs } from "../ics.js";
import { usd } from "../emails.js";
import { verifyWebhook } from "../stripe.js";
import { RESCHED_TTL, feePctFor, displayStatus, expirePending, getGroup, getVisibleGroup, isBookable, markBookingPaid, markBalancePaid, markCartPaid, markPartPaid, markFeaturePaid, newId, openSlots, refundBooking, refundBalance, requireOwner, isTeam } from "../shared.js";


export default function bookingRoutes(ctx, add) {
  const { db, stripe, config, limiters, notify } = ctx;

  // Validate the request and price it. Used for the quote shown before paying and again when booking.
  function priceRequest(body, { requireSlot }, user) {
    const group = getVisibleGroup(db, str(body.groupId, "Group", { required: true, max: 80 }), user);
    const date = body.date;
    if (!isDate(date) || date <= todayStr() || date > addDays(todayStr(), 730)) throw new HttpError(400, "Pick a future date");
    const time = body.time;
    if (!isTime(time)) throw new HttpError(400, "Pick a start time");
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
      if (pkg.private_customer_id !== null) { // a custom offer: only for the customer it was made for, while it lasts
        if (!user || pkg.private_customer_id !== user.id) throw new HttpError(400, "That package isn't offered by this group");
        if (pkg.expires_at <= now()) throw new HttpError(400, "This custom offer has expired. Ask the group for a new one.");
      }
      if (pkg.holiday_date && pkg.holiday_date !== date) throw new HttpError(400, `This special is only for ${pkg.holiday_date}`);
    }
    if (!pkg && group.hourly === 0) throw new HttpError(400, `${group.name} is booked by package. Pick one of their packages.`);
    const minHours = group.min_hours || 1; // the group's own minimum applies to booking by the hour; its listed packages are priced as shown
    const hours = pkg ? pkg.hours : int(body.hours, "Hours", { min: 1, max: MAX_HOURS });
    if (!pkg && hours < minHours) throw new HttpError(400, `${group.name} plays a minimum of ${minHours} hours`);
    let addons = [];
    if (body.addonIds !== undefined && body.addonIds !== null) {
      if (!Array.isArray(body.addonIds) || body.addonIds.length > MAX_ADDONS) throw new HttpError(400, "Pick add-ons from the list");
      const ids = [...new Set(body.addonIds.map((x) => int(x, "Add-on", { min: 1 })))];
      addons = ids.map((id) => db.get("SELECT id, name, price_cents FROM addons WHERE id = ? AND group_id = ?", id, group.id));
      if (addons.some((a) => !a)) throw new HttpError(400, "One of those add-ons isn't offered by this group");
    }
    const minutes = pkg ? packageMinutes(pkg) : hours * 60;
    if (requireSlot) { expirePending(db); assertStart(db, group, date, time, minutes); }
    const quote = buildQuote({ group, pkg, hours, distanceMiles: miles(lookupZip(group.zip), ez), feePct: feePctFor(group, config), addons });
    return { group, pkg, date, time, event, guests, eventZip, quote, minutes };
  }

  const policyInfo = (key) => ({ key, text: POLICIES[key].text, rows: POLICIES[key].rows.map(([days, pct]) => ({ days, pct })) });

  add("POST", "/api/quote", ({ body, user }) => {
    const r = priceRequest(body, { requireSlot: false }, user);
    const { platform_fee_cents, ...quote } = r.quote; // customers don't need the fee breakdown
    expirePending(db);
    const at = checkStart(db, r.group, r.date, r.time, r.minutes); // so the form can warn before paying that this length doesn't fit
    return { quote: { ...quote, duration_min: r.minutes }, fits: at.listed && at.fits, policy: policyInfo(r.quote.policy), bookable: isBookable(ctx, r.group), payments: stripe.mode };
  });

  // ---- views ----
  // The balance can be paid in the app once the group has confirmed, until the event day, if it is still owed.
  const canPayBalance = (b, today) => b.status === "confirmed" && b.payment_status === "paid" && b.balance_status === "unpaid" && balanceCents(b) > 0 && b.date >= today && !b.balance_parts_cents;
  const canPayPart = (b, today) => b.status === "confirmed" && b.payment_status === "paid" && b.balance_status === "unpaid" && b.date >= today && balanceCents(b) - (b.balance_parts_cents || 0) > 0;

  // ---- rescheduling ----
  const RESCHED_MIN_DAYS = 2, RESCHED_MAX = 2;
  const reschedPending = (b) => b.resched_status === "pending" && b.resched_at > now() - RESCHED_TTL;
  // ---- show-up guarantee: the customer shows a 4-digit code on the day, the group enters it, and a group that never
  // checked in can be reported as a no-show for a few days afterwards; an admin reviews it and can refund everything paid in the app ----
  const NOSHOW_WINDOW_DAYS = 3;
  const CHECKIN_MAX_FAILS = 3, CHECKIN_LOCK_SECONDS = 3 * 3600;
  const ensureCode = (b) => {
    if (b.checkin_code) return b.checkin_code;
    const code = String(crypto.randomInt(1000, 10000));
    db.run("UPDATE bookings SET checkin_code = ? WHERE id = ? AND checkin_code = ''", code, b.id);
    return db.get("SELECT checkin_code c FROM bookings WHERE id = ?", b.id).c;
  };
  const canNoShow = (b, today) => b.status === "confirmed" && b.payment_status === "paid" && !b.checked_in_at && !b.noshow_status && b.date < today && daysBetween(b.date, today) <= NOSHOW_WINDOW_DAYS && !extrasPaidCents(db, b.id);
  const canReschedule = (b, today) => b.status === "confirmed" && b.payment_status === "paid" && !reschedPending(b) && b.resched_count < RESCHED_MAX && daysBetween(today, b.date) >= RESCHED_MIN_DAYS;
  const clearResched = (id, extraSql = "") => db.run(`UPDATE bookings SET resched_status = '', resched_date = '', resched_time = '', resched_note = ''${extraSql}, updated_at = ? WHERE id = ?`, now(), id);

  const addonsOf = (b) => { try { return JSON.parse(b.addons_json || "[]"); } catch { return []; } };
  function view(b, role) {
    const status = displayStatus(b);
    const today = todayStr();
    const out = {
      id: b.id, group_id: b.group_id, group_name: b.group_name, group_type: b.group_type, category: categoryOf(b.group_type), date: b.date, time: b.time, hours: b.hours, duration_min: durationOf(b), package_name: b.package_name,
      event_type: b.event_type, guests: b.guests, event_zip: b.event_zip, address: b.address, message: b.message,
      subtotal_cents: b.subtotal_cents, travel_fee_cents: b.travel_fee_cents, addons: addonsOf(b), addons_cents: b.addons_cents, total_cents: b.total_cents, deposit_cents: b.deposit_cents,
      balance_cents: b.total_cents - b.deposit_cents, policy: b.policy, status, payment_status: b.payment_status, refund_cents: b.refund_cents, created_at: b.created_at,
      balance_status: b.balance_status, balance_refund_cents: b.balance_refund_cents,
      balance_paid_cents: balancePaidInApp(b), balance_left_cents: balanceLeft(b),
      parts: db.all("SELECT id, payer_id, payer_name, note, amount_cents, status, paid_at FROM balance_parts WHERE booking_id = ? AND status != 'pending' ORDER BY paid_at", b.id).map((p) => ({ payer_name: p.payer_name, note: p.note, amount_cents: p.amount_cents, status: p.status, paid_at: p.paid_at, by_customer: p.payer_id === b.customer_id })),
      discount_cents: b.discount_cents, bundle_id: b.bundle_id, direct: Boolean(b.direct), extras: extrasOf(db, b.id), needs: safeJson(b.needs_json, []),
      can_extra: b.status === "confirmed" && b.payment_status !== "unpaid" && !b.noshow_status && today >= b.date && today <= addDays(b.date, 1),
      arrival: db.get("SELECT at, label FROM party_timeline WHERE booking_id = ? ORDER BY at LIMIT 1", b.id) || null,
      reschedule: reschedPending(b) ? { date: b.resched_date, time: b.resched_time, note: b.resched_note } : null
    };
    if (role === "customer") {
      out.can_cancel = ["requested", "confirmed", "pending_payment"].includes(b.status) && b.date > today;
      out.refund_if_cancel_cents = b.status === "pending_payment" ? 0 : refundForCancel(b, today);
      out.refund_percent_now = refundPercent(b.policy, daysBetween(today, b.date));
      out.can_review = b.status === "confirmed" && b.date < today && !["unpaid", "refunded"].includes(b.payment_status) && !b.reviewed;
      out.reviewed = Boolean(b.reviewed);
      out.can_pay_balance = canPayBalance(b, today);
      out.can_pay_part = canPayPart(b, today);
      out.can_reschedule = canReschedule(b, today);
      out.checked_in = Boolean(b.checked_in_at);
      if (b.status === "confirmed" && b.payment_status === "paid" && !b.checked_in_at && (b.date === today || b.date === addDays(today, 1))) out.checkin_code = ensureCode(b);
      out.can_confirm_arrival = b.status === "confirmed" && !b.checked_in_at && b.date === today;
      out.can_report_noshow = canNoShow(b, today);
      out.noshow = b.noshow_status ? { status: b.noshow_status, note: b.noshow_note } : null;
      out.pay_url = b.status === "pending_payment" && !stripe.live ? `${config.baseUrl}/#/pay/booking/${b.id}` : undefined;
    } else {
      out.customer_name = b.name;
      out.phone = b.status === "confirmed" ? b.phone : ""; // shared only once the group has accepted
      out.platform_fee_cents = b.platform_fee_cents;
      out.payout_cents = Math.max(0, b.deposit_cents - b.platform_fee_cents);
      out.can_respond = b.status === "requested";
      out.checkin_locked = b.checkin_locked_until > now();
      out.can_checkin = b.status === "confirmed" && !b.checked_in_at && b.date === today && !out.checkin_locked;
      out.checked_in = Boolean(b.checked_in_at);
      out.noshow = b.noshow_status ? { status: b.noshow_status, note: b.noshow_note, reply: b.noshow_reply } : null;
      out.can_reply_noshow = b.noshow_status === "reported" && !b.noshow_reply;
      out.can_respond_reschedule = b.status === "confirmed" && reschedPending(b);
      out.can_mark_balance_offline = b.status === "confirmed" && balanceCents(b) > 0 && (b.balance_status === "unpaid" || b.balance_status === "offline");
    }
    return out;
  }
  const BOOKING_SELECT = `SELECT b.*, g.name AS group_name, g.type AS group_type, (SELECT 1 FROM reviews r WHERE r.booking_id = b.id) AS reviewed FROM bookings b JOIN groups g ON g.id = b.group_id`;

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

  // Payment link for a booking that is still waiting on a deposit, or null if it can't be resumed.
  async function resumePayment(b) {
    const row = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id);
    if (!stripe.live) return { booking: view(row, "customer"), payment: { mode: "simulated", url: `${config.baseUrl}/#/pay/booking/${b.id}` } };
    if (!b.stripe_session_id) return null;
    const s = await stripe.getCheckoutSession(b.stripe_session_id).catch(() => null);
    if (s && s.status === "open" && typeof s.url === "string" && s.url.startsWith("https://")) return { booking: view(row, "customer"), payment: { mode: "stripe", url: s.url } };
    return null;
  }

  add("POST", "/api/bookings/:id/reschedule", ({ params, body, user }) => withLock("booking:" + params.id, async () => {
    const b = mine(user, params.id), today = todayStr();
    if (b.status !== "confirmed") throw new HttpError(400, "Only confirmed bookings can be moved.");
    if (reschedPending(b)) throw new HttpError(400, "You already have a request waiting for the group's answer.");
    if (b.resched_count >= RESCHED_MAX) throw new HttpError(400, `A booking can be moved at most ${RESCHED_MAX} times. Message the group instead.`);
    if (daysBetween(today, b.date) < RESCHED_MIN_DAYS) throw new HttpError(400, "It's too close to the event to request a new date. Message the group directly.");
    const date = body.date, time = body.time;
    if (!isTime(time)) throw new HttpError(400, "Pick a start time");
    if (!isDate(date) || date <= today || date > addDays(today, 730)) throw new HttpError(400, "Pick a future date");
    if (date === b.date && time === b.time) throw new HttpError(400, "That's the time you already have.");
    expirePending(db);
    assertStart(db, getGroup(db, b.group_id), date, time, durationOf(b), { exceptId: b.id });
    db.run("UPDATE bookings SET resched_status = 'pending', resched_date = ?, resched_time = ?, resched_note = ?, resched_at = ?, updated_at = ? WHERE id = ?", date, time, str(body.note, "Note", { max: 200 }), now(), now(), b.id);
    const g = getGroup(db, b.group_id), fresh = db.get("SELECT * FROM bookings WHERE id = ?", b.id);
    notify.toGroup(g, "resched.requested.group", { ...notify.bookingVars(fresh, g), newDate: date, newTime: time, note: fresh.resched_note, url: `${config.baseUrl}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
    return { booking: view(db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id), "customer") };
  }), { auth: true });

  add("DELETE", "/api/bookings/:id/reschedule", ({ params, user }) => withLock("booking:" + params.id, async () => {
    const b = mine(user, params.id);
    if (!reschedPending(b)) throw new HttpError(400, "There is no request to withdraw.");
    clearResched(b.id);
    return { booking: view(db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id), "customer") };
  }), { auth: true });

  add("POST", "/api/bookings/:id/reschedule/respond", ({ params, body, user }) => withLock("booking:" + params.id, async () => {
    const b = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, params.id);
    const g = b && getGroup(db, b.group_id);
    if (!b || !isTeam(db, user, g)) throw new HttpError(404, "Booking not found");
    if (b.status !== "confirmed" || !reschedPending(b)) throw new HttpError(400, "There is no pending request on this booking.");
    // once the event day has passed (or a no-show was reported) the date can't move any more
    if (body.accept === true && (b.date < todayStr() || b.noshow_status)) throw new HttpError(400, "This event date has already passed, so it can't be moved.");
    const v = { ...notify.bookingVars(b, g), newDate: b.resched_date, newTime: b.resched_time, url: `${config.baseUrl}/#/booking/${b.id}` };
    if (body.accept === true) {
      expirePending(db);
      const at = checkStart(db, g, b.resched_date, b.resched_time, durationOf(b), { exceptId: b.id });
      if (!at.listed) throw new HttpError(409, "That time is no longer on your calendar. Open it again, or decline.");
      if (!at.fits) throw new HttpError(409, "That time was just taken by another booking.");
      db.run(`UPDATE bookings SET date = ?, time = ?, resched_count = resched_count + 1, reminder7_sent = 0, reminder1_sent = 0,
        resched_status = '', resched_date = '', resched_time = '', resched_note = '', updated_at = ? WHERE id = ?`, b.resched_date, b.resched_time, now(), b.id);
      notify.to(b.customer_id, "resched.accepted.customer", v);
    } else {
      clearResched(b.id);
      notify.to(b.customer_id, "resched.declined.customer", v);
    }
    return { booking: view(db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id), "owner") };
  }), { auth: true });

  // ---- the balance ----
  add("POST", "/api/bookings/:id/balance", ({ params, user }) => withLock("booking:" + params.id, async () => {
    const b = mine(user, params.id);
    if (b.balance_parts_cents) throw new HttpError(400, "Part of the balance is already paid. Use \"Pay part of the balance\" to pay the rest.");
    if (!canPayBalance(b, todayStr())) throw new HttpError(400, b.balance_status === "offline" ? "The group already marked the balance as received." : b.balance_status !== "unpaid" ? "The balance is already paid." : "The balance can be paid once the group confirms, until the day of the event.");
    const group = getGroup(db, b.group_id);
    if (!stripe.live) return { payment: { mode: "simulated", url: `${config.baseUrl}/#/pay/balance/${b.id}` } };
    if (!group.stripe_ready) throw new HttpError(400, "This group can't take payments in the app right now. Pay the balance directly to the group.");
    const session = await stripe.checkoutForBalance({ booking: b, group, successUrl: `${config.baseUrl}/#/booking/${b.id}?balance=1`, cancelUrl: `${config.baseUrl}/#/booking/${b.id}` });
    db.run("UPDATE bookings SET balance_session_id = ? WHERE id = ?", session.id, b.id);
    return { payment: { mode: "stripe", url: session.url } };
  }), { auth: true });

  add("POST", "/api/bookings/:id/simulate-pay-balance", async ({ params, user }) => {
    if (stripe.live) throw new HttpError(400, "Simulated payments are off");
    const b = mine(user, params.id);
    await markBalancePaid(ctx, b.id, "sim_bal_" + b.id);
    return { booking: view(mine(user, b.id), "customer") };
  }, { auth: true });

  // The group got the balance in cash or by Zelle: record it so the customer isn't asked to pay again. Reversible until the event.
  add("POST", "/api/bookings/:id/balance-offline", ({ params, body, user }) => withLock("booking:" + params.id, async () => {
    const b = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, params.id);
    const g = b && getGroup(db, b.group_id);
    if (!b || !isTeam(db, user, g)) throw new HttpError(404, "Booking not found");
    if (b.status !== "confirmed" || balanceCents(b) <= 0) throw new HttpError(400, "There is no balance to mark on this booking");
    if (body.received === true) {
      if (b.balance_status !== "unpaid") throw new HttpError(400, b.balance_status === "offline" ? "Already marked as received" : "The customer already paid the balance in the app");
      db.run("UPDATE bookings SET balance_status = 'offline', updated_at = ? WHERE id = ?", now(), b.id);
      // If the customer has a checkout open, close it so they can't pay twice.
      if (stripe.live && b.balance_session_id) await stripe.expireCheckoutSession(b.balance_session_id).catch(() => {});
    } else {
      if (b.balance_status !== "offline") throw new HttpError(400, "It isn't marked as received");
      db.run("UPDATE bookings SET balance_status = 'unpaid', updated_at = ? WHERE id = ?", now(), b.id);
    }
    return { booking: view(db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id), "owner") };
  }), { auth: true });


  // ---- arrival check-in and no-show reports ----
  add("POST", "/api/bookings/:id/checkin", ({ params, body, user }) => withLock("booking:" + params.id, async () => {
    const b = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, params.id);
    const g = b && getGroup(db, b.group_id);
    if (!b || !isTeam(db, user, g)) throw new HttpError(404, "Booking not found");
    if (b.status !== "confirmed") throw new HttpError(400, "Only confirmed bookings can be checked in.");
    if (b.checked_in_at) throw new HttpError(400, "Already checked in.");
    if (b.date !== todayStr()) throw new HttpError(400, "Check-in opens on the day of the event.");
    // The code has only 4 digits, and a fake check-in would block the customer's no-show report, so guessing is hard-capped:
    // 3 wrong codes lock this booking's check-in for 3 hours (stored in the database, so a restart or a new IP doesn't reset it).
    // An honest group is never stuck: the customer can confirm the arrival in their own app.
    if (b.checkin_locked_until > now()) throw new HttpError(429, "Too many wrong codes. Ask the customer to tap \"The group arrived\" in their booking, or try again in a few hours.");
    const code = str(body.code, "Code", { required: true, max: 8 });
    const want = Buffer.from(b.checkin_code || "none"), got = Buffer.from(code);
    if (!b.checkin_code || want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
      const fails = b.checkin_fails + 1;
      if (fails >= CHECKIN_MAX_FAILS) db.run("UPDATE bookings SET checkin_fails = 0, checkin_locked_until = ? WHERE id = ?", now() + CHECKIN_LOCK_SECONDS, b.id);
      else db.run("UPDATE bookings SET checkin_fails = ? WHERE id = ?", fails, b.id);
      throw new HttpError(400, fails >= CHECKIN_MAX_FAILS ? "That code isn't right, and check-in is now locked for a few hours. Ask the customer to tap \"The group arrived\" in their booking." : `That code isn't right. Ask the customer to open their booking and read you the 4-digit code (${CHECKIN_MAX_FAILS - fails} tries left).`);
    }
    db.run("UPDATE bookings SET checked_in_at = ?, updated_at = ? WHERE id = ?", now(), now(), b.id);
    notify.to(b.customer_id, "checkin.customer", { ...notify.bookingVars(b, g), url: `${config.baseUrl}/#/bookings` });
    return { booking: view(db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id), "owner") };
  }), { auth: true });

  // The customer can confirm the arrival themselves (event day only). This is the way out if the code can't be used.
  add("POST", "/api/bookings/:id/arrived", ({ params, user }) => withLock("booking:" + params.id, async () => {
    const b = mine(user, params.id);
    if (b.status !== "confirmed") throw new HttpError(400, "Only a confirmed booking can be marked.");
    if (b.checked_in_at) throw new HttpError(400, "The arrival is already recorded.");
    if (b.date !== todayStr()) throw new HttpError(400, "You can confirm the arrival on the day of the event.");
    db.run("UPDATE bookings SET checked_in_at = ?, updated_at = ? WHERE id = ?", now(), now(), b.id);
    return { booking: view(db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id), "customer") };
  }), { auth: true });

  add("POST", "/api/bookings/:id/noshow", ({ params, body, user }) => withLock("booking:" + params.id, async () => {
    const b = mine(user, params.id), today = todayStr();
    if (!canNoShow(b, today)) {
      const why = b.noshow_status ? "You already reported this booking."
        : b.checked_in_at ? "The group checked in with your code, so this can't be reported as a no-show. Contact support if something else went wrong."
        : b.status !== "confirmed" || b.payment_status !== "paid" ? "Only a confirmed, paid booking can be reported."
        : b.date >= today ? "You can report a no-show after the event day has passed."
        : `Reports must be made within ${NOSHOW_WINDOW_DAYS} days of the event.`;
      throw new HttpError(400, why);
    }
    const note = str(body.note, "What happened", { min: 5, max: 400 });
    // a no-show report also withdraws any request to move the date (it frees the slot it was holding)
    db.run("UPDATE bookings SET noshow_status = 'reported', noshow_note = ?, noshow_at = ?, resched_status = '', resched_date = '', resched_time = '', resched_note = '', updated_at = ? WHERE id = ?", note, now(), now(), b.id);
    const g = getGroup(db, b.group_id);
    notify.toGroup(g, "noshow.reported.group", { ...notify.bookingVars(b, g), url: `${config.baseUrl}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
    ctx.alert(`NO-SHOW REPORTED: booking ${b.id} (${g.name}, ${b.date}). Review it on the Admin page.`, "noshow-" + b.id);
    return { booking: view(db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id), "customer") };
  }), { auth: true });

  add("POST", "/api/bookings/:id/noshow/reply", ({ params, body, user }) => withLock("booking:" + params.id, async () => {
    const b = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, params.id);
    const g = b && getGroup(db, b.group_id);
    if (!b || !isTeam(db, user, g)) throw new HttpError(404, "Booking not found");
    if (b.noshow_status !== "reported") throw new HttpError(400, "There is no open report on this booking.");
    if (b.noshow_reply) throw new HttpError(400, "You already answered this report.");
    db.run("UPDATE bookings SET noshow_reply = ?, updated_at = ? WHERE id = ?", str(body.reply, "Your answer", { min: 5, max: 400 }), now(), b.id);
    ctx.alert(`No-show report answered by the group: booking ${b.id} (${g.name}). Review it on the Admin page.`, "noshow-reply-" + b.id);
    return { booking: view(db.get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id), "owner") };
  }), { auth: true });

  // ---- add to calendar ----
  add("GET", "/api/bookings/:id/ics", ({ params, user, res }) => {
    const b = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, params.id);
    const g = b && db.get("SELECT id, owner_id FROM groups WHERE id = ?", b.group_id);
    const isCustomer = b && b.customer_id === user.id, isOwner = b && g && isTeam(db, user, g);
    if (!b || (!isCustomer && !isOwner)) throw new HttpError(404, "Booking not found");
    if (!["requested", "confirmed"].includes(b.status)) throw new HttpError(400, "Only active bookings can be added to a calendar");
    const money = (c) => `$${(c / 100).toFixed(2)}`;
    const addonText = (x) => { const a = addonsOf(x); return a.length ? ` Add-ons: ${a.map((i) => i.name).join(", ")}.` : ""; };
    const description = isCustomer
      ? `${b.event_type} with ${b.group_name}.${addonText(b)} Deposit paid: ${money(b.deposit_cents)}. Balance due to the group at the event: ${money(b.total_cents - b.deposit_cents)}. ${b.status === "requested" ? "Waiting for the group to confirm." : "Confirmed."} Booking ${b.id}`
      : `${b.event_type} for ${b.name}, ${b.guests} guests.${addonText(b)} Deposit ${money(b.deposit_cents)}, balance due at the event ${money(b.total_cents - b.deposit_cents)}.${b.status === "confirmed" ? " Phone: " + b.phone : ""}${b.message ? " Request: " + b.message : ""}`;
    const body = bookingToIcs({
      id: b.id, date: b.date, time: b.time, hours: durationOf(b) / 60, status: b.status, location: b.address, description,
      summary: isCustomer ? `${b.group_name}: ${b.event_type}` : `${b.event_type} for ${b.name} (${b.group_name})`
    });
    res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="bellas-musica-${b.date}.ics"`, "Cache-Control": "no-store" });
    res.end(body);
  }, { auth: true });

  // ---- create ----
  add("POST", "/api/bookings", async ({ body, user, ip }) => {
    if (!limiters.booking.check(`${ip}|${user.id}`)) throw new HttpError(429, "Too many booking attempts. Try again later.");
    if (ctx.email.live && !user.email_verified) throw new HttpError(403, "Please confirm your email address first. We sent you a link; you can ask for another from the banner at the top.", { code: "verify_email" });
    if (body.acceptPolicy !== true) throw new HttpError(400, "Please accept the deposit and cancellation policy");
    const target = getVisibleGroup(db, str(body.groupId, "Group", { required: true, max: 80 }), user);
    if (isTeam(db, user, target)) throw new HttpError(400, "You can't book your own group");
    if (!isBookable(ctx, target)) throw new HttpError(400, "This group isn't taking online deposits yet. Send them a message instead.");

    // Their own unpaid hold on this exact slot: hand back the same checkout instead of a confusing "not available".
    expirePending(db);
    const old = db.get("SELECT * FROM bookings WHERE customer_id = ? AND group_id = ? AND date = ? AND time = ? AND status = 'pending_payment'", user.id, target.id, body.date, body.time);
    if (old) {
      const again = priceRequest(body, { requireSlot: false }, user);
      if (again.quote.total_cents === old.total_cents && again.quote.deposit_cents === old.deposit_cents) {
        const resumed = await resumePayment(old);
        if (resumed) return resumed;
      }
      db.run("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), old.id); // details changed: replace the hold
    }
    // Stop one person from squatting on many slots at once.
    if (db.get("SELECT COUNT(*) c FROM bookings WHERE customer_id = ? AND status = 'pending_payment'", user.id).c >= 6) { // up to 6, so a whole party can be paid in one checkout
      throw new HttpError(429, "You have several unpaid holds. Pay for or cancel one before holding another.");
    }
    // what the vendor needs from the family (power, parking, flat ground...): they confirm it before paying
    const needs = safeJson(target.needs_json, []);
    if (needs.length && body.acceptNeeds !== true) throw new HttpError(400, "Please confirm you can provide what they need");
    const r = priceRequest(body, { requireSlot: true }, user);
    const phone = normalizePhone(str(body.phone, "Phone", { required: true, max: 30 }));
    if (!phone) throw new HttpError(400, "Enter a valid US phone number");
    const id = newId("b"), q = r.quote, t = now();
    try {
      db.run(
        `INSERT INTO bookings (id, group_id, customer_id, date, time, hours, duration_min, needs_json, package_id, package_name, event_type, guests, event_zip, name, phone, address, message,
           subtotal_cents, travel_fee_cents, addons_json, addons_cents, total_cents, deposit_cents, platform_fee_cents, policy, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)`,
        id, r.group.id, user.id, r.date, r.time, q.hours, r.minutes, JSON.stringify(needs), r.pkg?.id ?? null, r.pkg?.name ?? "", r.event, r.guests, r.eventZip,
        str(body.name, "Name", { required: true, max: 80 }), phone, str(body.address, "Event location", { required: true, max: 160 }), str(body.message, "Message", { max: 500 }),
        q.subtotal_cents, q.travel_fee_cents, JSON.stringify(q.addons.map((a) => ({ name: a.name, price_cents: a.price_cents }))), q.addons_cents, q.total_cents, q.deposit_cents, q.platform_fee_cents, q.policy, t, t);
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, "That time was just taken. Please pick another.");
      throw e;
    }
    ctx.stats.count("booking_started", r.group.id);
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
    if (stripe.live && b.balance_status === "unpaid" && b.balance_session_id) {
      const s = await stripe.getCheckoutSession(b.balance_session_id);
      if (s.payment_status === "paid" && s.amount_total === balanceCents(b)) await markBalancePaid(ctx, b.id, String(s.payment_intent || ""));
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
    const isOwner = isTeam(db, user, g), isCustomer = b.customer_id === user.id;
    if (!isOwner && !isCustomer) throw new HttpError(404, "Booking not found");
    const base = config.baseUrl, bv = notify.bookingVars(b, g);
    const today = todayStr();
    const setStatus = (s) => db.run("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?", s, now(), b.id);

    // Refund down to a target for each payment. Targets are absolute, so retrying after a failure never refunds twice.
    const settle = async (depositTarget, balanceTarget) => {
      let cur = await refundBooking(ctx, b, Math.max(0, depositTarget - b.refund_cents)); // refund first: if it fails nothing else changes
      cur = await refundBalance(ctx, cur, Math.max(0, balanceTarget - cur.balance_refund_cents));
      return cur;
    };
    const balancePaid = balancePaidInApp(b) > b.balance_refund_cents;

    if (action === "accept") {
      if (!isOwner) throw new HttpError(403, "Only the group can accept");
      if (b.status !== "requested" || b.payment_status !== "paid") throw new HttpError(400, "This request can't be accepted");
      setStatus("confirmed");
      ctx.stats.count("booking_confirmed", g.id);
      notify.to(b.customer_id, "booking.confirmed.customer", { ...bv, url: `${base}/#/booking/${b.id}` });
    } else if (action === "decline") {
      if (!isOwner) throw new HttpError(403, "Only the group can decline");
      if (b.status !== "requested") throw new HttpError(400, "This request can't be declined");
      await settle(b.deposit_cents, balanceCents(b));
      setStatus("declined");
      notify.to(b.customer_id, "booking.declined.customer", { ...bv, refund: usd(b.deposit_cents), url: `${base}/#/` });
    } else {
      if (!["pending_payment", "requested", "confirmed"].includes(b.status)) throw new HttpError(400, "This booking can't be cancelled");
      if (b.date <= today) throw new HttpError(400, "This event has already started or passed");
      // The group cancelling always refunds everything paid in the app; a customer's refund follows the policy they accepted.
      const parts = isOwner ? { deposit: b.deposit_cents, balance: balancePaid ? balancePaidInApp(b) : 0 } : refundParts(b, today);
      const after = await settle(parts.deposit, parts.balance);
      setStatus("cancelled");
      const refunded = after.refund_cents + after.balance_refund_cents;
      if (isOwner) notify.to(b.customer_id, "booking.cancelled.customer", { ...bv, refund: usd(refunded), url: `${base}/#/` });
      else notify.toGroup(g, "booking.cancelled.group", { ...bv, refund: usd(refunded), url: `${base}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
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
          else if (b) ctx.alert(`A deposit payment for booking ${obj.metadata.booking_id} (${obj.payment_intent}) doesn't match its price. Check it in Stripe and refund it if needed.`, "dep-mismatch-" + obj.metadata.booking_id);
          else console.error("webhook: unknown booking", obj.metadata?.booking_id);
        } else if (kind === "balance") {
          const b = db.get("SELECT total_cents, deposit_cents FROM bookings WHERE id = ?", String(obj.metadata.booking_id));
          if (b && obj.amount_total === b.total_cents - b.deposit_cents) await markBalancePaid(ctx, String(obj.metadata.booking_id), String(obj.payment_intent || ""));
          else console.error("webhook: amount mismatch or unknown booking (balance)", obj.metadata?.booking_id);
        } else if (kind === "part") {
          const p = db.get("SELECT amount_cents FROM balance_parts WHERE id = ?", String(obj.metadata.part_id));
          if (p && obj.amount_total === p.amount_cents) await markPartPaid(ctx, String(obj.metadata.part_id), String(obj.payment_intent || ""));
          else console.error("webhook: amount mismatch or unknown balance part", obj.metadata?.part_id);
        } else if (kind === "extra") {
          const x = db.get("SELECT amount_cents FROM extras WHERE id = ?", String(obj.metadata.extra_id));
          if (x && obj.amount_total === x.amount_cents) await markExtraPaid(ctx, String(obj.metadata.extra_id), String(obj.payment_intent || ""));
          else console.error("webhook: amount mismatch or unknown extra", obj.metadata?.extra_id);
        } else if (kind === "cart") {
          const c = db.get("SELECT amount_cents FROM carts WHERE id = ?", String(obj.metadata.cart_id));
          if (c && obj.amount_total === c.amount_cents) await markCartPaid(ctx, String(obj.metadata.cart_id), String(obj.payment_intent || ""));
          else console.error("webhook: amount mismatch or unknown cart", obj.metadata?.cart_id);
        } else if (kind === "feature") {
          const f = db.get("SELECT amount_cents FROM payments_feature WHERE id = ?", String(obj.metadata.feature_id));
          if (f && obj.amount_total === f.amount_cents) markFeaturePaid(ctx, String(obj.metadata.feature_id));
        }
      }
    } catch (e) {
      db.run("DELETE FROM webhook_events WHERE id = ?", String(event.id)); // let Stripe retry
      ctx.alert(`Stripe webhook ${event.type} failed: ${e.message}`, "webhook");
      throw e;
    }
    return { received: true };
  }, { raw: true });
}
