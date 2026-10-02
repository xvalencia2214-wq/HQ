import { HttpError, addDays, int, isDate, now, oneOf, str, todayStr } from "../util.js";
import { EVENT_TYPES } from "../pricing.js";
import { getGroup, getVisibleGroup, requireOwner } from "../shared.js";

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
  const markRead = (groupId, customerId, side) => db.run(
    `INSERT INTO thread_reads (group_id, customer_id, side, last_id)
     VALUES (?, ?, ?, COALESCE((SELECT MAX(id) FROM messages WHERE group_id = ? AND customer_id = ?), 0))
     ON CONFLICT(group_id, customer_id, side) DO UPDATE SET last_id = excluded.last_id`, groupId, customerId, side, groupId, customerId);
  const unreadFor = (groupId, customerId, side) => db.get(
    `SELECT COUNT(*) c FROM messages m WHERE m.group_id = ? AND m.customer_id = ? AND m.sender = ?
       AND m.id > COALESCE((SELECT last_id FROM thread_reads WHERE group_id = ? AND customer_id = ? AND side = ?), 0)`,
    groupId, customerId, side === "customer" ? "group" : "customer", groupId, customerId, side).c;
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
    // One notification per 30 minutes per conversation.
    if (!recent) {
      if (sender === "customer" && group.owner_id) ctx.notify.to(group.owner_id, "message.group", { group: group.name, url: `${config.baseUrl}/#/dashboard?g=${group.id}&tab=messages` }, { phone: group.contact_phone });
      else if (sender === "group") ctx.notify.to(customerId, "message.customer", { group: group.name, url: `${config.baseUrl}/#/messages?g=${group.id}` });
    }
    markRead(group.id, customerId, sender);
    return { messages: thread(group.id, customerId), masked };
  }

  // Customer side
  add("GET", "/api/groups/:id/messages", ({ params, user }) => { getGroup(db, params.id); markRead(params.id, user.id, "customer"); return { messages: thread(params.id, user.id) }; }, { auth: true });

  // Customer inbox: every conversation, newest first, with unread counts.
  add("GET", "/api/my/threads", ({ user }) => {
    const rows = db.all(`SELECT m.group_id, g.name AS group_name, MAX(m.id) AS last_id FROM messages m JOIN groups g ON g.id = m.group_id
                         WHERE m.customer_id = ? GROUP BY m.group_id ORDER BY last_id DESC LIMIT 50`, user.id);
    return { threads: rows.map((r) => ({ group_id: r.group_id, group_name: r.group_name, last: db.get("SELECT text, sender, created_at FROM messages WHERE id = ?", r.last_id), unread: unreadFor(r.group_id, user.id, "customer") })) };
  }, { auth: true });

  // Numbers for the badges in the top bar.
  add("GET", "/api/my/attention", ({ user }) => {
    const customerUnread = db.get(
      `SELECT COUNT(DISTINCT m.group_id) c FROM messages m
       LEFT JOIN thread_reads r ON r.group_id = m.group_id AND r.customer_id = m.customer_id AND r.side = 'customer'
       WHERE m.customer_id = ? AND m.sender = 'group' AND m.id > COALESCE(r.last_id, 0)`, user.id).c;
    const owns = db.get("SELECT COUNT(*) c FROM groups WHERE owner_id = ?", user.id).c > 0;
    const requests = owns ? db.get("SELECT COUNT(*) c FROM bookings b JOIN groups g ON g.id = b.group_id WHERE g.owner_id = ? AND b.status = 'requested'", user.id).c : 0;
    const managerUnread = owns ? db.get(
      `SELECT COUNT(DISTINCT m.group_id || '-' || m.customer_id) c FROM messages m JOIN groups g ON g.id = m.group_id
       LEFT JOIN thread_reads r ON r.group_id = m.group_id AND r.customer_id = m.customer_id AND r.side = 'group'
       WHERE g.owner_id = ? AND m.sender = 'customer' AND m.id > COALESCE(r.last_id, 0)`, user.id).c : 0;
    return { messages: customerUnread, manager: { owns, requests, messages: managerUnread } };
  }, { auth: true });
  add("POST", "/api/groups/:id/messages", ({ params, body, user, ip }) => {
    const group = getVisibleGroup(db, params.id, user);
    if (group.owner_id === user.id) throw new HttpError(400, "You can't message your own group");
    return post({ group, customerId: user.id, sender: "customer", body, user, ip });
  }, { auth: true });

  // One-tap "ask for a quote": sends the group the event details as a chat message, so nobody has to type them out.
  add("POST", "/api/groups/:id/quote-request", ({ params, body, user, ip }) => {
    const group = getVisibleGroup(db, params.id, user);
    if (group.owner_id === user.id) throw new HttpError(400, "You can't message your own group");
    const event = oneOf(body.event, "Event type", EVENT_TYPES);
    const guests = int(body.guests, "Guests", { min: 1, max: 5000 });
    const hours = int(body.hours, "Hours", { min: 1, max: 12 });
    if (hours < (group.min_hours || 1)) throw new HttpError(400, `${group.name} plays a minimum of ${group.min_hours} hours`);
    const date = body.date;
    if (!isDate(date) || date <= todayStr() || date > addDays(todayStr(), 730)) throw new HttpError(400, "Pick a future date");
    const note = str(body.note, "Note", { max: 200 });
    const text = `Quote request: ${event} on ${date}, about ${guests} guests, ${hours} hr.${note ? " " + note : ""} Could you send me a price?`;
    return post({ group, customerId: user.id, sender: "customer", body: { text }, user, ip });
  }, { auth: true });

  // Group side: the manager sees a list of conversations and can answer ones a customer started.
  add("GET", "/api/groups/:id/threads", ({ params, user }) => {
    requireOwner(db, user, params.id);
    const rows = db.all(
      `SELECT m.customer_id, u.name, MAX(m.id) AS last_id FROM messages m JOIN users u ON u.id = m.customer_id WHERE m.group_id = ? GROUP BY m.customer_id ORDER BY last_id DESC LIMIT 50`, params.id);
    return { threads: rows.map((r) => ({ customer_id: r.customer_id, name: shortName(r.name), last: db.get("SELECT text, sender, created_at FROM messages WHERE id = ?", r.last_id), unread: unreadFor(params.id, r.customer_id, "group") })) };
  }, { auth: true });
  add("GET", "/api/groups/:id/threads/:cid", ({ params, user }) => {
    requireOwner(db, user, params.id);
    const cid = int(params.cid, "customer", { min: 1 });
    markRead(params.id, cid, "group");
    return { messages: thread(params.id, cid) };
  }, { auth: true });
  add("POST", "/api/groups/:id/threads/:cid", ({ params, body, user, ip }) => {
    const group = requireOwner(db, user, params.id);
    const customerId = int(params.cid, "customer", { min: 1 });
    if (!db.get("SELECT 1 AS x FROM messages WHERE group_id = ? AND customer_id = ? AND sender = 'customer'", group.id, customerId)) throw new HttpError(400, "No conversation with that customer");
    return post({ group, customerId, sender: "group", body, user, ip });
  }, { auth: true });
}
