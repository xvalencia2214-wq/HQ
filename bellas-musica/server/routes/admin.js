import crypto from "node:crypto";
import { HttpError, int, now } from "../util.js";
import { lookupZip } from "../geo.js";
import { hashPassword } from "../auth.js";

// Owner-only tools. Anyone else gets a 404 so the page's existence isn't advertised.
export default function adminRoutes(ctx, add) {
  const { db, config } = ctx;
  const admin = (user) => {
    if (!user || !config.adminEmails.includes(user.email.toLowerCase())) throw new HttpError(404, "Not found");
    return user;
  };
  const log = (user, action, target = "", details = "") => db.run("INSERT INTO admin_log (admin_email, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)", user.email, action, target, details, now());

  add("GET", "/api/admin/summary", ({ user }) => {
    admin(user);
    const d7 = now() - 7 * 86400, d30 = now() - 30 * 86400;
    const one = (sql, ...p) => db.get(sql, ...p);
    const PAID = "payment_status IN ('paid','partial_refund','refunded')";
    const money = one(`SELECT COALESCE(SUM(deposit_cents), 0) gross, COALESCE(SUM(refund_cents), 0) refunded,
        COALESCE(SUM(CAST(ROUND(platform_fee_cents * (deposit_cents - refund_cents) * 1.0 / deposit_cents) AS INTEGER)), 0) fees
      FROM bookings WHERE ${PAID}`);
    return {
      payments: ctx.stripe.mode, texts: ctx.sms.mode, timezone: config.timezone, platform_fee_pct: config.platformFeePct,
      users: { total: one("SELECT COUNT(*) c FROM users").c, last7: one("SELECT COUNT(*) c FROM users WHERE created_at > ?", d7).c, last30: one("SELECT COUNT(*) c FROM users WHERE created_at > ?", d30).c },
      groups: {
        real: one("SELECT COUNT(*) c FROM groups WHERE demo = 0").c, sample: one("SELECT COUNT(*) c FROM groups WHERE demo = 1").c, hidden: one("SELECT COUNT(*) c FROM groups WHERE hidden = 1").c,
        featured_now: one("SELECT COUNT(*) c FROM groups WHERE promoted_until > ?", now()).c, payouts_ready: one("SELECT COUNT(*) c FROM groups WHERE demo = 0 AND stripe_ready = 1").c
      },
      bookings: {
        by_status: Object.fromEntries(db.all("SELECT status, COUNT(*) c FROM bookings GROUP BY status").map((r) => [r.status, r.c])),
        created_30d: one("SELECT COUNT(*) c FROM bookings WHERE created_at > ? AND status != 'expired'", d30).c,
        confirmed_value_cents: one("SELECT COALESCE(SUM(total_cents), 0) v FROM bookings WHERE status = 'confirmed'").v
      },
      money: {
        deposits_collected_cents: money.gross, refunded_cents: money.refunded, net_deposits_cents: money.gross - money.refunded, platform_fees_kept_cents: money.fees,
        featured_revenue_cents: one("SELECT COALESCE(SUM(amount_cents), 0) v FROM payments_feature WHERE status = 'paid'").v
      },
      texts_30d: { sent: one("SELECT COUNT(*) c FROM sms_log WHERE sent = 1 AND created_at > ?", d30).c, failed: one("SELECT COUNT(*) c FROM sms_log WHERE error != '' AND created_at > ?", d30).c, logged_only: one("SELECT COUNT(*) c FROM sms_log WHERE sent = 0 AND error = '' AND created_at > ?", d30).c },
      groups_list: db.all(
        `SELECT g.id, g.name, g.type, g.zip, g.demo, g.hidden, g.promoted_until, g.stripe_ready, u.email AS owner_email,
                (SELECT COUNT(*) FROM bookings b WHERE b.group_id = g.id AND b.status IN ('requested','confirmed')) AS active_bookings
         FROM groups g LEFT JOIN users u ON u.id = g.owner_id ORDER BY g.demo, g.created_at DESC LIMIT 200`).map((g) => ({ ...g, city: lookupZip(g.zip)?.city || "", demo: Boolean(g.demo), hidden: Boolean(g.hidden), stripe_ready: Boolean(g.stripe_ready) })),
      recent_bookings: db.all(`SELECT b.id, g.name AS group_name, b.status, b.payment_status, b.date, b.total_cents, b.deposit_cents, b.created_at FROM bookings b JOIN groups g ON g.id = b.group_id WHERE b.status != 'expired' ORDER BY b.created_at DESC LIMIT 15`),
      recent_signups: db.all("SELECT id, name, email, created_at FROM users ORDER BY id DESC LIMIT 10"),
      log: db.all("SELECT admin_email, action, target, details, created_at FROM admin_log ORDER BY id DESC LIMIT 25")
    };
  });

  add("POST", "/api/admin/groups/:id/hide", ({ params, body, user }) => {
    admin(user);
    if (!db.get("SELECT 1 AS x FROM groups WHERE id = ?", params.id)) throw new HttpError(404, "Group not found");
    const hidden = body.hidden === true ? 1 : 0;
    db.run("UPDATE groups SET hidden = ? WHERE id = ?", hidden, params.id);
    log(user, hidden ? "hide group" : "unhide group", params.id);
    return { ok: true, hidden: Boolean(hidden) };
  });

  // Comp (or clear) featured placement without a payment.
  add("POST", "/api/admin/groups/:id/feature", ({ params, body, user }) => {
    admin(user);
    if (!db.get("SELECT 1 AS x FROM groups WHERE id = ?", params.id)) throw new HttpError(404, "Group not found");
    const days = int(body.days, "days", { min: 0, max: 365 });
    db.run("UPDATE groups SET promoted_until = ? WHERE id = ?", days ? now() + days * 86400 : 0, params.id);
    log(user, days ? "comp featured" : "clear featured", params.id, days ? `${days} days` : "");
    return { ok: true };
  });

  add("GET", "/api/admin/users", ({ query, user }) => {
    admin(user);
    const q = `%${String(query.q || "").trim().replace(/[%_]/g, "")}%`;
    return { users: db.all(
      `SELECT u.id, u.email, u.name, u.phone, u.created_at, (SELECT COUNT(*) FROM groups g WHERE g.owner_id = u.id) AS groups,
              (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id AND b.status != 'expired') AS bookings
       FROM users u WHERE u.email LIKE ? OR u.name LIKE ? ORDER BY u.id DESC LIMIT 50`, q, q) };
  });

  // Same as `npm run admin -- reset-password`, for helping someone from the browser.
  add("POST", "/api/admin/users/:id/reset-password", async ({ params, user }) => {
    admin(user);
    const id = int(params.id, "user", { min: 1 });
    const u = db.get("SELECT email FROM users WHERE id = ?", id);
    if (!u) throw new HttpError(404, "User not found");
    const pw = crypto.randomBytes(9).toString("base64url");
    db.run("UPDATE users SET pass_hash = ? WHERE id = ?", await hashPassword(pw), id);
    db.run("DELETE FROM sessions WHERE user_id = ?", id);
    log(user, "reset password", u.email);
    return { email: u.email, temporary_password: pw };
  });


}
