// When a listing can start a booking. A vendor opens start times per date, either one by one ("2:00 PM") or as a window
// ("5:00 AM-11:00 PM": any start in between, every 30 minutes). A booking takes [start, start + its length + the vendor's travel
// time) and a listing can serve `capacity` bookings at once (trucks, crews, lineups). Busy times from the vendor's own
// calendar and pending date changes count too. Bookings late the night before (or early the next morning) are included,
// so an 11 PM gig that runs past midnight blocks a 12:30 AM serenata.
import { HttpError, addDays, now, safeJson } from "./util.js";
import { MAX_CAPACITY, isTime, timeLabel, timeMin } from "./pricing.js";

const ACTIVE = "('pending_payment','requested','confirmed')";
export const RESCHED_TTL = 72 * 3600; // a reschedule request the group ignores lapses after 3 days, releasing the time it held
export const WINDOW_STEP = 30;
const MAX_ENTRIES = 40;

// ---- availability entries ----
const parseEntry = (e) => {
  if (typeof e !== "string") return null;
  const parts = e.split("-");
  if (parts.length === 1) return isTime(e) ? { from: timeMin(e), to: timeMin(e) } : null;
  if (parts.length !== 2 || !isTime(parts[0]) || !isTime(parts[1])) return null;
  const from = timeMin(parts[0]), to = timeMin(parts[1]);
  return from < to ? { from, to } : null;
};
// Validate and tidy one day's entries (sorted, no duplicates). Throws on anything that isn't a time or a window.
export function cleanEntries(list) {
  if (!Array.isArray(list) || list.length > MAX_ENTRIES) throw new HttpError(400, "Bad time slot");
  const out = [];
  for (const e of list) {
    const p = parseEntry(e);
    if (!p) throw new HttpError(400, "Bad time slot");
    const label = p.from === p.to ? timeLabel(p.from) : `${timeLabel(p.from)}-${timeLabel(p.to)}`;
    if (!out.some((x) => x.label === label)) out.push({ ...p, label });
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to).map((x) => x.label);
}
// Every start time (minutes after midnight) a day's entries allow.
export function startMinutes(entries) {
  const set = new Set();
  for (const e of entries || []) {
    const p = parseEntry(e);
    if (!p) continue;
    if (p.from === p.to) set.add(p.from);
    else for (let m = p.from; m <= p.to; m += WINDOW_STEP) set.add(m);
  }
  return [...set].sort((a, b) => a - b);
}

// ---- lengths ----
export const durationOf = (b) => (b.duration_min > 0 ? b.duration_min : Math.max(1, b.hours || 1) * 60);
export const packageMinutes = (p) => (p.minutes > 0 ? p.minutes : p.hours * 60);
// The shortest thing a customer can book with this listing: what the calendar shows as open before they pick a length.
export function shortestMinutes(db, g) {
  const opts = db.all("SELECT hours, minutes FROM packages WHERE group_id = ? AND private_customer_id IS NULL", g.id).map(packageMinutes);
  if (g.hourly) opts.push((g.min_hours || 1) * 60);
  return opts.length ? Math.min(...opts) : 60;
}
export const capacityOf = (g) => Math.min(MAX_CAPACITY, Math.max(1, g.capacity || 1));

// ---- what is already taken ----
export function busyIntervals(db, g, date, { exceptId = "" } = {}) {
  const buffer = Math.max(0, g.buffer_min || 0), out = [];
  const near = [[addDays(date, -1), -1440], [date, 0], [addDays(date, 1), 1440]];
  for (const [d, shift] of near) {
    for (const b of db.all(`SELECT id, time, hours, duration_min FROM bookings WHERE group_id = ? AND date = ? AND status IN ${ACTIVE} AND id != ?`, g.id, d, exceptId)) {
      const s = timeMin(b.time) + shift;
      out.push({ s, e: s + durationOf(b) + buffer });
    }
    // a customer's pending request to move here holds the time until the vendor answers
    for (const b of db.all(`SELECT id, resched_time, hours, duration_min FROM bookings WHERE group_id = ? AND resched_date = ? AND resched_status = 'pending' AND resched_at > ? AND status IN ('requested','confirmed') AND id != ?`, g.id, d, now() - RESCHED_TTL, exceptId)) {
      const s = timeMin(b.resched_time) + shift;
      out.push({ s, e: s + durationOf(b) + buffer });
    }
    for (const x of db.all("SELECT start_min, end_min FROM ext_busy WHERE group_id = ? AND date = ?", g.id, d)) out.push({ s: x.start_min + shift, e: x.end_min + shift });
  }
  return out;
}
// Can one more booking run from s to e when these are already taken and `cap` can run at the same time?
export function fits(intervals, s, e, cap) {
  const over = intervals.filter((iv) => iv.s < e && iv.e > s);
  if (over.length < cap) return true;
  const points = [s, ...over.map((iv) => iv.s).filter((x) => x > s && x < e)];
  return points.every((t) => over.filter((iv) => iv.s <= t && iv.e > t).length < cap);
}

const dayEntries = (db, groupId, date) => {
  const row = db.get("SELECT slots FROM availability WHERE group_id = ? AND date = ?", groupId, date);
  return row ? safeJson(row.slots, []) : [];
};
export const openEntries = dayEntries;

// The start times (labels) still open on a date for a booking of `minutes` (default: the shortest the listing sells).
export function openTimes(db, g, date, { minutes } = {}) {
  const starts = startMinutes(dayEntries(db, g.id, date));
  if (!starts.length) return [];
  const len = (minutes > 0 ? minutes : shortestMinutes(db, g)) + Math.max(0, g.buffer_min || 0);
  const busy = busyIntervals(db, g, date), cap = capacityOf(g);
  return starts.filter((m) => fits(busy, m, m + len, cap)).map(timeLabel);
}
// Is `time` one of the vendor's start times that day, and does a booking of `minutes` fit there?
export function checkStart(db, g, date, time, minutes, { exceptId = "", ignoreCalendar = false } = {}) {
  const m = timeMin(time);
  if (m < 0) return { listed: false, fits: false };
  const listed = ignoreCalendar || startMinutes(dayEntries(db, g.id, date)).includes(m);
  const ok = fits(busyIntervals(db, g, date, { exceptId }), m, m + minutes + Math.max(0, g.buffer_min || 0), capacityOf(g));
  return { listed, fits: ok };
}
// The same as an error, for booking, moving and paying late.
export function assertStart(db, g, date, time, minutes, opts = {}) {
  const r = checkStart(db, g, date, time, minutes, opts);
  if (!r.listed) throw new HttpError(409, "That time isn't available");
  if (!r.fits) throw new HttpError(409, minutes >= 60 && minutes % 60 === 0
    ? `That time is taken for ${minutes / 60} hour${minutes === 60 ? "" : "s"}. Pick another time or a shorter booking.`
    : `That time is taken for ${minutes} minutes. Pick another time.`);
}

// The most bookings this listing already has running at the same moment, from today on (so lowering `capacity` below
// it is refused instead of leaving two bookings on top of each other).
export function peakLoad(db, g, fromDate) {
  const iv = db.all(`SELECT date, time, hours, duration_min FROM bookings WHERE group_id = ? AND date >= ? AND status IN ${ACTIVE}`, g.id, addDays(fromDate, -1))
    .map((b) => { const s = Date.parse(b.date + "T00:00:00Z") / 60000 + timeMin(b.time); return { s, e: s + durationOf(b) }; });
  let peak = 0;
  for (const a of iv) peak = Math.max(peak, iv.filter((x) => x.s <= a.s && x.e > a.s).length);
  return peak;
}
