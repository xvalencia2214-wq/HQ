import { HttpError, now, safeJson, todayStr, addDays, rid, withLock } from "./util.js";
import { categoryOf, balancePaidInApp } from "./pricing.js";
import { RESCHED_TTL, checkStart, durationOf, openTimes } from "./schedule.js";
export { balancePaidInApp };
import { lookupZip } from "./geo.js";
import { embedUrl } from "./media.js";
import { usd } from "./emails.js";

const ACTIVE = "('pending_payment','requested','confirmed')";
export const HOLD_SECONDS = 1800; // an unpaid booking holds its slot for 30 minutes
export { RESCHED_TTL };

export function expirePending(db) {
  // a payment link a vendor sent its own client holds the time until its own deadline
  db.run("UPDATE bookings SET status = 'expired', updated_at = ? WHERE status = 'pending_payment' AND ((hold_until = 0 AND created_at < ?) OR (hold_until > 0 AND hold_until < ?))", now(), now() - HOLD_SECONDS, now());
}

// The start times still open on a date (for the shortest booking the listing sells, unless `minutes` is given).
export function openSlots(db, groupId, date, { expire = true, minutes } = {}) {
  if (expire) expirePending(db);
  const g = db.get("SELECT id, hourly, min_hours, capacity, buffer_min FROM groups WHERE id = ?", groupId);
  return g ? openTimes(db, g, date, { minutes }) : [];
}

export function hasOpenDate(db, groupId, date) {
  return openSlots(db, groupId, date).length > 0;
}

// First upcoming date that still has a free slot, so calendars open on a month that has something to click.
export function firstOpenDate(db, groupId) {
  expirePending(db);
  for (const r of db.all("SELECT date FROM availability WHERE group_id = ? AND date > ? ORDER BY date LIMIT 150", groupId, todayStr())) {
    if (openSlots(db, groupId, r.date, { expire: false }).length) return r.date;
  }
  return null;
}

export function ratingMap(db) {
  const m = new Map();
  for (const r of db.all("SELECT group_id, COUNT(*) c, SUM(rating) s FROM reviews GROUP BY group_id")) m.set(r.group_id, r);
  return m;
}
export function ratingOf(g, map) {
  const r = map.get(g.id) || { c: 0, s: 0 };
  const n = g.seed_reviews + r.c;
  return { rating: n ? (g.seed_rating * g.seed_reviews + r.s) / n : 0, reviews: n };
}

// Custom offers this customer can still book: theirs, unexpired, and not already used by an active booking.
export function activeOffers(db, groupId, customerId) {
  return db.all(
    `SELECT p.id, p.name, p.description, p.hours, p.price_cents, p.expires_at FROM packages p
     WHERE p.group_id = ? AND p.private_customer_id = ? AND p.expires_at > ?
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.package_id = p.id AND b.status IN ('pending_payment','requested','confirmed'))
     ORDER BY p.id DESC`, groupId, customerId, now());
}

// Events this group has actually played through the site: confirmed, in the past, and the money was not sent back
// (a no-show that was refunded does not count). This is the number shown as "booked here".
export function doneCount(db, groupId) {
  return db.get("SELECT COUNT(*) c FROM bookings WHERE group_id = ? AND status = 'confirmed' AND date < ? AND payment_status IN ('paid','partial_refund')", groupId, todayStr()).c;
}

export const isPromoted = (g) => g.promoted_until > now();
export const isPro = (g) => g.pro_until > now();
// The platform fee for a listing: lower for Bella's Pro, half for 30 days after a referral.
export function feePctFor(g, config) {
  let pct = config.platformFeePct;
  if (isPro(g)) pct = Math.min(pct, config.proFeePct);
  if (g.fee_discount_until > now()) pct = Math.min(pct, Math.floor(config.platformFeePct / 2));
  return pct;
}

// The "from" price on cards: the cheapest package, else the hourly price (for listings that can be booked by the hour).
export const fromCents = (g, minPrice) => minPrice.get(g.id) ?? (g.hourly !== 0 ? g.rate_cents : 0);

export function isBookable(ctx, g) {
  // In live Stripe mode only real groups that finished payout setup can take deposits.
  return ctx.stripe.live ? !g.demo && Boolean(g.stripe_ready) : true;
}

