import { todayStr, addDays, now } from "./util.js";
import { expirePending } from "./shared.js";
import { fillDemoAvailability } from "./seed.js";

// Text customers a day or so after their event asking for a review (only if they opted in to texts).
export function sendReviewReminders(ctx) {
  const { db, sms, config } = ctx;
  const today = todayStr();
  const rows = db.all(
    `SELECT b.id, b.group_id, b.customer_id, g.name AS group_name FROM bookings b JOIN groups g ON g.id = b.group_id
     WHERE b.status = 'confirmed' AND b.payment_status IN ('paid','partial_refund') AND b.date < ? AND b.date >= ? AND b.reminder_sent = 0
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)`, today, addDays(today, -14));
  for (const r of rows) {
    db.run("UPDATE bookings SET reminder_sent = 1 WHERE id = ?", r.id);
    const u = db.get("SELECT phone, sms_opt_in FROM users WHERE id = ?", r.customer_id);
    if (u) sms.notifyPhone(u.phone, u.sms_opt_in, `How was ${r.group_name}? Leave a quick review: ${config.baseUrl}/#/bookings`);
  }
  return rows.length;
}

export function housekeeping(ctx) {
  const { db } = ctx;
  db.run("DELETE FROM sessions WHERE expires_at < ?", now());
  db.run("DELETE FROM webhook_events WHERE created_at < ?", now() - 30 * 86400);
  db.run("DELETE FROM payments_feature WHERE status = 'pending' AND created_at < ?", now() - 7 * 86400);
}

export function startJobs(ctx) {
  const timers = [
    setInterval(() => expirePending(ctx.db), 5 * 60_000),
    setInterval(() => { try { housekeeping(ctx); fillDemoAvailability(ctx.db); sendReviewReminders(ctx); } catch (e) { console.error("job failed", e); } }, 60 * 60_000)
  ];
  timers.forEach((t) => t.unref());
  try { housekeeping(ctx); sendReviewReminders(ctx); } catch (e) { console.error("job failed", e); }
  return () => timers.forEach(clearInterval);
}
