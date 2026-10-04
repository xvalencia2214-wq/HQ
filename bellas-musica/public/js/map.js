import { esc, money } from "./ui.js";
import { t } from "./i18n.js";

let instance = null;
export function killMap() { if (instance) { instance.remove(); instance = null; } }

// Pins are nudged so groups in the same ZIP don't stack, and they show the area, not an address.
function jitter(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  return { lat: ((h % 1000) / 1000 - 0.5) * 0.06, lon: (((h >> 10) % 1000) / 1000 - 0.5) * 0.06 };
}

export function drawMap(box, list, origin) {
  const L = window.L;
  if (!L) { box.innerHTML = `<div class="empty">${esc(t("map.fail"))}</div>`; return; }
  L.Icon.Default.imagePath = "vendor/leaflet/images/";
  instance = L.map(box, { scrollWheelZoom: false });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(instance);
  const bounds = [[origin.lat, origin.lon]];
  L.circleMarker([origin.lat, origin.lon], { radius: 9, color: "#ffffff", weight: 3, fillColor: "#2a5ff5", fillOpacity: 1 }).addTo(instance).bindTooltip(t("map.you"));
  list.forEach((g, i) => {
    const j = jitter(g.id), pos = [g.lat + j.lat, g.lon + j.lon];
    bounds.push(pos);
    L.marker(pos, { title: g.name }).addTo(instance).bindPopup(
      `<strong>#${i + 1} ${esc(g.name)}</strong><br>${esc(g.type)} · ${esc(t("card.from", { price: money(g.from_cents) }))}<br><a href="#/group/${esc(g.id)}">${esc(t("card.book"))}</a>`);
  });
  instance.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
}
