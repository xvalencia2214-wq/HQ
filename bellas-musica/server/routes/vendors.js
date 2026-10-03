import fs from "node:fs";
import path from "node:path";
import { HttpError, int, now, oneOf, rid, str, todayStr } from "../util.js";
import { balancePaidInApp, categoryOf } from "../pricing.js";
import { getGroup, newId, requireOwner, requireRealOwner, isPro } from "../shared.js";
import { bookingsFeed, checkCalendarUrl, syncCalendar } from "../ical.js";
import { sniffImage } from "../media.js";

const REFERRAL_DAYS = 30;
const DOC_KINDS = ["insurance", "health_permit", "business_license", "security_license", "other"];
const MAX_DOC_BYTES = 5 * 1024 * 1024;

// Which papers a kind of vendor should have on file (shown in its dashboard).
export function docsNeeded(type) {
  const c = categoryOf(type);
  if (c === "food") return ["health_permit", "insurance"];
  if (["Bounce house", "Tents", "Dance floor and stage"].includes(type)) return ["insurance"];
  if (type === "Security / bouncer") return ["security_license", "insurance"];
  if (c === "venues") return ["business_license", "insurance"];
  return [];
}

// Vendor tools: referrals, Bella's Pro, calendar sync, earnings, and licenses/insurance for review.
export default function vendorRoutes(ctx, add) {
  const { db, config, stripe } = ctx;
  const docDir = path.join(config.dataDir || path.dirname(config.uploadDir), "documents");
  fs.mkdirSync(docDir, { recursive: true });

  // ---- referrals: invite another business; when it publishes, both get half the platform fee for 30 days ----
  const myCode = (user) => {
    let u = db.get("SELECT ref_code FROM users WHERE id = ?", user.id);
    if (!u.ref_code) { db.run("UPDATE users SET ref_code = ? WHERE id = ? AND ref_code = ''", rid(5).replace(/[-_]/g, "x").toUpperCase(), user.id); u = db.get("SELECT ref_code FROM users WHERE id = ?", user.id); }
    return u.ref_code;
  };
  add("GET", "/api/my/referral", ({ user }) => {
    const code = myCode(user);
    const joined = db.all("SELECT u.id, u.ref_rewarded FROM users u WHERE u.referred_by = ?", user.id);
    return { code, url: `${config.baseUrl}/#/signup?ref=${code}&next=${encodeURIComponent("#/dashboard?new=1")}`, invited: joined.length, live: joined.filter((x) => x.ref_rewarded).length, days: REFERRAL_DAYS };
  }, { auth: true });

  // ---- Bella's Pro: 30 days of a lower platform fee, a Pro badge and more photos ----
  add("POST", "/api/groups/:id/pro", async ({ params, user }) => {
    const g = requireRealOwner(db, user, params.id);
    const id = newId("f");
    db.run("INSERT INTO payments_feature (id, group_id, amount_cents, kind, created_at) VALUES (?, ?, ?, 'pro', ?)", id, g.id, config.proPriceCents, now());
    if (!stripe.live) return { id, simulated: true, url: `${config.baseUrl}/#/pay/pro/${id}`, amount_cents: config.proPriceCents };
    const session = await stripe.checkoutForFeature({ feature: { id, amount_cents: config.proPriceCents, name: `Bella's Pro (30 days): ${g.name}` }, group: g, successUrl: `${config.baseUrl}/#/dashboard?feature=${id}`, cancelUrl: `${config.baseUrl}/#/dashboard` });
    db.run("UPDATE payments_feature SET stripe_session_id = ? WHERE id = ?", session.id, id);
    return { id, url: session.url, amount_cents: config.proPriceCents };
  }, { auth: true });

  // ---- calendar sync ----
  const calView = (g) => ({
    feed_url: g.ical_token ? `${config.baseUrl}/api/cal/${g.ical_token}.ics` : "",
    import_url: g.ical_import_url, synced_at: g.ical_synced_at, error: g.ical_error,
    busy_days: db.get("SELECT COUNT(DISTINCT date) c FROM ext_busy WHERE group_id = ? AND date >= ?", g.id, todayStr()).c
  });
  add("GET", "/api/groups/:id/calendar-sync", ({ params, user }) => ({ sync: calView(requireOwner(db, user, params.id)) }), { auth: true });
  // A private feed link (anyone with it can read the booking times): created on demand, replaced if it leaked.
  add("POST", "/api/groups/:id/calendar-sync/feed", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    db.run("UPDATE groups SET ical_token = ? WHERE id = ?", rid(18), g.id);
    return { sync: calView(getGroup(db, g.id)) };
  }, { auth: true });
  add("PUT", "/api/groups/:id/calendar-sync/import", async ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    const url = checkCalendarUrl(str(body.url, "Calendar link", { required: true, max: 600 }), { allowHttp: config.icsAllowHttp });
    db.run("UPDATE groups SET ical_import_url = ?, ical_error = '' WHERE id = ?", url, g.id);
    const r = await syncCalendar(ctx, getGroup(db, g.id));
    if (r.error) throw new HttpError(400, `We couldn't read that calendar: ${r.error}`);
    return { sync: calView(getGroup(db, g.id)) };
  }, { auth: true });
  add("DELETE", "/api/groups/:id/calendar-sync/import", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    db.tx(() => { db.run("UPDATE groups SET ical_import_url = '', ical_error = '', ical_synced_at = 0 WHERE id = ?", g.id); db.run("DELETE FROM ext_busy WHERE group_id = ?", g.id); });
    return { sync: calView(getGroup(db, g.id)) };
  }, { auth: true });
  add("GET", "/api/cal/:file", ({ params, res }) => {
    const token = String(params.file).replace(/\.ics$/, "");
    const g = /^[\w-]{20,40}$/.test(token) ? db.get("SELECT * FROM groups WHERE ical_token = ?", token) : null;
    if (!g) throw new HttpError(404, "Not found");
    const rows = db.all("SELECT id, date, time, hours, duration_min, event_type, name, guests, address, status FROM bookings WHERE group_id = ? AND status IN ('requested','confirmed') AND date >= ? ORDER BY date", g.id, todayStr().slice(0, 8) + "01");
    res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" });
    res.end(bookingsFeed(g.name, rows));
  });

  // ---- earnings: what reached the vendor through the app, by month of the event (for taxes and planning) ----
  function earnings(g, year) {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}`, events: 0, deposits_cents: 0, balances_cents: 0, extras_cents: 0, offline_cents: 0, fees_cents: 0, refunded_cents: 0 }));
    for (const b of db.all("SELECT * FROM bookings WHERE group_id = ? AND date LIKE ? AND payment_status != 'unpaid'", g.id, `${year}-%`)) {
      const m = months[Number(b.date.slice(5, 7)) - 1];
      const kept = b.deposit_cents - b.refund_cents;
      const share = Math.round((kept * (b.deposit_cents - b.platform_fee_cents)) / b.deposit_cents); // the vendor's part of the deposit kept
      m.deposits_cents += share;
      m.fees_cents += kept - share;
      m.balances_cents += Math.max(0, balancePaidInApp(b) - b.balance_refund_cents);
      if (b.balance_status === "offline") m.offline_cents += b.total_cents - b.deposit_cents - (b.balance_parts_cents || 0);
      m.refunded_cents += b.refund_cents + b.balance_refund_cents;
      if (b.status === "confirmed") m.events++;
      for (const x of db.all("SELECT status, amount_cents, fee_cents FROM extras WHERE booking_id = ? AND status IN ('paid','cash')", b.id)) {
        if (x.status === "paid") { m.extras_cents += x.amount_cents - x.fee_cents; m.fees_cents += x.fee_cents; } else m.offline_cents += x.amount_cents;
      }
    }
    const total = months.reduce((t, m) => { for (const k of Object.keys(t)) t[k] += m[k]; return t; }, { events: 0, deposits_cents: 0, balances_cents: 0, extras_cents: 0, offline_cents: 0, fees_cents: 0, refunded_cents: 0 });
    return { year, months, total };
  }
  const yearOf = (q) => (q.year ? int(q.year, "Year", { min: 2024, max: 2100 }) : Number(todayStr().slice(0, 4)));
  add("GET", "/api/groups/:id/earnings", ({ params, query, user }) => ({ earnings: earnings(requireOwner(db, user, params.id), yearOf(query)) }), { auth: true });
  add("GET", "/api/groups/:id/earnings.csv", ({ params, query, user, res }) => {
    const g = requireOwner(db, user, params.id), e = earnings(g, yearOf(query));
    const d = (c) => (c / 100).toFixed(2);
    const rows = [["month", "events", "deposits_to_you", "balances_paid_in_app", "extras_paid_in_app", "paid_outside_app", "platform_fees", "refunded_to_customers"], ...e.months.map((m) => [m.month, m.events, d(m.deposits_cents), d(m.balances_cents), d(m.extras_cents), d(m.offline_cents), d(m.fees_cents), d(m.refunded_cents)]),
      ["total", e.total.events, d(e.total.deposits_cents), d(e.total.balances_cents), d(e.total.extras_cents), d(e.total.offline_cents), d(e.total.fees_cents), d(e.total.refunded_cents)]];
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="earnings-${e.year}.csv"`, "Cache-Control": "no-store" });
    res.end(rows.map((r) => r.join(",")).join("\r\n") + "\r\n");
  }, { auth: true });

  // ---- licenses, permits and insurance ----
  const docView = (d) => ({ id: d.id, kind: d.kind, status: d.status, expires: d.expires, note: d.note, created_at: d.created_at });
  add("GET", "/api/groups/:id/documents", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    return { documents: db.all("SELECT * FROM documents WHERE group_id = ? ORDER BY created_at DESC", g.id).map(docView), needed: docsNeeded(g.type) };
  }, { auth: true });
  add("POST", "/api/groups/:id/documents", ({ params, body, user, ip }) => {
    const g = requireOwner(db, user, params.id);
    if (!ctx.limiters.upload.check(`${ip}|${user.id}`)) throw new HttpError(429, "Too many uploads. Try again later.");
    const kind = oneOf(body.kind, "Document type", DOC_KINDS);
    if (db.get("SELECT COUNT(*) c FROM documents WHERE group_id = ? AND status = 'pending'", g.id).c >= 5) throw new HttpError(400, "You have several documents waiting for review already.");
    const b64 = typeof body.data === "string" ? body.data.replace(/^data:[\w/+.-]+;base64,/i, "") : "";
    if (!b64 || b64.length > MAX_DOC_BYTES * 1.4) throw new HttpError(413, "The file is too large (max 5 MB)");
    const buf = Buffer.from(b64, "base64");
    if (buf.length > MAX_DOC_BYTES) throw new HttpError(413, "The file is too large (max 5 MB)");
    const img = sniffImage(buf), pdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
    if (!img && !pdf) throw new HttpError(400, "Upload a PDF or a photo (JPG, PNG or WebP)");
    const id = newId("d"), file = `${id}.${pdf ? "pdf" : img.ext}`;
    fs.writeFileSync(path.join(docDir, file), buf, { flag: "wx" });
    db.run("INSERT INTO documents (id, group_id, kind, file, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, g.id, kind, file, pdf ? "application/pdf" : img.mime || `image/${img.ext}`, now());
    return { documents: db.all("SELECT * FROM documents WHERE group_id = ? ORDER BY created_at DESC", g.id).map(docView), needed: docsNeeded(g.type) };
  }, { auth: true, limit: 7_500_000 });

  // admin review (the admin routes module checks is_admin for /api/admin/*; these do it themselves)
  const admin = (user) => { if (!user || !config.adminEmails.includes(user.email.toLowerCase())) throw new HttpError(404, "Not found"); };
  add("GET", "/api/admin/documents", ({ user, query }) => {
    admin(user);
    const status = query.status ? oneOf(query.status, "status", ["pending", "approved", "rejected"]) : "pending";
    return { documents: db.all("SELECT d.*, g.name AS group_name, g.type FROM documents d JOIN groups g ON g.id = d.group_id WHERE d.status = ? ORDER BY d.created_at LIMIT 100", status).map((d) => ({ ...docView(d), group_id: d.group_id, group_name: d.group_name, type: d.type })) };
  }, { auth: true });
  add("GET", "/api/admin/documents/:id/file", ({ params, user, res }) => {
    admin(user);
    const d = db.get("SELECT * FROM documents WHERE id = ?", params.id);
    if (!d) throw new HttpError(404, "Not found");
    res.writeHead(200, { "Content-Type": d.mime, "Content-Disposition": `inline; filename="${d.file}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" });
    res.end(fs.readFileSync(path.join(docDir, d.file)));
  }, { auth: true });
  add("POST", "/api/admin/documents/:id", ({ params, body, user }) => {
    admin(user);
    const d = db.get("SELECT * FROM documents WHERE id = ?", params.id);
    if (!d) throw new HttpError(404, "Not found");
    const approve = body.approve === true;
    const expires = body.expires ? (/^\d{4}-\d{2}-\d{2}$/.test(body.expires) ? body.expires : (() => { throw new HttpError(400, "Expiry date looks like 2027-06-30"); })()) : "";
    db.tx(() => {
      db.run("UPDATE documents SET status = ?, expires = ?, note = ?, reviewed_at = ? WHERE id = ?", approve ? "approved" : "rejected", expires, str(body.note, "Note", { max: 200 }), now(), d.id);
      if (approve) db.run(`UPDATE groups SET ${d.kind === "insurance" ? "insured" : "licensed"} = 1 WHERE id = ?`, d.group_id);
      db.run("INSERT INTO admin_log (admin_email, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)", user.email, approve ? "document approved" : "document rejected", d.group_id, d.kind, now());
    });
    const g = getGroup(db, d.group_id);
    ctx.notify.toGroup(g, approve ? "doc.approved.group" : "doc.rejected.group", { group: g.name, doc: d.kind.replace(/_/g, " "), note: str(body.note, "Note", { max: 200 }), url: `${config.baseUrl}/#/dashboard?g=${g.id}&tab=payments` });
    return { ok: true };
  }, { auth: true });

  // Approved documents that expired take the badge away again (checked by the hourly job).
  ctx.expireDocuments = () => {
    for (const d of db.all("SELECT * FROM documents WHERE status = 'approved' AND expires != '' AND expires < ?", todayStr())) {
      db.run("UPDATE documents SET status = 'expired' WHERE id = ?", d.id);
      const still = db.get("SELECT 1 AS x FROM documents WHERE group_id = ? AND status = 'approved' AND kind " + (d.kind === "insurance" ? "= 'insurance'" : "!= 'insurance'"), d.group_id);
      if (!still) db.run(`UPDATE groups SET ${d.kind === "insurance" ? "insured" : "licensed"} = 0 WHERE id = ?`, d.group_id);
    }
  };

  // Calendar imports re-read every hour.
  ctx.syncCalendars = async () => {
    for (const g of db.all("SELECT * FROM groups WHERE ical_import_url != ''")) await syncCalendar(ctx, g);
  };
  void isPro;
}
