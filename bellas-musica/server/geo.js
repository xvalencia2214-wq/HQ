import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Full US ZIP centroid table (zip,lat,lon,city,state), loaded once into memory.
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "zips.csv");
const zips = new Map();
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  if (!line) continue;
  const [zip, lat, lon, city, state] = line.split(",");
  zips.set(zip, { zip, lat: Number(lat), lon: Number(lon), city, state });
}

export const lookupZip = (z) => zips.get(z) || null;
export const zipCount = () => zips.size;

export function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Closest ZIP centroid to a point (used by "use my location").
export function nearestZip(lat, lon) {
  let best = null, bestD = Infinity;
  for (const z of zips.values()) {
    const d = (z.lat - lat) ** 2 + ((z.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = z; }
  }
  return best;
}
