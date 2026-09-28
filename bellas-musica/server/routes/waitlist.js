import { HttpError, oneOf, str } from "../util.js";
import { lookupZip } from "../geo.js";
import { inMarket } from "../market.js";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// "Tell me when you reach my city": one row per email + ZIP + kind, so it doubles as a demand map for where to launch next.
export default function waitlistRoutes(ctx, add) {
  const { db, limiters } = ctx;
  add("POST", "/api/waitlist", ({ body, ip }) => {
    if (!limiters.waitlist.check(ip)) throw new HttpError(429, "Too many requests. Try again later.");
    const email = str(body.email, "Email", { required: true, max: 254 }).toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email");
    const zip = str(body.zip, "ZIP", { required: true, max: 5 });
    const z = /^\d{5}$/.test(zip) ? lookupZip(zip) : null;
    if (!z) throw new HttpError(400, "Enter a valid 5-digit ZIP code");
    const kind = oneOf(body.kind === "group" ? "group" : "customer", "kind", ["customer", "group"]);
    const lang = body.lang === "es" ? "es" : "en";
    const res = db.run("INSERT OR IGNORE INTO waitlist (email, zip, kind, lang, created_at) VALUES (?, ?, ?, ?, ?)", email, zip, kind, lang, Math.floor(Date.now() / 1000));
    if (res.changes) {
      ctx.stats.count("waitlist", zip);
      ctx.notify.toEmail(email, lang, "waitlist.joined", { city: `${z.city}, ${z.state}`, url: ctx.config.baseUrl + "/c/chicago" });
    }
    return { ok: true, city: z.city, state: z.state, in_market: inMarket(zip) };
  });
}
