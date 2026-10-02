import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, money, sel, tomorrowKey, groupPhoto, shareButtons, wireShare, toast } from "../ui.js";
import { drawMap } from "../map.js";
import { waitlistBox } from "./waitlist.js";
import { heart, loadFavs, wireHearts } from "../fav.js";

const FIELDS = ["zip", "event", "date", "guests", "song", "type", "max", "sort", "radius"];

// What the customer already told us, carried into the group page so they don't have to type it twice.
const carry = (p) => new URLSearchParams(Object.entries({ event: p.event, guests: p.guests, date: p.date, zip: p.zip }).filter(([, v]) => v)).toString();

export function groupCard(g, i, ctx = "") {
  const tags = [];
  if (g.promoted) tags.push(`<span class="feat">${esc(t("card.featured"))}</span>`);
  if (g.demo) tags.push(`<span class="tag sample">${esc(t("card.sample"))}</span>`);
  if (g.events_done) tags.push(`<span class="tag trust">${esc(g.events_done === 1 ? t("card.doneOne") : t("card.done", { n: g.events_done }))}</span>`);
  if (g.min_hours > 1) tags.push(`<span class="tag">${esc(t("g.minHours", { n: g.min_hours }))}</span>`);
  if (g.verified) tags.push(`<span class="tag trust" title="${esc(t("badge.verifiedTip"))}">✓ ${esc(t("badge.verified"))}</span>`);
  if (g.insured) tags.push(`<span class="tag trust" title="${esc(t("badge.insuredTip"))}">🛡 ${esc(t("badge.insured"))}</span>`);
  const href = `#/group/${esc(g.id)}${ctx ? "?" + esc(ctx) : ""}`;
  return `<article class="card">${i != null ? `<span class="rank">#${i + 1}</span>` : ""}${groupPhoto(g)}${heart(g.id, "on-card")}
    <h3>${esc(g.name)}</h3>
    <div class="meta">${g.reviews ? `<span class="stars">★ ${g.rating.toFixed(1)}</span><span>(${g.reviews})</span>` : `<span class="stars">★ ${esc(t("card.new"))}</span>`}<span class="tag">${esc(t("type." + g.type))}</span>${tags.join("")}</div>
    <div class="meta"><span class="price">${esc(t("card.from", { price: money(g.from_cents) }))}</span>${g.distance_miles == null ? "" : `<span>${esc(g.distance_miles < 1 ? t("card.nearby") : t("card.away", { n: g.distance_miles }))}</span>`}<span>${esc(t("card.members", { n: g.members }))}</span></div>
    ${g.fits_event ? `<div class="fit">✓ ${esc(t("card.fits"))}</div>` : ""}
    ${g.matched_songs?.length ? `<div class="fit">♪ ${esc(t("card.plays"))}: ${esc(g.matched_songs.join(", "))}</div>` : ""}
    ${g.open_slots?.length ? `<div class="fit">📅 ${esc(t("card.open"))}: ${esc(g.open_slots.join(", "))}</div>` : ""}
    <p>${esc(g.story)}</p>
    <a class="btn" href="${href}">${esc(t("card.book"))}</a>
    ${shareButtons(g.name, "#/group/" + g.id)}
  </article>`;
}

export async function home(app, params) {
  const p = Object.fromEntries(params);
  const view = p.view === "map" ? "map" : "list";
  const meta = state.meta;
  const moreOpen = ["song", "type", "max", "radius"].some((k) => p[k]) || (p.sort && p.sort !== "rating");

  app.innerHTML = `<section class="hero"><img class="hero-logo" src="logo.svg" alt="" width="84" height="84"><h1>${esc(t("home.title"))}</h1><p>${esc(t("home.sub"))}</p>
    <form class="search" id="sform">
      <div class="row"><div><label for="s-zip">${esc(t("f.zip"))}</label><input id="s-zip" inputmode="numeric" maxlength="5" pattern="\\d{5}" required placeholder="60608" value="${esc(p.zip || "")}" autocomplete="postal-code">
        ${navigator.geolocation ? `<button type="button" class="locate" id="locate">${esc(t("f.locate"))}</button>` : ""}</div>
      <div><label for="s-event">${esc(t("f.event"))}</label><select id="s-event"><option value="">${esc(t("f.anyEvent"))}</option>${meta.events.map((e) => `<option value="${esc(e)}"${sel(e, p.event)}>${esc(t("event." + e))}</option>`).join("")}</select></div></div>
      <div class="row"><div><label for="s-date">${esc(t("f.date"))}</label><input id="s-date" type="date" min="${tomorrowKey()}" value="${esc(p.date || "")}"></div>
      <div><label for="s-guests">${esc(t("f.guests"))}</label><input id="s-guests" type="number" min="1" max="5000" inputmode="numeric" placeholder="100" value="${esc(p.guests || "")}"></div></div>
      <details class="more"${moreOpen ? " open" : ""}><summary>${esc(t("f.more"))}</summary>
        <div class="row"><div><label for="s-song">${esc(t("f.song"))}</label><input id="s-song" maxlength="60" placeholder="Las Mañanitas" value="${esc(p.song || "")}"></div>
        <div><label for="s-type">${esc(t("f.type"))}</label><select id="s-type"><option value="">${esc(t("f.any"))}</option>${meta.group_types.map((x) => `<option value="${esc(x)}"${sel(x, p.type)}>${esc(t("type." + x))}</option>`).join("")}</select></div></div>
        <div class="row"><div><label for="s-max">${esc(t("f.max"))}</label><select id="s-max"><option value="">${esc(t("f.any"))}</option>${[250, 350, 500, 900].map((v) => `<option value="${v}"${sel(v, p.max)}>${esc(t("f.upTo", { price: money(v * 100) }))}</option>`).join("")}</select></div>
        <div><label for="s-radius">${esc(t("f.radius"))}</label><select id="s-radius">${[[10, ""], [25, ""], [60, ""], [100, ""], [200, ""]].map(([n]) => `<option value="${n}"${sel(n, p.radius || 60)}>${esc(t("f.miles", { n }))}</option>`).join("")}</select></div></div>
        <div class="row"><div><label for="s-sort">${esc(t("f.sort"))}</label><select id="s-sort">${[["rating", "sort.rating"], ["price", "sort.price"], ["distance", "sort.distance"]].map(([v, k]) => `<option value="${v}"${sel(v, p.sort || "rating")}>${esc(t(k))}</option>`).join("")}</select></div></div>
      </details>
      <button class="btn" type="submit">${esc(t("f.search"))}</button>
    </form></section><div id="results"></div>`;

  const q = () => {
    const out = new URLSearchParams();
    for (const k of FIELDS) {
      const el = document.getElementById("s-" + k);
      const v = el ? el.value.trim() : "";
      if (v && !(k === "radius" && v === "60") && !(k === "sort" && v === "rating")) out.set(k, v);
    }
    if (view === "map") out.set("view", "map");
    return out;
  };
  document.getElementById("sform").addEventListener("submit", (e) => { e.preventDefault(); location.hash = "#/?" + q().toString(); });
  const loc = document.getElementById("locate");
  if (loc) loc.onclick = () => {
    loc.textContent = t("f.locating");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try { document.getElementById("s-zip").value = (await api.get(`/api/nearest-zip?lat=${pos.coords.latitude.toFixed(4)}&lon=${pos.coords.longitude.toFixed(4)}`)).zip; }
      catch (e) { toast(e.message, "error"); }
      loc.textContent = t("f.locate");
    }, () => { toast(t("f.locFail"), "error"); loc.textContent = t("f.locate"); }, { timeout: 8000 });
  };

  await loadFavs(); // so the hearts on the cards start in the right state
  const box = document.getElementById("results");
  if (!p.zip) {
    const m = meta.market;
    box.innerHTML = `<div class="panel empty">${esc(t("home.hint"))}</div>
      <div class="panel"><h2 class="sec">${esc(t("chi.hoods"))} · ${esc(m.name)}</h2><div class="chips">${m.neighborhoods.map((n) => `<a class="tag chip-link" href="#/?zip=${esc(n.zip)}">${esc(n.name)}</a>`).join("")}</div>
      <p><a href="#/chicago">${esc(t("chi.title"))} →</a></p></div>`;
    return;
  }
  box.innerHTML = `<div class="panel empty">${esc(t("home.searching"))}</div>`;

  const sp = new URLSearchParams();
  for (const k of FIELDS) if (p[k]) sp.set(k, p[k]);
  let data;
  try { data = await api.get("/api/search?" + sp.toString()); }
  catch (e) { box.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }

  const viewLink = (v) => { const u = new URLSearchParams(location.hash.split("?")[1] || ""); if (v === "map") u.set("view", "map"); else u.delete("view"); return "#/?" + u.toString(); };
  const filtered = FIELDS.some((k) => k !== "zip" && p[k]);
  const ctx = carry(p);
  box.innerHTML = `<div class="titlebar"><h2>${esc(t("home.top", { city: `${data.origin.city}, ${data.origin.state}` }))}</h2>
    <div class="seg"><a href="${esc(viewLink("list"))}" class="${view === "list" ? "on" : ""}">${esc(t("home.list"))}</a><a href="${esc(viewLink("map"))}" class="${view === "map" ? "on" : ""}">${esc(t("home.map"))}</a></div></div>
    <div class="links"><a href="#/best/${esc(data.origin.zip)}">🏆 ${esc(t("best.link", { city: data.origin.city }))}</a>${filtered ? `<a href="#/?zip=${esc(data.origin.zip)}">${esc(t("f.clear"))}</a>` : ""}<a href="#/quotes?${esc(ctx)}">✉ ${esc(t("rq.cta"))}</a></div>` +
    (!data.results.length ? `<div class="panel empty">${esc(t("home.none"))}${filtered ? `<br><a class="btn small" href="#/?zip=${esc(data.origin.zip)}">${esc(t("f.clear"))}</a>` : ""}<br><a class="btn small ghost" href="#/quotes?${esc(ctx)}">${esc(t("rq.cta"))}</a></div>`
      : view === "map" ? `<div id="map" class="map" role="region" aria-label="${esc(t("home.map"))}"></div><div class="legend">${esc(t("map.note"))}</div>`
        : `<div class="grid">${data.results.map((g, i) => groupCard(g, i, ctx)).join("")}</div>`);
  wireShare(box); wireHearts(box);
  if (!data.results.length && !data.in_market) box.appendChild(waitlistBox(data.origin.zip, `${data.origin.city}, ${data.origin.state}`));
  if (data.results.length && view === "map") drawMap(document.getElementById("map"), data.results, data.origin);
}
