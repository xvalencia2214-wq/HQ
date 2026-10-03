import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every setting comes from environment variables so secrets never live in the repo.
export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(root, "data"));
  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  const prod = env.NODE_ENV === "production";

  let secret = env.SESSION_SECRET;
  if (!secret) {
    if (prod) throw new Error("SESSION_SECRET must be set in production");
    // Dev convenience: generate once and keep it beside the database.
    const f = path.join(dataDir, ".dev-secret");
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    secret = fs.readFileSync(f, "utf8");
  }

  const int = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    root,
    publicDir: path.join(root, "public"),
    dataDir,
    uploadDir: path.join(dataDir, "uploads"),
    port: int(env.PORT, 3000),
    prod,
    baseUrl: (env.BASE_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/$/, ""),
    trustProxy: env.TRUST_PROXY === "1",
    secret,
    demoSeed: env.DEMO_SEED !== "0",
    adminEmails: String(env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean), // who may open the admin page
    sitemapCacheSeconds: int(env.SITEMAP_CACHE, 600), // sitemap.xml is rebuilt at most this often (0 = every request; tests use 0)
    timezone: env.BUSINESS_TZ || "America/Chicago", // the calendar day used for "today", holds and refund windows
    // Rate limits (max requests per window per client); tests raise these
    limits: {
      api: int(env.RATE_API, 300), register: int(env.RATE_REGISTER, 10), forgot: int(env.RATE_FORGOT, 5), waitlist: int(env.RATE_WAITLIST, 5), auth: int(env.RATE_AUTH, 10),
      chat: int(env.RATE_CHAT, 20), upload: int(env.RATE_UPLOAD, 30), booking: int(env.RATE_BOOKING, 20), feedEvent: int(env.RATE_FEEDEVENT, 3), clientError: int(env.RATE_CLIENTERROR, 10)
    },
    // Money
    platformFeePct: int(env.PLATFORM_FEE_PCT, 10), // % of the booking total, taken from the deposit
    featurePriceCents: int(env.FEATURE_PRICE_CENTS, 4900), // 30 days of featured placement
    proPriceCents: int(env.PRO_PRICE_CENTS, 2900),          // 30 days of Bella's Pro
    proFeePct: int(env.PRO_FEE_PCT, 6),                      // the platform fee for Pro listings
    directFeePct: int(env.DIRECT_FEE_PCT, 3),                // the fee on a vendor's own client paid through its payment link
    partyInsuranceUrl: env.PARTY_INSURANCE_URL || "",        // a partner's event-insurance page, shown on party pages when set
    icsAllowHttp: env.ICS_ALLOW_HTTP === "1",                 // tests only: calendar imports must be https
    // Stripe (leave unset to run in simulated-payments mode)
    stripeKey: env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    stripeApi: env.STRIPE_API_BASE || "https://api.stripe.com",
    // Email (Resend). Leave the key empty to only log emails (simulated).
    resendKey: env.RESEND_API_KEY || "",
    emailFrom: env.EMAIL_FROM || "",            // e.g. Bella's Música <hello@yourdomain.com>
    emailReplyTo: env.EMAIL_REPLY_TO || "",
    emailApi: env.EMAIL_API_BASE || "https://api.resend.com",
    // Operations
    sentryDsn: env.SENTRY_DSN || "",            // optional: errors also go to Sentry (https://sentry.io, free plan) with the same de-duplication
    alertWebhook: env.ALERT_WEBHOOK_URL || "",  // Slack/Discord/any JSON webhook: told when something breaks
    backupDir: env.BACKUP_DIR ? path.resolve(env.BACKUP_DIR) : "", // daily database copies go here (empty = off)
    backupKeep: int(env.BACKUP_KEEP, 14),
    // Who is sending (shown in email footers; commercial email must include a postal address)
    businessName: env.BUSINESS_NAME || "Bella's Música",
    businessAddress: env.BUSINESS_ADDRESS || "",
    supportEmail: env.SUPPORT_EMAIL || "",
    // Weather for outdoor parties (US National Weather Service, free, no key). WEATHER=0 turns it off.
    weatherApi: env.WEATHER === "0" ? "" : env.WEATHER_API_BASE || "https://api.weather.gov",
    // Twilio SMS (leave unset to log messages instead of sending)
    twilioSid: env.TWILIO_ACCOUNT_SID || "",
    twilioToken: env.TWILIO_AUTH_TOKEN || "",
    twilioFrom: env.TWILIO_FROM || "",
    twilioWhatsappFrom: env.TWILIO_WHATSAPP_FROM || "", // a WhatsApp-enabled Twilio number (+1...), optional
    twilioApi: env.TWILIO_API_BASE || "https://api.twilio.com"
  };
}
