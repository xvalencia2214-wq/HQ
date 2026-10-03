import crypto from "node:crypto";
import { TEMPLATES, renderEmail, usd, eventLabel } from "./emails.js";
import { POLICIES } from "./pricing.js";

// One place that decides who hears about what: email (always for receipts and security, otherwise only if the user
// hasn't opted out) and text (only if they opted in), each in the recipient's own language.
export function createNotifier(ctx) {
  const { db, config, sms, email } = ctx;
  const sign = (id) => crypto.createHmac("sha256", config.secret).update("unsub:" + id).digest("base64url").slice(0, 22);
  const unsubUrl = (id) => `${config.baseUrl}/unsubscribe?u=${id}&t=${sign(id)}`;
  const verifyUnsub = (id, t) => {
    const want = Buffer.from(sign(id)), got = Buffer.from(String(t || ""));
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  };
  const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";

  // opts.phone overrides the text destination (a group's own alert number); opts.noEmail / opts.noSms silence a channel.
  function to(userId, kind, vars = {}, opts = {}) {
    const u = db.get("SELECT id, email, name, phone, sms_opt_in, lang, email_notify FROM users WHERE id = ?", userId);
    if (!u) return;
    const tpl = TEMPLATES[kind];
    if (!tpl) throw new Error("unknown notification: " + kind);
    const lang = u.lang === "es" ? "es" : "en";
    const v = { name: firstName(u.name), support: config.supportEmail, ...vars };
    if (v.event) v.event = eventLabel(v.event, lang);
    if (v.policyKey) v.policy = (POLICIES[v.policyKey] || POLICIES.moderate).text[lang];
    const msg = tpl[lang](v);
    if (!opts.noEmail && u.email && (tpl.transactional || u.email_notify)) {
      const nonTx = !tpl.transactional;
      const rendered = renderEmail(msg, { lang, config, unsubUrl: nonTx ? unsubUrl(u.id) : "" });
      email.send({
        to: u.email, ...rendered, kind,
        headers: nonTx ? { "List-Unsubscribe": `<${unsubUrl(u.id)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined
      }).catch(() => {});
    }
    if (!opts.noSms && msg.sms) sms.notifyPhone(opts.phone || u.phone, u.sms_opt_in, msg.sms);
  }

  // For people without an account (the waitlist). Transactional only: they asked for exactly this.
  function toEmail(address, lang, kind, vars = {}) {
    const tpl = TEMPLATES[kind];
    if (!tpl || !tpl.transactional) throw new Error("toEmail is for transactional notifications only: " + kind);
    const l = lang === "es" ? "es" : "en";
    email.send({ to: address, ...renderEmail(tpl[l]({ name: "", support: config.supportEmail, ...vars, ...(vars.event ? { event: eventLabel(vars.event, l) } : {}) }), { lang: l, config, unsubUrl: "" }), kind }).catch(() => {});
  }

  // The arrival time the family set for this vendor on their party timeline (12-hour clock), if any.
  const arrival = (id) => {
    const t = ctx.db.get("SELECT at, label FROM party_timeline WHERE booking_id = ? ORDER BY at LIMIT 1", id);
    if (!t) return { arrive: "", arriveLabel: "" };
    const [h, m] = t.at.split(":").map(Number);
    return { arrive: `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`, arriveLabel: t.label };
  };
  // The fields most booking messages need, already formatted.
  function bookingVars(b, g) {
    return {
      group: g.name, customer: b.name, event: b.event_type, date: b.date, time: b.time, hours: b.hours, guests: b.guests, address: b.address,
      total: usd(b.total_cents), deposit: usd(b.deposit_cents), balance: usd(b.total_cents - b.deposit_cents),
      payout: usd(Math.max(0, b.deposit_cents - b.platform_fee_cents)), policyKey: b.policy,
      ...arrival(b.id),
      addons: (() => { try { return JSON.parse(b.addons_json || "[]").map((a) => a.name).join(", "); } catch { return ""; } })()
    };
  }
  const ownerOf = (g) => g.owner_id || null;
  return { to, toEmail, bookingVars, ownerOf, sign, verifyUnsub, unsubUrl };
}
