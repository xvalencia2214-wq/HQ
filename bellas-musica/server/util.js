import crypto from "node:crypto";

export const now = () => Math.floor(Date.now() / 1000);
export const rid = (n = 12) => crypto.randomBytes(n).toString("base64url");

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, "Request too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit = 100_000) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString("utf8"));
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

// ---- validation helpers: all throw HttpError(400) with a readable message ----
export function str(v, name, { min = 0, max = 200, required = false } = {}) {
  if (v === undefined || v === null || v === "") {
    if (required || min > 0) throw new HttpError(400, `${name} is required`);
    return "";
  }
  if (typeof v !== "string") throw new HttpError(400, `${name} must be text`);
  const s = v.trim();
  if (s.length < min) throw new HttpError(400, `${name} is too short`);
  if (s.length > max) throw new HttpError(400, `${name} is too long (max ${max})`);
  return s;
}
export function int(v, name, { min = -Infinity, max = Infinity, required = true } = {}) {
  if (v === undefined || v === null || v === "") {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}`);
  return n;
}
export function oneOf(v, name, list) {
  if (!list.includes(v)) throw new HttpError(400, `${name} must be one of: ${list.join(", ")}`);
  return v;
}
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const isZip = (s) => typeof s === "string" && /^\d{5}$/.test(s);
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);

// Fixed-window in-memory rate limiter (fine for a single small server).
export function createLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    check(key) {
      const t = Date.now();
      const h = hits.get(key);
      if (!h || t - h.start > windowMs) { hits.set(key, { start: t, n: 1 }); return true; }
      h.n += 1;
      if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start > windowMs) hits.delete(k);
      return h.n <= max;
    }
  };
}

export const centsToDollars = (c) => (c / 100).toFixed(2);
export const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// Serialize async work per key (single process). Used so two requests for the same booking can't interleave around a refund.
const locks = new Map();
export async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  const chain = prev.then(() => mine);
  locks.set(key, chain);
  await prev;
  try { return await fn(); }
  finally { release(); if (locks.get(key) === chain) locks.delete(key); }
}