export function firstPhotos(db) {
  const m = new Map();
  for (const p of db.all("SELECT group_id, file FROM photos ORDER BY position, created_at")) if (!m.has(p.group_id)) m.set(p.group_id, p.file);
  return m;
}

// What anyone may see about a group. Never includes owner id, contact phone or Stripe ids.
export function publicGroup(ctx, g, extras = {}) {
  const zip = lookupZip(g.zip);
  const { rating, reviews } = extras.rating || ratingOf(g, ratingMap(ctx.db));
  return {
    id: g.id, name: g.name, type: g.type, category: categoryOf(g.type), hourly: g.hourly !== 0, zip: g.zip, city: zip?.city || "", state: zip?.state || "",
    rate_cents: g.rate_cents, min_hours: g.min_hours || 1, members: g.members, story: g.story, rating: Math.round(rating * 10) / 10, reviews,
    events_done: doneCount(ctx.db, g.id), verified: Boolean(g.verified), insured: Boolean(g.insured), licensed: Boolean(g.licensed), pro: isPro(g), weather_policy: g.weather_policy || "", promoted: isPromoted(g), demo: Boolean(g.demo), bookable: isBookable(ctx, g),
    max_guests: g.max_guests, sound_system: Boolean(g.sound_system), dress_code: g.dress_code, set_minutes: g.set_minutes,
    travel_miles: g.travel_miles, travel_fee_cents: g.travel_fee_cents, deposit_pct: g.deposit_pct, cancel_policy: g.cancel_policy,
    events: safeJson(g.events, []), songs: safeJson(g.songs, []), needs: safeJson(g.needs_json, []), weekly_discount_pct: g.weekly_discount_pct || 0,
    video: g.video_provider ? { provider: g.video_provider, url: embedUrl(g.video_provider, g.video_id) } : null,
    ...extras.fields
  };
}

export function groupDetail(ctx, g) {
  const { db } = ctx;
  return publicGroup(ctx, g, {
    fields: {
      next_open: firstOpenDate(db, g.id),
      photos: db.all("SELECT id, file FROM photos WHERE group_id = ? ORDER BY position, created_at", g.id).map((p) => ({ id: p.id, url: "/uploads/" + p.file })),
      packages: db.all("SELECT id, name, description, hours, minutes, price_cents, holiday, holiday_date FROM packages WHERE group_id = ? AND private_customer_id IS NULL AND (holiday_date = '' OR holiday_date > ?) ORDER BY holiday_date != '' DESC, price_cents", g.id, todayStr()),
      addons: db.all("SELECT id, name, description, price_cents FROM addons WHERE group_id = ? ORDER BY id", g.id),
      recent_reviews: db.all(
        `SELECT r.id, r.rating, r.text, r.created_at, r.reply, r.reply_at, u.name FROM reviews r JOIN users u ON u.id = r.customer_id
         WHERE r.group_id = ? ORDER BY r.id DESC LIMIT 20`, g.id
      ).map((r) => ({ id: r.id, rating: r.rating, text: r.text, created_at: r.created_at, name: firstName(r.name), reply: r.reply ? { text: r.reply, at: r.reply_at } : null,
        photos: db.all("SELECT file FROM review_photos WHERE review_id = ? ORDER BY id", r.id).map((p) => "/uploads/" + p.file) })),
      response: responseTime(db, g)
    }
  });
}

// "Usually replies within ..." from real conversations: how long the group took to answer the first message of each
// thread in the last 90 days. Needs 3 answered threads, and never shown for sample groups (their replies are automatic).
export function responseTime(db, g) {
  if (g.demo) return null;
  const since = now() - 90 * 86400;
  const rows = db.all(
    `SELECT MIN(CASE WHEN sender = 'customer' THEN created_at END) AS c, customer_id,
            (SELECT MIN(m2.created_at) FROM messages m2 WHERE m2.group_id = m.group_id AND m2.customer_id = m.customer_id AND m2.sender = 'group'
               AND m2.created_at >= (SELECT MIN(m3.created_at) FROM messages m3 WHERE m3.group_id = m.group_id AND m3.customer_id = m.customer_id AND m3.sender = 'customer')) AS r
     FROM messages m WHERE m.group_id = ? GROUP BY m.customer_id HAVING c > ? ORDER BY c DESC LIMIT 100`, g.id, since);
  const waits = rows.filter((x) => x.r).map((x) => x.r - x.c).sort((a, b) => a - b);
  if (waits.length < 3) return null;
  const median = waits[Math.floor(waits.length / 2)];
  const bucket = median <= 3600 ? "hour" : median <= 4 * 3600 ? "hours" : median <= 86400 ? "day" : null;
  return bucket ? { bucket, samples: waits.length } : null;
}

