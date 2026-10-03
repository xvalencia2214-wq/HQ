import fs from "node:fs";
import path from "node:path";
import { HttpError, addDays, int, isDate, isZip, now, oneOf, rid, safeJson, str, todayStr } from "../util.js";
import { EVENT_TYPES, GROUP_TYPES, HOURLY_BY_DEFAULT, MAX_ADDONS, MAX_HOURS, POLICIES, SLOTS, categoryOf } from "../pricing.js";
import { lookupZip } from "../geo.js";
import { inMarket } from "../market.js";
import { parseVideo, sniffImage } from "../media.js";
import { maskContact } from "./messages.js";
import { activeOffers, feePctFor, getGroup, getVisibleGroup, isLive, groupDetail, markFeaturePaid, newId, requireOwner, openSlots, expirePending } from "../shared.js";
import { normalizePhone } from "../sms.js";

const MAX_GROUPS_PER_USER = 5;
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "group";
const dollarsToCents = (v, name, { min, max }) => int(v, name, { min, max }) * 100;

function stringList(v, name, { maxItems, maxLen }) {
  if (!Array.isArray(v)) throw new HttpError(400, `${name} must be a list`);
  if (v.length > maxItems) throw new HttpError(400, `${name}: at most ${maxItems} items`);
  return [...new Set(v.map((x) => str(x, name, { max: maxLen })).filter(Boolean))];
}

