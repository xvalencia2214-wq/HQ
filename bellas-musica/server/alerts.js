// Sends a message to a webhook (Slack, Discord, or anything that accepts JSON) when something goes wrong,
// at most once per key every 10 minutes so one broken thing can't flood you. Without ALERT_WEBHOOK_URL it only logs.
export function createAlerts(config) {
  const last = new Map();
  return function alert(message, key = String(message).slice(0, 80)) {
    console.error("[alert]", message);
    if (!config.alertWebhook) return;
    const t = Date.now();
    if (last.has(key) && t - last.get(key) < 10 * 60_000) return;
    last.set(key, t);
    if (last.size > 200) for (const [k, v] of last) if (t - v > 3_600_000) last.delete(k);
    const text = `[${config.businessName}] ${message}`.slice(0, 1800);
    fetch(config.alertWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }) }).catch(() => {});
  };
}