// Reviewers appear as "Ana G." only.
function firstName(full) {
  const p = String(full).trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
}

export function getGroup(db, id) {
  const g = db.get("SELECT * FROM groups WHERE id = ?", id);
  if (!g) throw new HttpError(404, "Group not found");
  return g;
}
// A group is "live" (findable and bookable) once published, unless the owner paused it or you hid it. Sample groups are always live.
export const LIVE_SQL = "hidden = 0 AND paused = 0 AND (published_at > 0 OR demo = 1)";
export const isLive = (g) => !g.hidden && !g.paused && (g.published_at > 0 || g.demo === 1);

// Not-live groups look like they don't exist to everyone except their manager, and (unless you hid them) customers who already have a booking or a conversation.
// The listing's owner, or a helper the owner added to the team.
export const isTeam = (db, user, g) => Boolean(user && g && (g.owner_id === user.id || db.get("SELECT 1 AS x FROM group_team WHERE group_id = ? AND user_id = ?", g.id, user.id)));
export const roleOf = (db, user, g) => (!user || !g ? "" : g.owner_id === user.id ? "owner" : isTeam(db, user, g) ? "manager" : "");
export function getVisibleGroup(db, id, user) {
  const g = getGroup(db, id);
  if (isLive(g) || isTeam(db, user, g)) return g;
  if (user && !g.hidden && db.get("SELECT (SELECT COUNT(*) FROM bookings WHERE group_id = ? AND customer_id = ? AND status != 'expired') + (SELECT COUNT(*) FROM messages WHERE group_id = ? AND customer_id = ?) n", g.id, user.id, g.id, user.id).n) return g;
  throw new HttpError(404, "Group not found");
}
// Running the listing day to day: the owner or a team member.
export function requireOwner(db, user, groupId) {
  const g = getGroup(db, groupId);
  if (!isTeam(db, user, g)) throw new HttpError(403, "You don't manage this group");
  return g;
}
// Payouts, the team itself and paid upgrades: the owner only.
export function requireRealOwner(db, user, groupId) {
  const g = getGroup(db, groupId);
  if (!user || g.owner_id !== user.id) throw new HttpError(403, isTeam(db, user, g) ? "Only the owner of this listing can do that" : "You don't manage this group");
  return g;
}

export const displayStatus = (b) => (b.status === "confirmed" && b.date < todayStr() ? "completed" : b.status);

// ---- payment state changes (idempotent: safe if Stripe retries a webhook or the user refreshes) ----
export async function refundBooking(ctx, booking, cents) {
  const { db, stripe } = ctx;
  if (booking.payment_status !== "paid" && booking.payment_status !== "partial_refund") return booking;
  cents = Math.min(cents, booking.deposit_cents - booking.refund_cents); // never refund more than was charged
  if (cents <= 0) return booking;
  if (stripe.live && booking.stripe_payment_intent && !booking.stripe_payment_intent.startsWith("sim_")) {
    try {
      // Paid in a cart: refund the customer from the shared charge; the vendor's transfer is settled just below.
      if (booking.cart_id) await stripe.refund({ paymentIntent: booking.stripe_payment_intent, amountCents: cents, key: `refund-${booking.id}-${cents}`, destination: false });
      else await stripe.refund({ paymentIntent: booking.stripe_payment_intent, amountCents: cents, key: `refund-${booking.id}-${cents}` });
    }
    catch (e) { ctx.alert(`REFUND FAILED for booking ${booking.id} (${(cents / 100).toFixed(2)} USD): ${e.message}`, "refund-" + booking.id); throw e; }
  }
  const total = booking.refund_cents + cents;
  db.run("UPDATE bookings SET refund_cents = ?, payment_status = ?, updated_at = ? WHERE id = ?",
    total, total >= booking.deposit_cents ? "refunded" : "partial_refund", now(), booking.id);
  if (booking.cart_id) await settleCartTransfer(ctx, booking.id);
  return db.get("SELECT * FROM bookings WHERE id = ?", booking.id);
}

