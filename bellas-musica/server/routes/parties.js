import { HttpError, int, isDate, isZip, now, oneOf, rid, safeJson, str, todayStr, addDays } from "../util.js";
import { CATEGORIES, EVENT_TYPES, categoryOf } from "../pricing.js";
import { lookupZip } from "../geo.js";
import { LIVE_SQL, firstPhotos, fromCents, isLive, newId, ratingMap, ratingOf } from "../shared.js";
import { maskContact } from "./messages.js";
import { partyWeather, priceGuide } from "../party.js";

const MAX_PARTIES = 20, MAX_PICKS = 40, MAX_TIMELINE = 40, MAX_COMMENTS = 300;
const CATS = Object.keys(CATEGORIES);
const ACTIVE = "('pending_payment','requested','confirmed')";
const TEMPLATES = ["quince", "wedding", "birthday", "bautizo", "backyard", "graduation", ""];

// What has been paid in the app for a booking so far (deposit after refunds, plus the balance or its parts).
export function paidInApp(b) {
  const deposit = ["paid", "partial_refund"].includes(b.payment_status) ? b.deposit_cents - b.refund_cents : 0;
  const owed = b.total_cents - b.deposit_cents;
  const balance = ["paid", "partial_refund"].includes(b.balance_status) ? owed - b.balance_refund_cents : (b.balance_parts_cents || 0);
  return deposit + balance;
}