export default function groupRoutes(ctx, add) {
  const { db, stripe, config, limiters } = ctx;

  // What a group still needs to look trustworthy and be bookable. `tab` says where to fix it in the dashboard.
  function checklist(g, detail) {
    const owner = g.owner_id ? db.get("SELECT phone, sms_opt_in FROM users WHERE id = ?", g.owner_id) : null;
    const openDates = db.get("SELECT COUNT(*) c FROM availability WHERE group_id = ? AND date > ?", g.id, todayStr()).c;
    const items = [
      { key: "photos", done: detail.photos.length >= 3, tab: "media" },
      { key: "video", done: Boolean(g.video_provider), tab: "media" },
      { key: "story", done: g.story.trim().length >= 80, tab: "listing" },
      { key: "events", done: detail.events.length >= 1, tab: "listing" },
      ...(detail.category === "music" ? [{ key: "songs", done: detail.songs.length >= 5, tab: "extras" }] : []),
      { key: "packages", done: detail.packages.length >= 1, tab: "extras" },
      { key: "dates", done: openDates >= 4, tab: "calendar" },
      { key: "payouts", done: Boolean(g.stripe_ready), tab: "payments" },
      { key: "alerts", done: Boolean(owner && owner.sms_opt_in && (g.contact_phone || owner.phone)), tab: "listing" }
    ];
    return { items, done: items.filter((i) => i.done).length, total: items.length };
  }

  // The minimum a profile needs before customers can see it: one photo, a real story, the events you play, and a date to book.
  function publishMissing(g, detail) {
    const missing = [];
    if (detail.photos.length < 1) missing.push("photos");
    if (g.story.trim().length < 40) missing.push("story");
    if (detail.events.length < 1) missing.push("events");
    if (g.hourly === 0 && detail.packages.length < 1) missing.push("packages"); // booked by package only: needs one to book
    if (db.get("SELECT COUNT(*) c FROM availability WHERE group_id = ? AND date > ?", g.id, todayStr()).c < 1) missing.push("dates");
    if (stripe.live && !g.stripe_ready) missing.push("payouts");
    return missing;
  }
  // A business invited by another one publishes its first listing: both get half the platform fee for 30 days (once per new business).
  function rewardReferral(g) {
    const owner = db.get("SELECT id, referred_by, ref_rewarded FROM users WHERE id = ?", g.owner_id);
    if (!owner || !owner.referred_by || owner.ref_rewarded) return;
    const until = now() + 30 * 86400;
    db.tx(() => {
      db.run("UPDATE users SET ref_rewarded = 1 WHERE id = ?", owner.id);
      db.run("UPDATE groups SET fee_discount_until = MAX(fee_discount_until, ?) WHERE id = ?", until, g.id);
      db.run("UPDATE groups SET fee_discount_until = MAX(fee_discount_until, ?) WHERE owner_id = ?", until, owner.referred_by);
    });
    ctx.notify.to(owner.referred_by, "referral.reward", { group: g.name, url: `${config.baseUrl}/#/dashboard` });
  }
  const statusOf = (g) => (g.hidden ? "hidden" : g.published_at === 0 && !g.demo ? "draft" : g.paused ? "paused" : "live");

  // Everything the owner may see about their own group (adds private fields).
  function manageView(g) {
    const detail = groupDetail(ctx, g);
    return {
      ...detail,
      checklist: checklist(g, detail),
      status: statusOf(g), publish_missing: g.published_at === 0 && !g.demo ? publishMissing(g, detail) : [], outside_market: !inMarket(g.zip),
      contact_phone: g.contact_phone, promoted_until: g.promoted_until, pro_until: g.pro_until, fee_discount_until: g.fee_discount_until, fee_pct: feePctFor(g, config),
      stripe: { mode: stripe.mode, connected: Boolean(g.stripe_account_id), ready: Boolean(g.stripe_ready) },
      is_owner: true,
      stats_30d: { views: ctx.stats.total("group_view", 30, g.id), requests: ctx.stats.total("booking_paid", 30, g.id), confirmed: ctx.stats.total("booking_confirmed", 30, g.id), feed_views: ctx.stats.total("feed_view", 30, g.id), feed_taps: ctx.stats.total("feed_tap", 30, g.id) },
      open_offers: db.all("SELECT p.id, p.name, p.hours, p.price_cents, p.expires_at, u.name AS customer FROM packages p JOIN users u ON u.id = p.private_customer_id WHERE p.group_id = ? AND p.expires_at > ? ORDER BY p.id DESC", g.id, now()).map((o) => ({ ...o, customer: o.customer.split(" ")[0] })),
      pending_requests: db.get("SELECT COUNT(*) c FROM bookings WHERE group_id = ? AND status = 'requested'", g.id).c,
      unread_threads: db.get(
        `SELECT COUNT(DISTINCT m.customer_id) c FROM messages m
         LEFT JOIN thread_reads r ON r.group_id = m.group_id AND r.customer_id = m.customer_id AND r.side = 'group'
         WHERE m.group_id = ? AND m.sender = 'customer' AND m.id > COALESCE(r.last_id, 0)`, g.id).c
    };
  }

  add("POST", "/api/groups", ({ body, user }) => {
    if (db.get("SELECT COUNT(*) c FROM groups WHERE owner_id = ?", user.id).c >= MAX_GROUPS_PER_USER) throw new HttpError(400, "Group limit reached");
    const name = str(body.name, "Group name", { min: 2, max: 80 });
    const zip = str(body.zip, "ZIP", { required: true, max: 5 });
    if (!isZip(zip) || !lookupZip(zip)) throw new HttpError(400, "Enter a valid US ZIP code");
    const id = `${slug(name)}-${rid(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    const type = oneOf(body.type, "Type", GROUP_TYPES);
    // Booked by the hour (music, photographers, security...) or only by package (tents, food trucks...). Hourly listings need a price per hour.
    const hourly = body.hourly === undefined ? HOURLY_BY_DEFAULT[categoryOf(type)] : body.hourly === true;
    const rate = hourly || (body.rate !== undefined && body.rate !== null && body.rate !== "") ? dollarsToCents(body.rate, "Price per hour", { min: 50, max: 5000 }) : 0;
    db.run(
      `INSERT INTO groups (id, owner_id, name, type, zip, rate_cents, members, story, created_at, hourly) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${hourly ? 1 : 0})`,
      id, user.id, name, type, zip, rate,
      int(body.members ?? 1, "Musicians", { min: 1, max: 40 }), str(body.story, "Story", { max: 800 }), now());
    // No payout account yet: in simulated mode this is instant; live mode requires Stripe onboarding.
    if (!stripe.live) db.run("UPDATE groups SET stripe_ready = 1 WHERE id = ?", id);
    return manageView(getGroup(db, id));
  }, { auth: true });

  add("POST", "/api/groups/:id/publish", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    if (g.hidden) throw new HttpError(403, "This listing was hidden by the site owner. Contact support.");
    const missing = publishMissing(g, groupDetail(ctx, g));
    if (missing.length) throw new HttpError(400, "Finish these steps before you publish", { missing });
    const first = g.published_at === 0;
    db.run("UPDATE groups SET published_at = CASE WHEN published_at = 0 THEN ? ELSE published_at END, paused = 0 WHERE id = ?", now(), g.id);
    if (first) rewardReferral(g);
    return manageView(getGroup(db, g.id));
  }, { auth: true });

  add("POST", "/api/groups/:id/pause", ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    if (g.published_at === 0 && !g.demo) throw new HttpError(400, "Publish your listing first");
    db.run("UPDATE groups SET paused = ? WHERE id = ?", body.paused === true ? 1 : 0, g.id);
    return manageView(getGroup(db, g.id));
  }, { auth: true });

  add("GET", "/api/my/groups", ({ user }) => ({ groups: db.all("SELECT * FROM groups WHERE owner_id = ? ORDER BY created_at", user.id).map(manageView) }), { auth: true });

  add("GET", "/api/groups/:id", ({ params, user }) => {
    const g = getVisibleGroup(db, params.id, user);
    const isOwner = Boolean(user && g.owner_id === user.id);
    if (!isOwner) ctx.stats.count("group_view", g.id); // a group looking at its own page is not a customer view
    return { ...groupDetail(ctx, g), is_owner: isOwner };
  });

  add("PATCH", "/api/groups/:id", ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    const set = {};
    if (body.name !== undefined) set.name = str(body.name, "Group name", { min: 2, max: 80 });
    if (body.type !== undefined) set.type = oneOf(body.type, "Type", GROUP_TYPES);
    if (body.zip !== undefined) { if (!isZip(body.zip) || !lookupZip(body.zip)) throw new HttpError(400, "Enter a valid US ZIP code"); set.zip = body.zip; }
    if (body.rate !== undefined) set.rate_cents = dollarsToCents(body.rate, "Price per hour", { min: 50, max: 5000 });
    if (body.hourly !== undefined) {
      if (typeof body.hourly !== "boolean") throw new HttpError(400, "Booking by the hour must be on or off");
      set.hourly = body.hourly ? 1 : 0;
      if (body.hourly && (set.rate_cents ?? g.rate_cents) < 5000) throw new HttpError(400, "Set a price per hour (at least $50) to take bookings by the hour");
    }
    if (body.weather_policy !== undefined) set.weather_policy = maskContact(str(body.weather_policy, "Weather policy", { max: 300 })).text;
    if (body.min_hours !== undefined) set.min_hours = int(body.min_hours, "Minimum hours", { min: 1, max: MAX_HOURS });
    if (body.members !== undefined) set.members = int(body.members, "Musicians", { min: 1, max: 40 });
    if (body.story !== undefined) set.story = str(body.story, "Story", { max: 800 });
    if (body.events !== undefined) set.events = JSON.stringify(stringList(body.events, "Events", { maxItems: 10, maxLen: 40 }).filter((e) => EVENT_TYPES.includes(e)));
    if (body.songs !== undefined) set.songs = JSON.stringify(stringList(body.songs, "Songs", { maxItems: 80, maxLen: 60 }));
    if (body.max_guests !== undefined) set.max_guests = int(body.max_guests, "Max guests", { min: 1, max: 5000 });
    if (body.sound_system !== undefined) set.sound_system = body.sound_system === true ? 1 : 0;
    if (body.dress_code !== undefined) set.dress_code = str(body.dress_code, "Dress code", { max: 120 });
    if (body.set_minutes !== undefined) set.set_minutes = int(body.set_minutes, "Set length", { min: 10, max: 240 });
    if (body.travel_miles !== undefined) set.travel_miles = int(body.travel_miles, "Free travel miles", { min: 0, max: 500 });
    if (body.travel_fee !== undefined) set.travel_fee_cents = dollarsToCents(body.travel_fee, "Travel fee", { min: 0, max: 2000 });
    if (body.deposit_pct !== undefined) set.deposit_pct = int(body.deposit_pct, "Deposit %", { min: 20, max: 50 });
    if (body.cancel_policy !== undefined) set.cancel_policy = oneOf(body.cancel_policy, "Cancellation policy", Object.keys(POLICIES));
    if (body.contact_phone !== undefined) {
      const raw = str(body.contact_phone, "Phone", { max: 30 });
      if (raw && !normalizePhone(raw)) throw new HttpError(400, "Enter a valid US phone number");
      set.contact_phone = raw ? normalizePhone(raw) : "";
    }
    if (body.video_url !== undefined) {
      const v = parseVideo(body.video_url);
      if (!v) throw new HttpError(400, "Use a YouTube, Vimeo, TikTok or Instagram video link");
      set.video_provider = v.provider; set.video_id = v.id;
    }
    const keys = Object.keys(set);
    if (keys.length) db.run(`UPDATE groups SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => set[k]), g.id);
    return manageView(getGroup(db, g.id));
  }, { auth: true });

  // ---- packages ----
  function packageFields(body) {
    return {
      name: str(body.name, "Package name", { min: 2, max: 60 }),
      description: str(body.description, "Description", { max: 200 }),
      hours: int(body.hours, "Hours", { min: 1, max: 12 }),
      price_cents: dollarsToCents(body.price, "Price", { min: 20, max: 50000 })
    };
  }
  add("POST", "/api/groups/:id/packages", ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    if (db.get("SELECT COUNT(*) c FROM packages WHERE group_id = ? AND private_customer_id IS NULL", g.id).c >= 12) throw new HttpError(400, "At most 12 packages");
    const f = packageFields(body);
    db.run("INSERT INTO packages (group_id, name, description, hours, price_cents) VALUES (?, ?, ?, ?, ?)", g.id, f.name, f.description, f.hours, f.price_cents);
    return manageView(getGroup(db, g.id));
  }, { auth: true });
  const ownedPackage = (user, id) => {
    const p = db.get("SELECT p.*, g.owner_id FROM packages p JOIN groups g ON g.id = p.group_id WHERE p.id = ?", id);
    if (!p || p.private_customer_id !== null) throw new HttpError(404, "Package not found"); // custom offers have their own routes
    if (p.owner_id !== user.id) throw new HttpError(403, "You don't manage this group");
    return p;
  };
  add("PATCH", "/api/packages/:pid", ({ params, body, user }) => {
    const p = ownedPackage(user, params.pid);
    const f = packageFields({ name: body.name ?? p.name, description: body.description ?? p.description, hours: body.hours ?? p.hours, price: body.price ?? p.price_cents / 100 });
    db.run("UPDATE packages SET name = ?, description = ?, hours = ?, price_cents = ? WHERE id = ?", f.name, f.description, f.hours, f.price_cents, p.id);
    return manageView(getGroup(db, p.group_id));
  }, { auth: true });
  add("DELETE", "/api/packages/:pid", ({ params, user }) => {
    const p = ownedPackage(user, params.pid);
    db.run("DELETE FROM packages WHERE id = ?", p.id);
    return manageView(getGroup(db, p.group_id));
  }, { auth: true });

  // ---- add-ons: extras a customer can tick when booking (fog machine, lights, visuals...), a flat price per event; 0 means included ----
  function addonFields(body) {
    return {
      name: str(body.name, "Add-on name", { min: 2, max: 60 }),
      description: str(body.description, "Description", { max: 160 }),
      price_cents: dollarsToCents(body.price ?? 0, "Price", { min: 0, max: 5000 })
    };
  }
  add("POST", "/api/groups/:id/addons", ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    if (db.get("SELECT COUNT(*) c FROM addons WHERE group_id = ?", g.id).c >= MAX_ADDONS) throw new HttpError(400, `At most ${MAX_ADDONS} add-ons`);
    const f = addonFields(body);
    if (db.get("SELECT 1 AS x FROM addons WHERE group_id = ? AND LOWER(name) = LOWER(?)", g.id, f.name)) throw new HttpError(400, "You already have an add-on with that name");
    db.run("INSERT INTO addons (group_id, name, description, price_cents) VALUES (?, ?, ?, ?)", g.id, f.name, f.description, f.price_cents);
    return manageView(getGroup(db, g.id));
  }, { auth: true });
  const ownedAddon = (user, id) => {
    const a = db.get("SELECT a.*, g.owner_id FROM addons a JOIN groups g ON g.id = a.group_id WHERE a.id = ?", id);
    if (!a) throw new HttpError(404, "Add-on not found");
    if (a.owner_id !== user.id) throw new HttpError(403, "You don't manage this group");
    return a;
  };
  add("PATCH", "/api/addons/:aid", ({ params, body, user }) => {
    const a = ownedAddon(user, params.aid);
    const f = addonFields({ name: body.name ?? a.name, description: body.description ?? a.description, price: body.price ?? a.price_cents / 100 });
    db.run("UPDATE addons SET name = ?, description = ?, price_cents = ? WHERE id = ?", f.name, f.description, f.price_cents, a.id);
    return manageView(getGroup(db, a.group_id));
  }, { auth: true });
  add("DELETE", "/api/addons/:aid", ({ params, user }) => {
    const a = ownedAddon(user, params.aid);
    db.run("DELETE FROM addons WHERE id = ?", a.id); // bookings keep their own copy of what was ordered
    return manageView(getGroup(db, a.group_id));
  }, { auth: true });

  // ---- custom offers: a private, custom-priced package for one customer who has messaged the group ----
  const OFFER_DAYS = 7;
  add("POST", "/api/groups/:id/offers", ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    const customerId = int(body.customerId, "customer", { min: 1 });
    if (!db.get("SELECT 1 AS x FROM messages WHERE group_id = ? AND customer_id = ? AND sender = 'customer'", g.id, customerId)) throw new HttpError(400, "You can only send offers to people who have messaged you.");
    if (db.get("SELECT COUNT(*) c FROM packages WHERE group_id = ? AND private_customer_id = ? AND expires_at > ?", g.id, customerId, now()).c >= 3) throw new HttpError(400, "That customer already has 3 open offers.");
    // Offers are shown to the customer before any booking exists, so phone numbers and emails are stripped like in chat.
    const f = packageFields({ name: maskContact(str(body.name, "Offer name", { min: 2, max: 60 })).text, description: "", hours: body.hours, price: body.price });
    const note = maskContact(str(body.note, "Note", { max: 200 })).text;
    const expires = now() + OFFER_DAYS * 86400;
    const info = db.run("INSERT INTO packages (group_id, name, description, hours, price_cents, private_customer_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", g.id, f.name, note, f.hours, f.price_cents, customerId, expires);
    const price = `$${(f.price_cents / 100).toLocaleString("en-US")}`;
    // The offer also appears in the conversation, so both sides have a record of what was promised.
    db.run("INSERT INTO messages (group_id, customer_id, sender, text, created_at) VALUES (?, ?, 'group', ?, ?)", g.id, customerId, `Custom offer: ${f.name}, ${f.hours} hr for ${price}.${note ? " " + note : ""} It's on my page under "Custom offer" for ${OFFER_DAYS} days.`, now());
    ctx.notify.to(customerId, "offer.customer", { group: g.name, offer: f.name, hours: f.hours, price, note, days: OFFER_DAYS, url: `${config.baseUrl}/#/group/${g.id}` });
    return { offer_id: Number(info.lastInsertRowid) };
  }, { auth: true });

  add("DELETE", "/api/groups/:id/offers/:pid", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    const p = db.get("SELECT id FROM packages WHERE id = ? AND group_id = ? AND private_customer_id IS NOT NULL", params.pid, g.id);
    if (!p) throw new HttpError(404, "Offer not found");
    if (db.get("SELECT 1 AS x FROM bookings WHERE package_id = ? AND status IN ('pending_payment','requested','confirmed')", p.id)) throw new HttpError(400, "The customer already booked this offer.");
    db.run("DELETE FROM packages WHERE id = ?", p.id);
    return { ok: true };
  }, { auth: true });

  add("GET", "/api/groups/:id/offers", ({ params, user }) => {
    const g = getVisibleGroup(db, params.id, user);
    return { offers: activeOffers(db, g.id, user.id) };
  }, { auth: true });

  // ---- calendar ----
  const monthDays = (month) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) throw new HttpError(400, "month must look like 2026-10");
    const [y, m] = month.split("-").map(Number);
    return Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  };

  // Public: open (still bookable) slots per day.
  add("GET", "/api/groups/:id/availability", ({ params, query, user }) => {
    getVisibleGroup(db, params.id, user);
    expirePending(db);
    const today = todayStr(), days = {};
    for (const d of monthDays(query.month)) if (d > today) { const s = openSlots(db, params.id, d, { expire: false }); if (s.length) days[d] = s; }
    return { days };
  });

  // Owner: the slots they configured, plus which are already taken.
  add("GET", "/api/groups/:id/calendar", ({ params, query, user }) => {
    requireOwner(db, user, params.id);
    expirePending(db);
    const days = {}, booked = {};
    for (const d of monthDays(query.month)) {
      const row = db.get("SELECT slots FROM availability WHERE group_id = ? AND date = ?", params.id, d);
      if (row) days[d] = safeJson(row.slots, []);
      const taken = db.all("SELECT time FROM bookings WHERE group_id = ? AND date = ? AND status IN ('pending_payment','requested','confirmed')", params.id, d);
      const held = db.all("SELECT resched_time t FROM bookings WHERE group_id = ? AND resched_date = ? AND resched_status = 'pending' AND resched_at > ? AND status IN ('requested','confirmed')", params.id, d, now() - 72 * 3600).map((r) => r.t);
      if (taken.length || held.length) booked[d] = [...taken.map((t) => t.time), ...held];
    }
    return { days, booked };
  }, { auth: true });

  add("PUT", "/api/groups/:id/availability", ({ params, body, user }) => {
    requireOwner(db, user, params.id);
    const dates = body.dates;
    if (!dates || typeof dates !== "object" || Array.isArray(dates)) throw new HttpError(400, "dates must be an object");
    const entries = Object.entries(dates);
    if (entries.length > 400) throw new HttpError(400, "Too many dates at once");
    const today = todayStr();
    db.tx(() => {
      for (const [d, slots] of entries) {
        if (!isDate(d) || d <= today || d > addDays(today, 730)) throw new HttpError(400, `Bad date: ${d}`);
        if (!Array.isArray(slots) || slots.some((s) => !SLOTS.includes(s))) throw new HttpError(400, "Bad time slot");
        const clean = SLOTS.filter((s) => slots.includes(s));
        if (clean.length) db.run("INSERT INTO availability (group_id, date, slots) VALUES (?, ?, ?) ON CONFLICT(group_id, date) DO UPDATE SET slots = excluded.slots", params.id, d, JSON.stringify(clean));
        else db.run("DELETE FROM availability WHERE group_id = ? AND date = ?", params.id, d);
      }
    });
    return { ok: true };
  }, { auth: true });

  add("POST", "/api/groups/:id/availability/weekends", ({ params, body, user }) => {
    requireOwner(db, user, params.id);
    const weeks = int(body.weeks ?? 8, "weeks", { min: 1, max: 52 });
    const today = todayStr();
    let n = 0;
    db.tx(() => {
      for (let i = 1; i <= weeks * 7; i++) {
        const d = addDays(today, i), dow = new Date(d + "T12:00:00Z").getUTCDay();
        if (dow === 5 || dow === 6 || dow === 0) {
          db.run("INSERT INTO availability (group_id, date, slots) VALUES (?, ?, ?) ON CONFLICT(group_id, date) DO UPDATE SET slots = excluded.slots", params.id, d, JSON.stringify(SLOTS));
          n++;
        }
      }
    });
    return { opened: n };
  }, { auth: true });

  add("DELETE", "/api/groups/:id/availability", ({ params, user }) => {
    requireOwner(db, user, params.id);
    db.run("DELETE FROM availability WHERE group_id = ? AND date > ?", params.id, todayStr());
    return { ok: true };
  }, { auth: true });

  // ---- photos (JSON body with base64; validated by file signature) ----
  add("POST", "/api/groups/:id/photos", ({ params, body, user, ip }) => {
    const g = requireOwner(db, user, params.id);
    if (!limiters.upload.check(`${ip}|${user.id}`)) throw new HttpError(429, "Too many uploads. Try again later.");
    const maxPhotos = g.pro_until > now() ? MAX_PHOTOS * 2 : MAX_PHOTOS; // Bella's Pro: twice the photos
    if (db.get("SELECT COUNT(*) c FROM photos WHERE group_id = ?", g.id).c >= maxPhotos) throw new HttpError(400, `At most ${maxPhotos} photos`);
    const b64 = typeof body.data === "string" ? body.data.replace(/^data:image\/[a-z+]+;base64,/i, "") : "";
    if (!b64 || b64.length > MAX_PHOTO_BYTES * 1.4) throw new HttpError(413, "Photo is too large (max 4 MB)");
    const buf = Buffer.from(b64, "base64");
    if (buf.length > MAX_PHOTO_BYTES) throw new HttpError(413, "Photo is too large (max 4 MB)");
    const kind = sniffImage(buf);
    if (!kind) throw new HttpError(400, "Only JPG, PNG or WebP photos");
    const file = `${rid(14)}.${kind.ext}`;
    fs.writeFileSync(path.join(config.uploadDir, file), buf, { flag: "wx" });
    const pos = (db.get("SELECT COALESCE(MAX(position), 0) m FROM photos WHERE group_id = ?", g.id).m || 0) + 1;
    db.run("INSERT INTO photos (id, group_id, file, position, created_at) VALUES (?, ?, ?, ?, ?)", newId("p"), g.id, file, pos, now());
    return manageView(getGroup(db, g.id));
  }, { auth: true, limit: 6_500_000 });

  const ownedPhoto = (user, gid, pid) => {
    requireOwner(db, user, gid);
    const p = db.get("SELECT * FROM photos WHERE id = ? AND group_id = ?", pid, gid);
    if (!p) throw new HttpError(404, "Photo not found");
    return p;
  };
  add("DELETE", "/api/groups/:id/photos/:pid", ({ params, user }) => {
    const p = ownedPhoto(user, params.id, params.pid);
    db.run("DELETE FROM photos WHERE id = ?", p.id);
    fs.unlink(path.join(config.uploadDir, path.basename(p.file)), () => {});
    return manageView(getGroup(db, params.id));
  }, { auth: true });
  add("POST", "/api/groups/:id/photos/:pid/cover", ({ params, user }) => {
    const p = ownedPhoto(user, params.id, params.pid);
    db.run("UPDATE photos SET position = (SELECT COALESCE(MIN(position), 1) - 1 FROM photos WHERE group_id = ?) WHERE id = ?", params.id, p.id);
    return manageView(getGroup(db, params.id));
  }, { auth: true });

  // ---- payouts (Stripe Connect Express) ----
  add("POST", "/api/groups/:id/stripe/onboard", async ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    if (!stripe.live) { db.run("UPDATE groups SET stripe_ready = 1 WHERE id = ?", g.id); return { ready: true, simulated: true }; }
    let account = g.stripe_account_id;
    if (!account) {
      account = (await stripe.createAccount(user.email)).id;
      db.run("UPDATE groups SET stripe_account_id = ? WHERE id = ?", account, g.id);
    }
    const link = await stripe.accountLink(account, `${config.baseUrl}/#/dashboard?stripe=refresh`, `${config.baseUrl}/#/dashboard?stripe=return`);
    return { url: link.url };
  }, { auth: true });

  add("POST", "/api/groups/:id/stripe/refresh", async ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    if (!stripe.live) return { ready: Boolean(g.stripe_ready) };
    if (!g.stripe_account_id) return { ready: false };
    const acct = await stripe.getAccount(g.stripe_account_id);
    const transfersOk = acct.capabilities?.transfers === undefined || acct.capabilities.transfers === "active";
    const ready = Boolean(acct.charges_enabled && acct.payouts_enabled && transfersOk);
    db.run("UPDATE groups SET stripe_ready = ? WHERE id = ?", ready ? 1 : 0, g.id);
    return { ready };
  }, { auth: true });

  // ---- paid featured placement (30 days) ----
  add("POST", "/api/groups/:id/feature", async ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    const id = newId("f");
    db.run("INSERT INTO payments_feature (id, group_id, amount_cents, created_at) VALUES (?, ?, ?, ?)", id, g.id, config.featurePriceCents, now());
    if (!stripe.live) return { id, simulated: true, url: `${config.baseUrl}/#/pay/feature/${id}`, amount_cents: config.featurePriceCents };
    const session = await stripe.checkoutForFeature({
      feature: { id, amount_cents: config.featurePriceCents }, group: g,
      successUrl: `${config.baseUrl}/#/dashboard?feature=${id}`, cancelUrl: `${config.baseUrl}/#/dashboard`
    });
    db.run("UPDATE payments_feature SET stripe_session_id = ? WHERE id = ?", session.id, id);
    return { id, url: session.url, amount_cents: config.featurePriceCents };
  }, { auth: true });

  const ownedFeature = (user, id) => {
    const f = db.get("SELECT f.*, g.owner_id FROM payments_feature f JOIN groups g ON g.id = f.group_id WHERE f.id = ?", id);
    if (!f || f.owner_id !== user.id) throw new HttpError(404, "Not found");
    return f;
  };
  add("POST", "/api/feature/:fid/simulate-pay", ({ params, user }) => {
    if (stripe.live) throw new HttpError(400, "Simulated payments are off");
    const f = ownedFeature(user, params.fid);
    markFeaturePaid(ctx, f.id);
    return { ok: true, group_id: f.group_id };
  }, { auth: true });
  add("POST", "/api/feature/:fid/refresh", async ({ params, user }) => {
    const f = ownedFeature(user, params.fid);
    if (f.status !== "paid" && stripe.live && f.stripe_session_id) {
      const s = await stripe.getCheckoutSession(f.stripe_session_id);
      if (s.payment_status === "paid") markFeaturePaid(ctx, f.id);
    }
    return { status: db.get("SELECT status FROM payments_feature WHERE id = ?", f.id).status, group_id: f.group_id };
  }, { auth: true });

}
