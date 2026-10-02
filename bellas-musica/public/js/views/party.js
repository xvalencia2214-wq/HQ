import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, sel, tomorrowKey, wireShare } from "../ui.js";
import { loadFavs, wireHearts } from "../fav.js";
import { groupCard } from "./home.js";
import { CAT_ORDER, CAT_ICON } from "../cats.js";

const NEED_KEY = "bm_party_need";
const loadNeed = () => { try { const v = JSON.parse(localStorage.getItem(NEED_KEY) || "null"); return Array.isArray(v) ? v.filter((c) => CAT_ORDER.includes(c)) : null; } catch { return null; } };
const saveNeed = (v) => { try { localStorage.setItem(NEED_KEY, JSON.stringify(v)); } catch { /* private mode */ } };

// "Plan a party": one date and place, then who is free that day in every category (music, food, tents, decorations...),
// with a checklist of what is still needed and what is already booked for that date.
export async function party(app, params) {
  const meta = state.meta;
  const p = { event: params.get("event") || "", date: params.get("date") || "", zip: params.get("zip") || "", guests: params.get("guests") || "" };
  document.title = `${t("party.nav")} · Bella's Música`;
  let need = loadNeed() || [...CAT_ORDER];

  app.innerHTML = `<section class="hero party-hero"><img class="hero-logo" src="logo.svg" alt="" width="84" height="84"><h1>${esc(t("party.title"))}</h1><p>${esc(t("party.sub"))}</p>
    <ul class="points"><li>✓ ${esc(t("party.p1"))}</li><li>✓ ${esc(t("party.p2"))}</li><li>✓ ${esc(t("party.p3"))}</li></ul>
    <form class="search" id="pform">
      <div class="row"><div><label for="p-date">${esc(t("f.date"))}</label><input id="p-date" type="date" min="${tomorrowKey()}" value="${esc(p.date)}" required></div>
      <div><label for="p-zip">${esc(t("f.zip"))}</label><input id="p-zip" inputmode="numeric" maxlength="5" pattern="\\d{5}" placeholder="60608" value="${esc(p.zip)}" required autocomplete="postal-code"></div></div>
      <div class="row"><div><label for="p-event">${esc(t("f.event"))}</label><select id="p-event"><option value="">${esc(t("f.anyEvent"))}</option>${meta.events.map((e) => `<option value="${esc(e)}"${sel(e, p.event)}>${esc(t("event." + e))}</option>`).join("")}</select></div>
      <div><label for="p-guests">${esc(t("f.guests"))}</label><input id="p-guests" type="number" min="1" max="5000" inputmode="numeric" placeholder="100" value="${esc(p.guests)}"></div></div>
      <div id="perr" class="err" role="alert"></div>
      <button class="btn" type="submit">${esc(t("party.go"))}</button></form></section>
    <div class="panel"><h2 class="sec">${esc(t("party.need"))}</h2><p class="dim small">${esc(t("party.needHint"))}</p><div class="chips needs" id="needs"></div></div>
    <div id="party-results"></div>`;

  document.getElementById("pform").onsubmit = (e) => {
    e.preventDefault();
    const v = { date: document.getElementById("p-date").value, zip: document.getElementById("p-zip").value.trim(), event: document.getElementById("p-event").value, guests: document.getElementById("p-guests").value.trim() };
    const err = document.getElementById("perr");
    if (!v.date || v.date < tomorrowKey()) { err.textContent = t("party.pick"); document.getElementById("p-date").focus(); return; }
    if (!/^\d{5}$/.test(v.zip)) { err.textContent = t("rq.needZip"); document.getElementById("p-zip").focus(); return; }
    location.hash = "#/party?" + new URLSearchParams(Object.entries(v).filter(([, x]) => x)).toString();
  };

  // What is already booked for that date (only when logged in): shown as ticked in the checklist.
  let booked = {};
  if (state.user && p.date) {
    try {
      for (const b of (await api.get("/api/my/bookings")).bookings) if (b.date === p.date && ["requested", "confirmed", "pending_payment"].includes(b.status) && b.category) (booked[b.category] ||= []).push(b.group_name);
    } catch { /* not important */ }
  }
  const drawNeeds = () => {
    document.getElementById("needs").innerHTML = CAT_ORDER.map((c) => `<label class="chk chip need${booked[c] ? " done" : ""}"><input type="checkbox" value="${c}"${need.includes(c) ? " checked" : ""}> <span>${CAT_ICON[c]} ${esc(t("cat." + c))}${booked[c] ? ` · ✓ ${esc(t("party.booked", { name: booked[c].join(", ") }))}` : ""}</span></label>`).join("");
    document.querySelectorAll("#needs input").forEach((i) => { i.onchange = () => { need = CAT_ORDER.filter((c) => document.querySelector(`#needs input[value="${c}"]`).checked); saveNeed(need); drawResults(); }; });
  };
  drawNeeds();

  await loadFavs();
  const box = document.getElementById("party-results");
  const cache = {};
  async function drawResults() {
    if (!p.date || !p.zip) { box.innerHTML = `<div class="panel empty">${esc(t("party.pick"))}</div>`; return; }
    const cats = CAT_ORDER.filter((c) => need.includes(c));
    box.innerHTML = cats.map((c) => `<section class="panel party-cat" id="pc-${c}"><div class="titlebar"><h2 class="sec">${CAT_ICON[c]} ${esc(t("cat." + c))}</h2></div><div class="dim">${esc(t("home.searching"))}</div></section>`).join("");
    const ctx = new URLSearchParams(Object.entries(p).filter(([, x]) => x)).toString();
    await Promise.all(cats.map(async (c) => {
      const q = new URLSearchParams({ zip: p.zip, date: p.date, category: c, limit: "3" });
      if (p.event) q.set("event", p.event);
      if (p.guests) q.set("guests", p.guests);
      let r;
      try { r = cache[c] ||= await api.get("/api/search?" + q.toString()); } catch (e) { r = { error: e.message, results: [] }; }
      const sec = document.getElementById("pc-" + c); if (!sec) return;
      const all = `#/?${new URLSearchParams({ zip: p.zip, date: p.date, ...(p.event ? { event: p.event } : {}), ...(p.guests ? { guests: p.guests } : {}), ...(c === "music" ? {} : { category: c }) }).toString()}`;
      sec.innerHTML = `<div class="titlebar"><h2 class="sec">${CAT_ICON[c]} ${esc(t("cat." + c))}</h2>${r.results.length ? `<a href="${esc(all)}">${esc(t("party.seeAll"))} →</a>` : ""}</div>` +
        (r.error ? `<div class="err">${esc(r.error)}</div>` : r.results.length ? `<div class="grid">${r.results.map((g) => groupCard(g, null, ctx)).join("")}</div>` : `<div class="dim">${esc(t("party.none"))}</div>`);
      wireShare(sec); wireHearts(sec);
    }));
    if (cats.length) box.insertAdjacentHTML("beforeend", `<p class="dim small center">${esc(t("party.saveTip"))}</p>`);
  }
  drawResults();
}
