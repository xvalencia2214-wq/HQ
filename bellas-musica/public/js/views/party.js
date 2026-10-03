import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, sel, tomorrowKey, wireShare, money, toast, fmtDate } from "../ui.js";
import { loadFavs, wireHearts } from "../fav.js";
import { groupCard } from "./home.js";
import { CAT_ORDER, CAT_ICON } from "../cats.js";
import { TEMPLATES, TEMPLATE_KEYS } from "../party-templates.js";

const NEED_KEY = "bm_party_need";
const loadNeed = () => { try { const v = JSON.parse(localStorage.getItem(NEED_KEY) || "null"); return Array.isArray(v) ? v.filter((c) => CAT_ORDER.includes(c)) : null; } catch { return null; } };
const saveNeed = (v) => { try { localStorage.setItem(NEED_KEY, JSON.stringify(v)); } catch { /* private mode */ } };

// Who is free that day, one section per category. Used by Plan a party and by a saved party's page.
// `pick(groupId)` (optional) adds a "+ Family list" button to each card.
export async function categorySections(box, p, cats, { pick = null } = {}) {
  if (!p.date || !p.zip) { box.innerHTML = `<div class="panel empty">${esc(t("party.pick"))}</div>`; return; }
  box.innerHTML = cats.map((c) => `<section class="panel party-cat" id="pc-${c}"><div class="titlebar"><h2 class="sec">${CAT_ICON[c]} ${esc(t("cat." + c))}</h2></div><div class="dim">${esc(t("home.searching"))}</div></section>`).join("");
  const ctx = new URLSearchParams(Object.entries({ event: p.event, guests: p.guests, date: p.date, zip: p.zip }).filter(([, x]) => x)).toString();
  await Promise.all(cats.map(async (c) => {
    const q = new URLSearchParams({ zip: p.zip, date: p.date, category: c, limit: "3" });
    if (p.event) q.set("event", p.event);
    if (p.guests) q.set("guests", String(p.guests));
    let r, guide = null;
    try { [r, guide] = await Promise.all([api.get("/api/search?" + q.toString()), api.get(`/api/price-guide?category=${c}${p.event ? "&event=" + encodeURIComponent(p.event) : ""}`).then((x) => x.guide).catch(() => null)]); }
    catch (e) { r = { error: e.message, results: [] }; }
    const sec = document.getElementById("pc-" + c); if (!sec) return;
    const all = `#/?${new URLSearchParams({ zip: p.zip, date: p.date, ...(p.event ? { event: p.event } : {}), ...(p.guests ? { guests: String(p.guests) } : {}), ...(c === "music" ? {} : { category: c }) }).toString()}`;
    const guideLine = guide ? `<div class="dim small guide">💲 ${esc(t("pp.guide", { low: money(guide.low), high: money(guide.high) }))}${guide.source === "bookings" ? " " + esc(t("pp.guideBooked", { n: guide.n })) : ""}</div>` : "";
    sec.innerHTML = `<div class="titlebar"><h2 class="sec">${CAT_ICON[c]} ${esc(t("cat." + c))}</h2>${r.results.length ? `<a href="${esc(all)}">${esc(t("party.seeAll"))} →</a>` : ""}</div>${guideLine}` +
      (r.error ? `<div class="err">${esc(r.error)}</div>` : r.results.length ? `<div class="grid">${r.results.map((g) => groupCard(g, null, ctx).replace("</article>", pick ? `<button type="button" class="btn ghost small pickbtn" data-pick="${esc(g.id)}">${esc(t("pp.addPick"))}</button></article>` : "</article>")).join("")}</div>` : `<div class="dim">${esc(t("party.none"))}</div>`);
    wireShare(sec); wireHearts(sec);
    if (pick) sec.querySelectorAll("[data-pick]").forEach((b) => { b.onclick = async () => { b.disabled = true; try { await pick(b.dataset.pick); b.textContent = "✓ " + t("pp.added"); } catch (e) { toast(e.message, "error"); b.disabled = false; } }; });
  }));
}

