import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang } from "../i18n.js";
import { esc, money, fmtDate, toast, sel, tomorrowKey } from "../ui.js";
import { CAT_ORDER, CAT_ICON } from "../cats.js";
import { TEMPLATES, TEMPLATE_KEYS, guestMath } from "../party-templates.js";
import { categorySections } from "./party.js";
import { loadFavs } from "../fav.js";
import { qrSvg } from "../qr.js";

const pct = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0);
const statusWord = (s) => t(s === "unpaid" ? "pp.unpaid" : "status." + s);

// Comments under a pick or in the family chat (shared by the owner page and the family link).
export function commentList(list, { canDelete = false } = {}) {
  return `<ul class="pcomments">${list.map((c) => `<li><strong>${esc(c.name)}${c.is_owner ? " ★" : ""}</strong> ${esc(c.text)}${canDelete ? ` <button type="button" class="linkbtn small" data-delc="${c.id}" aria-label="${esc(t("pp.remove"))}">✕</button>` : ""}</li>`).join("")}</ul>`;
}

// A saved party: budget against what is booked, the vendors for that day, the family shortlist and chat,
// the day-of timeline, a guest calculator, the weather, and who is still free in the categories not booked yet.
export async function myParty(app, id) {
  let P;
  try { P = (await api.get(`/api/parties/${encodeURIComponent(id)}`)).party; }
  catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)} <a href="#/party">${esc(t("party.nav"))}</a></div>`; return; }
  document.title = `${P.title || t("pp.untitled")} · Bella's Música`;
  const meta = state.meta;
  await loadFavs();

  function draw() {
    const m = P.money, tpl = TEMPLATES[P.template];
    const g = guestMath(P.guests);
    const vendorOpts = (sel0) => `<option value="">${esc(t("pp.vendorNone"))}</option>${P.vendors.map((v) => `<option value="${esc(v.id)}"${v.id === sel0 ? " selected" : ""}>${esc(v.group_name)}</option>`).join("")}`;
    const tlRow = (r = {}) => `<div class="tlrow"><input type="time" class="tl-at" aria-label="${esc(t("pp.time"))}" value="${esc(r.at || "")}"><input class="tl-label" maxlength="80" aria-label="${esc(t("pp.what"))}" placeholder="${esc(t("pp.what"))}" value="${esc(r.label || "")}"><select class="tl-b" aria-label="${esc(t("cat.all"))}">${vendorOpts(r.booking_id)}</select><button type="button" class="linkbtn tl-del" aria-label="${esc(t("pp.remove"))}">✕</button></div>`;
    app.innerHTML = `<a class="back" href="#/party">← ${esc(t("party.nav"))}</a>
    <div class="panel party-head"><div class="titlebar"><h1>🎉 ${esc(P.title || t("pp.untitled"))}</h1></div>
      <div class="meta">${P.event ? `<span class="tag">${esc(t("event." + P.event))}</span>` : ""}<span>📅 ${esc(fmtDate(P.date))}</span>${P.guests ? `<span>👥 ${esc(t("dash.guests", { n: P.guests }))}</span>` : ""}<span>📍 ${esc(P.zip)}</span></div>
      <div class="btnrow"><button type="button" class="btn small" id="pp-share">👪 ${esc(t("pp.share"))}</button><a class="btn ghost small" href="#/my-party/${esc(P.id)}/sign">🖨 ${esc(t("pp.sign"))}</a><button type="button" class="btn ghost small" id="pp-edit-t">✎ ${esc(t("pp.edit"))}</button></div>
      <div id="pp-sharebox" hidden><p class="dim small">${esc(t("pp.shareHint"))}</p><div class="copyrow"><input readonly id="pp-link" value="${esc(P.share_url)}" aria-label="${esc(t("pp.share"))}"><button type="button" class="btn small" id="pp-copy">${esc(t("pp.copy"))}</button><a class="btn ghost small" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(t("pp.waText", { title: P.title || t("pp.untitled") }) + " " + P.share_url)}">WhatsApp</a></div><button type="button" class="linkbtn small" id="pp-rotate">${esc(t("pp.newLink"))}</button></div>
      <form id="pp-edit" hidden class="stack">
        <label for="e-title">${esc(t("pp.title"))}</label><input id="e-title" maxlength="80" value="${esc(P.title)}">
        <div class="row"><div><label for="e-date">${esc(t("f.date"))}</label><input id="e-date" type="date" min="${tomorrowKey()}" value="${esc(P.date)}"></div><div><label for="e-zip">${esc(t("f.zip"))}</label><input id="e-zip" inputmode="numeric" maxlength="5" value="${esc(P.zip)}"></div></div>
        <div class="row"><div><label for="e-event">${esc(t("f.event"))}</label><select id="e-event"><option value="">${esc(t("f.anyEvent"))}</option>${meta.events.map((e) => `<option value="${esc(e)}"${sel(e, P.event)}>${esc(t("event." + e))}</option>`).join("")}</select></div><div><label for="e-guests">${esc(t("f.guests"))}</label><input id="e-guests" type="number" min="0" max="5000" value="${P.guests || ""}"></div></div>
        <label for="e-tpl">${esc(t("pp.kind"))}</label><select id="e-tpl"><option value="">${esc(t("pp.kindAny"))}</option>${TEMPLATE_KEYS.map((k) => `<option value="${k}"${sel(k, P.template)}>${esc(t("tpl." + k))}</option>`).join("")}</select>
        <div class="err" id="e-err" role="alert"></div><button class="btn small" type="submit">${esc(t("common.save"))}</button> <button type="button" class="btn ghost small" id="pp-del">${esc(t("pp.delete"))}</button>
      </form>
      <div id="pp-weather"></div></div>

    <div class="two">
      <div class="panel"><h2 class="sec">💰 ${esc(t("pp.money"))}</h2>
        <form id="pp-budget" class="inline"><label for="b-amt">${esc(t("pp.budget"))}</label><input id="b-amt" type="number" min="0" max="500000" step="50" inputmode="numeric" value="${P.budget_cents ? P.budget_cents / 100 : ""}"><button class="btn small" type="submit">${esc(t("common.save"))}</button></form>
        <div class="sum"><span>${esc(t("pp.booked"))}</span><strong>${money(m.booked_cents)}</strong></div>
        <div class="sum"><span>${esc(t("pp.paid"))}</span><span>${money(m.paid_cents)}</span></div>
        <div class="sum"><span>${esc(t("pp.toPay"))}</span><span>${money(m.to_pay_cents)}</span></div>
        ${P.budget_cents ? `<div class="meter" role="img" aria-label="${esc(t("pp.booked"))} ${pct(m.booked_cents, P.budget_cents)}%"><i class="${m.left_cents < 0 ? "over" : ""}" style="width:${pct(m.booked_cents, P.budget_cents)}%"></i></div>
          <div class="sum strong"><span>${esc(m.left_cents < 0 ? t("pp.over", { amount: money(-m.left_cents) }) : t("pp.left"))}</span><span>${m.left_cents < 0 ? "" : money(m.left_cents)}</span></div>` : `<p class="dim small">${esc(t("pp.noBudget"))}</p>`}
        ${tpl && P.budget_cents ? `<details class="split"><summary>${esc(t("pp.split"))}</summary><ul>${CAT_ORDER.filter((c) => tpl.split[c]).map((c) => `<li>${CAT_ICON[c]} ${esc(t("cat." + c))}: ${esc(money(Math.round((P.budget_cents * tpl.split[c]) / 10000) * 100))}${m.by_category[c] ? ` · ${esc(t("pp.booked"))} ${money(m.by_category[c])}` : ""}</li>`).join("")}</ul></details>` : ""}
      </div>
      <div class="panel"><h2 class="sec">✅ ${esc(t("pp.vendors"))}</h2>
        ${P.vendors.length ? `<ul class="plist">${P.vendors.map((v) => `<li><span>${CAT_ICON[v.category] || ""} <a href="#/booking/${esc(v.id)}">${esc(v.group_name)}</a> <span class="dim small">· ${esc(t("type." + v.type))} · ${esc(v.time)}</span><br><span class="small ${v.status === "unpaid" ? "warn" : "dim"}">${esc(statusWord(v.status))}${v.balance_left_cents ? " · " + esc(t("pp.balanceLeft", { amount: money(v.balance_left_cents) })) : ""}</span></span><strong>${money(v.total_cents)}</strong></li>`).join("")}</ul>` : `<p class="dim">${esc(t("pp.noVendors"))}</p>`}
        <h3 class="sec small-h">${esc(t("party.need"))}</h3><div class="chips needs" id="pp-needs">${CAT_ORDER.map((c) => `<label class="chk chip need${P.booked_categories.includes(c) ? " done" : ""}"><input type="checkbox" value="${c}"${P.needs.includes(c) ? " checked" : ""}> <span>${CAT_ICON[c]} ${esc(t("cat." + c))}${P.booked_categories.includes(c) ? " ✓" : ""}</span></label>`).join("")}</div>
      </div>
    </div>

    <div class="panel" id="pp-picks"><h2 class="sec">♥ ${esc(t("pp.picks"))}</h2><p class="dim small">${esc(t("pp.picksHint"))}</p>
      ${P.picks.length ? `<div class="picks">${P.picks.map((k) => `<div class="pick"><div class="pick-h"><a href="#/group/${esc(k.id)}?date=${esc(P.date)}&zip=${esc(P.zip)}${P.event ? "&event=" + encodeURIComponent(P.event) : ""}"><strong>${esc(k.name)}</strong></a> <span class="dim small">${CAT_ICON[k.category] || ""} ${esc(t("type." + k.type))} · ${esc(t("card.from", { price: money(k.from_cents) }))}</span><span class="votes">♥ ${k.votes}</span><button type="button" class="linkbtn small" data-unpick="${esc(k.id)}">${esc(t("pp.remove"))}</button></div>
        ${k.added_by ? `<div class="dim small">${esc(t("pp.by", { name: k.added_by }))}</div>` : ""}${commentList(k.comments, { canDelete: true })}
        <form class="cform" data-g="${esc(k.id)}"><input name="text" maxlength="300" placeholder="${esc(t("pp.commentPh"))}" aria-label="${esc(t("pp.comment"))}"><button class="btn small" type="submit">${esc(t("pp.send"))}</button></form></div>`).join("")}</div>` : `<p class="dim">${esc(t("pp.noPicks"))}</p>`}
      <h3 class="sec small-h">💬 ${esc(t("pp.chat"))}</h3>${commentList(P.comments, { canDelete: true })}
      <form class="cform" data-g=""><input name="text" maxlength="300" placeholder="${esc(t("pp.commentPh"))}" aria-label="${esc(t("pp.chat"))}"><button class="btn small" type="submit">${esc(t("pp.send"))}</button></form>
    </div>

    <div class="two">
      <div class="panel"><h2 class="sec">🕒 ${esc(t("pp.timeline"))}</h2><p class="dim small">${esc(t("pp.timelineHint"))}</p>
        <div id="tl">${(P.timeline.length ? P.timeline : [{}]).map(tlRow).join("")}</div>
        <div class="btnrow"><button type="button" class="btn ghost small" id="tl-add">${esc(t("pp.addRow"))}</button>${tpl ? `<button type="button" class="btn ghost small" id="tl-tpl">${esc(t("pp.useTpl"))}</button>` : ""}<button type="button" class="btn small" id="tl-save">${esc(t("pp.saveTimeline"))}</button></div><div class="err" id="tl-err" role="alert"></div></div>
      <div class="panel"><h2 class="sec">🧮 ${esc(t("pp.calc"))}</h2>
        ${g ? `<p>${esc(t("pp.calcFor", { n: P.guests }))}</p><ul class="calc"><li>🪑 ${esc(t("pp.calcTables", { n: g.roundTables, chairs: g.chairs }))}</li><li>⛺ ${esc(t("pp.calcTent", { size: g.tent }))}</li><li>🌮 ${esc(t("pp.calcTacos", { n: g.tacos, servings: g.servings }))}</li><li>🥤 ${esc(t("pp.calcAguas", { n: g.aguasGallons }))}</li><li>🎂 ${esc(t("pp.calcCake", { n: g.cakeServings }))}</li>${g.security ? `<li>🛡️ ${esc(t("pp.calcSecurity", { n: g.security }))}</li>` : ""}</ul><p class="dim small">${esc(t("pp.calcNote"))}</p>` : `<p class="dim">${esc(t("pp.calcNeedGuests"))}</p>`}
      </div>
    </div>
    <h2 class="sec">${esc(t("pp.find"))}</h2><div id="pp-find"></div>`;
    wire();
    const missing = P.needs.filter((c) => !P.booked_categories.includes(c));
    categorySections(document.getElementById("pp-find"), { date: P.date, zip: P.zip, event: P.event, guests: P.guests }, missing, { pick: (gid) => api.post(`/api/parties/${encodeURIComponent(P.id)}/picks`, { groupId: gid }).then((r) => { P = r.party; }) });
    loadWeather();
  }

  async function loadWeather() {
    const box = document.getElementById("pp-weather"); if (!box) return;
    let w;
    try { w = (await api.get(`/api/parties/${encodeURIComponent(P.id)}/weather`)).weather; } catch { return; }
    if (!w.available) { if (w.reason === "far") box.innerHTML = `<p class="dim small">🌤 ${esc(t("pp.weatherFar"))}</p>`; return; }
    const tentBooked = P.booked_categories.includes("rentals");
    box.innerHTML = `<div class="note weather${w.rain >= 40 ? " warn" : ""}">🌦 <strong>${esc(w.name)}:</strong> ${esc(w.short)}${w.temp ? ` · ${w.temp}°${w.unit}` : ""} · ${esc(t("pp.rain", { pct: w.rain }))}
      ${w.rain >= 40 && !tentBooked ? `<br>${esc(t("pp.rainTent"))} <a href="#/?zip=${esc(P.zip)}&date=${esc(P.date)}&category=rentals&type=Tents">${esc(t("pp.findTents"))} →</a>` : ""}</div>`;
  }

  const save = async (body) => { P = (await api.patch(`/api/parties/${encodeURIComponent(P.id)}`, body)).party; };
  function wire() {
    const $ = (s) => document.getElementById(s);
    $("pp-share").onclick = () => { $("pp-sharebox").hidden = !$("pp-sharebox").hidden; };
    $("pp-copy").onclick = async () => { try { await navigator.clipboard.writeText(P.share_url); toast(t("share.copied")); } catch { $("pp-link").select(); } };
    $("pp-rotate").onclick = async () => { if (!confirm(t("pp.newLink") + "?")) return; P = (await api.post(`/api/parties/${encodeURIComponent(P.id)}/share`)).party; draw(); $("pp-sharebox").hidden = false; };
    $("pp-edit-t").onclick = () => { $("pp-edit").hidden = !$("pp-edit").hidden; };
    $("pp-edit").onsubmit = async (e) => {
      e.preventDefault();
      const tpl = $("e-tpl").value;
      try {
        await save({ title: $("e-title").value, date: $("e-date").value, zip: $("e-zip").value.trim(), event: $("e-event").value, guests: $("e-guests").value === "" ? "" : Number($("e-guests").value), template: tpl, ...(tpl && tpl !== P.template ? { needs: TEMPLATES[tpl].needs } : {}) });
        toast(t("common.saved")); draw();
      } catch (ex) { $("e-err").textContent = ex.message; }
    };
    $("pp-del").onclick = async () => { if (!confirm(t("pp.confirmDelete"))) return; await api.del(`/api/parties/${encodeURIComponent(P.id)}`); location.hash = "#/party"; };
    $("pp-budget").onsubmit = async (e) => { e.preventDefault(); try { await save({ budget: $("b-amt").value === "" ? "" : Number($("b-amt").value) }); toast(t("common.saved")); draw(); } catch (ex) { toast(ex.message, "error"); } };
    document.querySelectorAll("#pp-needs input").forEach((i) => { i.onchange = async () => { try { await save({ needs: [...document.querySelectorAll("#pp-needs input:checked")].map((x) => x.value) }); draw(); } catch (ex) { toast(ex.message, "error"); } }; });
    document.querySelectorAll("[data-unpick]").forEach((b) => { b.onclick = async () => { P = (await api.del(`/api/parties/${encodeURIComponent(P.id)}/picks/${encodeURIComponent(b.dataset.unpick)}`)).party; draw(); }; });
    document.querySelectorAll("[data-delc]").forEach((b) => { b.onclick = async () => { P = (await api.del(`/api/parties/${encodeURIComponent(P.id)}/comments/${b.dataset.delc}`)).party; draw(); }; });
    document.querySelectorAll(".cform").forEach((f) => { f.onsubmit = async (e) => {
      e.preventDefault(); const text = f.text.value.trim(); if (!text) return;
      try { P = (await api.post(`/api/parties/${encodeURIComponent(P.id)}/comments`, { text, groupId: f.dataset.g || undefined })).party; draw(); } catch (ex) { toast(ex.message, "error"); }
    }; });
    // timeline
    const tl = $("tl");
    const wireRows = () => tl.querySelectorAll(".tl-del").forEach((b) => { b.onclick = () => { b.parentElement.remove(); }; });
    wireRows();
    const rowHtml = (r) => { const d = document.createElement("div"); d.innerHTML = `<div class="tlrow"><input type="time" class="tl-at" aria-label="${esc(t("pp.time"))}" value="${esc(r.at || "")}"><input class="tl-label" maxlength="80" aria-label="${esc(t("pp.what"))}" placeholder="${esc(t("pp.what"))}" value="${esc(r.label || "")}"><select class="tl-b" aria-label="${esc(t("cat.all"))}"><option value="">${esc(t("pp.vendorNone"))}</option>${P.vendors.map((v) => `<option value="${esc(v.id)}">${esc(v.group_name)}</option>`).join("")}</select><button type="button" class="linkbtn tl-del" aria-label="${esc(t("pp.remove"))}">✕</button></div>`; return d.firstChild; };
    $("tl-add").onclick = () => { tl.appendChild(rowHtml({})); wireRows(); };
    if ($("tl-tpl")) $("tl-tpl").onclick = () => { tl.innerHTML = ""; for (const [at, en, es] of TEMPLATES[P.template].timeline) tl.appendChild(rowHtml({ at, label: lang() === "es" ? es : en })); wireRows(); };
    $("tl-save").onclick = async () => {
      const items = [...tl.querySelectorAll(".tlrow")].map((r) => ({ at: r.querySelector(".tl-at").value, label: r.querySelector(".tl-label").value.trim(), bookingId: r.querySelector(".tl-b").value || undefined })).filter((r) => r.at || r.label);
      try { P = (await api.put(`/api/parties/${encodeURIComponent(P.id)}/timeline`, { items })).party; toast(t("pp.saved")); draw(); }
      catch (ex) { $("tl-err").textContent = ex.message; }
    };
  }
  draw();
}

