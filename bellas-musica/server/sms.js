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
export function createSms(config, db, alert = () => {}) {
  const live = Boolean(config.twilioSid && config.twilioToken && config.twilioFrom);

  // channel "whatsapp" goes through Twilio's WhatsApp sender when one is set up; otherwise it falls back to a normal text.
  async function send(phone, body, channel = "sms") {
    const to0 = normalizePhone(phone);
    if (!to0) return false;
    const wa = channel === "whatsapp" && config.twilioWhatsappFrom;
    const to = wa ? "whatsapp:" + to0 : to0;
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
        body: new URLSearchParams({ To: to, From: wa ? "whatsapp:" + config.twilioWhatsappFrom : config.twilioFrom, Body: text })
      });
      if (!res.ok) throw new Error(`Twilio ${res.status}`);
      db.run("UPDATE sms_log SET sent = 1 WHERE id = ?", row.lastInsertRowid);
      return true;
    } catch (e) {
      db.run("UPDATE sms_log SET error = ? WHERE id = ?", String(e.message).slice(0, 200), row.lastInsertRowid);
      alert(`Text message failed: ${e.message}`, "sms");
      return false;
    }
  }

  // Only text people who opted in, and never let a failed text break the request that triggered it.
  function notify(user, body) {
    if (!user || !user.sms_opt_in || !user.phone) return;
    send(user.phone, body, user.notify_channel).catch(() => {});
  }
  function notifyPhone(phone, optedIn, body, channel = "sms") {
    if (!optedIn || !phone) return;
    send(phone, body, channel).catch(() => {});
  }

  return { live, mode: live ? "twilio" : "simulated", send, notify, notifyPhone };
}