// "Plan a party": one date and place, then who is free that day in every category, with a checklist; save it to get the full party page.
export async function party(app, params) {
  const meta = state.meta;
  const p = { event: params.get("event") || "", date: params.get("date") || "", zip: params.get("zip") || "", guests: params.get("guests") || "", tpl: TEMPLATES[params.get("tpl")] ? params.get("tpl") : "" };
  document.title = `${t("party.nav")} · Bella's Música`;
  let need = p.tpl ? [...TEMPLATES[p.tpl].needs] : loadNeed() || [...CAT_ORDER];
  let mine = [];
  if (state.user) { try { mine = (await api.get("/api/my/parties")).parties.filter((x) => !x.past); } catch { /* fine */ } }

  app.innerHTML = `${mine.length ? `<div class="panel"><h2 class="sec">🎉 ${esc(t("pp.mine"))}</h2><div class="chips">${mine.map((x) => `<a class="catchip" href="#/my-party/${esc(x.id)}">${esc(x.title || t("pp.untitled"))} · ${esc(fmtDate(x.date))}</a>`).join("")}</div></div>` : ""}
    <section class="hero party-hero"><img class="hero-logo" src="logo.svg" alt="" width="84" height="84"><h1>${esc(t("party.title"))}</h1><p>${esc(t("party.sub"))}</p>
    <ul class="points"><li>✓ ${esc(t("party.p1"))}</li><li>✓ ${esc(t("party.p2"))}</li><li>✓ ${esc(t("party.p3"))}</li></ul>
    <form class="search" id="pform">
      <label for="p-tpl">${esc(t("pp.kind"))}</label><select id="p-tpl"><option value="">${esc(t("pp.kindAny"))}</option>${TEMPLATE_KEYS.map((k) => `<option value="${k}"${sel(k, p.tpl)}>${esc(t("tpl." + k))}</option>`).join("")}</select>
      <div class="row"><div><label for="p-date">${esc(t("f.date"))}</label><input id="p-date" type="date" min="${tomorrowKey()}" value="${esc(p.date)}" required></div>
      <div><label for="p-zip">${esc(t("f.zip"))}</label><input id="p-zip" inputmode="numeric" maxlength="5" pattern="\\d{5}" placeholder="60608" value="${esc(p.zip)}" required autocomplete="postal-code"></div></div>
      <div class="row"><div><label for="p-event">${esc(t("f.event"))}</label><select id="p-event"><option value="">${esc(t("f.anyEvent"))}</option>${meta.events.map((e) => `<option value="${esc(e)}"${sel(e, p.event)}>${esc(t("event." + e))}</option>`).join("")}</select></div>
      <div><label for="p-guests">${esc(t("f.guests"))}</label><input id="p-guests" type="number" min="1" max="5000" inputmode="numeric" placeholder="100" value="${esc(p.guests)}"></div></div>
      <div id="perr" class="err" role="alert"></div>
      <button class="btn" type="submit">${esc(t("party.go"))}</button></form></section>
    <div class="panel"><h2 class="sec">${esc(t("party.need"))}</h2><p class="dim small">${esc(t("party.needHint"))}</p><div class="chips needs" id="needs"></div>
      <div class="savebox">${p.date && p.zip ? (state.user ? `<button type="button" class="btn" id="psave">💾 ${esc(t("pp.save"))}</button>` : `<a class="btn" href="#/signup?next=${encodeURIComponent(location.hash)}">💾 ${esc(t("pp.loginSave"))}</a>`) + `<p class="dim small">${esc(t("pp.saveHint"))}</p>` : ""}</div></div>
    <div id="party-results"></div>`;

  const TPL_EVENT = { quince: "Quinceañera", wedding: "Wedding", birthday: "Birthday", graduation: "Other", bautizo: "Other", backyard: "Birthday" };
  document.getElementById("p-tpl").onchange = (e) => {
    const k = e.target.value; if (!TEMPLATES[k]) return;
    need = [...TEMPLATES[k].needs]; saveNeed(need); drawNeeds();
    const ev = document.getElementById("p-event"); if (!ev.value && TPL_EVENT[k]) ev.value = TPL_EVENT[k];
  };
  document.getElementById("pform").onsubmit = (e) => {
    e.preventDefault();
    const v = { date: document.getElementById("p-date").value, zip: document.getElementById("p-zip").value.trim(), event: document.getElementById("p-event").value, guests: document.getElementById("p-guests").value.trim(), tpl: document.getElementById("p-tpl").value };
    const err = document.getElementById("perr");
    if (!v.date || v.date < tomorrowKey()) { err.textContent = t("party.pick"); document.getElementById("p-date").focus(); return; }
    if (!/^\d{5}$/.test(v.zip)) { err.textContent = t("rq.needZip"); document.getElementById("p-zip").focus(); return; }
    location.hash = "#/party?" + new URLSearchParams(Object.entries(v).filter(([, x]) => x)).toString();
  };
  const save = document.getElementById("psave");
  if (save) save.onclick = async () => {
    save.disabled = true;
    const tpl = document.getElementById("p-tpl").value;
    try {
      const r = await api.post("/api/parties", { title: tpl ? t("tpl." + tpl) : "", event: p.event, date: p.date, zip: p.zip, guests: p.guests ? Number(p.guests) : "", template: tpl, needs: need });
      location.hash = "#/my-party/" + r.party.id;
    } catch (ex) { toast(ex.message, "error"); save.disabled = false; }
  };

  // What is already booked for that date (only when logged in): shown as ticked in the checklist.
  const booked = {};
  if (state.user && p.date) {
    try {
      for (const b of (await api.get("/api/my/bookings")).bookings) if (b.date === p.date && ["requested", "confirmed", "pending_payment"].includes(b.status) && b.category) (booked[b.category] ||= []).push(b.group_name);
    } catch { /* not important */ }
  }
  function drawNeeds() {
    document.getElementById("needs").innerHTML = CAT_ORDER.map((c) => `<label class="chk chip need${booked[c] ? " done" : ""}"><input type="checkbox" value="${c}"${need.includes(c) ? " checked" : ""}> <span>${CAT_ICON[c]} ${esc(t("cat." + c))}${booked[c] ? ` · ✓ ${esc(t("party.booked", { name: booked[c].join(", ") }))}` : ""}</span></label>`).join("");
    document.querySelectorAll("#needs input").forEach((i) => { i.onchange = () => { need = CAT_ORDER.filter((c) => document.querySelector(`#needs input[value="${c}"]`).checked); saveNeed(need); drawResults(); }; });
  }
  drawNeeds();

  await loadFavs();
  const box = document.getElementById("party-results");
  const drawResults = async () => {
    await categorySections(box, p, CAT_ORDER.filter((c) => need.includes(c)));
    if (need.length && p.date && p.zip) box.insertAdjacentHTML("beforeend", `<p class="dim small center">${esc(t("party.saveTip"))}</p>`);
  };
  drawResults();
}
