import crypto from "node:crypto";

// Tells you when something goes wrong: a message to a webhook (Slack, Discord, anything that accepts JSON) and, if SENTRY_DSN is
// set, an event to Sentry. At most once per key every 10 minutes so one broken thing can't flood you. With neither it only logs.
export function createAlerts(config) {
  const last = new Map();
  const sentry = parseDsn(config.sentryDsn);
  return function alert(message, key = String(message).slice(0, 80)) {
    console.error("[alert]", message);
    if (!config.alertWebhook && !sentry) return;
    const t = Date.now();
    if (last.has(key) && t - last.get(key) < 10 * 60_000) return;
    last.set(key, t);
    if (last.size > 200) for (const [k, v] of last) if (t - v > 3_600_000) last.delete(k);
    if (config.alertWebhook) {
      const text = `[${config.businessName}] ${message}`.slice(0, 1800);
      fetch(config.alertWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }) }).catch(() => {});
    }
    if (sentry) {
      fetch(sentry.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=bellas-musica/1.0, sentry_key=${sentry.key}` },
        body: JSON.stringify({ event_id: crypto.randomBytes(16).toString("hex"), timestamp: new Date().toISOString(), level: "error", platform: "node", logger: "bellas-musica", server_name: config.businessName, environment: config.prod ? "production" : "development", message: String(message).slice(0, 1800), fingerprint: [key], tags: { key: String(key).slice(0, 60) } })
      }).catch(() => {});
    }
  };
}

// https://PUBLICKEY@o123.ingest.sentry.io/456  ->  { key, url: https://o123.ingest.sentry.io/api/456/store/ }. A bad DSN just turns Sentry off.
export function parseDsn(dsn) {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.split("/").filter(Boolean).pop();
    if (!u.username || !/^\d+$/.test(project || "") || !/^https?:$/.test(u.protocol)) return null;
    return { key: u.username, url: `${u.protocol}//${u.host}/api/${project}/store/` };
  } catch { return null; }
}