// The balance is a second payment on the same booking, refunded on its own PaymentIntent.
export async function refundBalance(ctx, booking, cents) {
  const { db, stripe } = ctx;
  const paidIn = balancePaidInApp(booking);
  cents = Math.min(cents, paidIn - booking.balance_refund_cents);
  if (cents <= 0) return booking;
  if (booking.balance_parts_cents > 0) {
    // Paid in parts (installments, padrinos): newest first, each back to the card that paid it. Totals are saved after
    // each part, so if one refund fails the next attempt continues where this one stopped.
    let left = cents;
    for (const p of db.all("SELECT * FROM balance_parts WHERE booking_id = ? AND status IN ('paid','partial_refund') ORDER BY paid_at DESC, rowid DESC", booking.id)) {
      if (left <= 0) break;
      const take = Math.min(left, p.amount_cents - p.refund_cents);
      if (take <= 0) continue;
      if (stripe.live && p.pi && !p.pi.startsWith("sim_")) {
        try { await stripe.refund({ paymentIntent: p.pi, amountCents: take, key: `refund-part-${p.id}-${p.refund_cents + take}`, applicationFee: false }); }
        catch (e) { ctx.alert(`BALANCE REFUND FAILED for booking ${booking.id}, part ${p.id} (${(take / 100).toFixed(2)} USD): ${e.message}`, "refund-part-" + p.id); throw e; }
      }
      db.tx(() => {
        db.run("UPDATE balance_parts SET refund_cents = refund_cents + ?, status = CASE WHEN refund_cents + ? >= amount_cents THEN 'refunded' ELSE 'partial_refund' END WHERE id = ?", take, take, p.id);
        db.run("UPDATE bookings SET balance_refund_cents = balance_refund_cents + ?, updated_at = ? WHERE id = ?", take, now(), booking.id);
      });
      left -= take;
    }
  } else {
    if (stripe.live && booking.balance_pi && !booking.balance_pi.startsWith("sim_")) {
      try { await stripe.refund({ paymentIntent: booking.balance_pi, amountCents: cents, key: `refund-bal-${booking.id}-${cents}`, applicationFee: false }); }
      catch (e) { ctx.alert(`BALANCE REFUND FAILED for booking ${booking.id} (${(cents / 100).toFixed(2)} USD): ${e.message}`, "refund-bal-" + booking.id); throw e; }
    }
    db.run("UPDATE bookings SET balance_refund_cents = balance_refund_cents + ?, updated_at = ? WHERE id = ?", cents, now(), booking.id);
  }
  const after = db.get("SELECT * FROM bookings WHERE id = ?", booking.id);
  db.run("UPDATE bookings SET balance_status = ? WHERE id = ?", after.balance_refund_cents >= paidIn ? "refunded" : "partial_refund", booking.id);
  return db.get("SELECT * FROM bookings WHERE id = ?", booking.id);
}

// A cart booking's vendor should hold (deposit - fee) of what was kept: the same proportion as a destination charge.
const vendorShare = (b, cents) => Math.round((cents * (b.deposit_cents - b.platform_fee_cents)) / b.deposit_cents);
export const cartTransferCents = (b) => Math.max(0, vendorShare(b, b.deposit_cents - b.refund_cents));
// After a refund, take back from the vendor's transfer exactly what it should no longer hold. Computed from running totals,
// so a retry never takes back twice; if Stripe fails it is alerted and retried by the hourly job.
export async function settleCartTransfer(ctx, bookingId) {
  const { db, stripe } = ctx;
  const b = db.get("SELECT * FROM bookings WHERE id = ?", bookingId);
  if (!b || !b.stripe_transfer_id || !stripe.live) return;
  const shouldHold = cartTransferCents(b), holds = b.transfer_cents - b.transfer_reversed_cents;
  const back = holds - shouldHold;
  if (back <= 0) return;
  try {
    await stripe.reverseTransfer({ transfer: b.stripe_transfer_id, amountCents: back, key: `reverse-${b.id}-${b.transfer_reversed_cents + back}` });
    db.run("UPDATE bookings SET transfer_reversed_cents = transfer_reversed_cents + ? WHERE id = ?", back, b.id);
  } catch (e) { ctx.alert(`TRANSFER REVERSAL FAILED for cart booking ${b.id} (${(back / 100).toFixed(2)} USD): ${e.message}. It will be retried.`, "reverse-" + b.id); }
}

