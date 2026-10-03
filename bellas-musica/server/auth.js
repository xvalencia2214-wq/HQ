import crypto from "node:crypto";
import { promisify } from "node:util";
import { now, parseCookies } from "./util.js";

const scrypt = promisify(crypto.scrypt);
export const COOKIE = "bm_sid";
const SESSION_DAYS = 30;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", hashToken(token), userId, now() + SESSION_DAYS * 86400);
  return token;
}

export function userFromRequest(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db.get(
    `SELECT u.id, u.email, u.name, u.phone, u.sms_opt_in, u.email_notify, u.email_verified, u.lang, u.notify_channel FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`, hashToken(token), now());
  return row || null;
}

export function destroySession(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.run("DELETE FROM sessions WHERE token_hash = ?", hashToken(token));
}

export function sessionCookie(token, { secure, clear = false }) {
  const attrs = [`${COOKIE}=${clear ? "" : token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

// One-time links (password reset, email confirmation). Only a hash is stored, so a database leak can't be used to take over accounts.
export function createAuthToken(db, userId, kind, ttlSeconds) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.run("DELETE FROM auth_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL", userId, kind); // only the newest link works
  db.run("INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)", hashToken(token), userId, kind, now() + ttlSeconds);
  return token;
}

// Returns the user id if the token is valid, unused and unexpired, and burns it in the same statement so it can't be replayed.
export function consumeAuthToken(db, token, kind) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const h = hashToken(token);
  const res = db.run("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?", now(), h, kind, now());
  if (res.changes !== 1) return null;
  return db.get("SELECT user_id FROM auth_tokens WHERE token_hash = ?", h).user_id;
}
