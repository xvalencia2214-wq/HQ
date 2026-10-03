import { HttpError, addDays, todayStr, getTimezone } from "./util.js";
import { parseTime } from "./ics.js";

// ---- reading a vendor's own calendar (Google, Apple, Outlook all give a private "iCal / .ics" link) ----
// Every busy event becomes a busy time on our calendar for that date. Supported: timed events (UTC "Z" or local time),
// all-day events, cancelled/free events skipped. Repeating events (RRULE) are only counted on their first date.

const unfold = (text) => text.replace(/\r?\n[ \t]/g, "");
// "20261024T190000Z" / "20261024T190000" / "20261024" -> { date, min, allDay }
function parseStamp(value, params, tz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, , z] = m;
  if (hh === undefined || /VALUE=DATE(?!-)/i.test(params)) return { date: `${y}-${mo}-${d}`, min: 0, allDay: true };
  if (z) { // UTC: convert to the business time zone
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm));
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(dt).map((p) => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute), allDay: false };
  }
  return { date: `${y}-${mo}-${d}`, min: Number(hh) * 60 + Number(mm), allDay: false }; // local / TZID time: taken as wall-clock time here
}

export function parseBusy(text, { tz = getTimezone(), from = todayStr(), days = 400 } = {}) {
  const until = addDays(from, days);
  const out = [];
  for (const block of unfold(String(text)).split(/BEGIN:VEVENT/i).slice(1)) {
    const body = block.split(/END:VEVENT/i)[0];
    const prop = (name) => { const m = new RegExp(`^${name}((?:;[^:\\r\\n]*)?):(.*)$`, "im").exec(body); return m ? { params: m[1] || "", value: m[2].trim() } : null; };
    if (/^STATUS:CANCELLED/im.test(body) || /^TRANSP:TRANSPARENT/im.test(body)) continue;
    const s = prop("DTSTART"); if (!s) continue;
    const start = parseStamp(s.value, s.params, tz); if (!start) continue;
    const e = prop("DTEND");
    let end = e ? parseStamp(e.value, e.params, tz) : null;
    if (!end) { const dur = prop("DURATION"); const dm = dur && /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(dur.value); end = dm && !start.allDay ? (() => { const total = start.min + (+dm[1] || 0) * 1440 + (+dm[2] || 0) * 60 + (+dm[3] || 0); return { date: addDays(start.date, Math.floor(total / 1440)), min: total % 1440, allDay: false }; })() : null; }
    if (start.allDay) {
      const last = end && end.allDay ? addDays(end.date, -1) : start.date; // DTEND of an all-day event is the day after
      for (let d = start.date, n = 0; d <= last && n < 60; d = addDays(d, 1), n++) if (d >= from && d <= until) out.push({ date: d, start: 0, end: 1440 });
      continue;
    }
    if (!end) end = { date: start.date, min: Math.min(1440, start.min + 60) };
    // split across midnight
    for (let d = start.date, n = 0; d <= end.date && n < 14; d = addDays(d, 1), n++) {
      const a = d === start.date ? start.min : 0, b = d === end.date ? end.min : 1440;
      if (b > a && d >= from && d <= until) out.push({ date: d, start: a, end: b });
    }
  }
  return out.slice(0, 5000);
}

// Only fetch public https calendars (no local or private network addresses), small and quick.
export function checkCalendarUrl(raw, { allowHttp = false } = {}) {
  let u;
  const fixed = String(raw || "").trim().replace(/^webcal:\/\//i, "https://");
  try { u = new URL(fixed); } catch { throw new HttpError(400, "Paste the private iCal link from your calendar's settings"); }
  if (!(u.protocol === "https:" || (allowHttp && u.protocol === "http:"))) throw new HttpError(400, "The calendar link must start with https://");
  const h = u.hostname.toLowerCase();
  if (!allowHttp && (h === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h.endsWith(".local") || h.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(h))) throw new HttpError(400, "That calendar address isn't allowed");
  return u.toString();
}

export async function fetchCalendar(url) {
  const res = await fetch(url, { headers: { "User-Agent": "BellasMusica calendar sync", Accept: "text/calendar" }, redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`the calendar answered ${res.status}`);
  const text = await res.text();
  if (text.length > 3_000_000) throw new Error("the calendar file is too big");
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("that link isn't an iCal calendar");
  return text;
}

export async function syncCalendar(ctx, g) {
  const { db, config } = ctx;
  try {
    const busy = parseBusy(await fetchCalendar(checkCalendarUrl(g.ical_import_url, { allowHttp: config.icsAllowHttp })));
    db.tx(() => {
      db.run("DELETE FROM ext_busy WHERE group_id = ?", g.id);
      for (const b of busy) db.run("INSERT INTO ext_busy (group_id, date, start_min, end_min) VALUES (?, ?, ?, ?)", g.id, b.date, b.start, b.end);
      db.run("UPDATE groups SET ical_synced_at = ?, ical_error = '' WHERE id = ?", Math.floor(Date.now() / 1000), g.id);
    });
    return { busy: busy.length };
  } catch (e) {
    db.run("UPDATE groups SET ical_error = ? WHERE id = ?", String(e.message || e).slice(0, 160), g.id);
    return { error: String(e.message || e) };
  }
}

// ---- the vendor's bookings as a calendar feed (subscribe to it in Google Calendar) ----
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const p2 = (n) => String(n).padStart(2, "0");
const local = (d) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00`;
function fold(line) {
  const out = []; let cur = "", bytes = 0;
  for (const ch of line) { const b = Buffer.byteLength(ch); if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; } cur += ch; bytes += b; }
  out.push(cur); return out.join("\r\n ");
}
export function bookingsFeed(groupName, bookings) {
  const now = new Date();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bella's Musica//Vendor feed//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc("Bella's Música: " + groupName)}`];
  for (const b of bookings) {
    const [h, m] = parseTime(b.time), [y, mo, d] = b.date.split("-").map(Number);
    const start = new Date(Date.UTC(y, mo - 1, d, h, m)), end = new Date(start.getTime() + (b.duration_min > 0 ? b.duration_min : b.hours * 60) * 60_000);
    lines.push("BEGIN:VEVENT", `UID:${b.id}@bellasmusica`, `DTSTAMP:${local(now)}Z`, `DTSTART:${local(start)}`, `DTEND:${local(end)}`,
      `SUMMARY:${esc(`${b.event_type} for ${b.name}`)}`, `LOCATION:${esc(b.status === "confirmed" ? b.address : "")}`,
      `DESCRIPTION:${esc(`${b.guests} guests. ${b.status === "confirmed" ? "Confirmed." : "Waiting for your answer in the app."}`)}`, `STATUS:${b.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
