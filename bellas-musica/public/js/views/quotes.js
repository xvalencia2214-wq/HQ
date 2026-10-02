import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang } from "../i18n.js";
import { esc, money, fmtDate, sel, tomorrowKey, toast } from "../ui.js";

// "Get quotes": describe the event once, it goes to the few groups that can really do it; replies and private offers land below.
export async function quotes(app, params) {
  const meta = state.meta;
  const p = Object.fromEntries(params);
  const zip = p.zip || (() => { try { return localStorage.getItem("bm_zip"); } catch { return null; } })() || meta.market.center_zip;
  const { requests } = await api.get("/api/my/requests");
  app.innerHTML = `<div class="titlebar"><h1>${esc(t("rq.title"))}</h1></div><p class="dim">${esc(t("rq.sub"))}</p>
    <div class="panel"><form id="rqform" novalidate>
      <div class="row"><div><label for="rq-ev">${esc(t("f.event"))}</label><select id="rq-ev" name="event">${meta.events.map((e) => `<option value="${esc(e)}"${sel(e, p.event || "Quinceañera")}>${esc(t("event." + e))}</option>`).join("")}</select></div>
      <div><label for="rq-date">${esc(t("f.date"))}</label><input id="rq-date" name="date" type="date" min="${tomorrowKey()}" required value="${esc(p.date || "")}"></div></div>
      <div class="row"><div><label for="rq-guests">${esc(t("f.guests"))}</label><input id="rq-guests" name="guests" type="number" min="1" max="5000" inputmode="numeric" required value="${esc(p.guests || "")}"></div>
      <div><label for="rq-hours">${esc(t("g.hoursLabel"))}</label><select id="rq-hours" name="hours">${[1, 2, 3, 4, 5, 6].map((h) => `<option value="${h}"${h === 3 ? " selected" : ""}>${esc(t("g.hours", { n: h }))}</option>`).join("")}</select></div></div>
      <label for="rq-zip">${esc(t("g.eventZip"))}</label><input id="rq-zip" name="zip" inputmode="numeric" maxlength="5" required value="${esc(zip)}" autocomplete="postal-code">
      <label for="rq-note">${esc(t("rq.note"))}</label><textarea id="rq-note" name="note" maxlength="300" placeholder="${esc(t("rq.notePh"))}"></textarea>
      <ul class="rq-promise"><li>${esc(t("rq.p1"))}</li><li>${esc(t("rq.p2"))}</li><li>${esc(t("rq.p3"))}</li></ul>
      <div id="rqerr" class="err" role="alert"></div><button class="btn wide" type="submit">${esc(t("rq.send"))}</button></form></div>
    <div id="rqresult"></div>
    ${requests.length ? `<h2 class="sec">${esc(t("rq.yours"))}</h2>${requests.map(card).join("")}` : ""}`;
  document.getElementById("rqform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = document.getElementById("rqerr"), btn = e.target.querySelector("button[type=submit]");
    err.textContent = ""; btn.disabled = true;
    try {
      const r = await api.post("/api/requests", { event: f.event, date: f.date, guests: Number(f.guests), hours: Number(f.hours), zip: f.zip, note: f.note });
      if (!r.sent) { document.getElementById("rqresult").innerHTML = `<div class="note warn" role="status">${esc(t("rq.none"))} <a href="#/?zip=${esc(f.zip)}&date=${esc(f.date)}">${esc(t("rq.wider"))}</a></div>`; btn.disabled = false; return; }
      toast(t("rq.sent", { n: r.sent })); quotes(app, new URLSearchParams());
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
}

function card(r) {
  const answered = r.groups.filter((g) => g.replied || g.offers.length).length;
  return `<div class="panel rq-card${r.past ? " past" : ""}"><div class="titlebar"><h3>${esc(t("event." + r.event))} · ${esc(fmtDate(r.date))}</h3><span class="dim small">${esc(t("rq.summary", { guests: r.guests, n: r.groups.length, a: answered }))}</span></div>
    ${r.groups.map((g) => `<div class="req"><div><strong><a href="#/group/${esc(g.id)}?event=${encodeURIComponent(r.event)}&date=${esc(r.date)}&guests=${r.guests}&zip=${esc(r.zip)}">${esc(g.name)}</a></strong> <span class="tag">${esc(t("type." + g.type))}</span>
      <div class="dim small">${!g.live ? esc(t("rq.gone")) : g.offers.length ? "" : g.replied ? esc(t("rq.replied", { n: g.reply_minutes })) : esc(t("rq.waiting"))}</div>
      ${g.offers.map((o) => `<div class="note ok small"><strong>${esc(o.name)}</strong> · ${esc(t("g.hours", { n: o.hours }))} · <strong>${money(o.price_cents)}</strong> <span class="dim">· ${esc(t("off.until", { date: new Date(o.expires_at * 1000).toLocaleDateString(lang() === "es" ? "es-US" : "en-US") }))}</span></div>`).join("")}</div>
      <div class="req-r">${g.live ? `<a class="btn small${g.offers.length ? "" : " ghost"}" href="#/group/${esc(g.id)}?event=${encodeURIComponent(r.event)}&date=${esc(r.date)}&guests=${r.guests}&zip=${esc(r.zip)}">${esc(g.offers.length ? t("off.book") : t("rq.open"))}</a> ` : ""}${g.live && g.replied ? `<a class="btn ghost small" href="#/messages?g=${esc(g.id)}">${esc(t("nav.messages"))}</a>` : ""}</div></div>`).join("")}</div>`;
}
