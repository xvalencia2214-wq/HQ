// Minimal, strict iCalendar (RFC 5545) writer for a single booking.
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 bytes must be folded; continuation lines start with one space.
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const p2 = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}`;

export function parseTime(t) { // "2:00 PM" -> [14, 0]
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(t);
  if (!m) return [12, 0];
  return [(Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0), Number(m[2])];
}

// Times are "floating" (no time zone): the event is at that wall-clock time wherever the person is.
export function bookingToIcs({ id, date, time, hours, summary, location, description, status }) {
  const [h, m] = parseTime(time);
  const [y, mo, d] = date.split("-").map(Number);
  const start = new Date(Date.UTC(y, mo - 1, d, h, m)), end = new Date(start.getTime() + hours * 3600_000);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bella's Musica//Booking//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${id}@bellasmusica`, `DTSTAMP:${stamp(new Date())}Z`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(summary)}`, `LOCATION:${esc(location)}`, `DESCRIPTION:${esc(description)}`,
    `STATUS:${status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Tomorrow", "TRIGGER:-P1D", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
