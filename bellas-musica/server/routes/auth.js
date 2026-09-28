import { HttpError, now, str } from "../util.js";
import { hashPassword, verifyPassword, createSession, destroySession, sessionCookie } from "../auth.js";
import { normalizePhone } from "../sms.js";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64"); // burns the same time for unknown emails

export const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, phone: u.phone, sms_opt_in: Boolean(u.sms_opt_in), lang: u.lang };

function phoneField(v) {
  const raw = str(v, "Phone", { max: 30 });
  if (!raw) return "";
  const p = normalizePhone(raw);
  if (!p) throw new HttpError(400, "Enter a valid US phone number");
  return p;
}

export default function authRoutes(ctx, add) {
  const { db, limiters } = ctx;
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
    return { user: publicUser(db.get("SELECT * FROM users WHERE id = ?", info.lastInsertRowid)) };
  });

  add("POST", "/api/auth/login", async ({ req, res, body, ip }) => {
    const email = str(body.email, "Email", { required: true, max: 254 }).toLowerCase();
    if (!limiters.auth.check(`${ip}|${email}`)) throw new HttpError(429, "Too many login attempts. Try again in 15 minutes.");
    const u = db.get("SELECT * FROM users WHERE email = ?", email);
    const ok = await verifyPassword(typeof body.password === "string" ? body.password : "", u ? u.pass_hash : DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, "Wrong email or password");
    startSession(res, req, u.id);
    return { user: publicUser(u) };
  });

  add("POST", "/api/auth/logout", ({ req, res }) => {
    destroySession(db, req);
    res.setHeader("Set-Cookie", sessionCookie("", { secure: ctx.isSecure(req), clear: true }));
    return { ok: true };
  });

  add("GET", "/api/me", ({ user }) => ({ user: publicUser(user) }));

  add("PATCH", "/api/me", ({ body, user }) => {
    const name = body.name !== undefined ? str(body.name, "Name", { min: 1, max: 80 }) : user.name;
    const phone = body.phone !== undefined ? phoneField(body.phone) : user.phone;
    const sms = body.sms_opt_in !== undefined ? (body.sms_opt_in === true && phone ? 1 : 0) : (phone ? user.sms_opt_in : 0);
    const lang = body.lang === "es" || body.lang === "en" ? body.lang : user.lang;
    db.run("UPDATE users SET name = ?, phone = ?, sms_opt_in = ?, lang = ? WHERE id = ?", name, phone, sms, lang, user.id);
    return { user: publicUser(db.get("SELECT * FROM users WHERE id = ?", user.id)) };
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
}
