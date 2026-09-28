import { todayStr, addDays, now, getTimezone } from "./util.js";
import { usd } from "./emails.js";
import { backupIfNeeded } from "./backups.js";
import { RESCHED_TTL } from "./shared.js";
import { expirePending } from "./shared.js";
import { fillDemoAvailability } from "./seed.js";

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
    if (b.owner_id) notify.to(b.owner_id, "event.reminder.group", { ...v, phone: b.phone, balanceLine: balanceDue(b) ? `Balance to collect: ${balanceDue(b)}` : "Balance already paid.", url: `${config.baseUrl}/#/dashboard?g=${b.group_id}&tab=requests` }, { phone: b.contact_phone });
  }
  return sent;
}
const balanceDue = (b) => (b.balance_status === "paid" || b.balance_status === "offline" ? "" : usd(b.total_cents - b.deposit_cents));

export function housekeeping(ctx) {
  const { db } = ctx;
  db.run("DELETE FROM sessions WHERE expires_at < ?", now());
  db.run("DELETE FROM webhook_events WHERE created_at < ?", now() - 30 * 86400);
  db.run("DELETE FROM auth_tokens WHERE expires_at < ?", now() - 86400);
  db.run("UPDATE bookings SET resched_status = '', resched_date = '', resched_time = '', resched_note = '' WHERE resched_status = 'pending' AND (resched_at < ? OR date < ?)", now() - RESCHED_TTL, todayStr());
  db.run("DELETE FROM payments_feature WHERE status = 'pending' AND created_at < ?", now() - 7 * 86400);
}

export function startJobs(ctx) {
  const timers = [
    setInterval(() => expirePending(ctx.db), 5 * 60_000),
    setInterval(() => { try { housekeeping(ctx); fillDemoAvailability(ctx.db); sendReviewReminders(ctx); sendEventReminders(ctx); backupIfNeeded(ctx); } catch (e) { ctx.alert("Background job failed: " + e.message, "job"); } }, 60 * 60_000)
  ];
  timers.forEach((t) => t.unref());
  try { housekeeping(ctx); sendReviewReminders(ctx); sendEventReminders(ctx); backupIfNeeded(ctx); } catch (e) { ctx.alert("Background job failed: " + e.message, "job"); }
  return () => timers.forEach(clearInterval);
}
