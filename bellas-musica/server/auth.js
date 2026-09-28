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
    `SELECT u.id, u.email, u.name, u.phone, u.sms_opt_in, u.lang FROM sessions s JOIN users u ON u.id = s.user_id
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
