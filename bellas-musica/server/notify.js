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
    const u = db.get("SELECT id, email, name, phone, sms_opt_in, lang, email_notify, notify_channel, push_only FROM users WHERE id = ?", userId);
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
    if (!opts.noSms && msg.sms) {
      const text = () => sms.notifyPhone(opts.phone || u.phone, u.sms_opt_in, msg.sms, u.notify_channel);
      if (!ctx.push || !ctx.push.hasDevice(u.id)) return text();
      // phone notifications are free: always sent to devices that turned them on. With "instead of texts" the text only
      // goes out if no device could be reached.
      const p = ctx.push.toUser(u.id, pushPayload(msg, kind, vars)).catch(() => false);
      if (u.push_only) p.then((ok) => { if (!ok) text(); }); else text();
    }
  }
  // The notification on the phone: the email's subject as the title, the text message (without our name and the link)
  // as the body, and tapping it opens the same page as the link.
  function pushPayload(msg, kind, vars) {
    const body = String(msg.sms).replace(/^Bella's Música:\s*/, "").replace(/\s*https?:\/\/\S+\s*$/, "").trim();
    const link = String(vars.url || msg.cta?.url || "");
    const url = link.startsWith(config.baseUrl) ? link.slice(config.baseUrl.length) || "/" : link.startsWith("/") ? link : "/";
    return { title: msg.subject || "Bella's Música", body: body.slice(0, 240), url, tag: kind };
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
      group: g.name, customer: b.name, event: b.event_type, date: b.date, time: b.time, hours: b.hours, minutes: b.duration_min > 0 ? b.duration_min : b.hours * 60, guests: b.guests, address: b.address,
      total: usd(b.total_cents), deposit: usd(b.deposit_cents), balance: usd(b.total_cents - b.deposit_cents),
      payout: usd(Math.max(0, b.deposit_cents - b.platform_fee_cents)), policyKey: b.policy,
      ...arrival(b.id),
      needs: (() => { try { return JSON.parse(b.needs_json || "[]").join("; "); } catch { return ""; } })(),
      addons: (() => { try { return JSON.parse(b.addons_json || "[]").map((a) => a.name).join(", "); } catch { return ""; } })()
    };
  }
  const ownerOf = (g) => g.owner_id || null;
  // Everyone who runs a listing: the owner (texts go to the listing's alert number if set) and each team member (their own
  // email and phone, by their own settings).
  function toGroup(g, kind, vars = {}, opts = {}) {
    if (!g) return;
    if (g.owner_id) to(g.owner_id, kind, vars, opts);
    const { phone, ...rest } = opts;
    for (const m of db.all("SELECT user_id FROM group_team WHERE group_id = ? AND user_id != ?", g.id, g.owner_id || 0)) to(m.user_id, kind, vars, rest);
  }
  return { to, toGroup, toEmail, bookingVars, ownerOf, sign, verifyUnsub, unsubUrl };
}
