import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, money, sel, tomorrowKey, groupPhoto, shareButtons, wireShare } from "../ui.js";
import { drawMap } from "../map.js";

export function groupCard(g, i) {
  const tags = [];
  if (g.promoted) tags.push(`<span class="feat">${esc(t("card.featured"))}</span>`);
  if (g.demo) tags.push(`<span class="tag sample">${esc(t("card.sample"))}</span>`);
  return `<article class="card">${i != null ? `<span class="rank">#${i + 1}</span>` : ""}${groupPhoto(g)}
    <h3>${esc(g.name)}</h3>
    <div class="meta">${g.reviews ? `<span class="stars">★ ${g.rating.toFixed(1)}</span><span>(${g.reviews})</span>` : `<span class="stars">★ ${esc(t("card.new"))}</span>`}<span class="tag">${esc(g.type)}</span>${tags.join("")}</div>
    <div class="meta"><span class="price">${esc(t("card.from", { price: money(g.from_cents) }))}</span><span>${esc(t("card.away", { n: g.distance_miles }))}</span><span>${esc(t("card.members", { n: g.members }))}</span></div>
    ${g.fits_event ? `<div class="fit">✓ ${esc(t("card.fits"))}</div>` : ""}
    ${g.matched_songs?.length ? `<div class="fit">♪ ${esc(t("card.plays"))}: ${esc(g.matched_songs.join(", "))}</div>` : ""}
    ${g.open_slots?.length ? `<div class="fit">📅 ${esc(t("card.open"))}: ${esc(g.open_slots.join(", "))}</div>` : ""}
    <p>${esc(g.story)}</p>
    <a class="btn" href="#/group/${esc(g.id)}">${esc(t("card.book"))}</a>
    ${shareButtons(g.name, "#/group/" + g.id)}
  </article>`;
}

export async function home(app, params) {
  const p = Object.fromEntries(params);
  const view = p.view === "map" ? "map" : "list";
  const meta = state.meta;
  const hero = `<section class="hero"><img class="hero-logo" src="logo.svg" alt="" width="84" height="84"><h1>${esc(t("home.title"))}</h1><p>${esc(t("home.sub"))}</p>
    <form class="search" id="sform">
      <div class="row"><div><label for="s-zip">${esc(t("f.zip"))}</label><input id="s-zip" inputmode="numeric" maxlength="5" pattern="\\d{5}" required placeholder="60608" value="${esc(p.zip || "")}"></div>
      <div><label for="s-event">${esc(t("f.event"))}</label><select id="s-event"><option value="">${esc(t("f.anyEvent"))}</option>${meta.events.map((e) => `<option value="${esc(e)}"${sel(e, p.event)}>${esc(t("event." + e))}</option>`).join("")}</select></div></div>
      <div class="row"><div><label for="s-date">${esc(t("f.date"))}</label><input id="s-date" type="date" min="${tomorrowKey()}" value="${esc(p.date || "")}"></div>
      <div><label for="s-guests">${esc(t("f.guests"))}</label><input id="s-guests" type="number" min="1" max="5000" inputmode="numeric" placeholder="100" value="${esc(p.guests || "")}"></div></div>
      <div class="row"><div><label for="s-song">${esc(t("f.song"))}</label><input id="s-song" maxlength="60" placeholder="Las Mañanitas" value="${esc(p.song || "")}"></div>
      <div><label for="s-type">${esc(t("f.type"))}</label><select id="s-type"><option value="">${esc(t("f.any"))}</option>${meta.group_types.map((x) => `<option value="${esc(x)}"${sel(x, p.type)}>${esc(t("type." + x))}</option>`).join("")}</select></div></div>
      <div class="row"><div><label for="s-max">${esc(t("f.max"))}</label><select id="s-max"><option value="">${esc(t("f.any"))}</option>${[250, 350, 500, 900].map((v) => `<option value="${v}"${sel(v, p.max)}>${esc(t("f.upTo", { price: money(v * 100) }))}</option>`).join("")}</select></div>
      <div><label for="s-sort">${esc(t("f.sort"))}</label><select id="s-sort">${[["rating", "sort.rating"], ["price", "sort.price"], ["distance", "sort.distance"]].map(([v, k]) => `<option value="${v}"${sel(v, p.sort || "rating")}>${esc(t(k))}</option>`).join("")}</select></div></div>
      <button class="btn" type="submit">${esc(t("f.search"))}</button>
    </form></section>`;

  app.innerHTML = hero + '<div id="results"></div>';
  document.getElementById("sform").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new URLSearchParams();
    for (const [id, k] of [["zip", "zip"], ["event", "event"], ["date", "date"], ["guests", "guests"], ["song", "song"], ["type", "type"], ["max", "max"], ["sort", "sort"]]) {
      const v = document.getElementById("s-" + id).value.trim();
      if (v) q.set(k, v);
    }
    if (view === "map") q.set("view", "map");
    location.hash = "#/?" + q.toString();
  });
  if (!p.zip) { document.getElementById("results").innerHTML = `<div class="panel empty">${esc(t("home.hint"))}</div>`; return; }

  const q = new URLSearchParams();
  for (const k of ["zip", "event", "date", "guests", "song", "type", "max", "sort"]) if (p[k]) q.set(k, p[k]);
  let data;
  try { data = await api.get("/api/search?" + q.toString()); }
  catch (e) { document.getElementById("results").innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }

  const box = document.getElementById("results");
  const viewLink = (v) => { const u = new URLSearchParams(location.hash.split("?")[1] || ""); if (v === "map") u.set("view", "map"); else u.delete("view"); return "#/?" + u.toString(); };
  box.innerHTML = `<div class="titlebar"><h2>${esc(t("home.top", { city: `${data.origin.city}, ${data.origin.state}` }))}</h2>
    <div class="seg"><a href="${esc(viewLink("list"))}" class="${view === "list" ? "on" : ""}">${esc(t("home.list"))}</a><a href="${esc(viewLink("map"))}" class="${view === "map" ? "on" : ""}">${esc(t("home.map"))}</a></div></div>
    <div class="links"><a href="#/best/${esc(data.origin.zip)}">🏆 ${esc(t("best.link", { city: data.origin.city }))}</a></div>` +
    (!data.results.length ? `<div class="panel empty">${esc(t("home.none"))}</div>`
      : view === "map" ? `<div id="map" class="map" role="region" aria-label="${esc(t("home.map"))}"></div><div class="legend">${esc(t("map.note"))}</div>`
        : `<div class="grid">${data.results.map(groupCard).join("")}</div>`);
  wireShare(box);
  if (data.results.length && view === "map") drawMap(document.getElementById("map"), data.results, data.origin);
}