// A printable sign for the party: "Planned on Bella's Música" with a QR code to the vendor list.
export async function partySign(app, id) {
  let P;
  try { P = (await api.get(`/api/parties/${encodeURIComponent(id)}`)).party; }
  catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  const draw = async () => {
    if (!P.credits_public) {
      app.innerHTML = `<a class="back" href="#/my-party/${esc(P.id)}">← ${esc(P.title || t("pp.untitled"))}</a><div class="panel narrow"><h1 class="sec">🖨 ${esc(t("pp.sign"))}</h1><p>${esc(t("sign.allowHint"))}</p><button type="button" class="btn" id="allow">${esc(t("sign.allow"))}</button></div>`;
      document.getElementById("allow").onclick = async () => { P = (await api.patch(`/api/parties/${encodeURIComponent(P.id)}`, { credits_public: true })).party; draw(); };
      return;
    }
    const vendors = P.vendors.filter((v) => v.status !== "unpaid");
    app.innerHTML = `<div class="noprint"><a class="back" href="#/my-party/${esc(P.id)}">← ${esc(P.title || t("pp.untitled"))}</a> <button type="button" class="btn small" id="print">🖨 ${esc(t("sign.print"))}</button> <button type="button" class="linkbtn small" id="hide">${esc(t("sign.hide"))}</button></div>
      <div class="sign"><img src="logo.svg" alt="" width="110" height="110"><h1>${esc(P.title || t("pp.untitled"))}</h1><p class="sign-sub">${esc(t("thanks.title"))}</p>
      <div class="sign-qr" id="qr"></div><p class="sign-scan">${esc(t("thanks.scan"))}</p>
      ${vendors.length ? `<ul class="sign-list">${vendors.map((v) => `<li>${CAT_ICON[v.category] || ""} ${esc(v.group_name)}</li>`).join("")}</ul>` : ""}<p class="sign-foot">bellasmusica · ${esc(t("party.nav"))}</p></div>`;
    document.getElementById("print").onclick = () => window.print();
    document.getElementById("hide").onclick = async () => { P = (await api.patch(`/api/parties/${encodeURIComponent(P.id)}`, { credits_public: false })).party; draw(); };
    try { document.getElementById("qr").innerHTML = await qrSvg(P.thanks_url, { cell: 8 }); } catch (e) { document.getElementById("qr").textContent = P.thanks_url; }
  };
  draw();
}