export default function partyRoutes(ctx, add) {
  const { db, config, limiters } = ctx;

  const fields = (body, cur = {}) => {
    const out = {};
    if (body.title !== undefined || !cur.id) out.title = maskContact(str(body.title ?? cur.title ?? "", "Party name", { max: 80 })).text;
    if (body.event !== undefined) out.event = body.event === "" ? "" : oneOf(body.event, "Event", EVENT_TYPES);
    if (body.date !== undefined || !cur.id) {
      if (!isDate(body.date) || body.date <= todayStr() || body.date > addDays(todayStr(), 730)) throw new HttpError(400, "Pick a future date");
      out.date = body.date;
    }
    if (body.zip !== undefined || !cur.id) { if (!isZip(body.zip) || !lookupZip(body.zip)) throw new HttpError(400, "Enter a valid 5-digit ZIP code"); out.zip = body.zip; }
    if (body.guests !== undefined) out.guests = body.guests === "" || body.guests === null ? 0 : int(body.guests, "Guests", { min: 0, max: 5000 });
    if (body.budget !== undefined) out.budget_cents = body.budget === "" || body.budget === null ? 0 : int(body.budget, "Budget", { min: 0, max: 500000 }) * 100;
    if (body.template !== undefined) out.template = oneOf(body.template, "Template", TEMPLATES);
    if (body.needs !== undefined) {
      if (!Array.isArray(body.needs) || body.needs.length > CATS.length) throw new HttpError(400, "Pick categories from the list");
      out.needs = JSON.stringify(CATS.filter((c) => body.needs.includes(c)));
    }
    if (body.credits_public !== undefined) { if (typeof body.credits_public !== "boolean") throw new HttpError(400, "On or off"); out.credits_public = body.credits_public ? 1 : 0; }
    return out;
  };
  const ownParty = (user, id) => {
    const p = db.get("SELECT * FROM parties WHERE id = ?", String(id));
    if (!p || p.customer_id !== user.id) throw new HttpError(404, "Party not found");
    return p;
  };
  const byToken = (token) => {
    const p = /^[\w-]{20,40}$/.test(String(token)) ? db.get("SELECT * FROM parties WHERE share_token = ?", String(token)) : null;
    if (!p) throw new HttpError(404, "This party link isn't valid any more. Ask for a new one.");
    return p;
  };

  // The customer's own bookings on the party date are the party's vendors (no linking step needed).
  const partyBookings = (p) => db.all(
    `SELECT b.*, g.name AS group_name, g.type AS group_type FROM bookings b JOIN groups g ON g.id = b.group_id
     WHERE b.customer_id = ? AND b.date = ? AND b.status IN ${ACTIVE} ORDER BY b.time, b.created_at`, p.customer_id, p.date);

  const groupCard = (g, ratings, photos, minPrice) => {
    const r = ratingOf(g, ratings);
    return { id: g.id, name: g.name, type: g.type, category: categoryOf(g.type), rating: Math.round(r.rating * 10) / 10, reviews: r.reviews, from_cents: fromCents(g, minPrice), photo: photos.has(g.id) ? "/uploads/" + photos.get(g.id) : null, demo: Boolean(g.demo) };
  };

  // role: "owner" (everything), "family" (the shared link: no addresses, phones or money paid), "thanks" (public credits page).
  function view(p, role, { voter = "" } = {}) {
    const bookings = partyBookings(p);
    const timeline = db.all("SELECT id, at, label, booking_id FROM party_timeline WHERE party_id = ? ORDER BY at, id", p.id);
    const vendors = bookings.map((b) => {
      const owed = b.total_cents - b.deposit_cents;
      const base = { id: b.id, group_id: b.group_id, group_name: b.group_name, type: b.group_type, category: categoryOf(b.group_type), time: b.time, status: b.status === "pending_payment" ? "unpaid" : b.status };
      if (role === "thanks") return base;
      const paid = paidInApp(b);
      return { ...base, total_cents: b.total_cents, paid_cents: role === "owner" ? paid : undefined, balance_left_cents: b.status === "confirmed" ? Math.max(0, owed - (["paid", "partial_refund"].includes(b.balance_status) ? owed : b.balance_parts_cents || 0)) : null, balance_offline: b.balance_status === "offline" };
    });
    const base = {
      id: p.id, title: p.title, event: p.event, date: p.date, zip: p.zip, guests: p.guests, template: p.template,
      host: (db.get("SELECT name FROM users WHERE id = ?", p.customer_id)?.name || "").split(" ")[0],
      vendors, booked_categories: [...new Set(vendors.filter((v) => v.status !== "unpaid").map((v) => v.category))]
    };
    if (role === "thanks") return base;
    const ratings = ratingMap(db), photos = firstPhotos(db);
    const minPrice = new Map(db.all("SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL GROUP BY group_id").map((r) => [r.group_id, r.m]));
    const comments = db.all("SELECT id, group_id, name, text, is_owner, created_at FROM party_comments WHERE party_id = ? ORDER BY id", p.id);
    const picks = db.all("SELECT * FROM party_picks WHERE party_id = ? ORDER BY created_at", p.id).map((pk) => {
      const g = db.get("SELECT * FROM groups WHERE id = ?", pk.group_id);
      if (!g || !isLive(g)) return null;
      const votes = db.all("SELECT voter FROM party_votes WHERE party_id = ? AND group_id = ?", p.id, g.id);
      return { ...groupCard(g, ratings, photos, minPrice), added_by: pk.added_by, votes: votes.length, my_vote: Boolean(voter && votes.some((v) => v.voter === voter)), comments: comments.filter((c) => c.group_id === g.id) };
    }).filter(Boolean).sort((a, b) => b.votes - a.votes);
    const out = {
      ...base, needs: safeJson(p.needs, []), picks, comments: comments.filter((c) => !c.group_id),
      timeline: timeline.map((t) => ({ ...t, vendor: t.booking_id ? vendors.find((v) => v.id === t.booking_id)?.group_name || "" : "" }))
    };
    if (role === "family") return out;
    const active = vendors.filter((v) => v.status !== "unpaid");
    const booked = active.reduce((n, v) => n + v.total_cents, 0), paid = vendors.reduce((n, v) => n + (v.paid_cents || 0), 0);
    const byCat = {};
    for (const v of active) byCat[v.category] = (byCat[v.category] || 0) + v.total_cents;
    return {
      ...out, budget_cents: p.budget_cents, credits_public: Boolean(p.credits_public),
      money: { booked_cents: booked, paid_cents: paid, to_pay_cents: Math.max(0, booked - paid), left_cents: p.budget_cents ? p.budget_cents - booked : null, by_category: byCat },
      share_url: `${config.baseUrl}/#/fp/${p.share_token}`, thanks_url: `${config.baseUrl}/#/thanks/${p.id}`
    };
  }

  // ---- the customer's own parties ----
  add("POST", "/api/parties", ({ body, user }) => {
    if (db.get("SELECT COUNT(*) c FROM parties WHERE customer_id = ?", user.id).c >= MAX_PARTIES) throw new HttpError(400, `At most ${MAX_PARTIES} parties`);
    const f = fields(body);
    const id = newId("p"), t = now();
    db.run(`INSERT INTO parties (id, customer_id, title, event, date, zip, guests, budget_cents, needs, template, share_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, user.id, f.title || "", f.event || "", f.date, f.zip, f.guests || 0, f.budget_cents || 0, f.needs || JSON.stringify(CATS), f.template || "", rid(18), t, t);
    return { party: view(db.get("SELECT * FROM parties WHERE id = ?", id), "owner") };
  }, { auth: true });

  add("GET", "/api/my/parties", ({ user }) => ({
    parties: db.all("SELECT * FROM parties WHERE customer_id = ? ORDER BY date", user.id).map((p) => ({ id: p.id, title: p.title, event: p.event, date: p.date, zip: p.zip, past: p.date < todayStr(), vendors: partyBookings(p).length }))
  }), { auth: true });

  add("GET", "/api/parties/:id", ({ params, user }) => ({ party: view(ownParty(user, params.id), "owner") }), { auth: true });

  add("PATCH", "/api/parties/:id", ({ params, body, user }) => {
    const p = ownParty(user, params.id);
    const f = fields(body, p), keys = Object.keys(f);
    if (keys.length) db.run(`UPDATE parties SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, ...keys.map((k) => f[k]), now(), p.id);
    return { party: view(db.get("SELECT * FROM parties WHERE id = ?", p.id), "owner") };
  }, { auth: true });

  add("DELETE", "/api/parties/:id", ({ params, user }) => { db.run("DELETE FROM parties WHERE id = ?", ownParty(user, params.id).id); return { ok: true }; }, { auth: true });

  // A new family link (the old one stops working), e.g. after it was shared too widely.
  add("POST", "/api/parties/:id/share", ({ params, user }) => {
    const p = ownParty(user, params.id);
    db.run("UPDATE parties SET share_token = ?, updated_at = ? WHERE id = ?", rid(18), now(), p.id);
    return { party: view(db.get("SELECT * FROM parties WHERE id = ?", p.id), "owner") };
  }, { auth: true });

  // Day-of timeline: replaced as a whole. A row can point at one of the party's bookings; that vendor then sees its arrival time.
  add("PUT", "/api/parties/:id/timeline", ({ params, body, user }) => {
    const p = ownParty(user, params.id);
    if (!Array.isArray(body.items) || body.items.length > MAX_TIMELINE) throw new HttpError(400, `At most ${MAX_TIMELINE} timeline rows`);
    const mine = new Set(partyBookings(p).map((b) => b.id));
    const rows = body.items.map((it) => {
      const at = String(it?.at ?? "");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new HttpError(400, "Times look like 18:30");
      const bookingId = it.bookingId ? String(it.bookingId) : "";
      if (bookingId && !mine.has(bookingId)) throw new HttpError(400, "That vendor isn't booked for this party");
      return { at, label: maskContact(str(it.label, "Timeline item", { min: 1, max: 80 })).text, bookingId };
    });
    db.tx(() => {
      db.run("DELETE FROM party_timeline WHERE party_id = ?", p.id);
      for (const r of rows) db.run("INSERT INTO party_timeline (party_id, at, label, booking_id) VALUES (?, ?, ?, ?)", p.id, r.at, r.label, r.bookingId);
    });
    return { party: view(p, "owner") };
  }, { auth: true });

  const addPick = (p, groupId, by) => {
    const g = db.get("SELECT * FROM groups WHERE id = ?", str(groupId, "Group", { required: true, max: 80 }));
    if (!g || !isLive(g)) throw new HttpError(404, "Group not found");
    if (db.get("SELECT COUNT(*) c FROM party_picks WHERE party_id = ?", p.id).c >= MAX_PICKS) throw new HttpError(400, `At most ${MAX_PICKS} options on the list`);
    db.run("INSERT OR IGNORE INTO party_picks (party_id, group_id, added_by, created_at) VALUES (?, ?, ?, ?)", p.id, g.id, by, now());
  };
  add("POST", "/api/parties/:id/picks", ({ params, body, user }) => {
    const p = ownParty(user, params.id);
    addPick(p, body.groupId, user.name.split(" ")[0]);
    return { party: view(p, "owner") };
  }, { auth: true });
  add("DELETE", "/api/parties/:id/picks/:gid", ({ params, user }) => {
    const p = ownParty(user, params.id);
    db.run("DELETE FROM party_picks WHERE party_id = ? AND group_id = ?", p.id, params.gid);
    db.run("DELETE FROM party_votes WHERE party_id = ? AND group_id = ?", p.id, params.gid);
    return { party: view(p, "owner") };
  }, { auth: true });
  add("POST", "/api/parties/:id/comments", ({ params, body, user, ip }) => {
    const p = ownParty(user, params.id);
    postComment(p, { ...body, name: user.name.split(" ")[0] }, ip, true);
    return { party: view(p, "owner") };
  }, { auth: true });
  add("DELETE", "/api/parties/:id/comments/:cid", ({ params, user }) => {
    const p = ownParty(user, params.id);
    db.run("DELETE FROM party_comments WHERE id = ? AND party_id = ?", params.cid, p.id);
    return { party: view(p, "owner") };
  }, { auth: true });

  add("GET", "/api/parties/:id/weather", async ({ params, user }) => {
    const p = ownParty(user, params.id);
    return { weather: await partyWeather(config, p.zip, p.date) };
  }, { auth: true });

  // ---- the family link: anyone with it can see the plan, vote and comment (no account needed) ----
  function postComment(p, body, ip, isOwner = false) {
    if (!limiters.chat.check("party:" + ip)) throw new HttpError(429, "Too many messages. Wait a minute.");
    if (db.get("SELECT COUNT(*) c FROM party_comments WHERE party_id = ?", p.id).c >= MAX_COMMENTS) throw new HttpError(400, "This party has too many comments");
    const name = maskContact(str(body.name, "Your name", { min: 1, max: 40 })).text;
    const text = maskContact(str(body.text, "Comment", { min: 1, max: 300 })).text;
    let groupId = "";
    if (body.groupId) { groupId = String(body.groupId); if (!db.get("SELECT 1 AS x FROM party_picks WHERE party_id = ? AND group_id = ?", p.id, groupId)) throw new HttpError(400, "That option isn't on this party's list"); }
    db.run("INSERT INTO party_comments (party_id, group_id, name, text, is_owner, created_at) VALUES (?, ?, ?, ?, ?, ?)", p.id, groupId, name, text, isOwner ? 1 : 0, now());
  }
  const voterOf = (v) => (/^[\w-]{8,40}$/.test(String(v || "")) ? String(v) : "");

  add("GET", "/api/fp/:token", ({ params, query }) => ({ party: view(byToken(params.token), "family", { voter: voterOf(query.voter) }) }));
  add("POST", "/api/fp/:token/vote", ({ params, body }) => {
    const p = byToken(params.token), voter = voterOf(body.voter);
    if (!voter) throw new HttpError(400, "Bad voter id");
    const gid = String(body.groupId || "");
    if (!db.get("SELECT 1 AS x FROM party_picks WHERE party_id = ? AND group_id = ?", p.id, gid)) throw new HttpError(400, "That option isn't on this party's list");
    if (db.run("DELETE FROM party_votes WHERE party_id = ? AND group_id = ? AND voter = ?", p.id, gid, voter).changes === 0) {
      if (db.get("SELECT COUNT(*) c FROM party_votes WHERE party_id = ?", p.id).c >= 2000) throw new HttpError(400, "Too many votes on this party");
      db.run("INSERT INTO party_votes (party_id, group_id, voter, created_at) VALUES (?, ?, ?, ?)", p.id, gid, voter, now());
    }
    return { party: view(p, "family", { voter }) };
  });
  add("POST", "/api/fp/:token/comments", ({ params, body, ip }) => {
    const p = byToken(params.token);
    postComment(p, body, ip);
    return { party: view(p, "family", { voter: voterOf(body.voter) }) };
  });
  add("POST", "/api/fp/:token/picks", ({ params, body, ip }) => {
    const p = byToken(params.token);
    if (!limiters.chat.check("party:" + ip)) throw new HttpError(429, "Too many changes. Wait a minute.");
    addPick(p, body.groupId, maskContact(str(body.name, "Your name", { min: 1, max: 40 })).text);
    return { party: view(p, "family", { voter: voterOf(body.voter) }) };
  });

  // ---- "This party was planned on Bella's Música": public credits page, only if the host turned it on ----
  add("GET", "/api/thanks/:id", ({ params }) => {
    const p = db.get("SELECT * FROM parties WHERE id = ?", String(params.id));
    if (!p || !p.credits_public) throw new HttpError(404, "Not found");
    const v = view(p, "thanks");
    return { party: { title: v.title, event: v.event, month: p.date.slice(0, 7), host: v.host, vendors: v.vendors.filter((x) => x.status !== "unpaid").map(({ group_id, group_name, type, category }) => ({ group_id, group_name, type, category })) } };
  });

  // ---- price guide ----
  add("GET", "/api/price-guide", ({ query }) => {
    const category = oneOf(query.category, "category", CATS);
    const event = query.event ? oneOf(query.event, "event", EVENT_TYPES) : "";
    return { guide: priceGuide(db, category, event) || (event ? priceGuide(db, category) : null) };
  });
}
