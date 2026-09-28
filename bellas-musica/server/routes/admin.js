import crypto from "node:crypto";
import { HttpError, int, now, oneOf, str, rid } from "../util.js";
import { lookupZip } from "../geo.js";
import { hashPassword } from "../auth.js";
import { backupStatus } from "../backups.js";
import { hashClaim } from "./claim.js";
import { GROUP_TYPES } from "../pricing.js";

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
      email: ctx.email.mode, backups: backupStatus(config), alerts_on: Boolean(config.alertWebhook),
      funnel_30d: {
        searches: ctx.stats.total("search"), group_views: ctx.stats.total("group_view"), booking_started: ctx.stats.total("booking_started"),
        booking_paid: ctx.stats.total("booking_paid"), booking_confirmed: ctx.stats.total("booking_confirmed"), signups: ctx.stats.total("signup")
      },
      top_zips: ctx.stats.top("search", 30, 8).map((r) => ({ zip: r.ref, city: lookupZip(r.ref)?.city || "", searches: r.n })),
      waitlist: (() => {
        const rows = db.all("SELECT zip, kind, COUNT(*) n FROM waitlist GROUP BY zip, kind");
        const by = new Map();
        for (const r of rows) { const z = lookupZip(r.zip); const k = z ? `${z.city}, ${z.state}` : r.zip; const e = by.get(k) || { place: k, customers: 0, groups: 0 }; e[r.kind === "group" ? "groups" : "customers"] += r.n; by.set(k, e); }
        return { total: db.get("SELECT COUNT(*) c FROM waitlist").c, by_city: [...by.values()].sort((a, b) => b.customers + b.groups - a.customers - a.groups).slice(0, 15) };
      })(),
      texts_30d: { sent: one("SELECT COUNT(*) c FROM sms_log WHERE sent = 1 AND created_at > ?", d30).c, failed: one("SELECT COUNT(*) c FROM sms_log WHERE error != '' AND created_at > ?", d30).c, logged_only: one("SELECT COUNT(*) c FROM sms_log WHERE sent = 0 AND error = '' AND created_at > ?", d30).c },
      invites: db.all("SELECT id, name, type, zip, created_at FROM groups WHERE invited = 1 AND owner_id IS NULL ORDER BY created_at DESC").map((g) => ({ ...g, city: lookupZip(g.zip)?.city || "" })),
      groups_list: db.all(
        `SELECT g.id, g.name, g.type, g.zip, g.demo, g.hidden, g.paused, g.published_at, g.promoted_until, g.stripe_ready, u.email AS owner_email,
                (SELECT COUNT(*) FROM bookings b WHERE b.group_id = g.id AND b.status IN ('requested','confirmed')) AS active_bookings
         FROM groups g LEFT JOIN users u ON u.id = g.owner_id ORDER BY g.demo, g.created_at DESC LIMIT 200`).map((g) => ({ ...g, city: lookupZip(g.zip)?.city || "", demo: Boolean(g.demo), hidden: Boolean(g.hidden), status: g.hidden ? "hidden" : g.demo ? "live" : g.published_at === 0 ? "draft" : g.paused ? "paused" : "live", stripe_ready: Boolean(g.stripe_ready) })),
      recent_bookings: db.all(`SELECT b.id, g.name AS group_name, b.status, b.payment_status, b.date, b.total_cents, b.deposit_cents, b.created_at FROM bookings b JOIN groups g ON g.id = b.group_id WHERE b.status != 'expired' ORDER BY b.created_at DESC LIMIT 15`),
      recent_signups: db.all("SELECT id, name, email, created_at FROM users ORDER BY id DESC LIMIT 10"),
      log: db.all("SELECT admin_email, action, target, details, created_at FROM admin_log ORDER BY id DESC LIMIT 25")
    };
  });

  // A spreadsheet-ready list of everyone waiting for a city. Cells that start with = + - @ are neutralized (CSV formula injection).
  add("GET", "/api/admin/waitlist.csv", ({ user, res }) => {
    admin(user);
    const cell = (v) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const rows = db.all("SELECT email, zip, kind, lang, created_at FROM waitlist ORDER BY id");
    const csv = ["email,zip,city,state,kind,language,signed_up", ...rows.map((r) => { const z = lookupZip(r.zip); return [r.email, r.zip, z?.city, z?.state, r.kind, r.lang, new Date(r.created_at * 1000).toISOString()].map(cell).join(","); })].join("\n") + "\n";
    log(user, "download waitlist", "", `${rows.length} rows`);
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="waitlist.csv"', "Cache-Control": "no-store" });
    res.end(csv);
  });

  // Invite a group: create a draft from the details they sent you, and get a one-time link to hand them.
  const newClaim = (groupId) => { const token = crypto.randomBytes(24).toString("base64url"); db.run("UPDATE groups SET claim_token_hash = ? WHERE id = ?", hashClaim(token), groupId); return `${config.baseUrl}/#/claim/${token}`; };
  add("POST", "/api/admin/invites", ({ body, user }) => {
    admin(user);
    const name = str(body.name, "Group name", { min: 2, max: 80 });
    const zip = str(body.zip, "ZIP", { required: true, max: 5 });
    if (!/^\d{5}$/.test(zip) || !lookupZip(zip)) throw new HttpError(400, "Enter a valid US ZIP code");
    const id = `${name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "group"}-${rid(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    db.run(`INSERT INTO groups (id, owner_id, invited, name, type, zip, rate_cents, members, story, created_at) VALUES (?, NULL, 1, ?, ?, ?, ?, ?, ?, ?)`,
      id, name, oneOf(body.type, "Type", GROUP_TYPES), zip, int(body.rate ?? 300, "Price per hour", { min: 50, max: 5000 }) * 100, int(body.members ?? 5, "Musicians", { min: 1, max: 40 }), str(body.story, "Story", { max: 800 }), now());
    log(user, "create invite", id, name);
    return { group_id: id, claim_url: newClaim(id) }; // shown once: only a hash is kept
  });
  add("POST", "/api/admin/invites/:id/regenerate", ({ params, user }) => {
    admin(user);
    const g = db.get("SELECT id FROM groups WHERE id = ? AND invited = 1 AND owner_id IS NULL", params.id);
    if (!g) throw new HttpError(404, "No unclaimed invitation with that id");
    log(user, "new invite link", g.id);
    return { claim_url: newClaim(g.id) };
  });
  add("DELETE", "/api/admin/invites/:id", ({ params, user }) => {
    admin(user);
    const g = db.get("SELECT id, name FROM groups WHERE id = ? AND invited = 1 AND owner_id IS NULL", params.id);
    if (!g) throw new HttpError(404, "No unclaimed invitation with that id");
    db.run("DELETE FROM groups WHERE id = ?", g.id);
    log(user, "delete invite", g.id, g.name);
    return { ok: true };
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
