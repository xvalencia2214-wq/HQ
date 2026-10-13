import crypto from "node:crypto";
import { HttpError, int, now, oneOf, rid, str } from "../util.js";
import { EVENT_TYPES } from "../pricing.js";
import { getGroup, isTeam, requireOwner } from "../shared.js";
import { maskContact } from "./messages.js";

// Reviews from a vendor's past clients (people it played for before joining), so a good business doesn't start at zero
// against sites with years of reviews. The vendor sends a one-time link; the client logs in and writes the review.
// They are labelled "Past client" (never "booked here"), capped per listing, can't come from the vendor's own team,
// account or connection, and the site owner can remove any of them.
export const MAX_PAST_REVIEWS = 10;      // finished past-client reviews per listing
const MAX_OPEN = 20;                     // links waiting for an answer at once
const LINK_DAYS = 30;
const hash = (t) => crypto.createHash("sha256").update("pastrev:" + String(t)).digest("hex");

export default function clientReviewRoutes(ctx, add) {
  const { db, config, notify } = ctx;
  const ipHash = (ip) => crypto.createHmac("sha256", config.secret).update("ip:" + String(ip || "")).digest("hex").slice(0, 32);
  const linkFor = (token) => `${config.baseUrl}/#/review/${token}`;
  const ownerView = (r) => ({ id: r.id, client_name: r.client_name, email: r.client_email ? r.client_email.replace(/^(.).*(@.*)$/, "$1…$2") : "", event: r.event_type, when: r.event_month,
    status: r.status === "invited" && r.expires_at < now() ? "expired" : r.status, rating: r.rating || null, text: r.status === "done" ? r.text : "", created_at: r.created_at, reviewed_at: r.reviewed_at });
  const counts = (gid) => ({
    done: db.get("SELECT COUNT(*) c FROM client_reviews WHERE group_id = ? AND status = 'done'", gid).c,
    open: db.get("SELECT COUNT(*) c FROM client_reviews WHERE group_id = ? AND status = 'invited' AND expires_at > ?", gid, now()).c
  });

  add("GET", "/api/groups/:id/client-reviews", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    return { invites: db.all("SELECT * FROM client_reviews WHERE group_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 60", g.id).map(ownerView), ...counts(g.id), max: MAX_PAST_REVIEWS };
  }, { auth: true });

  add("POST", "/api/groups/:id/client-reviews", ({ params, body, user, ip }) => {
    const g = requireOwner(db, user, params.id);
    if (g.demo) throw new HttpError(400, "Sample listings can't ask for reviews.");
    const c = counts(g.id);
    if (c.done >= MAX_PAST_REVIEWS) throw new HttpError(400, `You already have ${MAX_PAST_REVIEWS} reviews from past clients. New reviews come from bookings made here.`);
    if (c.done + c.open >= MAX_PAST_REVIEWS + MAX_OPEN) throw new HttpError(400, "You have many links waiting for an answer. Cancel some before you send more.");
    const name = str(body.name, "Client's name", { min: 2, max: 60 });
    const email = str(body.email, "Client's email", { max: 120 }).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email, or leave it empty to send the link by WhatsApp");
    const when = str(body.when, "When", { required: true, max: 7 });
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(when)) throw new HttpError(400, "Pick the month of the event");
    const thisMonth = new Date().toISOString().slice(0, 7);
    if (when > thisMonth || when < `${Number(thisMonth.slice(0, 4)) - 5}${thisMonth.slice(4)}`) throw new HttpError(400, "The event must be in the past (up to 5 years ago)");
    const event = oneOf(body.event, "Event", EVENT_TYPES);
    const token = rid(18), id = rid(9);
    db.run(`INSERT INTO client_reviews (id, group_id, token_hash, client_name, client_email, event_type, event_month, status, created_by, creator_ip_hash, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'invited', ?, ?, ?, ?)`, id, g.id, hash(token), name, email, event, when, user.id, ipHash(ip), now(), now() + LINK_DAYS * 86400);
    if (email) notify.toEmail(email, body.lang === "es" ? "es" : "en", "pastreview.invite", { group: g.name, client: name, event, url: linkFor(token) });
    return { invite: ownerView(db.get("SELECT * FROM client_reviews WHERE id = ?", id)), url: linkFor(token), emailed: Boolean(email) };
  }, { auth: true });

  // a fresh link for one that wasn't answered (the old one stops working)
  add("POST", "/api/client-reviews/:id/link", ({ params, user, ip }) => {
    const r = db.get("SELECT * FROM client_reviews WHERE id = ?", params.id);
    if (!r || !isTeam(db, user, getGroup(db, r.group_id))) throw new HttpError(404, "Not found");
    if (r.status !== "invited") throw new HttpError(400, "This client already answered.");
    const token = rid(18);
    db.run("UPDATE client_reviews SET token_hash = ?, creator_ip_hash = ?, expires_at = ? WHERE id = ?", hash(token), ipHash(ip), now() + LINK_DAYS * 86400, r.id);
    return { url: linkFor(token) };
  }, { auth: true });

  add("DELETE", "/api/client-reviews/:id", ({ params, user }) => {
    const r = db.get("SELECT * FROM client_reviews WHERE id = ?", params.id);
    if (!r || !isTeam(db, user, getGroup(db, r.group_id))) throw new HttpError(404, "Not found");
    if (r.status !== "invited") throw new HttpError(400, "A review that was written can't be deleted by the business.");
    db.run("UPDATE client_reviews SET status = 'cancelled' WHERE id = ?", r.id);
    return { ok: true };
  }, { auth: true });

  // The client's side: see what the link is for (no login needed), then write the review (logged in).
  const byToken = (token) => {
    const r = typeof token === "string" && token.length >= 20 && token.length <= 40 ? db.get("SELECT * FROM client_reviews WHERE token_hash = ?", hash(token)) : null;
    if (!r || r.status === "cancelled" || r.status === "removed") throw new HttpError(404, "This review link doesn't work anymore. Ask the business for a new one.");
    return r;
  };
  add("GET", "/api/past-review/:token", ({ params }) => {
    const r = byToken(params.token), g = getGroup(db, r.group_id);
    return { group: { id: g.id, name: g.name, type: g.type }, client_name: r.client_name, event: r.event_type, when: r.event_month,
      status: r.status === "invited" && r.expires_at < now() ? "expired" : r.status };
  });
  add("POST", "/api/past-review/:token", ({ params, body, user, ip }) => {
    const r = byToken(params.token), g = getGroup(db, r.group_id);
    if (r.status === "done") throw new HttpError(409, "This review was already written. Thank you!");
    if (r.expires_at < now()) throw new HttpError(400, "This link expired. Ask the business for a new one.");
    if (isTeam(db, user, g) || r.created_by === user.id) throw new HttpError(403, "A business can't review itself. Send this link to your client.");
    if (config.pastReviewIpCheck && r.creator_ip_hash && r.creator_ip_hash === ipHash(ip)) throw new HttpError(403, "This link has to be opened by your client, on their own phone.");
    if (db.get("SELECT 1 AS x FROM client_reviews WHERE group_id = ? AND reviewer_id = ? AND status = 'done'", g.id, user.id)) throw new HttpError(409, "You already reviewed this business.");
    const rating = int(body.rating, "Rating", { min: 1, max: 5 });
    const text = maskContact(str(body.text, "Review", { min: 10, max: 800 })).text;
    const done = db.tx(() => {
      if (db.get("SELECT COUNT(*) c FROM client_reviews WHERE group_id = ? AND status = 'done'", g.id).c >= MAX_PAST_REVIEWS) return false;
      return db.run("UPDATE client_reviews SET status = 'done', rating = ?, text = ?, reviewer_id = ?, reviewer_ip_hash = ?, reviewed_at = ? WHERE id = ? AND status = 'invited'", rating, text, user.id, ipHash(ip), now(), r.id).changes === 1;
    });
    if (!done) throw new HttpError(409, "This business can't receive more reviews this way. Thank you!");
    if (g.owner_id) notify.to(g.owner_id, "pastreview.got", { group: g.name, client: user.name, rating, url: `${config.baseUrl}/#/dashboard?g=${g.id}&tab=reviews` });
    return { ok: true };
  }, { auth: true });

  // the business answers in public, like on a booking review
  add("POST", "/api/client-reviews/:id/reply", ({ params, body, user }) => {
    const r = db.get("SELECT * FROM client_reviews WHERE id = ? AND status = 'done'", params.id);
    if (!r || !isTeam(db, user, getGroup(db, r.group_id))) throw new HttpError(404, "Review not found");
    const text = maskContact(str(body.text, "Reply", { min: 2, max: 500 })).text;
    db.run("UPDATE client_reviews SET reply = ?, reply_at = ? WHERE id = ?", text, now(), r.id);
    return { ok: true, reply: { text, at: now() } };
  }, { auth: true });
  add("DELETE", "/api/client-reviews/:id/reply", ({ params, user }) => {
    const r = db.get("SELECT * FROM client_reviews WHERE id = ? AND status = 'done'", params.id);
    if (!r || !isTeam(db, user, getGroup(db, r.group_id))) throw new HttpError(404, "Review not found");
    db.run("UPDATE client_reviews SET reply = '', reply_at = 0 WHERE id = ?", r.id);
    return { ok: true };
  }, { auth: true });
}
