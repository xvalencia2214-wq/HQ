import { now } from "./util.js";

// US numbers only for now. Returns E.164 or null.
export function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return null;
}

// Texts go out from the platform's number, so users never see each other's phone numbers.
// With no Twilio settings every message is only written to sms_log (simulated).
export function createSms(config, db) {
  const live = Boolean(config.twilioSid && config.twilioToken && config.twilioFrom);

  async function send(phone, body) {
    const to = normalizePhone(phone);
    if (!to) return false;
    const text = String(body).slice(0, 300);
    const row = db.run("INSERT INTO sms_log (to_phone, body, created_at) VALUES (?, ?, ?)", to, text, now());
    if (!live) return true;
    try {
      const res = await fetch(`${config.twilioApi}/2010-04-01/Accounts/${config.twilioSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ To: to, From: config.twilioFrom, Body: text })
      });
      if (!res.ok) throw new Error(`Twilio ${res.status}`);
      db.run("UPDATE sms_log SET sent = 1 WHERE id = ?", row.lastInsertRowid);
      return true;
    } catch (e) {
      db.run("UPDATE sms_log SET error = ? WHERE id = ?", String(e.message).slice(0, 200), row.lastInsertRowid);
      return false;
    }
  }

  // Only text people who opted in, and never let a failed text break the request that triggered it.
  function notify(user, body) {
    if (!user || !user.sms_opt_in || !user.phone) return;
    send(user.phone, body).catch(() => {});
  }
  function notifyPhone(phone, optedIn, body) {
    if (!optedIn || !phone) return;
    send(phone, body).catch(() => {});
  }

  return { live, mode: live ? "twilio" : "simulated", send, notify, notifyPhone };
}
