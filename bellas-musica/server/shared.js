import { HttpError, now, safeJson, todayStr, addDays, rid, withLock } from "./util.js";
import { SLOTS } from "./pricing.js";
import { lookupZip } from "./geo.js";
import { embedUrl } from "./media.js";

const ACTIVE = "('pending_payment','requested','confirmed')";
export const HOLD_SECONDS = 1800; // an unpaid booking holds its slot for 30 minutes

export function expirePending(db) {
  db.run("UPDATE bookings SET status = 'expired', updated_at = ? WHERE status = 'pending_payment' AND created_at < ?", now(), now() - HOLD_SECONDS);
}

export function openSlots(db, groupId, date, { expire = true } = {}) {
  if (expire) expirePending(db);
  const row = db.get("SELECT slots FROM availability WHERE group_id = ? AND date = ?", groupId, date);
  if (!row) return [];
  const taken = new Set(db.all(`SELECT time FROM bookings WHERE group_id = ? AND date = ? AND status IN ${ACTIVE}`, groupId, date).map((r) => r.time));
  return safeJson(row.slots, []).filter((s) => SLOTS.includes(s) && !taken.has(s));
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

export const isPromoted = (g) => g.promoted_until > now();

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
    id: g.id, name: g.name, type: g.type, zip: g.zip, city: zip?.city || "", state: zip?.state || "",
    rate_cents: g.rate_cents, members: g.members, story: g.story, rating: Math.round(rating * 10) / 10, reviews,
    promoted: isPromoted(g), demo: Boolean(g.demo), bookable: isBookable(ctx, g),
    max_guests: g.max_guests, sound_system: Boolean(g.sound_system), dress_code: g.dress_code, set_minutes: g.set_minutes,
    travel_miles: g.travel_miles, travel_fee_cents: g.travel_fee_cents, deposit_pct: g.deposit_pct, cancel_policy: g.cancel_policy,
    events: safeJson(g.events, []), songs: safeJson(g.songs, []),
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
      packages: db.all("SELECT id, name, description, hours, price_cents FROM packages WHERE group_id = ? ORDER BY price_cents", g.id),
      recent_reviews: db.all(
        `SELECT r.rating, r.text, r.created_at, u.name FROM reviews r JOIN users u ON u.id = r.customer_id
         WHERE r.group_id = ? ORDER BY r.id DESC LIMIT 20`, g.id
      ).map((r) => ({ rating: r.rating, text: r.text, created_at: r.created_at, name: firstName(r.name) }))
    }
  });
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
export function getVisibleGroup(db, id, user) {
  const g = getGroup(db, id);
  if (isLive(g) || (user && g.owner_id === user.id)) return g;
  if (user && !g.hidden && db.get("SELECT (SELECT COUNT(*) FROM bookings WHERE group_id = ? AND customer_id = ? AND status != 'expired') + (SELECT COUNT(*) FROM messages WHERE group_id = ? AND customer_id = ?) n", g.id, user.id, g.id, user.id).n) return g;
  throw new HttpError(404, "Group not found");
}
export function requireOwner(db, user, groupId) {
  const g = getGroup(db, groupId);
  if (!user || g.owner_id !== user.id) throw new HttpError(403, "You don't manage this group");
  return g;
}

export const displayStatus = (b) => (b.status === "confirmed" && b.date < todayStr() ? "completed" : b.status);

// ---- payment state changes (idempotent: safe if Stripe retries a webhook or the user refreshes) ----
export async function refundBooking(ctx, booking, cents) {
  if (cents <= 0) return booking;
  const { db, stripe } = ctx;
  if (booking.payment_status !== "paid" && booking.payment_status !== "partial_refund") return booking;
  if (stripe.live && booking.stripe_payment_intent && !booking.stripe_payment_intent.startsWith("sim_")) {
    try { await stripe.refund({ paymentIntent: booking.stripe_payment_intent, amountCents: cents, key: `refund-${booking.id}-${cents}` }); }
    catch (e) { ctx.alert(`REFUND FAILED for booking ${booking.id} (${(cents / 100).toFixed(2)} USD): ${e.message}`, "refund-" + booking.id); throw e; }
  }
  const total = booking.refund_cents + cents;
  db.run("UPDATE bookings SET refund_cents = ?, payment_status = ?, updated_at = ? WHERE id = ?",
    total, total >= booking.deposit_cents ? "refunded" : "partial_refund", now(), booking.id);
  return db.get("SELECT * FROM bookings WHERE id = ?", booking.id);
}

