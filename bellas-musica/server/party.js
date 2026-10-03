import { lookupZip } from "./geo.js";
import { daysBetween, todayStr } from "./util.js";
import { CATEGORIES, categoryOf } from "./pricing.js";
import { LIVE_SQL, fromCents } from "./shared.js";

// ---- weather (National Weather Service: free, no key, about 7 days ahead) ----
const weatherCache = new Map(); // "zip|date" -> { at, value }
export async function partyWeather(config, zip, date) {
  if (!config.weatherApi) return { available: false, reason: "off" };
  const days = daysBetween(todayStr(), date);
  if (days < 0) return { available: false, reason: "past" };
  if (days > 6) return { available: false, reason: "far", days };
  const z = lookupZip(zip);
  if (!z) return { available: false, reason: "zip" };
  const key = `${zip}|${date}`, hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.value;
  const get = async (url) => {
    const res = await fetch(url, { headers: { "User-Agent": "BellasMusica (party planner)", Accept: "application/geo+json" }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error("weather " + res.status);
    return res.json();
  };
  let value;
  try {
    const point = await get(`${config.weatherApi}/points/${z.lat.toFixed(4)},${z.lon.toFixed(4)}`);
    const fc = await get(point.properties.forecast);
    const periods = (fc.properties?.periods || []).filter((p) => String(p.startTime).slice(0, 10) === date);
    const day = periods.find((p) => p.isDaytime) || periods[0];
    value = day ? {
      available: true, name: String(day.name || ""), short: String(day.shortForecast || "").slice(0, 80),
      temp: Number(day.temperature) || null, unit: day.temperatureUnit === "C" ? "C" : "F",
      rain: Number(day.probabilityOfPrecipitation?.value) || 0
    } : { available: false, reason: "nodata" };
  } catch { value = { available: false, reason: "error" }; }
  weatherCache.set(key, { at: Date.now(), value });
  if (weatherCache.size > 2000) weatherCache.delete(weatherCache.keys().next().value);
  return value;
}

// ---- price guide: what this kind of vendor usually costs here ----
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
export function priceGuide(db, category, event = "") {
  if (!CATEGORIES[category]) return null;
  // Real bookings first (paid, kept, past or upcoming), at least 5 of them.
  const booked = db.all(
    `SELECT b.total_cents, b.event_type, g.type FROM bookings b JOIN groups g ON g.id = b.group_id
     WHERE g.demo = 0 AND b.status IN ('requested','confirmed') AND b.payment_status IN ('paid','partial_refund')`
  ).filter((r) => categoryOf(r.type) === category && (!event || r.event_type === event)).map((r) => r.total_cents).sort((a, b) => a - b);
  if (booked.length >= 5) return { source: "bookings", n: booked.length, low: pct(booked, 0.25), mid: pct(booked, 0.5), high: pct(booked, 0.75) };
  // Otherwise listed prices: each package, and three hours for listings booked by the hour.
  const types = CATEGORIES[category];
  const rows = db.all(`SELECT * FROM groups WHERE ${LIVE_SQL} AND type IN (${types.map(() => "?").join(",")})`, ...types);
  const prices = [];
  for (const g of rows) {
    for (const p of db.all("SELECT price_cents FROM packages WHERE group_id = ? AND private_customer_id IS NULL", g.id)) prices.push(p.price_cents);
    if (g.hourly !== 0 && g.rate_cents) prices.push(g.rate_cents * Math.max(3, g.min_hours || 1));
  }
  prices.sort((a, b) => a - b);
  if (prices.length < 3) return null;
  return { source: "listings", n: rows.length, low: pct(prices, 0.25), mid: pct(prices, 0.5), high: pct(prices, 0.75) };
}

export { fromCents };
