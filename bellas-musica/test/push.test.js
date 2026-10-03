// Phone notifications: a pretend push service receives what the app sends; the test decrypts each one with the phone's
// own key (exactly what a real phone does) and checks the VAPID signature, so the encryption is proven, not assumed.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";
import { validEndpoint, encryptPayload } from "../server/push.js";
import { sendDailyTexts } from "../server/jobs.js";

const b64u = (b) => Buffer.from(b).toString("base64url");
// A pretend phone: its own key pair and auth secret, and the decryption a browser does (RFC 8291).
function phone() {
  const ecdh = crypto.createECDH("prime256v1"); const pub = ecdh.generateKeys(); const auth = crypto.randomBytes(16);
  const decrypt = (buf) => {
    const salt = buf.subarray(0, 16), idlen = buf[20], as = buf.subarray(21, 21 + idlen), ct = buf.subarray(21 + idlen);
    const shared = ecdh.computeSecret(as);
    const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), pub, as]), 32));
    const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2); // last-record delimiter
    return JSON.parse(plain.subarray(0, -1).toString("utf8"));
  };
  return { keys: { p256dh: b64u(pub), auth: b64u(auth) }, decrypt };
}
// A pretend push service: records each delivery; a path ending in /gone answers 410 like a phone that uninstalled.
async function pushService() {
  const got = [];
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => { got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(req.url.endsWith("/gone") ? 410 : 201); res.end(); });
  });
  await new Promise((r) => srv.listen(0, r));
  return { url: `http://127.0.0.1:${srv.address().port}`, got, close: () => new Promise((r) => srv.close(r)) };
}
const wait = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 40)); return fn(); };
// The VAPID header: a JWT signed with the key the app publishes
function checkVapid(headers, publicKey, origin) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(headers.authorization);
  assert.ok(m, headers.authorization); assert.equal(m[2], publicKey);
  const [h, c, sig] = m[1].split(".");
  const raw = Buffer.from(publicKey, "base64url");
  const key = crypto.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)) } });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claims.aud, origin); assert.ok(claims.exp > Date.now() / 1000);
  assert.equal(headers["content-encoding"], "aes128gcm");
}

test("only real push services are accepted as addresses", () => {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QK2", "https://wns2-par02p.notify.windows.com/w/?token=x"]) assert.ok(validEndpoint(ok), ok);
  for (const bad of ["http://fcm.googleapis.com/x", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com:8443/x", "file:///etc/passwd", "not a url"]) assert.ok(!validEndpoint(bad), bad);
  assert.throws(() => encryptPayload("x", "short", "short"));
});

test("phone notifications: turn on, get alerts (encrypted and signed), instead of texts, test button, gone phones removed", async () => {
  const P = await pushService();
  const S = await startApp({ DEMO_SEED: "0", PUSH_ALLOW_ANY: "1" });
  try {
    const o = client(S.base), c = client(S.base);
    await o.signup("push-o@example.com", "Paco Owner", { phone: "312-555-0111", sms_opt_in: true, lang: "es" });
    await c.signup("push-c@example.com", "Carla Cliente");
    const key = (await o.get("/api/push/key")).json.key;
    assert.equal(Buffer.from(key, "base64url").length, 65);
    const ph = phone();
    // bad subscriptions are refused
    assert.equal((await o.post("/api/push/subscribe", { endpoint: "ftp://x", keys: ph.keys })).status, 400);
    assert.equal((await o.post("/api/push/subscribe", { endpoint: P.url + "/a", keys: { p256dh: "abc", auth: "def" } })).status, 400);
    assert.equal((await client(S.base).post("/api/push/subscribe", { endpoint: P.url + "/a", keys: ph.keys })).status, 401);
    // "instead of texts" needs a device first
    await o.patch("/api/me", { name: "Paco Owner", phone: "312-555-0111", sms_opt_in: true, push_only: true });
    assert.equal(S.db.get("SELECT push_only FROM users WHERE email = 'push-o@example.com'").push_only, 0);
    assert.equal((await o.post("/api/push/subscribe", { endpoint: P.url + "/paco", keys: ph.keys, device: "Android" })).json.devices, 1);

    // the test button
    assert.equal((await o.post("/api/push/test")).status, 200);
    assert.ok(await wait(() => P.got.length === 1));
    checkVapid(P.got[0].headers, key, P.url);
    assert.match(ph.decrypt(P.got[0].body).body, /Listo/);

    // a real alert: a paid booking request, in the owner's language, opening the dashboard
    const g = await makeGroup(o, { dates: [inDays(10)] });
    const smsBefore = S.db.get("SELECT COUNT(*) c FROM sms_log").c;
    const b = (await c.post("/api/bookings", bookingBody(g, inDays(10)))).json.booking;
    await c.post(`/api/bookings/${b.id}/simulate-pay`);
    assert.ok(await wait(() => P.got.length >= 2));
    const n = ph.decrypt(P.got[1].body);
    assert.ok(n.title && n.body && !/https?:/.test(n.body), JSON.stringify(n));
    assert.match(n.url, /^\/#\//); assert.doesNotMatch(n.body, /^Bella/);
    assert.ok(S.db.get("SELECT COUNT(*) c FROM sms_log").c > smsBefore, "texts still go out by default");

    // instead of texts: no text while the phone is reachable
    await o.patch("/api/me", { name: "Paco Owner", phone: "312-555-0111", sms_opt_in: true, push_only: true });
    assert.equal((await o.get("/api/me")).json.user.push_only, true);
    const before = S.db.get("SELECT COUNT(*) c FROM sms_log").c, pushes = P.got.length;
    await c.post(`/api/groups/${g}/messages`, { text: "Hola, ¿tienen trompeta?" });
    assert.ok(await wait(() => P.got.length > pushes));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(S.db.get("SELECT COUNT(*) c FROM sms_log").c, before);

    // the morning message reaches the phone
    await o.patch(`/api/bookings/${b.id}`, { action: "accept" });
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), b.id);
    const p2 = P.got.length;
    assert.equal(sendDailyTexts(S.ctx, { hour: 8 }), 1);
    assert.ok(await wait(() => P.got.length > p2));
    assert.match(ph.decrypt(P.got[P.got.length - 1].body).body, /Hoy: 1 evento/);

    // the phone uninstalled: the service says 410, the device is dropped, and texts come back
    S.db.run("UPDATE push_subs SET endpoint = ? WHERE user_id = (SELECT id FROM users WHERE email = 'push-o@example.com')", P.url + "/gone");
    const before2 = S.db.get("SELECT COUNT(*) c FROM sms_log").c;
    S.db.run("UPDATE messages SET created_at = created_at - 3600"); // chat alerts go out at most every 30 minutes
    await c.post(`/api/groups/${g}/messages`, { text: "¿Y violín?" });
    assert.ok(await wait(() => !S.db.get("SELECT COUNT(*) c FROM push_subs").c));
    assert.ok(await wait(() => S.db.get("SELECT COUNT(*) c FROM sms_log").c > before2), "fell back to a text");

    // the same phone, someone else logs in: it moves to them; turning off works
    await o.post("/api/push/subscribe", { endpoint: P.url + "/shared", keys: ph.keys });
    await c.post("/api/push/subscribe", { endpoint: P.url + "/shared", keys: ph.keys });
    assert.equal(S.db.get("SELECT COUNT(*) c FROM push_subs").c, 1);
    assert.equal((await c.post("/api/push/unsubscribe", { endpoint: P.url + "/shared" })).json.devices, 0);
  } finally { await S.close(); await P.close(); }
});