// A payment that must not stand (a second payment, or money that arrived after a cancellation) goes straight back, in full,
// and is written down so our records always add up to what Stripe actually refunded.
async function strayRefund(ctx, booking, paymentIntent, cents, reason) {
  const { db, stripe } = ctx;
  if (cents <= 0) return; // nothing was paid (a $0 balance when the deposit was 100%)
  if (paymentIntent && db.get("SELECT 1 AS x FROM extra_refunds WHERE payment_intent = ?", paymentIntent)) return; // this payment was already sent back (the same payment can be reported twice)
  if (stripe.live && paymentIntent && !paymentIntent.startsWith("sim_")) {
    try { await stripe.refund({ paymentIntent, amountCents: cents, key: `stray-${paymentIntent}-${cents}`, applicationFee: false }); }
    catch (e) { ctx.alert(`STRAY PAYMENT COULD NOT BE REFUNDED (${reason}) booking ${booking.id}, ${paymentIntent}: ${e.message}`, "stray-" + paymentIntent); throw e; }
  } else if (stripe.live) ctx.alert(`A payment arrived without a payment id (${reason}) for booking ${booking.id}: refund it by hand in Stripe`, "stray-noid");
  db.run("INSERT INTO extra_refunds (booking_id, payment_intent, cents, reason, created_at) VALUES (?, ?, ?, ?, ?)", booking.id, paymentIntent || "", cents, reason, now());
}

export function markBalancePaid(ctx, bookingId, paymentIntent) {
  return withLock("booking:" + bookingId, () => markBalancePaidLocked(ctx, bookingId, paymentIntent));
}

