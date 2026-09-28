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
    timezone: env.BUSINESS_TZ || "America/Chicago", // the calendar day used for "today", holds and refund windows
    // Rate limits (max requests per window per client); tests raise these
    limits: {
      api: int(env.RATE_API, 300), register: int(env.RATE_REGISTER, 10), auth: int(env.RATE_AUTH, 10),
      chat: int(env.RATE_CHAT, 20), upload: int(env.RATE_UPLOAD, 30), booking: int(env.RATE_BOOKING, 20)
    },
    // Money
    platformFeePct: int(env.PLATFORM_FEE_PCT, 10), // % of the booking total, taken from the deposit
    featurePriceCents: int(env.FEATURE_PRICE_CENTS, 4900), // 30 days of featured placement
    // Stripe (leave unset to run in simulated-payments mode)
    stripeKey: env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    stripeApi: env.STRIPE_API_BASE || "https://api.stripe.com",
    // Twilio SMS (leave unset to log messages instead of sending)
    twilioSid: env.TWILIO_ACCOUNT_SID || "",
    twilioToken: env.TWILIO_AUTH_TOKEN || "",
    twilioFrom: env.TWILIO_FROM || "",
    twilioApi: env.TWILIO_API_BASE || "https://api.twilio.com"
  };
}
