// Checks everything that has to be right before real customers use the site.
//   npm run preflight            (reads the same environment variables the server uses)
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { setTimezone } from "./util.js";
import { parseDsn } from "./alerts.js";

const ok = (name, detail = "") => ({ name, status: "ok", detail });
const warn = (name, detail) => ({ name, status: "warn", detail });
const fail = (name, detail) => ({ name, status: "fail", detail });

async function get(url, headers = {}) {
  try { const res = await fetch(url, { headers }); let json = null; try { json = await res.json(); } catch { /* not json */ } return { ok: res.ok, status: res.status, json }; }
  catch (e) { return { ok: false, status: 0, json: null, error: e.message }; }
}

export async function runPreflight(config) {
  const out = [];
  const [major, minor] = process.versions.node.split(".").map(Number);
  out.push(major > 22 || (major === 22 && minor >= 13) ? ok("Node version", process.versions.node) : fail("Node version", `${process.versions.node}: Node 22.13 or newer is required`));
  out.push(config.prod ? ok("NODE_ENV=production") : warn("NODE_ENV", "not 'production': fine for testing, but set it on the live server"));
  out.push(config.baseUrl.startsWith("https://") ? ok("BASE_URL is https", config.baseUrl) : (config.prod ? fail("BASE_URL", `${config.baseUrl} is not https: cookies would be sent insecurely and Stripe redirects break`) : warn("BASE_URL", `${config.baseUrl}: use your real https address when you deploy`)));
  out.push(config.secret.length >= 32 && config.prod ? ok("SESSION_SECRET is long and set") : (config.prod ? fail("SESSION_SECRET", "must be at least 32 characters (openssl rand -hex 32)") : warn("SESSION_SECRET", "using a generated development secret")));
  if (config.prod && !config.trustProxy) out.push(warn("TRUST_PROXY", "not set: behind a load balancer every visitor will look like one IP, and rate limits will punish everyone together"));
  try { const f = path.join(config.dataDir, ".preflight"); fs.writeFileSync(f, "x"); fs.rmSync(f); out.push(ok("DATA_DIR is writable", config.dataDir)); } catch (e) { out.push(fail("DATA_DIR", `cannot write to ${config.dataDir}: ${e.message}. Use a persistent disk!`)); }
  try { setTimezone(config.timezone); out.push(ok("BUSINESS_TZ", config.timezone)); } catch { out.push(fail("BUSINESS_TZ", `${config.timezone} is not a valid time zone`)); }
  if (config.previewPassword) out.push(warn("PREVIEW_PASSWORD", "is set: the site is private (visitors are asked for the password). Remove it on launch day"));
  out.push(config.adminEmails.length ? ok("ADMIN_EMAILS", config.adminEmails.join(", ")) : warn("ADMIN_EMAILS", "empty: nobody can open the owner page"));
  out.push(config.businessAddress ? ok("BUSINESS_ADDRESS (email footer)") : warn("BUSINESS_ADDRESS", "empty: commercial email must include a postal address (CAN-SPAM)"));
  out.push(config.supportEmail ? ok("SUPPORT_EMAIL", config.supportEmail) : warn("SUPPORT_EMAIL", "empty: people who need help have nobody to write to"));
  if (config.sentryDsn) out.push(parseDsn(config.sentryDsn) ? ok("SENTRY_DSN is set", "errors are sent to Sentry") : warn("SENTRY_DSN", "is set but is not a valid Sentry DSN (it looks like https://KEY@HOST/PROJECTNUMBER): Sentry is off"));
  out.push(config.alertWebhook ? ok("ALERT_WEBHOOK_URL is set") : (config.sentryDsn && parseDsn(config.sentryDsn) ? ok("ALERT_WEBHOOK_URL", "empty, but Sentry will tell you") : warn("ALERT_WEBHOOK_URL", "empty: you will not be told when something breaks")));
  out.push(config.backupDir ? ok("BACKUP_DIR", `${config.backupDir} (keeps ${config.backupKeep} days)`) : warn("BACKUP_DIR", "empty: no automatic database backups"));

  // ---- Stripe ----
  if (!config.stripeKey) out.push(warn("Stripe", "STRIPE_SECRET_KEY is empty: payments are SIMULATED (fine for testing, no real money moves)"));
  else {
    const H = { Authorization: `Bearer ${config.stripeKey}` };
    const mode = config.stripeKey.startsWith("sk_live_") || config.stripeKey.startsWith("rk_live_") ? "LIVE" : "test";
    out.push(/^(sk|rk)_(test|live)_/.test(config.stripeKey) ? ok("Stripe key", `${mode} mode`) : fail("Stripe key", "does not look like a Stripe secret key (sk_test_… or sk_live_…)"));
    const acct = await get(`${config.stripeApi}/v1/account`, H);
    out.push(acct.ok ? ok("Stripe account reachable", `${acct.json.country || "?"}, charges ${acct.json.charges_enabled ? "enabled" : "NOT enabled"}`) : fail("Stripe account", `${acct.status || acct.error}: ${acct.json?.error?.message || "cannot reach Stripe with this key"}`));
    if (acct.ok && !acct.json.charges_enabled) out.push(fail("Stripe charges", "your Stripe account cannot accept charges yet: finish its activation"));
    const connect = await get(`${config.stripeApi}/v1/accounts?limit=1`, H);
    out.push(connect.ok ? ok("Stripe Connect is enabled") : fail("Stripe Connect", `groups cannot be paid until Connect is turned on for your platform (${connect.json?.error?.message || connect.status})`));
    if (!config.stripeWebhookSecret) out.push(fail("STRIPE_WEBHOOK_SECRET", "empty: payment confirmations from Stripe would be rejected"));
    const hooks = await get(`${config.stripeApi}/v1/webhook_endpoints?limit=100`, H);
    if (hooks.ok) {
      const mine = (hooks.json.data || []).find((h) => h.url === `${config.baseUrl}/api/stripe/webhook`);
      if (!mine) out.push(fail("Stripe webhook endpoint", `none points at ${config.baseUrl}/api/stripe/webhook. Add it in the Stripe dashboard (events: checkout.session.completed, checkout.session.async_payment_succeeded)`));
      else {
        const ev = mine.enabled_events || [];
        const need = ["checkout.session.completed", "checkout.session.async_payment_succeeded"].filter((e) => !ev.includes(e) && !ev.includes("*"));
        out.push(need.length ? fail("Stripe webhook events", `the endpoint is missing: ${need.join(", ")}`) : ok("Stripe webhook endpoint", mine.status || "enabled"));
      }
    } else out.push(warn("Stripe webhook endpoint", "could not list endpoints with this key (restricted key?): confirm it in the Stripe dashboard"));
  }

  // ---- Twilio ----
  if (!(config.twilioSid && config.twilioToken && config.twilioFrom)) out.push(warn("Twilio", "not configured: texts are only logged. US carriers require A2P 10DLC registration before real texting (see docs/twilio-a2p.md)"));
  else {
    const H = { Authorization: "Basic " + Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString("base64") };
    const acct = await get(`${config.twilioApi}/2010-04-01/Accounts/${config.twilioSid}.json`, H);
    out.push(acct.ok ? ok("Twilio credentials", `account ${acct.json.status || "ok"}`) : fail("Twilio credentials", `${acct.status || acct.error}: check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN`));
    if (acct.ok) {
      const nums = await get(`${config.twilioApi}/2010-04-01/Accounts/${config.twilioSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(config.twilioFrom)}`, H);
      out.push(nums.ok && (nums.json.incoming_phone_numbers || []).length ? ok("Twilio number", config.twilioFrom) : fail("Twilio number", `${config.twilioFrom} is not a number on this account`));
      out.push(warn("Twilio A2P registration", "cannot be checked automatically: confirm your brand and campaign are APPROVED in the Twilio console, or US carriers will block your texts"));
    }
  }

  // ---- Email (Resend) ----
  if (!(config.resendKey && config.emailFrom)) out.push(warn("Email", "RESEND_API_KEY / EMAIL_FROM not set: emails are only logged, so password resets will not reach anyone"));
  else {
    const H = { Authorization: `Bearer ${config.resendKey}` };
    const domains = await get(`${config.emailApi}/domains`, H);
    if (!domains.ok) out.push(fail("Resend key", `${domains.status || domains.error}: check RESEND_API_KEY`));
    else {
      out.push(ok("Resend key"));
      const from = (config.emailFrom.match(/<([^>]+)>/)?.[1] || config.emailFrom).split("@")[1] || "";
      const d = (domains.json.data || []).find((x) => x.name === from);
      out.push(!d ? fail("Email sender domain", `${from} is not added to Resend. Add it and publish the DNS records`) : d.status === "verified" ? ok("Email sender domain verified", from) : warn("Email sender domain", `${from} is "${d.status}": finish the DNS records or emails will land in spam`));
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const results = await runPreflight(config);
  const icon = { ok: "✓", warn: "!", fail: "✗" };
  for (const r of results) console.log(`${icon[r.status]} ${r.name}${r.detail ? "  " + r.detail : ""}`);
  const f = results.filter((r) => r.status === "fail").length, w = results.filter((r) => r.status === "warn").length;
  console.log(`\n${f ? `${f} problem(s) to fix before launch` : "No blocking problems"}${w ? `, ${w} thing(s) worth a look` : ""}.`);
  process.exit(f ? 1 : 0);
}