async function markBalancePaidLocked(ctx, bookingId, paymentIntent) {
  const { db } = ctx;
  const b = db.get("SELECT * FROM bookings WHERE id = ?", bookingId);
  if (!b) return null;
  if (paymentIntent && b.balance_pi === paymentIntent) return b; // the same payment reported twice
  const owed = b.total_cents - b.deposit_cents;
  const payable = b.status === "confirmed" && b.payment_status === "paid" && b.balance_status === "unpaid" && owed > 0 && b.date >= todayStr() && !b.balance_parts_cents;
  if (!payable) {
    const why = b.balance_parts_cents ? "full balance paid after part of it was already paid" : b.balance_status === "paid" ? "second payment of the balance" : b.balance_status === "offline" ? "balance was already marked received outside the app" : `booking is ${b.status}`;
    await strayRefund(ctx, b, paymentIntent, owed, why);
    return db.get("SELECT * FROM bookings WHERE id = ?", b.id);
  }
  db.run("UPDATE bookings SET balance_status = 'paid', balance_pi = ?, balance_paid_at = ?, updated_at = ? WHERE id = ?", paymentIntent, now(), now(), b.id);
  const paid = db.get("SELECT * FROM bookings WHERE id = ?", b.id);
  const g = db.get("SELECT id, name, contact_phone, owner_id FROM groups WHERE id = ?", paid.group_id);
  const v = { ...ctx.notify.bookingVars(paid, g), url: `${ctx.config.baseUrl}/#/booking/${paid.id}` };
  ctx.notify.to(paid.customer_id, "balance.paid.customer", v);
  ctx.notify.toGroup(g, "balance.paid.group", { ...v, url: `${ctx.config.baseUrl}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
  return paid;
}

export function markBookingPaid(ctx, bookingId, paymentIntent) {
  return withLock("booking:" + bookingId, () => markBookingPaidLocked(ctx, bookingId, paymentIntent));
}

async function markBookingPaidLocked(ctx, bookingId, paymentIntent) {
  const { db } = ctx;
  const b = db.get("SELECT * FROM bookings WHERE id = ?", bookingId);
  if (!b) return b;
  if (b.payment_status !== "unpaid") {
    // The same payment reported twice is fine. A different payment for a deposit that is already paid (two checkouts open
    // at once) goes straight back, in full.
    if (paymentIntent && b.stripe_payment_intent && paymentIntent !== b.stripe_payment_intent) await strayRefund(ctx, b, paymentIntent, b.deposit_cents, "second payment of the same deposit");
    return db.get("SELECT * FROM bookings WHERE id = ?", b.id);
  }
  if (b.status === "pending_payment") {
    db.run("UPDATE bookings SET status = 'requested', payment_status = 'paid', stripe_payment_intent = ?, updated_at = ? WHERE id = ?", paymentIntent, now(), b.id);
  } else if (b.status === "expired") {
    // Paid after the hold lapsed: keep the booking only if the slot is still free, otherwise give the money back.
    db.run("UPDATE bookings SET payment_status = 'paid', stripe_payment_intent = ?, updated_at = ? WHERE id = ?", paymentIntent, now(), b.id);
    const g = db.get("SELECT * FROM groups WHERE id = ?", b.group_id);
    if (g && checkStart(db, g, b.date, b.time, durationOf(b), { exceptId: b.id, ignoreCalendar: true }).fits) {
      db.run("UPDATE bookings SET status = 'requested', updated_at = ? WHERE id = ?", now(), b.id);
    } else {
      await refundBooking(ctx, db.get("SELECT * FROM bookings WHERE id = ?", b.id), b.deposit_cents);
      return db.get("SELECT * FROM bookings WHERE id = ?", b.id);
    }
  } else {
    // Cancelled/declined while unpaid but money arrived: refund it all.
    db.run("UPDATE bookings SET payment_status = 'paid', stripe_payment_intent = ?, updated_at = ? WHERE id = ?", paymentIntent, now(), b.id);
    await refundBooking(ctx, db.get("SELECT * FROM bookings WHERE id = ?", b.id), b.deposit_cents);
    return db.get("SELECT * FROM bookings WHERE id = ?", b.id);
  }
  let paid = db.get("SELECT * FROM bookings WHERE id = ?", b.id);
  if (paid.status === "requested" && paid.direct) {
    // the vendor's own payment link: the vendor already agreed, so paying confirms it
    db.run("UPDATE bookings SET status = 'confirmed', updated_at = ? WHERE id = ?", now(), paid.id);
    paid = db.get("SELECT * FROM bookings WHERE id = ?", b.id);
    ctx.stats.count("booking_paid", paid.group_id); ctx.stats.count("booking_confirmed", paid.group_id);
    const g = db.get("SELECT id, name, contact_phone, owner_id FROM groups WHERE id = ?", paid.group_id);
    const base = ctx.config.baseUrl, v = ctx.notify.bookingVars(paid, g);
    ctx.notify.toGroup(g, "link.paid.group", { ...v, url: `${base}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
    ctx.notify.to(paid.customer_id, "booking.confirmed.customer", { ...v, url: `${base}/#/booking/${paid.id}` });
    return paid;
  }
  if (paid.status === "requested") {
    ctx.stats.count("booking_paid", paid.group_id);
    const g = db.get("SELECT id, name, contact_phone, owner_id FROM groups WHERE id = ?", paid.group_id);
    const base = ctx.config.baseUrl, v = ctx.notify.bookingVars(paid, g);
    ctx.notify.toGroup(g, "booking.requested.group", { ...v, url: `${base}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
    ctx.notify.to(paid.customer_id, "booking.received.customer", { ...v, url: `${base}/#/booking/${paid.id}` });
  }
  return paid;
}

// ---- balance parts (payment plan installments and padrinos) ----
export async function markPartPaid(ctx, partId, paymentIntent) {
  const p0 = ctx.db.get("SELECT booking_id FROM balance_parts WHERE id = ?", partId);
  if (!p0) return null;
  return withLock("booking:" + p0.booking_id, () => markPartPaidLocked(ctx, partId, paymentIntent));
}
async function markPartPaidLocked(ctx, partId, paymentIntent) {
  const { db } = ctx;
  const p = db.get("SELECT * FROM balance_parts WHERE id = ?", partId);
  const b = db.get("SELECT * FROM bookings WHERE id = ?", p.booking_id);
  if (p.status !== "pending") {
    if (!paymentIntent || p.pi === paymentIntent) return p; // the same payment reported twice
    await strayRefund(ctx, b, paymentIntent, p.amount_cents, "second payment of the same balance part");
    return p;
  }
  const owed = b.total_cents - b.deposit_cents;
  const payable = b.status === "confirmed" && b.payment_status === "paid" && b.balance_status === "unpaid" && b.date >= todayStr() && b.balance_parts_cents + p.amount_cents <= owed;
  if (!payable) {
    // Money for a booking that no longer takes it (cancelled, paid off, marked paid in cash, or two payers at once): it goes back in full.
    await strayRefund(ctx, b, paymentIntent, p.amount_cents, b.balance_parts_cents + p.amount_cents > owed ? "balance part would pay more than is owed" : `booking is ${b.status}, balance ${b.balance_status}`);
    db.run("UPDATE balance_parts SET status = 'stray', pi = ?, paid_at = ? WHERE id = ?", paymentIntent || "", now(), p.id);
    return db.get("SELECT * FROM balance_parts WHERE id = ?", p.id);
  }
  db.tx(() => {
    db.run("UPDATE balance_parts SET status = 'paid', pi = ?, paid_at = ? WHERE id = ?", paymentIntent || "", now(), p.id);
    db.run("UPDATE bookings SET balance_parts_cents = balance_parts_cents + ?, updated_at = ? WHERE id = ?", p.amount_cents, now(), b.id);
    if (b.balance_parts_cents + p.amount_cents >= owed) db.run("UPDATE bookings SET balance_status = 'paid', balance_paid_at = ? WHERE id = ?", now(), b.id);
  });
  const paid = db.get("SELECT * FROM bookings WHERE id = ?", b.id);
  const g = db.get("SELECT id, name, contact_phone, owner_id FROM groups WHERE id = ?", paid.group_id);
  const v = { ...ctx.notify.bookingVars(paid, g), amount: usd(p.amount_cents), payer: p.payer_name, left: usd(owed - paid.balance_parts_cents), url: `${ctx.config.baseUrl}/#/booking/${paid.id}` };
  ctx.notify.to(paid.customer_id, p.payer_id && p.payer_id !== paid.customer_id ? "part.padrino.customer" : "part.paid.customer", v);
  ctx.notify.toGroup(g, "part.paid.group", { ...v, url: `${ctx.config.baseUrl}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
  return db.get("SELECT * FROM balance_parts WHERE id = ?", p.id);
}

// ---- one checkout for several deposits ----
export async function markCartPaid(ctx, cartId, paymentIntent) {
  return withLock("cart:" + cartId, async () => {
    const { db, stripe } = ctx;
    const cart = db.get("SELECT * FROM carts WHERE id = ?", cartId);
    if (!cart) return null;
    if (cart.status === "paid") {
      if (paymentIntent && cart.pi !== paymentIntent) ctx.alert(`A second payment arrived for cart ${cart.id} (${paymentIntent}). Refund it in Stripe.`, "cart-dup-" + cart.id);
      return cart;
    }
    db.run("UPDATE carts SET status = 'paid', pi = ? WHERE id = ?", paymentIntent || "", cart.id);
    const items = new Map(safeJson(cart.items_json, []).map((x) => [x.id, x]));
    for (const id of safeJson(cart.booking_ids, [])) {
      await withLock("booking:" + id, async () => {
        const b = db.get("SELECT * FROM bookings WHERE id = ?", id);
        if (!b) return;
        const it = items.get(id);
        if (b.payment_status !== "unpaid") {
          // This deposit was already paid on its own: its share of the cart charge goes back.
          await cartStrayRefund(ctx, cart, b, paymentIntent, it ? it.deposit_cents : b.deposit_cents);
          return;
        }
        // The cart's price (with any bundle discount) becomes the booking's price only now that the cart is paid.
        if (it) db.run("UPDATE bookings SET total_cents = ?, deposit_cents = ?, platform_fee_cents = ?, discount_cents = ?, bundle_id = ? WHERE id = ?", it.total_cents, it.deposit_cents, it.platform_fee_cents, it.discount_cents, it.bundle_id || "", id);
        db.run("UPDATE bookings SET cart_id = ? WHERE id = ?", cart.id, id);
        await markBookingPaidLocked(ctx, id, paymentIntent); // a request to the vendor, or refunded if its slot is gone
      });
    }
    if (stripe.live) await transferCart(ctx, cart.id);
    return db.get("SELECT * FROM carts WHERE id = ?", cart.id);
  });
}
async function cartStrayRefund(ctx, cart, b, paymentIntent, cents) {
  const { db, stripe } = ctx;
  const marker = `${paymentIntent}#${b.id}`;
  if (cents <= 0 || db.get("SELECT 1 AS x FROM extra_refunds WHERE payment_intent = ?", marker)) return;
  if (stripe.live && paymentIntent && !paymentIntent.startsWith("sim_")) {
    try { await stripe.refund({ paymentIntent, amountCents: cents, key: `stray-cart-${cart.id}-${b.id}`, destination: false }); }
    catch (e) { ctx.alert(`CART REFUND FAILED for booking ${b.id} in cart ${cart.id}: ${e.message}`, "stray-cart-" + b.id); throw e; }
  }
  db.run("INSERT INTO extra_refunds (booking_id, payment_intent, cents, reason, created_at) VALUES (?, ?, ?, ?, ?)", b.id, marker, cents, "deposit was already paid on its own before the cart payment arrived", now());
}

// Send each vendor its share of a cart charge. Safe to call again: bookings already transferred are skipped (the hourly job retries failures).
export async function transferCart(ctx, cartId) {
  const { db, stripe } = ctx;
  const cart = db.get("SELECT * FROM carts WHERE id = ?", cartId);
  if (!cart || cart.status !== "paid" || !stripe.live || !cart.pi || cart.pi.startsWith("sim_")) return;
  let charge = "";
  try { charge = String((await stripe.getPaymentIntent(cart.pi)).latest_charge || ""); } catch { /* transfer without source_transaction */ }
  for (const id of safeJson(cart.booking_ids, [])) {
    await withLock("booking:" + id, async () => {
      const b = db.get("SELECT b.*, g.stripe_account_id FROM bookings b JOIN groups g ON g.id = b.group_id WHERE b.id = ?", id);
      if (!b || b.stripe_transfer_id || b.cart_id !== cart.id || !["paid", "partial_refund"].includes(b.payment_status)) return;
      const amount = cartTransferCents(b);
      if (amount <= 0 || !b.stripe_account_id) return;
      try {
        const tr = await stripe.transfer({ amountCents: amount, destination: b.stripe_account_id, group: cart.id, sourceCharge: charge, key: `transfer-${b.id}` });
        db.run("UPDATE bookings SET stripe_transfer_id = ?, transfer_cents = ? WHERE id = ?", String(tr.id || ""), amount, b.id);
      } catch (e) { ctx.alert(`TRANSFER FAILED for cart booking ${b.id} (${(amount / 100).toFixed(2)} USD): ${e.message}. It will be retried.`, "transfer-" + b.id); }
    });
  }
}

export function markFeaturePaid(ctx, featureId) {
  const { db } = ctx;
  const f = db.get("SELECT * FROM payments_feature WHERE id = ?", featureId);
  if (!f || f.status === "paid") return f;
  db.tx(() => {
    db.run("UPDATE payments_feature SET status = 'paid' WHERE id = ?", f.id);
    const col = f.kind === "pro" ? "pro_until" : "promoted_until"; // Bella's Pro or Featured: both 30 days, added to any time left
    const g = db.get(`SELECT ${col} AS until FROM groups WHERE id = ?`, f.group_id);
    db.run(`UPDATE groups SET ${col} = ? WHERE id = ?`, Math.max(now(), g.until) + 30 * 86400, f.group_id);
  });
  return db.get("SELECT * FROM payments_feature WHERE id = ?", f.id);
}

export const newId = (prefix) => `${prefix}${rid(9)}`;
export { addDays };
