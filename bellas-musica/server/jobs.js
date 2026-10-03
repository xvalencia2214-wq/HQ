import { todayStr, addDays, now, getTimezone } from "./util.js";
import { usd } from "./emails.js";
import { balanceLeft } from "./pricing.js";
import { backupIfNeeded } from "./backups.js";
import { RESCHED_TTL } from "./shared.js";
import { expirePending, transferCart, settleCartTransfer, refundBooking } from "./shared.js";
import { withLock } from "./util.js";
import { fillDemoAvailability } from "./seed.js";
import { expandSilentRequests } from "./routes/requests.js";

// Text customers a day or so after their event asking for a review (only if they opted in to texts).
export function sendReviewReminders(ctx) {
  const { db, config } = ctx;
  const today = todayStr();
  const rows = db.all(
    `SELECT b.id, b.group_id, b.customer_id, g.name AS group_name FROM bookings b JOIN groups g ON g.id = b.group_id
     WHERE b.status = 'confirmed' AND b.payment_status IN ('paid','partial_refund') AND b.date < ? AND b.date >= ? AND b.reminder_sent = 0
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)`, today, addDays(today, -14));
  for (const r of rows) {
    db.run("UPDATE bookings SET reminder_sent = 1 WHERE id = ?", r.id);
    ctx.notify.to(r.customer_id, "review.reminder", { group: r.group_name, url: `${config.baseUrl}/#/bookings` });
  }
  return rows.length;
}

// The morning text for vendors (and their helpers): today's gigs, new requests and what's left to collect today, so they
// know their day without opening the app. Sent once a day from 7 a.m. business time, only when there is something to say.
export function sendDailyTexts(ctx, { hour = businessHour() } = {}) {
  if (hour < 7 || hour >= 11) return 0;
  const { db, config, notify } = ctx;
  const today = todayStr();
  let sent = 0;
  const people = db.all(`SELECT DISTINCT u.id FROM users u WHERE u.daily_text = 1 AND u.daily_text_on != ? AND ((u.sms_opt_in = 1 AND u.phone != '') OR EXISTS (SELECT 1 FROM push_subs p WHERE p.user_id = u.id))
    AND (EXISTS (SELECT 1 FROM groups g WHERE g.owner_id = u.id AND g.demo = 0) OR EXISTS (SELECT 1 FROM group_team t WHERE t.user_id = u.id))`, today);
  for (const { id } of people) {
    const groups = db.all("SELECT id, name FROM groups WHERE (owner_id = ? OR id IN (SELECT group_id FROM group_team WHERE user_id = ?)) AND hidden = 0", id, id);
    if (!groups.length) continue;
    const ids = groups.map((g) => g.id), q = ids.map(() => "?").join(",");
    const gigs = db.all(`SELECT b.*, g.name AS group_name FROM bookings b JOIN groups g ON g.id = b.group_id WHERE b.group_id IN (${q}) AND b.date = ? AND b.status = 'confirmed'`, ...ids, today)
      .sort((a, b) => toMin(a.time) - toMin(b.time));
    const requests = db.get(`SELECT COUNT(*) c FROM bookings WHERE group_id IN (${q}) AND status = 'requested'`, ...ids).c;
    db.run("UPDATE users SET daily_text_on = ? WHERE id = ?", today, id); // checked today, even if there is nothing to say
    if (!gigs.length && !requests) continue;
    const collect = gigs.reduce((n, b) => n + balanceLeft(b), 0);
    const many = groups.length > 1;
    notify.to(id, "daily.vendor", {
      gigs: String(gigs.length), requests: String(requests), collect: collect ? usd(collect) : "",
      list: gigs.slice(0, 3).map((b) => `${b.time} ${String(b.name).slice(0, 24)}${many ? ` (${b.group_name})` : ""}`).join(", ") + (gigs.length > 3 ? "…" : ""),
      url: `${config.baseUrl}/#/dashboard`
    }, { noEmail: true });
    sent++;
  }
  return sent;
}
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(t || ""); return m ? ((Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + Number(m[2]) : 0; };

const businessHour = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: getTimezone(), hour: "numeric", hourCycle: "h23" }).format(new Date()));