export function markBookingPaid(ctx, bookingId, paymentIntent) {
  return withLock("booking:" + bookingId, () => markBookingPaidLocked(ctx, bookingId, paymentIntent));
}

async function markBookingPaidLocked(ctx, bookingId, paymentIntent) {
  const { db } = ctx;
  const b = db.get("SELECT * FROM bookings WHERE id = ?", bookingId);
  if (!b || b.payment_status !== "unpaid") return b; // already handled
  if (b.status === "pending_payment") {
    db.run("UPDATE bookings SET status = 'requested', payment_status = 'paid', stripe_payment_intent = ?, updated_at = ? WHERE id = ?", paymentIntent, now(), b.id);
  } else if (b.status === "expired") {
    // Paid after the hold lapsed: keep the booking only if the slot is still free, otherwise give the money back.
    db.run("UPDATE bookings SET payment_status = 'paid', stripe_payment_intent = ?, updated_at = ? WHERE id = ?", paymentIntent, now(), b.id);
    try {
      db.run("UPDATE bookings SET status = 'requested', updated_at = ? WHERE id = ?", now(), b.id);
    } catch {
      await refundBooking(ctx, db.get("SELECT * FROM bookings WHERE id = ?", b.id), b.deposit_cents);
      return db.get("SELECT * FROM bookings WHERE id = ?", b.id);
    }
  } else {
    // Cancelled/declined while unpaid but money arrived: refund it all.
    db.run("UPDATE bookings SET payment_status = 'paid', stripe_payment_intent = ?, updated_at = ? WHERE id = ?", paymentIntent, now(), b.id);
    await refundBooking(ctx, db.get("SELECT * FROM bookings WHERE id = ?", b.id), b.deposit_cents);
    return db.get("SELECT * FROM bookings WHERE id = ?", b.id);
  }
  const paid = db.get("SELECT * FROM bookings WHERE id = ?", b.id);
  if (paid.status === "requested") {
    ctx.stats.count("booking_paid", paid.group_id);
    const g = db.get("SELECT id, name, contact_phone, owner_id FROM groups WHERE id = ?", paid.group_id);
    const base = ctx.config.baseUrl, v = ctx.notify.bookingVars(paid, g);
    if (g.owner_id) ctx.notify.to(g.owner_id, "booking.requested.group", { ...v, url: `${base}/#/dashboard?g=${g.id}&tab=requests` }, { phone: g.contact_phone });
    ctx.notify.to(paid.customer_id, "booking.received.customer", { ...v, url: `${base}/#/booking/${paid.id}` });
  }
  return paid;
}

export function markFeaturePaid(ctx, featureId) {
  const { db } = ctx;
  const f = db.get("SELECT * FROM payments_feature WHERE id = ?", featureId);
  if (!f || f.status === "paid") return f;
  db.tx(() => {
    db.run("UPDATE payments_feature SET status = 'paid' WHERE id = ?", f.id);
    const g = db.get("SELECT promoted_until FROM groups WHERE id = ?", f.group_id);
    const start = Math.max(now(), g.promoted_until);
    db.run("UPDATE groups SET promoted_until = ? WHERE id = ?", start + 30 * 86400, f.group_id);
  });
  return db.get("SELECT * FROM payments_feature WHERE id = ?", f.id);
}

export const newId = (prefix) => `${prefix}${rid(9)}`;
export { addDays };
