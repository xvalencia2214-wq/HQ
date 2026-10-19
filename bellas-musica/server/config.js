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

  let secret = env.SESSION_SECRET, secretGenerated = false;
  if (!secret) {
    // Not set (a host service made by hand instead of from render.yaml): make a strong one once and keep it beside the
    // database, on the persistent disk, so the site still starts. Preflight and the start-up log say to set it.
    const f = path.join(dataDir, prod ? ".session-secret" : ".dev-secret");
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    secret = fs.readFileSync(f, "utf8");
    secretGenerated = true;
    if (prod) console.warn("SESSION_SECRET is not set: using one generated and saved in DATA_DIR. Set it in your host's environment settings.");
  }

  const int = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    root,
    publicDir: path.join(root, "public"),
    dataDir,
    uploadDir: path.join(dataDir, "uploads"),
    port: int(env.PORT, 3000),
    prod,
    // RENDER_EXTERNAL_URL is set by Render itself, so a first deploy works before you have your own domain
    baseUrl: (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/$/, ""),
    previewPassword: env.PREVIEW_PASSWORD || "", // set it to keep the whole site private (the browser asks for it) until launch
    trustProxy: env.TRUST_PROXY === "1",
    secret, secretGenerated,
    demoSeed: env.DEMO_SEED !== "0",
    adminEmails: String(env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean), // who may open the admin page
    sitemapCacheSeconds: int(env.SITEMAP_CACHE, 600), // sitemap.xml is rebuilt at most this often (0 = every request; tests use 0)
    timezone: env.BUSINESS_TZ || "America/Chicago", // the calendar day used for "today", holds and refund windows
    // Rate limits (max requests per window per client); tests raise these
    limits: {
      api: int(env.RATE_API, 300), register: int(env.RATE_REGISTER, 10), forgot: int(env.RATE_FORGOT, 5), waitlist: int(env.RATE_WAITLIST, 5), auth: int(env.RATE_AUTH, 10),
      chat: int(env.RATE_CHAT, 20), upload: int(env.RATE_UPLOAD, 30), booking: int(env.RATE_BOOKING, 20), feedEvent: int(env.RATE_FEEDEVENT, 3), clientError: int(env.RATE_CLIENTERROR, 10),
      helper: int(env.RATE_HELPER, 40) // questions to Don Chuy per hour, per network and per account
    },
    // Money
    platformFeePct: int(env.PLATFORM_FEE_PCT, 10), // % of the booking total, taken from the deposit
    featurePriceCents: int(env.FEATURE_PRICE_CENTS, 4900), // 30 days of featured placement
    proPriceCents: int(env.PRO_PRICE_CENTS, 2900),          // 30 days of Bella's Pro
    spotlightPriceCents: int(env.SPOTLIGHT_PRICE_CENTS, 9900), // 30 days of Spotlight: Featured plus the top of every list
    proFeePct: int(env.PRO_FEE_PCT, 6),                      // the platform fee for Pro listings
    directFeePct: int(env.DIRECT_FEE_PCT, 3),               // the fee on a vendor's own client paid through its payment link
    // Founding vendors: the first FOUNDING_SLOTS real listings to go live pay FOUNDING_FEE_PCT for FOUNDING_DAYS (0 slots = off)
    foundingSlots: int(env.FOUNDING_SLOTS, 25),
    foundingFeePct: int(env.FOUNDING_FEE_PCT, 5),
    foundingDays: int(env.FOUNDING_DAYS, 180),
    // A new vendor's deposits stay with the platform until it checks in at the party (or the no-show window passes),
    // for its first HOLD_NEW_VENDOR_EVENTS events here. 0 = vendors are paid when the deposit is paid, like before.
    holdNewVendorEvents: int(env.HOLD_NEW_VENDOR_EVENTS, 3),
    // Past-client reviews can't come from the internet connection the vendor used to make the link (0 = allow it: the
    // test drive runs everyone on one computer). The Admin page still flags it.
    pastReviewIpCheck: env.PAST_REVIEW_IP_CHECK !== "0",
    tipsCoverProcessing: env.TIPS_COVER_PROCESSING !== "0",  // tips: keep only the card processing cost (2.9% + 30¢), nothing else
    partyInsuranceUrl: env.PARTY_INSURANCE_URL || "",        // a partner's event-insurance page, shown on party pages when set
    icsAllowHttp: env.ICS_ALLOW_HTTP === "1",                 // tests only: calendar imports must be https
    // Stripe (leave unset to run in simulated-payments mode)
    stripeKey: env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    // Stripe sends events about vendors' payout accounts to a second ("Connected accounts") endpoint with its own secret;
    // both endpoints use the same address. Optional: a daily check covers a missed one.
    stripeConnectWebhookSecret: env.STRIPE_CONNECT_WEBHOOK_SECRET || "",
    stripeApi: env.STRIPE_API_BASE || "https://api.stripe.com",
    // Email (Resend). Leave the key empty to only log emails (simulated).
    resendKey: env.RESEND_API_KEY || "",
    emailFrom: env.EMAIL_FROM || "",            // e.g. Bella's Fiestas <hello@yourdomain.com>
    emailReplyTo: env.EMAIL_REPLY_TO || "",
    emailApi: env.EMAIL_API_BASE || "https://api.resend.com",
    // Don Chuy, the AI helper (server/helper.js). No key = a free test mode. AI_HELPER=0 hides him.
    aiKey: env.ANTHROPIC_API_KEY || "",
    aiApiBase: env.ANTHROPIC_BASE_URL || "",                  // tests point this at a fake; leave unset in production
    aiHelper: env.AI_HELPER !== "0",
    aiDailyLimitUsd: int(env.AI_DAILY_LIMIT_USD, 5),         // past this many dollars in a day, he rests until tomorrow
    // Operations
    sentryDsn: env.SENTRY_DSN || "",            // optional: errors also go to Sentry (https://sentry.io, free plan) with the same de-duplication
    alertWebhook: env.ALERT_WEBHOOK_URL || "",  // Slack/Discord/any JSON webhook: told when something breaks
    backupDir: env.BACKUP_DIR ? path.resolve(env.BACKUP_DIR) : "", // daily database copies go here (empty = off)
    backupKeep: int(env.BACKUP_KEEP, 14),
    // Off-site copies (database, photos, documents) in an S3-compatible bucket somewhere else: Cloudflare R2, Amazon S3,
    // Backblaze B2. BACKUP_S3_URL is the bucket's address, e.g. https://<account>.r2.cloudflarestorage.com/bellas-backups
    offsite: { url: env.BACKUP_S3_URL || "", keyId: env.BACKUP_S3_KEY_ID || "", secret: env.BACKUP_S3_SECRET || "", region: env.BACKUP_S3_REGION || "auto" },
    // Failed logins from one network, across every account (slows down password guessing); per 15 minutes
    loginFailsPerIp: int(env.RATE_LOGIN_IP, 30),
    // Who is sending (shown in email footers; commercial email must include a postal address)
    businessName: env.BUSINESS_NAME || "Bella's Fiestas",
    businessAddress: env.BUSINESS_ADDRESS || "",
    supportEmail: env.SUPPORT_EMAIL || "",
    // Weather for outdoor parties (US National Weather Service, free, no key). WEATHER=0 turns it off.
    weatherApi: env.WEATHER === "0" ? "" : env.WEATHER_API_BASE || "https://api.weather.gov",
    // Twilio SMS (leave unset to log messages instead of sending)
    twilioSid: env.TWILIO_ACCOUNT_SID || "",
    twilioToken: env.TWILIO_AUTH_TOKEN || "",
    twilioFrom: env.TWILIO_FROM || "",
    twilioWhatsappFrom: env.TWILIO_WHATSAPP_FROM || "", // a WhatsApp-enabled Twilio number (+1...), optional
    twilioApi: env.TWILIO_API_BASE || "https://api.twilio.com",
    // Phone notifications (Web Push). Keys are made automatically and kept in DATA_DIR/vapid.json unless set here.
    vapidPublic: env.VAPID_PUBLIC_KEY || "",
    vapidPrivate: env.VAPID_PRIVATE_KEY || "",
    pushAllowAny: env.PUSH_ALLOW_ANY === "1",   // tests only: accept any push address
    // App stores: the Android app's package name and signing fingerprints (from PWABuilder / Play Console), and the
    // iPhone app's TEAMID.bundle.id. They let the store apps open this site as their own.
    androidPackage: env.ANDROID_PACKAGE || "",
    androidSha256: String(env.ANDROID_SHA256 || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
    appleAppId: env.APPLE_APP_ID || "",
    appStoreUrl: /^https:\/\/apps\.apple\.com\//.test(env.APP_STORE_URL || "") ? env.APP_STORE_URL : "" // the App Store page, once it's approved
  };
}
