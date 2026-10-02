import { HttpError, addDays, int, isDate, isZip, now, oneOf, rid, safeJson, str, todayStr } from "../util.js";
import { EVENT_TYPES } from "../pricing.js";
import { lookupZip, miles, zipsWithin } from "../geo.js";
import { maskContact } from "./messages.js";
import { LIVE_SQL, activeOffers, isBookable, openSlots, ratingMap, ratingOf } from "../shared.js";

const MAX_GROUPS = 5;       // an event goes to at most this many groups
const RADIUS = 60;          // miles from the event ZIP
const MAX_PER_DAY = 3;      // new requests per customer per day
const BUDGET_SLACK = 1.5;   // a group up to 50% over the stated maximum can still be worth asking (they may have a smaller option)
// Group size the customer would like, as a range of musicians; and how far along the planning is (told to the group).
const SIZES = { "solo-duo": [1, 2], trio: [3, 3], small: [4, 6], large: [7, 99] };
const SIZE_TEXT = { "solo-duo": "a solo or duo", trio: "a trio", small: "4 to 6 musicians", large: "7 or more musicians" };
const STAGES = { "just-looking": "just looking", comparing: "comparing options", ready: "ready to book" };
const SLOTS_LIST = ["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"];

// "Get quotes". Unlike a blanket lead blast, a request goes only to groups that really can do the job: live, claimed,
// free that day, play that kind of event, fit the guest count and are in range. Groups never pay for it.
export default function requestRoutes(ctx, add) {
  const { db, config, limiters } = ctx;
  const EVENT_FIT_ANY = (events, event) => !events.length || events.includes(event);

  function matches({ event, date, guests, zip, customerId, time, size, budgetMax, hours }) {
    const origin = lookupZip(zip);
    const nearby = zipsWithin(origin, RADIUS);
    if (!nearby.length) return [];
    const ratings = ratingMap(db);
    const cheapest = new Map(db.all("SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL GROUP BY group_id").map((r) => [r.group_id, r.m]));
    const out = [];
    for (const g of db.all(`SELECT * FROM groups WHERE ${LIVE_SQL} AND zip IN (${nearby.map(() => "?").join(",")})`, ...nearby)) {
      if (g.owner_id === customerId) continue;
      if (!g.demo && !g.owner_id) continue;              // an unclaimed invitation has nobody to answer
      if (!isBookable(ctx, g)) continue;
      if (g.max_guests < guests) continue;
      if (!EVENT_FIT_ANY(safeJson(g.events, []), event)) continue;
      if (!openSlots(db, g.id, date).length) continue;   // free that day
      const z = lookupZip(g.zip);
      const d = z ? miles(origin, z) : 999;
      if (d > RADIUS) continue;
      // A budget is a promise not to waste a group's time: skip groups whose cheapest way to do this event is far above it.
      if (budgetMax) { const least = Math.min(cheapest.get(g.id) ?? Infinity, g.rate_cents * hours); if (least > budgetMax * 100 * BUDGET_SLACK) continue; }
      const r = ratingOf(g, ratings);
      // Prefer proven, close groups; a bonus for being free at the asked start time and for the right group size.
      const sizeFit = !size || (SIZES[size] && g.members >= SIZES[size][0] && g.members <= SIZES[size][1]);
      const timeFit = time && openSlots(db, g.id, date).includes(time);
      out.push({ g, d, score: (r.rating || 4.2) * 10 - d * 0.15 + (g.verified ? 3 : 0) + (timeFit ? 5 : 0) + (size && sizeFit ? 3 : 0) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, MAX_GROUPS);
  }

  add("POST", "/api/requests", ({ body, user }) => {
    if (!limiters.booking.check(`req|${user.id}`)) throw new HttpError(429, "Too many requests. Try again later.");
    const event = oneOf(body.event, "Event type", EVENT_TYPES);
    const date = body.date;
    if (!isDate(date) || date <= todayStr() || date > addDays(todayStr(), 730)) throw new HttpError(400, "Pick a future date");
    const guests = int(body.guests, "Guests", { min: 1, max: 5000 });
    const hours = int(body.hours, "Hours", { min: 1, max: 12 });
    const zip = str(body.zip, "Event ZIP", { required: true, max: 5 });
    if (!isZip(zip) || !lookupZip(zip)) throw new HttpError(400, "Enter the event's 5-digit ZIP code");
    const note = maskContact(str(body.note, "Note", { max: 300 })).text;
    // Optional extras. An empty value means "not sure yet".
    const time = body.time ? oneOf(body.time, "Start time", SLOTS_LIST) : "";
    const size = body.size ? oneOf(body.size, "Group size", Object.keys(SIZES)) : "";
    const stage = body.stage ? oneOf(body.stage, "Planning stage", Object.keys(STAGES)) : "";
    const budgetMin = body.budgetMin === undefined || body.budgetMin === "" || body.budgetMin === null ? 0 : int(body.budgetMin, "Minimum budget", { min: 0, max: 100000 });
    const budgetMax = body.budgetMax === undefined || body.budgetMax === "" || body.budgetMax === null ? 0 : int(body.budgetMax, "Maximum budget", { min: 0, max: 100000 });
    if (budgetMax && budgetMin > budgetMax) throw new HttpError(400, "Your minimum budget is above your maximum.");
    const since = now() - 86400;
    if (db.get("SELECT COUNT(*) c FROM event_requests WHERE customer_id = ? AND created_at > ?", user.id, since).c >= MAX_PER_DAY) throw new HttpError(429, `You can send ${MAX_PER_DAY} event requests a day. Check your quotes page for replies.`);

    const picked = matches({ event, date, guests, zip, customerId: user.id, time, size, budgetMax, hours });
    if (!picked.length) return { id: null, sent: 0, groups: [] }; // nothing sent, nothing stored: the page offers a wider search instead
    const id = rid(9);
    const place = lookupZip(zip);
    const budget = budgetMax ? (budgetMin ? ` Budget $${budgetMin} to $${budgetMax}.` : ` Budget up to $${budgetMax}.`) : budgetMin ? ` Budget from $${budgetMin}.` : "";
    const text = `Event request: ${event} on ${date}${time ? " at " + time : ""}, about ${guests} guests, ${hours} hr, near ${place.city}, ${place.state}.${size ? ` Looking for ${SIZE_TEXT[size]}.` : ""}${budget}${stage ? ` Planning: ${STAGES[stage]}.` : ""}${note ? " " + note : ""} Could you send me a price?`;
    db.tx(() => {
      db.run("INSERT INTO event_requests (id, customer_id, event, date, guests, hours, zip, note, created_at, start_time, budget_min, budget_max, stage, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, user.id, event, date, guests, hours, zip, note, now(), time, budgetMin, budgetMax, stage, size);
      for (const { g } of picked) {
        db.run("INSERT INTO event_request_groups (request_id, group_id) VALUES (?, ?)", id, g.id);
        db.run("INSERT INTO messages (group_id, customer_id, sender, text, created_at) VALUES (?, ?, 'customer', ?, ?)", g.id, user.id, text, now());
        if (g.demo) db.run("INSERT INTO messages (group_id, customer_id, sender, text, created_at) VALUES (?, ?, 'group', ?, ?)", g.id, user.id, "Thanks for reaching out! (This is a sample listing, so this is an automatic reply. Real groups answer here themselves.)", now());
      }
    });
    for (const { g } of picked) {
      if (g.owner_id) ctx.notify.to(g.owner_id, "request.group", { group: g.name, event, date, guests: String(guests), url: `${config.baseUrl}/#/dashboard?g=${g.id}&tab=messages` }, { phone: g.contact_phone });
    }
    ctx.stats.count("event_request", zip);
    return { id, sent: picked.length, groups: picked.map(({ g }) => ({ id: g.id, name: g.name })) };
  }, { auth: true });

  // Each request with who it went to, who has answered, and any private offer they made.
  add("GET", "/api/my/requests", ({ user }) => {
    const reqs = db.all("SELECT * FROM event_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20", user.id);
    return {
      requests: reqs.map((r) => ({
        id: r.id, event: r.event, date: r.date, guests: r.guests, hours: r.hours, zip: r.zip, created_at: r.created_at, past: r.date <= todayStr(),
        groups: db.all(`SELECT g.id, g.name, g.type FROM event_request_groups x JOIN groups g ON g.id = x.group_id WHERE x.request_id = ?`, r.id).map((g) => {
          const reply = db.get("SELECT MIN(created_at) t FROM messages WHERE group_id = ? AND customer_id = ? AND sender = 'group' AND created_at >= ?", g.id, user.id, r.created_at).t;
          const live = db.get(`SELECT 1 AS x FROM groups WHERE id = ? AND ${LIVE_SQL}`, g.id);
          return { id: g.id, name: g.name, type: g.type, live: Boolean(live), replied: Boolean(reply), reply_minutes: reply ? Math.max(1, Math.round((reply - r.created_at) / 60)) : null, offers: live ? activeOffers(db, g.id, user.id) : [] };
        })
      }))
    };
  }, { auth: true });
}
