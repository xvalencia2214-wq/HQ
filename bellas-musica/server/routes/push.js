// Phone notifications: a device turns them on (or off) for the person logged in, and can send itself a test.
import { HttpError, now, str } from "../util.js";
import { validEndpoint } from "../push.js";

export default function pushRoutes(ctx, add) {
  const { db, push, config } = ctx;

  add("GET", "/api/push/key", () => ({ key: push.publicKey }));

  add("POST", "/api/push/subscribe", ({ body, user }) => {
    if (!ctx.limiters.upload.check("push|" + user.id)) throw new HttpError(429, "Too many tries. Wait a little and try again.");
    const endpoint = str(body.endpoint, "Endpoint", { required: true, max: 800 });
    if (!validEndpoint(endpoint, config.pushAllowAny)) throw new HttpError(400, "This browser's notification service isn't supported");
    const p256dh = str(body.keys?.p256dh, "Key", { required: true, max: 200 }), auth = str(body.keys?.auth, "Key", { required: true, max: 100 });
    if (Buffer.from(p256dh, "base64url").length !== 65 || Buffer.from(auth, "base64url").length < 16) throw new HttpError(400, "Bad notification keys");
    const device = str(body.device, "Device", { max: 60 });
    db.tx(() => {
      // the same phone after someone else logs in on it: it now belongs to whoever is logged in
      db.run("DELETE FROM push_subs WHERE endpoint = ?", endpoint);
      db.run("INSERT INTO push_subs (user_id, endpoint, p256dh, auth, device, created_at) VALUES (?, ?, ?, ?, ?, ?)", user.id, endpoint, p256dh, auth, device, now());
      db.run("DELETE FROM push_subs WHERE user_id = ? AND id NOT IN (SELECT id FROM push_subs WHERE user_id = ? ORDER BY id DESC LIMIT 10)", user.id, user.id);
    });
    return { ok: true, devices: db.get("SELECT COUNT(*) c FROM push_subs WHERE user_id = ?", user.id).c };
  }, { auth: true });

  add("POST", "/api/push/unsubscribe", ({ body, user }) => {
    db.run("DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?", user.id, String(body.endpoint || ""));
    const left = db.get("SELECT COUNT(*) c FROM push_subs WHERE user_id = ?", user.id).c;
    if (!left) db.run("UPDATE users SET push_only = 0 WHERE id = ?", user.id); // no device left: texts come back on
    return { ok: true, devices: left };
  }, { auth: true });

  add("POST", "/api/push/test", async ({ user }) => {
    if (!ctx.limiters.chat.check("pushtest|" + user.id)) throw new HttpError(429, "Too many tries. Wait a little and try again.");
    const sent = await push.toUser(user.id, { title: "Bella's Música", body: user.lang === "es" ? "¡Listo! Las notificaciones funcionan en este teléfono." : "All set! Notifications work on this phone.", url: "/#/account" });
    if (!sent) throw new HttpError(400, "We couldn't reach this phone. Turn notifications off and on again.");
    return { ok: true };
  }, { auth: true });
}
