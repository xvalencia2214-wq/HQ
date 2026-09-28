import { HttpError, int, now, str } from "../util.js";
import { getGroup, requireOwner } from "../shared.js";

const HIDDEN = "[hidden until a booking is confirmed]";
// Phone numbers, emails and "text me on WhatsApp" style contact details stay out of chat until a booking is confirmed.
const CONTACT = /(\+?\d[\d\s().-]{6,}\d)|([^\s@]+@[^\s@]+\.[^\s@]+)|(wa\.me\/\S+)/gi;
export function maskContact(text) {
  let masked = false;
  const out = text.replace(CONTACT, () => { masked = true; return HIDDEN; });
  return { text: out, masked };
}

const shortName = (full) => { const p = String(full).trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };

export default function messageRoutes(ctx, add) {
  const { db, sms, config, limiters } = ctx;

  const hasConfirmed = (groupId, customerId) => Boolean(db.get("SELECT 1 AS x FROM bookings WHERE group_id = ? AND customer_id = ? AND status = 'confirmed'", groupId, customerId));
  const thread = (groupId, customerId) => db.all("SELECT id, sender, text, created_at FROM messages WHERE group_id = ? AND customer_id = ? ORDER BY id LIMIT 300", groupId, customerId);

  function post({ group, customerId, sender, body, user, ip }) {
    if (!limiters.chat.check(`${ip}|${user.id}`)) throw new HttpError(429, "You're sending messages too fast.");
    const raw = str(body.text, "Message", { min: 1, max: 500 });
    const { text, masked } = hasConfirmed(group.id, customerId) ? { text: raw, masked: false } : maskContact(raw);
    const recent = db.get("SELECT 1 AS x FROM messages WHERE group_id = ? AND customer_id = ? AND sender = ? AND created_at > ?", group.id, customerId, sender, now() - 1800);
    db.run("INSERT INTO messages (group_id, customer_id, sender, text, created_at) VALUES (?, ?, ?, ?, ?)", group.id, customerId, sender, text, now());
    if (sender === "customer" && group.demo && !db.get("SELECT 1 AS x FROM messages WHERE group_id = ? AND customer_id = ? AND sender = 'group'", group.id, customerId)) {
      db.run("INSERT INTO messages (group_id, customer_id, sender, text, created_at) VALUES (?, ?, 'group', ?, ?)", group.id, customerId,
        "Thanks for reaching out! (This is a sample listing, so this is an automatic reply. Real groups answer here themselves.)", now());
    }
    // One text per 30 minutes per conversation, and only to people who opted in.
    if (!recent) {
      if (sender === "customer" && group.owner_id) {
        const owner = db.get("SELECT phone, sms_opt_in FROM users WHERE id = ?", group.owner_id);
        sms.notifyPhone(group.contact_phone || owner?.phone, owner?.sms_opt_in, `Bella's Música: new message about ${group.name}. Reply in the app: ${config.baseUrl}/#/dashboard`);
      } else if (sender === "group") {
        const c = db.get("SELECT phone, sms_opt_in FROM users WHERE id = ?", customerId);
        sms.notifyPhone(c?.phone, c?.sms_opt_in, `Bella's Música: ${group.name} replied to your message. Open the app to read it: ${config.baseUrl}/#/group/${group.id}`);
      }
    }
    return { messages: thread(group.id, customerId), masked };
  }

  // Customer side
  add("GET", "/api/groups/:id/messages", ({ params, user }) => { getGroup(db, params.id); return { messages: thread(params.id, user.id) }; }, { auth: true });
  add("POST", "/api/groups/:id/messages", ({ params, body, user, ip }) => {
    const group = getGroup(db, params.id);
    if (group.owner_id === user.id) throw new HttpError(400, "You can't message your own group");
    return post({ group, customerId: user.id, sender: "customer", body, user, ip });
  }, { auth: true });

  // Group side: the manager sees a list of conversations and can answer ones a customer started.
  add("GET", "/api/groups/:id/threads", ({ params, user }) => {
    requireOwner(db, user, params.id);
    const rows = db.all(
      `SELECT m.customer_id, u.name, MAX(m.id) AS last_id FROM messages m JOIN users u ON u.id = m.customer_id WHERE m.group_id = ? GROUP BY m.customer_id ORDER BY last_id DESC LIMIT 50`, params.id);
    return { threads: rows.map((r) => ({ customer_id: r.customer_id, name: shortName(r.name), last: db.get("SELECT text, sender, created_at FROM messages WHERE id = ?", r.last_id) })) };
  }, { auth: true });
  add("GET", "/api/groups/:id/threads/:cid", ({ params, user }) => {
    requireOwner(db, user, params.id);
    return { messages: thread(params.id, int(params.cid, "customer", { min: 1 })) };
  }, { auth: true });
  add("POST", "/api/groups/:id/threads/:cid", ({ params, body, user, ip }) => {
    const group = requireOwner(db, user, params.id);
    const customerId = int(params.cid, "customer", { min: 1 });
    if (!db.get("SELECT 1 AS x FROM messages WHERE group_id = ? AND customer_id = ? AND sender = 'customer'", group.id, customerId)) throw new HttpError(400, "No conversation with that customer");
    return post({ group, customerId, sender: "group", body, user, ip });
  }, { auth: true });
}