// A week before and the day before a confirmed event, remind the customer (and the group the day before).
// Only between 9 a.m. and 8 p.m. business time, so texts never wake anyone up; unsent reminders go out at the next tick.
export function sendEventReminders(ctx, { hour = businessHour() } = {}) {
  if (hour < 9 || hour >= 20) return 0;
  const { db, config, notify } = ctx;
  const today = todayStr();
  let sent = 0;
  const rows = (date, col) => db.all(
    `SELECT b.*, g.name AS group_name, g.owner_id, g.contact_phone FROM bookings b JOIN groups g ON g.id = b.group_id
     WHERE b.status = 'confirmed' AND b.date = ? AND b.${col} = 0`, date);
  for (const b of rows(addDays(today, 7), "reminder7_sent")) {
    db.run("UPDATE bookings SET reminder7_sent = 1 WHERE id = ?", b.id); sent++;
    notify.to(b.customer_id, "event.reminder.customer", { ...notify.bookingVars(b, { name: b.group_name }), when: "week", balanceDue: balanceDue(b), url: `${config.baseUrl}/#/booking/${b.id}` });
  }
  for (const b of rows(addDays(today, 1), "reminder1_sent")) {
    db.run("UPDATE bookings SET reminder1_sent = 1 WHERE id = ?", b.id); sent++;
    const v = notify.bookingVars(b, { name: b.group_name });
    notify.to(b.customer_id, "event.reminder.customer", { ...v, when: "tomorrow", balanceDue: balanceDue(b), url: `${config.baseUrl}/#/booking/${b.id}` });
    notify.toGroup({ id: b.group_id, owner_id: b.owner_id }, "event.reminder.group", { ...v, phone: b.phone, balanceLine: balanceDue(b) ? `Balance to collect: ${balanceDue(b)}` : "Balance already paid.", url: `${config.baseUrl}/#/dashboard?g=${b.group_id}&tab=requests` }, { phone: b.contact_phone });
  }
  return sent;
}
const balanceDue = (b) => (b.balance_status === "paid" || b.balance_status === "offline" ? "" : usd(b.total_cents - b.deposit_cents - (b.balance_parts_cents || 0)));

export function housekeeping(ctx) {
  const { db } = ctx;
  db.run("DELETE FROM sessions WHERE expires_at < ?", now());
  db.run("DELETE FROM webhook_events WHERE created_at < ?", now() - 30 * 86400);
  db.run("DELETE FROM auth_tokens WHERE expires_at < ?", now() - 86400);
  db.run("UPDATE bookings SET resched_status = '', resched_date = '', resched_time = '', resched_note = '' WHERE resched_status = 'pending' AND (resched_at < ? OR date < ?)", now() - RESCHED_TTL, todayStr());
  db.run("DELETE FROM payments_feature WHERE status = 'pending' AND created_at < ?", now() - 7 * 86400);
}

