// Phone notifications (Web Push): free alerts on phones and computers that turned them on, through the browser's own push
// service (Google, Apple, Mozilla, Microsoft). Payloads are encrypted for that one device (RFC 8291) and every request is
// signed with our VAPID key (RFC 8292), so no outside library or account is needed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { now } from "./util.js";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s || ""), "base64url");
// Only the real push services: a subscription is a URL the browser gives us, so never let it point anywhere else.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([\w-]+\.)*push\.services\.mozilla\.com$/, /^([\w-]+\.)*notify\.windows\.com$/, /^([\w-]+\.)*push\.apple\.com$/];

export function validEndpoint(endpoint, allowAny = false) {
  let u;
  try { u = new URL(String(endpoint)); } catch { return false; }
  if (String(endpoint).length > 800) return false;
  if (allowAny) return u.protocol === "https:" || u.protocol === "http:";
  return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

// VAPID keys: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY if set, otherwise made once and kept beside the database (the same
// keys must survive restarts, or every phone would have to turn notifications on again).
function loadKeys(config) {
  let pub = config.vapidPublic, priv = config.vapidPrivate;
  if (!(pub && priv)) {
    const f = path.join(config.dataDir, "vapid.json");
    if (fs.existsSync(f)) ({ publicKey: pub, privateKey: priv } = JSON.parse(fs.readFileSync(f, "utf8")));
    else {
      const jwk = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
      pub = b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]));
      priv = jwk.d;
      fs.writeFileSync(f, JSON.stringify({ publicKey: pub, privateKey: priv }), { mode: 0o600 });
    }
  }
  const raw = unb64u(pub);
  const key = crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: priv, x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) } });
  return { publicKey: pub, key };
}

// The encrypted body for one device (aes128gcm content coding, a single record).
export function encryptPayload(text, p256dh, auth) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || secret.length < 16) throw new Error("bad subscription keys");
  const ecdh = crypto.createECDH("prime256v1");
  const asPub = ecdh.generateKeys();
  const shared = ecdh.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, secret, Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(text, "utf8"), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

export function createPush(config, db, alert = () => {}) {
  const { publicKey, key } = loadKeys(config);
  const subject = config.supportEmail ? `mailto:${config.supportEmail}` : config.baseUrl.startsWith("https://") ? config.baseUrl : "mailto:support@bellasmusica.invalid";
  const jwtFor = (endpoint) => {
    const enc = (o) => b64u(JSON.stringify(o));
    const data = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: now() + 12 * 3600, sub: subject })}`;
    return `${data}.${b64u(crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }))}`;
  };

  // One device. Returns true when the push service took it; a subscription the service says is gone is deleted.
  async function sendOne(sub, payload) {
    if (!validEndpoint(sub.endpoint, config.pushAllowAny)) { db.run("DELETE FROM push_subs WHERE id = ?", sub.id); return false; }
    try {
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: { Authorization: `vapid t=${jwtFor(sub.endpoint)}, k=${publicKey}`, TTL: "86400", Urgency: "high", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" },
        body: encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth),
        signal: AbortSignal.timeout(10000)
      });
      if (res.status === 404 || res.status === 410) { db.run("DELETE FROM push_subs WHERE id = ?", sub.id); return false; }
      if (!res.ok) throw new Error(`push service ${res.status}`);
      db.run("UPDATE push_subs SET last_ok = ?, fails = 0 WHERE id = ?", now(), sub.id);
      return true;
    } catch (e) {
      db.run("UPDATE push_subs SET fails = fails + 1 WHERE id = ?", sub.id);
      db.run("DELETE FROM push_subs WHERE id = ? AND fails >= 10", sub.id); // a device that keeps failing is dropped
      alert(`Phone notification failed: ${e.message}`, "push");
      return false;
    }
  }

  const hasDevice = (userId) => Boolean(db.get("SELECT 1 AS x FROM push_subs WHERE user_id = ? LIMIT 1", userId));
  // Every device of one person. Resolves to true if at least one got it.
  async function toUser(userId, payload) {
    const subs = db.all("SELECT * FROM push_subs WHERE user_id = ? ORDER BY id DESC LIMIT 10", userId);
    if (!subs.length) return false;
    db.run("INSERT INTO push_log (user_id, title, body, created_at) VALUES (?, ?, ?, ?)", userId, String(payload.title || "").slice(0, 120), String(payload.body || "").slice(0, 300), now());
    const results = await Promise.all(subs.map((s) => sendOne(s, payload)));
    return results.some(Boolean);
  }

  return { publicKey, toUser, hasDevice, sendOne };
}
