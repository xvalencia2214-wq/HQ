// Holiday serenatas: on Mother's Day (May 10) and the Virgen de Guadalupe (December 12) a mariachi plays house after
// house, 20 or 30 minutes each. A vendor sets the special once (length, price, the hours it runs that day) and families
// book a stop like any booking; the schedule keeps the stops (and the drive between them) from overlapping.
import { HttpError, now, oneOf, safeJson, str, todayStr } from "../util.js";
import { HOLIDAYS, SHORT_MINUTES, categoryOf, holidayDate, isTime, timeMin } from "../pricing.js";
import { lookupZip, miles } from "../geo.js";
import { dollarsToCents } from "./groups.js";
import { LIVE_SQL, firstPhotos, isBookable, ratingMap, ratingOf, requireOwner } from "../shared.js";
import { cleanEntries, openTimes } from "../schedule.js";

const DEFAULT_NAME = { mothers_day: "Serenata del 10 de mayo", guadalupe: "Mañanitas a la Virgen" };

export function upcomingHolidays(db, today) {
  return Object.keys(HOLIDAYS).map((key) => {
    const date = holidayDate(key, today);
    const days = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
    const offering = db.get(`SELECT COUNT(DISTINCT p.group_id) c FROM packages p JOIN groups g ON g.id = p.group_id WHERE p.holiday = ? AND p.holiday_date = ? AND ${LIVE_SQL.replace(/\b(hidden|paused|published_at|demo)\b/g, "g.$1")}`, key, date).c;
    return { key, date, days, offering };
  });
}

export default function specialsRoutes(ctx, add) {
  const { db } = ctx;
  const specialsOf = (g) => db.all("SELECT id, name, description, minutes, hours, price_cents, holiday, holiday_date FROM packages WHERE group_id = ? AND holiday != '' AND holiday_date >= ? ORDER BY holiday_date", g.id, todayStr());

  add("GET", "/api/groups/:id/specials", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    return { specials: specialsOf(g), holidays: upcomingHolidays(db, todayStr()) };
  }, { auth: true });

  add("POST", "/api/groups/:id/specials", ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    const key = oneOf(body.holiday, "Holiday", Object.keys(HOLIDAYS));
    const date = holidayDate(key, todayStr());
    const minutes = Number(oneOf(Number(body.minutes), "Length", [...SHORT_MINUTES, 60]));
    const price = dollarsToCents(body.price, "Price", { min: 20, max: 5000 });
    if (!isTime(body.from) || !isTime(body.to) || timeMin(body.to) <= timeMin(body.from)) throw new HttpError(400, "Pick the hours you'll be out playing that day");
    const name = str(body.name, "Name", { max: 60 }) || DEFAULT_NAME[key];
    const description = str(body.description, "Description", { max: 200 });
    db.tx(() => {
      // one special per holiday: setting it again replaces it
      db.run("DELETE FROM packages WHERE group_id = ? AND holiday = ? AND holiday_date = ?", g.id, key, date);
      db.run("INSERT INTO packages (group_id, name, description, hours, minutes, price_cents, holiday, holiday_date) VALUES (?, ?, ?, 1, ?, ?, ?, ?)",
        g.id, name, description, minutes === 60 ? 0 : minutes, price, key, date);
      const row = db.get("SELECT slots FROM availability WHERE group_id = ? AND date = ?", g.id, date);
      const entries = cleanEntries([...safeJson(row?.slots, []), `${body.from}-${body.to}`]);
      db.run("INSERT INTO availability (group_id, date, slots) VALUES (?, ?, ?) ON CONFLICT(group_id, date) DO UPDATE SET slots = excluded.slots", g.id, date, JSON.stringify(entries));
    });
    return { specials: specialsOf(g), holidays: upcomingHolidays(db, todayStr()) };
  }, { auth: true });

  // Public: who plays serenatas on the holiday, nearest first, with how many times are still open.
  add("GET", "/api/specials/:holiday", ({ params, query }) => {
    const key = oneOf(params.holiday, "Holiday", Object.keys(HOLIDAYS));
    const date = holidayDate(key, todayStr());
    const z = query.zip && lookupZip(String(query.zip)), photos = firstPhotos(db), ratings = ratingMap(db);
    const rows = db.all(`SELECT g.*, p.id AS pkg_id, p.name AS pkg_name, p.description AS pkg_desc, p.minutes AS pkg_minutes, p.hours AS pkg_hours, p.price_cents AS pkg_price
      FROM packages p JOIN groups g ON g.id = p.group_id WHERE p.holiday = ? AND p.holiday_date = ? AND ${LIVE_SQL.replace(/\b(hidden|paused|published_at|demo)\b/g, "g.$1")}`, key, date);
    const vendors = rows.filter((g) => isBookable(ctx, g)).map((g) => {
      const minutes = g.pkg_minutes > 0 ? g.pkg_minutes : g.pkg_hours * 60, r = ratingOf(g, ratings), gz = lookupZip(g.zip);
      const times = openTimes(db, g, date, { minutes });
      return {
        id: g.id, name: g.name, type: g.type, category: categoryOf(g.type), city: gz?.city || "", photo: photos.has(g.id) ? "/uploads/" + photos.get(g.id) : null,
        rating: Math.round(r.rating * 10) / 10, reviews: r.reviews, distance: z && gz ? Math.round(miles(z, gz)) : null,
        special: { id: g.pkg_id, name: g.pkg_name, description: g.pkg_desc, minutes, price_cents: g.pkg_price }, open: times.length, first: times[0] || "", last: times[times.length - 1] || ""
      };
    }).sort((a, b) => (b.open > 0) - (a.open > 0) || (a.distance ?? 9999) - (b.distance ?? 9999));
    return { holiday: key, date, vendors };
  });
}
