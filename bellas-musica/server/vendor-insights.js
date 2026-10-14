// What a vendor sees first on its dashboard: today at a glance, and how its price compares with others nearby.
import { todayStr, addDays } from "./util.js";
import { balanceLeft, timeMin } from "./pricing.js";
import { ANSWER_HOURS } from "./jobs.js";
import { LIVE_SQL, cartTransferCents, fromCents } from "./shared.js";
import { lookupZip, miles, zipsWithin } from "./geo.js";

// The "Today" box: the next gig, requests waiting (and the first deadline), unread messages, money still to come.
export function todayBox(db, g, unread) {
  const today = todayStr();
  const firstDay = db.get("SELECT MIN(date) d FROM bookings WHERE group_id = ? AND status = 'confirmed' AND date >= ?", g.id, today).d;
  const next = firstDay ? db.all("SELECT id, date, time, event_type, guests, name FROM bookings WHERE group_id = ? AND status = 'confirmed' AND date = ?", g.id, firstDay)
    .sort((a, b) => timeMin(a.time) - timeMin(b.time))[0] : null;
  const waiting = db.all("SELECT created_at, date FROM bookings WHERE group_id = ? AND status = 'requested'", g.id);
  // the same deadline the request card shows (then it's cancelled and refunded)
  const answerBy = waiting.length ? Math.min(...waiting.map((b) => Math.min(b.created_at + ANSWER_HOURS * 3600, Math.floor(Date.parse(b.date + "T05:00:00Z") / 1000)))) : 0;
  const upcoming = db.all("SELECT * FROM bookings WHERE group_id = ? AND status = 'confirmed' AND date >= ?", g.id, today);
  const toCollect = upcoming.reduce((s, b) => s + balanceLeft(b), 0); // balances still owed at the parties
  const held = db.all("SELECT * FROM bookings WHERE group_id = ? AND payout_hold = 1 AND payout_released_at = 0 AND payment_status IN ('paid','partial_refund') AND status IN ('requested','confirmed')", g.id)
    .reduce((s, b) => s + cartTransferCents(b), 0); // a new vendor's deposits, sent after check-in
  return {
    next_gig: next ? { id: next.id, date: next.date, time: next.time, event: next.event_type, guests: next.guests, customer: String(next.name).split(" ")[0] } : null,
    requests_waiting: waiting.length, answer_by: answerBy, unread_messages: unread,
    gigs_30d: upcoming.filter((b) => b.date <= addDays(today, 30)).length, to_collect_cents: toCollect, held_cents: held
  };
}

// "Mariachis near you usually start at $X–$Y": the middle half of real, live listings of the same type within 30 miles.
// Needs 3 others to say anything; sample listings never count (their prices are made up).
export function priceInsight(db, g) {
  const origin = lookupZip(g.zip);
  if (!origin) return null;
  const nearby = zipsWithin(origin, 30);
  if (!nearby.length) return null;
  const rows = db.all(`SELECT * FROM groups WHERE ${LIVE_SQL} AND demo = 0 AND type = ? AND id != ? AND zip IN (${nearby.map(() => "?").join(",")})`, g.type, g.id, ...nearby)
    .filter((x) => { const z = lookupZip(x.zip); return z && miles(origin, z) <= 30; });
  if (rows.length < 3) return null;
  const ids = [g.id, ...rows.map((x) => x.id)];
  const minPrice = new Map(db.all(`SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL AND group_id IN (${ids.map(() => "?").join(",")}) GROUP BY group_id`, ...ids).map((r) => [r.group_id, r.m]));
  const prices = rows.map((x) => fromCents(x, minPrice)).filter((c) => c > 0).sort((a, b) => a - b);
  if (prices.length < 3) return null;
  const pos = (q) => q * (prices.length - 1); // the low end rounds down and the high end up, so a short list shows its whole middle
  return { type: g.type, count: prices.length, low_cents: prices[Math.floor(pos(0.25))], median_cents: prices[Math.round(pos(0.5))], high_cents: prices[Math.ceil(pos(0.75))], yours_cents: fromCents(g, minPrice) };
}
