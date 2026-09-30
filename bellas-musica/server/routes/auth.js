import { HttpError, now, str, todayStr } from "../util.js";
import { hashPassword, verifyPassword, createSession, destroySession, sessionCookie, createAuthToken, consumeAuthToken } from "../auth.js";
import { normalizePhone } from "../sms.js";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64"); // burns the same time for unknown emails

export const publicUser = (u, admins = []) => u && { id: u.id, email: u.email, name: u.name, phone: u.phone, sms_opt_in: Boolean(u.sms_opt_in), email_notify: Boolean(u.email_notify), email_verified: Boolean(u.email_verified), lang: u.lang, is_admin: admins.includes(String(u.email).toLowerCase()) };

function phoneField(v) {
  const raw = str(v, "Phone", { max: 30 });
  if (!raw) return "";
  const p = normalizePhone(raw);
  if (!p) throw new HttpError(400, "Enter a valid US phone number");
  return p;
}

export default function authRoutes(ctx, add) {
  const { db, limiters } = ctx;
  const pub = (u) => publicUser(u, ctx.config.adminEmails);
  const sendVerification = (userId) => ctx.notify.to(userId, "auth.verify", { url: `${ctx.config.baseUrl}/#/verify/${createAuthToken(db, userId, "verify", 24 * 3600)}` });
  const startSession = (res, req, userId) => res.setHeader("Set-Cookie", sessionCookie(createSession(db, userId), { secure: ctx.isSecure(req) }));

  add("POST", "/api/auth/register", async ({ req, res, body, ip }) => {
    if (!limiters.register.check(ip)) throw new HttpError(429, "Too many sign-ups from this network. Try again later.");
    const email = str(body.email, "Email", { required: true, max: 254 }).toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email");
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 200) throw new HttpError(400, "Password must be 8 to 200 characters");
    const name = str(body.name, "Name", { min: 1, max: 80 });
    const phone = phoneField(body.phone);
    const sms = body.sms_opt_in === true && phone ? 1 : 0;
    if (db.get("SELECT 1 AS x FROM users WHERE email = ?", email)) throw new HttpError(409, "That email already has an account. Try logging in.");
    const info = db.run("INSERT INTO users (email, name, phone, sms_opt_in, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)", email, name, phone, sms, await hashPassword(password), now());
    startSession(res, req, Number(info.lastInsertRowid));
    ctx.stats.count("signup");
    sendVerification(Number(info.lastInsertRowid));
    return { user: pub(db.get("SELECT * FROM users WHERE id = ?", info.lastInsertRowid)) };
  });

  add("POST", "/api/auth/login", async ({ req, res, body, ip }) => {
    const email = str(body.email, "Email", { required: true, max: 254 }).toLowerCase();
    if (!limiters.auth.check(`${ip}|${email}`)) throw new HttpError(429, "Too many login attempts. Try again in 15 minutes.");
    const u = db.get("SELECT * FROM users WHERE email = ?", email);
    const ok = await verifyPassword(typeof body.password === "string" ? body.password : "", u ? u.pass_hash : DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, "Wrong email or password");
    startSession(res, req, u.id);
    return { user: pub(u) };
  });

  add("POST", "/api/auth/logout", ({ req, res }) => {
    destroySession(db, req);
    res.setHeader("Set-Cookie", sessionCookie("", { secure: ctx.isSecure(req), clear: true }));
    return { ok: true };
  });

  // ---- forgot / reset password, confirm email ----
  add("POST", "/api/auth/forgot", ({ body, ip }) => {
    const email = str(body.email, "Email", { required: true, max: 254 }).toLowerCase();
    if (!limiters.forgot.check(`${ip}|${email}`) || !limiters.forgot.check(`${ip}|*`)) throw new HttpError(429, "Too many requests. Try again in an hour.");
    const u = db.get("SELECT id FROM users WHERE email = ?", email);
    if (u) ctx.notify.to(u.id, "auth.reset", { url: `${ctx.config.baseUrl}/#/reset/${createAuthToken(db, u.id, "reset", 3600)}` });
    return { ok: true }; // same answer whether or not the address has an account
  });

  add("POST", "/api/auth/reset", async ({ body, ip }) => {
    if (!limiters.auth.check(`${ip}|reset`)) throw new HttpError(429, "Too many attempts. Try again later.");
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 200) throw new HttpError(400, "Password must be 8 to 200 characters");
    const userId = consumeAuthToken(db, body.token, "reset");
    if (!userId) throw new HttpError(400, "This reset link is invalid or has expired. Ask for a new one.");
    db.run("UPDATE users SET pass_hash = ?, email_verified = 1 WHERE id = ?", await hashPassword(password), userId); // clicking the link proves they own the inbox
    db.run("DELETE FROM sessions WHERE user_id = ?", userId);
    ctx.notify.to(userId, "auth.reset_done", {});
    return { ok: true };
  });

  add("POST", "/api/auth/verify", ({ body }) => {
    const userId = consumeAuthToken(db, body.token, "verify");
    if (!userId) throw new HttpError(400, "This confirmation link is invalid or has expired.");
    db.run("UPDATE users SET email_verified = 1 WHERE id = ?", userId);
    return { ok: true };
  });

  add("POST", "/api/auth/resend-verification", ({ user, ip }) => {
    if (user.email_verified) return { ok: true, already: true };
    if (!limiters.forgot.check(`${ip}|verify|${user.id}`)) throw new HttpError(429, "Too many requests. Try again in an hour.");
    sendVerification(user.id);
    return { ok: true };
  }, { auth: true });

  add("GET", "/api/me", ({ user }) => ({ user: pub(user) }));

  add("PATCH", "/api/me", ({ body, user }) => {
    const name = body.name !== undefined ? str(body.name, "Name", { min: 1, max: 80 }) : user.name;
    const phone = body.phone !== undefined ? phoneField(body.phone) : user.phone;
    const sms = body.sms_opt_in !== undefined ? (body.sms_opt_in === true && phone ? 1 : 0) : (phone ? user.sms_opt_in : 0);
    const lang = body.lang === "es" || body.lang === "en" ? body.lang : user.lang;
    const emailNotify = body.email_notify !== undefined ? (body.email_notify === true ? 1 : 0) : undefined;
    db.run("UPDATE users SET name = ?, phone = ?, sms_opt_in = ?, lang = ?, email_notify = COALESCE(?, email_notify) WHERE id = ?", name, phone, sms, lang, emailNotify ?? null, user.id);
    return { user: pub(db.get("SELECT * FROM users WHERE id = ?", user.id)) };
  }, { auth: true });

  add("POST", "/api/me/password", async ({ req, res, body, user, ip }) => {
    if (!limiters.auth.check(`${ip}|pw|${user.id}`)) throw new HttpError(429, "Too many attempts. Try again later.");
    const row = db.get("SELECT pass_hash FROM users WHERE id = ?", user.id);
    if (!(await verifyPassword(typeof body.current === "string" ? body.current : "", row.pass_hash))) throw new HttpError(401, "Current password is wrong");
    const next = typeof body.next === "string" ? body.next : "";
    if (next.length < 8 || next.length > 200) throw new HttpError(400, "New password must be 8 to 200 characters");
    db.run("UPDATE users SET pass_hash = ? WHERE id = ?", await hashPassword(next), user.id);
    // Sign out every other device, keep this one.
    destroySession(db, req);
    db.run("DELETE FROM sessions WHERE user_id = ?", user.id);
    startSession(res, req, user.id);
    return { ok: true };
  }, { auth: true });

  // Delete my account. Booking records must be kept (payments, taxes), so the person is anonymized rather than erased.
  add("POST", "/api/me/delete", async ({ req, res, body, user, ip }) => {
    if (!limiters.auth.check(`${ip}|del|${user.id}`)) throw new HttpError(429, "Too many attempts. Try again later.");
    const row = db.get("SELECT pass_hash FROM users WHERE id = ?", user.id);
    if (!(await verifyPassword(typeof body.password === "string" ? body.password : "", row.pass_hash))) throw new HttpError(401, "Wrong password");
    const today = todayStr();
    if (db.get("SELECT COUNT(*) c FROM bookings WHERE customer_id = ? AND status IN ('requested','confirmed') AND date >= ?", user.id, today).c) {
      throw new HttpError(409, "You have upcoming bookings. Cancel them first, then delete your account.");
    }
    if (db.get("SELECT COUNT(*) c FROM bookings b JOIN groups g ON g.id = b.group_id WHERE g.owner_id = ? AND b.status IN ('requested','confirmed') AND b.date >= ?", user.id, today).c) {
      throw new HttpError(409, "Your group has upcoming bookings. Decline or cancel them first, then delete your account.");
    }
    db.tx(() => {
      db.run("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE customer_id = ? AND status = 'pending_payment'", now(), user.id); // unpaid holds
      db.run("UPDATE users SET email = ?, name = 'Deleted user', phone = '', sms_opt_in = 0, pass_hash = 'deleted' WHERE id = ?", `deleted-${user.id}@deleted.invalid`, user.id);
      db.run("DELETE FROM sessions WHERE user_id = ?", user.id);
      db.run("UPDATE bookings SET name = 'Deleted user', phone = '', address = '', message = '' WHERE customer_id = ?", user.id);
      db.run("DELETE FROM messages WHERE customer_id = ?", user.id);
      db.run("DELETE FROM thread_reads WHERE customer_id = ?", user.id);
      db.run("DELETE FROM favorites WHERE user_id = ?", user.id);
      db.run("DELETE FROM shortlists WHERE user_id = ?", user.id); // shared links stop working; items go with them
      db.run("UPDATE groups SET hidden = 1, contact_phone = '' WHERE owner_id = ?", user.id); // their listings disappear
    });
    res.setHeader("Set-Cookie", sessionCookie("", { secure: ctx.isSecure(req), clear: true }));
    return { ok: true };
  }, { auth: true });
}
