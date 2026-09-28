import { now } from "./util.js";

// Sends email through Resend's REST API. With no RESEND_API_KEY every message is only written to email_log (simulated),
// so the whole app, including password reset, works in test mode and tests can read the links.
export function createEmail(config, db, alert = () => {}) {
  const live = Boolean(config.resendKey && config.emailFrom);

  async function send({ to, subject, text, html, kind = "", headers }) {
    if (!to || /@deleted\.invalid$/i.test(to)) return false;
    const row = db.run("INSERT INTO email_log (to_email, subject, body, kind, created_at) VALUES (?, ?, ?, ?, ?)", to, subject, text, kind, now());
    if (!live) return true;
    try {
      const res = await fetch(`${config.emailApi}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text, html, reply_to: config.emailReplyTo || undefined, headers })
      });
      if (!res.ok) throw new Error(`Email provider ${res.status}`);
      db.run("UPDATE email_log SET sent = 1 WHERE id = ?", row.lastInsertRowid);
      return true;
    } catch (e) {
      db.run("UPDATE email_log SET error = ? WHERE id = ?", String(e.message).slice(0, 200), row.lastInsertRowid);
      alert(`Email failed (${kind}): ${e.message}`, "email");
      return false;
    }
  }
  return { live, mode: live ? "resend" : "simulated", send };
}