// A paid request the group never answers must not hold the family's deposit: after 2 days the group is reminded, and after
// 3 days (or once the event day arrives) the request is cancelled and the deposit refunded in full.
export const ANSWER_HOURS = 72;
export async function expireUnansweredRequests(ctx) {
  const { db, config, notify } = ctx;
  const today = todayStr(), t = now();
  const dl = (b) => new Date((Math.min(b.created_at + ANSWER_HOURS * 3600, t + 86400)) * 1000).toLocaleString("en-US", { timeZone: getTimezone(), weekday: "short", hour: "numeric", minute: "2-digit" });
  for (const b of db.all("SELECT b.*, g.name AS group_name, g.owner_id, g.contact_phone FROM bookings b JOIN groups g ON g.id = b.group_id WHERE b.status = 'requested' AND b.payment_status = 'paid' AND b.answer_reminder_sent = 0 AND b.created_at < ? AND b.created_at >= ? AND b.date > ?", t - 48 * 3600, t - ANSWER_HOURS * 3600, today)) {
    db.run("UPDATE bookings SET answer_reminder_sent = 1 WHERE id = ?", b.id);
    notify.toGroup({ id: b.group_id, owner_id: b.owner_id }, "request.reminder.group", { ...notify.bookingVars(b, { name: b.group_name }), deadline: dl(b), url: `${config.baseUrl}/#/dashboard?g=${b.group_id}&tab=requests` }, { phone: b.contact_phone });
  }
  let n = 0;
  for (const { id } of db.all("SELECT id FROM bookings WHERE status = 'requested' AND (created_at < ? OR date <= ?)", t - ANSWER_HOURS * 3600, today)) {
    try {
      await withLock("booking:" + id, async () => {
        const b = db.get("SELECT b.*, g.name AS group_name, g.owner_id, g.contact_phone FROM bookings b JOIN groups g ON g.id = b.group_id WHERE b.id = ?", id);
        if (!b || b.status !== "requested") return; // answered meanwhile
        const after = await refundBooking(ctx, b, b.deposit_cents - b.refund_cents); // refund first: if it fails, it's retried next hour
        db.run("UPDATE bookings SET status = 'declined', updated_at = ? WHERE id = ?", now(), b.id);
        n++;
        const v = { ...notify.bookingVars(b, { name: b.group_name }), refund: usd(after.refund_cents) };
        notify.to(b.customer_id, "request.expired.customer", { ...v, url: `${config.baseUrl}/#/` });
        notify.toGroup({ id: b.group_id, owner_id: b.owner_id }, "request.expired.group", { ...v, url: `${config.baseUrl}/#/dashboard?g=${b.group_id}&tab=requests` }, { phone: b.contact_phone });
      });
    } catch (e) { ctx.alert(`Could not cancel the unanswered request ${id}: ${e.message}. It will be retried.`, "expire-request-" + id); }
  }
  return n;
}

// One-checkout payments: a vendor transfer that failed when the payment came in is retried every hour.
function retryCartTransfers(ctx) {
  if (!ctx.stripe.live) return;
  const carts = ctx.db.all("SELECT DISTINCT b.cart_id FROM bookings b WHERE b.cart_id != '' AND b.stripe_transfer_id = '' AND b.payment_status IN ('paid','partial_refund') AND b.updated_at > ?", Math.floor(Date.now() / 1000) - 30 * 86400);
  for (const c of carts) transferCart(ctx, c.cart_id).catch((e) => ctx.alert("Cart transfer retry failed: " + e.message, "transfer-retry"));
  // and a reversal that failed after a refund
  for (const b of ctx.db.all("SELECT id FROM bookings WHERE stripe_transfer_id != '' AND refund_cents > 0")) settleCartTransfer(ctx, b.id).catch(() => {});
}

export function startJobs(ctx) {
  const timers = [
    setInterval(() => expirePending(ctx.db), 5 * 60_000),
    setInterval(() => { try { housekeeping(ctx); fillDemoAvailability(ctx.db); sendReviewReminders(ctx); sendEventReminders(ctx); sendDailyTexts(ctx); expandSilentRequests(ctx); expireUnansweredRequests(ctx).catch((e) => ctx.alert("Request expiry failed: " + e.message, "job")); retryCartTransfers(ctx); ctx.expireDocuments?.(); ctx.syncCalendars?.().catch(() => {}); backupIfNeeded(ctx); } catch (e) { ctx.alert("Background job failed: " + e.message, "job"); } }, 60 * 60_000)
  ];
  timers.forEach((t) => t.unref());
  try { housekeeping(ctx); sendReviewReminders(ctx); sendEventReminders(ctx); sendDailyTexts(ctx); expandSilentRequests(ctx); backupIfNeeded(ctx); } catch (e) { ctx.alert("Background job failed: " + e.message, "job"); }
  return () => timers.forEach(clearInterval);
}
