// The tools that make the app a vendor's whole business: payment links for its own clients, lineup and pay, what it needs
// from the family, holiday serenatas and team logins (the "My business" tab), plus the lineup and "one more hour" buttons on
// each booking, and the pages a client, a helper or a family opens from a link.
import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang } from "../i18n.js";
import { esc, money, fmtDate, toast, goto, sel, lenLabel, minutesOf, fmtPhone, tomorrowKey } from "../ui.js";

const loc = () => (lang() === "es" ? "es-US" : "en-US");
const waLink = (phone, text) => `https://wa.me/${phone ? "1" + String(phone).replace(/\D/g, "").slice(-10) : ""}?text=${encodeURIComponent(text)}`;
const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast(t("biz.copied")); } catch { prompt(t("biz.copyThis"), text); } };
const LENGTHS = () => [...(state.meta.short_minutes || [15, 20, 30, 45]), 60, 120, 180, 240, 300, 360, 420, 480];
const lengthOptions = (v) => LENGTHS().map((m) => `<option value="${m}"${m === v ? " selected" : ""}>${esc(lenLabel(m))}</option>`).join("");
const timeOptions = (v) => (state.meta.times || state.meta.slots).map((x) => `<option value="${esc(x)}"${x === v ? " selected" : ""}>${esc(x)}</option>`).join("");
const isOwnerOf = (g) => (g.my_role || "owner") === "owner";

// ======================= the "My business" tab =======================
export async function businessTab({ g, body, refresh }) {
  body.innerHTML = `<div class="biz-intro note">${esc(t("biz.intro"))}</div>
    <div class="panel" id="biz-links"></div>
    <div class="two"><div class="panel" id="biz-crew"></div><div class="panel" id="biz-payroll"></div></div>
    <div class="two"><div class="panel" id="biz-needs"></div><div class="panel" id="biz-specials"></div></div>
    <div class="panel" id="biz-team"></div>`;
  await Promise.all([drawLinks(g), drawCrew(g), drawPayroll(g), drawNeeds(g, refresh), drawSpecials(g), drawTeam(g, refresh)]);
}

// ---- payment links for your own clients ----
async function drawLinks(g) {
  const box = document.getElementById("biz-links"); if (!box) return;
  const gid = encodeURIComponent(g.id);
  const { links, fee_pct } = await api.get(`/api/groups/${gid}/paylinks`);
  const statusText = (l) => (l.booking_status ? t("pl.st." + l.booking_status) : t("pl.st." + l.status));
  box.innerHTML = `<h2 class="sec">💳 ${esc(t("pl.title"))}</h2><p class="dim small">${esc(t("pl.hint", { pct: fee_pct }))}</p>
    <details id="pl-new"${links.length ? "" : " open"}><summary class="btn small">${esc(t("pl.new"))}</summary>
    <form id="plform" novalidate>
      <div class="row"><div><label for="pl-client">${esc(t("pl.client"))}</label><input id="pl-client" name="clientName" required maxlength="80"></div>
        <div><label for="pl-title">${esc(t("pl.what"))}</label><input id="pl-title" name="title" maxlength="80" placeholder="${esc(t("pl.whatPh"))}"></div></div>
      <div class="row"><div><label for="pl-date">${esc(t("f.date"))}</label><input id="pl-date" name="date" type="date" min="${tomorrowKey()}" required></div>
        <div><label for="pl-time">${esc(t("pl.time"))}</label><select id="pl-time" name="time">${timeOptions("6:00 PM")}</select></div>
        <div><label for="pl-len">${esc(t("pk.length"))}</label><select id="pl-len" name="len">${lengthOptions(180)}</select></div></div>
      <div class="row"><div><label for="pl-ev">${esc(t("f.event"))}</label><select id="pl-ev" name="event">${state.meta.events.map((e) => `<option value="${esc(e)}">${esc(t("event." + e))}</option>`).join("")}</select></div>
        <div><label for="pl-guests">${esc(t("f.guests"))}</label><input id="pl-guests" name="guests" type="number" min="1" max="5000" inputmode="numeric" value="100" required></div>
        <div><label for="pl-zip">${esc(t("g.eventZip"))}</label><input id="pl-zip" name="eventZip" inputmode="numeric" maxlength="5" required value="${esc(g.zip)}"></div></div>
      <label for="pl-addr">${esc(t("pl.addr"))}</label><input id="pl-addr" name="address" maxlength="160">
      <div class="row"><div><label for="pl-total">${esc(t("pl.total"))}</label><input id="pl-total" name="total" type="number" min="20" max="50000" inputmode="numeric" required></div>
        <div><label for="pl-dep">${esc(t("pl.deposit"))}</label><select id="pl-dep" name="depositPct">${[10, 20, 25, 30, 40, 50, 75, 100].map((p) => `<option value="${p}"${sel(p, g.deposit_pct)}>${p}%</option>`).join("")}</select></div>
        <div><label for="pl-days">${esc(t("pl.days"))}</label><select id="pl-days" name="days">${[1, 2, 3, 5, 7, 14].map((d) => `<option value="${d}"${sel(d, 3)}>${esc(t("pl.daysN", { n: d }))}</option>`).join("")}</select></div></div>
      <label for="pl-note">${esc(t("pl.note"))}</label><input id="pl-note" name="note" maxlength="300">
      <div class="err" role="alert"></div><button class="btn" type="submit">${esc(t("pl.create"))}</button>
    </form></details>
    <div id="pl-made"></div>
    ${links.length ? `<ul class="plist pl-list">${links.map((l) => `<li><span><strong>${esc(l.client_name)}</strong> · ${esc(l.title)}<br><span class="dim small">${esc(fmtDate(l.date))} · ${esc(l.time)} · ${esc(lenLabel(l.minutes))} · ${money(l.total_cents)} (${esc(t("pl.depShort", { amount: money(l.deposit_cents) }))})</span></span>
      <span><span class="badge ${l.booking_status === "confirmed" ? "confirmed" : l.status === "open" ? "requested" : "cancelled"}">${esc(statusText(l))}</span>${l.status === "open" || (l.status === "used" && l.booking_status === "unpaid") ? ` <button type="button" class="linkbtn" data-plcancel="${esc(l.id)}">${esc(t("pl.cancel"))}</button>` : ""}</span></li>`).join("")}</ul>` : ""}`;
  const form = document.getElementById("plform");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form)), err = form.querySelector(".err"); err.textContent = "";
    const len = Number(f.len);
    try {
      const r = await api.post(`/api/groups/${gid}/paylinks`, { clientName: f.clientName, title: f.title, date: f.date, time: f.time, ...(len < 60 ? { minutes: len } : { hours: len / 60 }), event: f.event, guests: Number(f.guests), eventZip: f.eventZip, address: f.address, total: Number(f.total), depositPct: Number(f.depositPct), days: Number(f.days), note: f.note });
      const msg = t("pl.waMsg", { name: f.clientName.split(" ")[0], group: g.name, date: fmtDate(f.date), url: r.url });
      await drawLinks(g);
      document.getElementById("pl-made").innerHTML = `<div class="note ok"><strong>✓ ${esc(t("pl.made"))}</strong><div class="copyrow"><input readonly value="${esc(r.url)}" aria-label="${esc(t("pl.title"))}"><button type="button" class="btn small" id="pl-copy">${esc(t("biz.copy"))}</button></div>
        <a class="btn small wa" href="${esc(waLink("", msg))}" target="_blank" rel="noopener">WhatsApp</a></div>`;
      document.getElementById("pl-copy").onclick = () => copy(r.url);
    } catch (ex) { err.textContent = ex.message; }
  };
  box.querySelectorAll("[data-plcancel]").forEach((b) => { b.onclick = async () => { if (!confirm(t("pl.confirmCancel"))) return; try { await api.del(`/api/paylinks/${encodeURIComponent(b.dataset.plcancel)}`); drawLinks(g); } catch (e) { toast(e.message, "error"); } }; });
}

// ---- roster ----
async function drawCrew(g) {
  const box = document.getElementById("biz-crew"); if (!box) return;
  const gid = encodeURIComponent(g.id);
  const { crew } = await api.get(`/api/groups/${gid}/crew`);
  const active = crew.filter((c) => c.active);
  box.innerHTML = `<h2 class="sec">👥 ${esc(t("crew.title"))}</h2><p class="dim small">${esc(t("crew.hint"))}</p>
    ${active.length ? `<ul class="plist">${active.map((c) => `<li><span><strong>${esc(c.name)}</strong>${c.role ? ` · ${esc(c.role)}` : ""}<br><span class="dim small">${c.phone ? esc(fmtPhone(c.phone)) + " · " : ""}${esc(t("crew.payEach", { amount: money(c.pay_cents) }))}</span></span>
      <button type="button" class="linkbtn" data-crewdel="${c.id}">${esc(t("cal.remove"))}</button></li>`).join("")}</ul>` : `<p class="dim">${esc(t("crew.none"))}</p>`}
    <form id="crewform" novalidate><div class="row"><div><label for="cw-name">${esc(t("crew.name"))}</label><input id="cw-name" name="name" required maxlength="60"></div>
      <div><label for="cw-role">${esc(t("crew.role"))}</label><input id="cw-role" name="role" maxlength="40" placeholder="${esc(t("crew.rolePh"))}"></div></div>
      <div class="row"><div><label for="cw-phone">${esc(t("crew.phone"))}</label><input id="cw-phone" name="phone" inputmode="tel" maxlength="20"></div>
      <div><label for="cw-pay">${esc(t("crew.pay"))}</label><input id="cw-pay" name="pay" type="number" min="0" max="5000" inputmode="numeric"></div></div>
      <div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("crew.add"))}</button></form>`;
  document.getElementById("crewform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = e.target.querySelector(".err"); err.textContent = "";
    try { await api.post(`/api/groups/${gid}/crew`, { name: f.name, role: f.role, phone: f.phone, pay: f.pay === "" ? 0 : Number(f.pay) }); await drawCrew(g); } catch (ex) { err.textContent = ex.message; }
  };
  box.querySelectorAll("[data-crewdel]").forEach((b) => { b.onclick = async () => { if (!confirm(t("common.confirmDelete"))) return; await api.del(`/api/crew/${b.dataset.crewdel}`); drawCrew(g); }; });
}

async function drawPayroll(g, month) {
  const box = document.getElementById("biz-payroll"); if (!box) return;
  const m = month || new Date().toISOString().slice(0, 7);
  const p = await api.get(`/api/groups/${encodeURIComponent(g.id)}/payroll?month=${m}`);
  const shift = (k, n) => { const [y, mo] = k.split("-").map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  box.innerHTML = `<div class="titlebar"><h2 class="sec">💵 ${esc(t("crew.payroll"))}</h2><span><button type="button" class="linkbtn" data-pm="-1" aria-label="${esc(t("cal.prev"))}">‹</button> ${esc(new Date(m + "-15").toLocaleDateString(loc(), { month: "long", year: "numeric" }))} <button type="button" class="linkbtn" data-pm="1" aria-label="${esc(t("cal.next"))}">›</button></span></div>
    <p class="dim small">${esc(t("crew.payrollHint"))}</p>
    ${p.people.length ? `<div class="tablewrap" tabindex="0" role="region" aria-label="${esc(t("crew.payroll"))}"><table class="earn"><thead><tr><th scope="col">${esc(t("crew.name"))}</th><th scope="col">${esc(t("crew.gigs"))}</th><th scope="col">${esc(t("crew.owed"))}</th><th scope="col">${esc(t("crew.paid"))}</th></tr></thead>
      <tbody>${p.people.map((x) => `<tr><th scope="row">${esc(x.name)}</th><td>${x.gigs}</td><td>${money(x.owed_cents)}</td><td>${money(x.paid_cents)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><th scope="row">${esc(t("earn.total"))}</th><td></td><td>${money(p.owed_cents)}</td><td>${money(p.paid_cents)}</td></tr></tfoot></table></div>` : `<p class="dim">${esc(t("crew.noGigs"))}</p>`}`;
  box.querySelectorAll("[data-pm]").forEach((b) => { b.onclick = () => drawPayroll(g, shift(m, Number(b.dataset.pm))); });
}

// ---- what you need from the family ----
async function drawNeeds(g, refresh) {
  const box = document.getElementById("biz-needs"); if (!box) return;
  let needs = [...(g.needs || [])];
  const presets = state.meta.needs_presets[g.category] || state.meta.needs_presets.music || [];
  const draw = () => {
    const have = new Set(needs.map((x) => x.toLowerCase()));
    box.innerHTML = `<h2 class="sec">📋 ${esc(t("needs.title"))}</h2><p class="dim small">${esc(t("needs.hint"))}</p>
      ${needs.length ? `<ul class="plist">${needs.map((n, i) => `<li><span>✓ ${esc(n)}</span><button type="button" class="linkbtn" data-nd="${i}">${esc(t("cal.remove"))}</button></li>`).join("")}</ul>` : `<p class="dim">${esc(t("needs.none"))}</p>`}
      <div class="chips">${presets.filter((p) => !have.has(p.en.toLowerCase()) && !have.has(p.es.toLowerCase())).map((p) => `<button type="button" class="chip" data-np="${esc(p[lang()] || p.en)}">+ ${esc(p[lang()] || p.en)}</button>`).join("")}</div>
      <div class="row"><div><label for="nd-new">${esc(t("needs.add"))}</label><input id="nd-new" maxlength="80"></div><div class="row-btn"><button type="button" class="btn ghost small" id="nd-addbtn">${esc(t("cal.add"))}</button></div></div>
      <div class="err" role="alert"></div><button type="button" class="btn small" id="nd-save">${esc(t("common.save"))}</button>`;
    box.querySelectorAll("[data-nd]").forEach((b) => { b.onclick = () => { needs.splice(Number(b.dataset.nd), 1); draw(); }; });
    box.querySelectorAll("[data-np]").forEach((b) => { b.onclick = () => { if (needs.length < 12) needs.push(b.dataset.np); draw(); }; });
    document.getElementById("nd-addbtn").onclick = () => { const v = document.getElementById("nd-new").value.trim(); if (v && needs.length < 12) { needs.push(v); draw(); } };
    document.getElementById("nd-save").onclick = async () => {
      try { const r = await api.patch(`/api/groups/${encodeURIComponent(g.id)}`, { needs }); g.needs = r.needs; needs = [...r.needs]; toast(t("common.saved")); draw(); }
      catch (e) { box.querySelector(".err").textContent = e.message; }
    };
  };
  draw();
}

// ---- holiday serenatas ----
async function drawSpecials(g) {
  const box = document.getElementById("biz-specials"); if (!box) return;
  const { specials, holidays } = await api.get(`/api/groups/${encodeURIComponent(g.id)}/specials`);
  box.innerHTML = `<h2 class="sec">🌹 ${esc(t("sp.title"))}</h2><p class="dim small">${esc(t("sp.hint"))}</p>
    ${holidays.map((h) => {
      const cur = specials.find((s) => s.holiday === h.key);
      return `<div class="sp-day"><strong>${esc(t("sp." + h.key))}</strong> · ${esc(fmtDate(h.date))} <span class="dim small">(${esc(t("sp.inDays", { n: h.days }))})</span>
        ${cur ? `<div class="note ok small">✓ ${esc(cur.name)} · ${esc(lenLabel(minutesOf(cur)))} · ${money(cur.price_cents)}</div>` : ""}
        <details${cur ? "" : ""}><summary class="linkbtn">${esc(t(cur ? "sp.change" : "sp.offer"))}</summary>
        <form class="spform" data-h="${esc(h.key)}" novalidate><div class="row"><div><label for="sp-len-${h.key}">${esc(t("pk.length"))}</label><select id="sp-len-${h.key}" name="minutes">${[15, 20, 30, 45, 60].map((m) => `<option value="${m}"${sel(m, cur ? minutesOf(cur) : 20)}>${esc(lenLabel(m))}</option>`).join("")}</select></div>
          <div><label for="sp-price-${h.key}">${esc(t("sp.price"))}</label><input id="sp-price-${h.key}" name="price" type="number" min="20" max="5000" inputmode="numeric" required value="${cur ? cur.price_cents / 100 : ""}"></div></div>
          <div class="row"><div><label for="sp-from-${h.key}">${esc(t("cal.from"))}</label><select id="sp-from-${h.key}" name="from">${timeOptions(h.key === "guadalupe" ? "12:00 AM" : "12:00 AM")}</select></div>
          <div><label for="sp-to-${h.key}">${esc(t("cal.to"))}</label><select id="sp-to-${h.key}" name="to">${timeOptions(h.key === "guadalupe" ? "7:00 AM" : "11:00 PM")}</select></div></div>
          <label for="sp-name-${h.key}">${esc(t("sp.name"))}</label><input id="sp-name-${h.key}" name="name" maxlength="60" placeholder="${esc(t("sp.namePh." + h.key))}" value="${esc(cur ? cur.name : "")}">
          <div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("common.save"))}</button></form></details></div>`;
    }).join("")}`;
  box.querySelectorAll(".spform").forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form)), err = form.querySelector(".err"); err.textContent = "";
      try { await api.post(`/api/groups/${encodeURIComponent(g.id)}/specials`, { holiday: form.dataset.h, minutes: Number(f.minutes), price: Number(f.price), from: f.from, to: f.to, name: f.name }); toast(t("common.saved")); drawSpecials(g); }
      catch (ex) { err.textContent = ex.message; }
    };
  });
}

// ---- team ----
async function drawTeam(g, refresh) {
  const box = document.getElementById("biz-team"); if (!box) return;
  const gid = encodeURIComponent(g.id);
  const { team, my_role } = await api.get(`/api/groups/${gid}/team`);
  const owner = my_role === "owner";
  box.innerHTML = `<h2 class="sec">🤝 ${esc(t("team.title"))}</h2><p class="dim small">${esc(t(owner ? "team.hint" : "team.hintManager"))}</p>
    <ul class="plist">${team.owner ? `<li><span><strong>${esc(team.owner.name)}</strong> · <span class="dim small">${esc(t("team.owner"))}</span></span></li>` : ""}
      ${team.members.map((m) => `<li><span><strong>${esc(m.name)}</strong> · <span class="dim small">${esc(m.email)} · ${esc(t("team.manager"))}</span></span>${owner ? `<button type="button" class="linkbtn" data-tmdel="${m.id}">${esc(t("cal.remove"))}</button>` : m.id === state.user.id ? `<button type="button" class="linkbtn" data-tmleave="${m.id}">${esc(t("team.leave"))}</button>` : ""}</li>`).join("")}
      ${owner ? team.invites.map((i) => `<li><span class="dim">${esc(i.email || t("team.linkInvite"))} · ${esc(t("team.waiting"))}</span><button type="button" class="linkbtn" data-tminv="${esc(i.id)}">${esc(t("pl.cancel"))}</button></li>`).join("") : ""}</ul>
    ${owner ? `<form id="tmform" novalidate><label for="tm-email">${esc(t("team.email"))}</label><div class="row"><div><input id="tm-email" name="email" type="email" maxlength="120" placeholder="${esc(t("team.emailPh"))}"></div><div class="row-btn"><button class="btn small" type="submit">${esc(t("team.invite"))}</button></div></div><div class="err" role="alert"></div></form><div id="tm-made"></div>` : ""}`;
  const form = document.getElementById("tmform");
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector(".err"); err.textContent = "";
    try {
      const r = await api.post(`/api/groups/${gid}/team/invite`, { email: form.email.value.trim() });
      await drawTeam(g, refresh);
      document.getElementById("tm-made").innerHTML = `<div class="note ok">${esc(t("team.made"))}<div class="copyrow"><input readonly value="${esc(r.url)}" aria-label="${esc(t("team.title"))}"><button type="button" class="btn small" id="tm-copy">${esc(t("biz.copy"))}</button></div>
        <a class="btn small wa" href="${esc(waLink("", t("team.waMsg", { group: g.name, url: r.url })))}" target="_blank" rel="noopener">WhatsApp</a></div>`;
      document.getElementById("tm-copy").onclick = () => copy(r.url);
    } catch (ex) { err.textContent = ex.message; }
  };
  box.querySelectorAll("[data-tmdel]").forEach((b) => { b.onclick = async () => { if (!confirm(t("team.confirmRemove"))) return; await api.del(`/api/groups/${gid}/team/${b.dataset.tmdel}`); drawTeam(g, refresh); }; });
  box.querySelectorAll("[data-tminv]").forEach((b) => { b.onclick = async () => { await api.del(`/api/groups/${gid}/team/invites/${encodeURIComponent(b.dataset.tminv)}`); drawTeam(g, refresh); }; });
  box.querySelectorAll("[data-tmleave]").forEach((b) => { b.onclick = async () => { if (!confirm(t("team.confirmLeave"))) return; await api.del(`/api/groups/${gid}/team/${b.dataset.tmleave}`); location.hash = "#/dashboard"; }; });
}

// Payouts, Pro and Featured are the owner's: a helper sees a note instead of the buttons.
export function ownerOnly(root, g) {
  if (isOwnerOf(g)) return;
  root.querySelectorAll("#onboard, #feature, #buypro").forEach((el) => { el.outerHTML = `<p class="dim small">${esc(t("team.ownerOnly"))}</p>`; });
}

// ======================= on each booking (vendor side) =======================
const exStatus = (x) => t("ex.st." + x.status);
export function bizBox(b) {
  const upcoming = ["requested", "confirmed"].includes(b.status) && b.date >= state.meta.today;
  const extras = (b.extras || []).filter((x) => x.status !== "cancelled" && x.status !== "declined");
  return `${b.direct ? `<div class="dim small">💳 ${esc(t("pl.viaLink"))}</div>` : ""}
    ${(b.tips || []).map((x) => `<div class="small">💝 ${esc(t("tip.got", { amount: money(x.amount_cents) }))}${x.note ? ` · “${esc(x.note)}”` : ""}</div>`).join("")}
    ${(b.needs || []).length ? `<div class="dim small">📋 ${esc(t("needs.confirmed", { list: b.needs.join("; ") }))}</div>` : ""}
    ${extras.length ? `<div class="extras">${extras.map((x) => `<div class="small">➕ ${esc(x.label)} · ${x.amount_cents ? money(x.amount_cents) : esc(t("ex.noPrice"))} · <span class="badge ${x.status === "paid" || x.status === "cash" ? "confirmed" : "requested"}">${esc(exStatus(x))}</span>
      ${x.status === "asked" ? ` <button type="button" class="btn small" data-exacc="${esc(x.id)}" data-amt="${x.amount_cents}">${esc(t("ex.accept"))}</button>` : ""}
      ${["asked", "offered"].includes(x.status) ? ` <button type="button" class="btn ghost small" data-excash="${esc(x.id)}">${esc(t("ex.cash"))}</button> <button type="button" class="linkbtn" data-excan="${esc(x.id)}">${esc(t("ex.cancel"))}</button>` : ""}</div>`).join("")}</div>` : ""}
    ${b.series ? `<div class="dim small">🔁 ${esc(t("wk.tag", { n: b.series.n, of: b.series.of }))}</div>` : ""}
    ${b.series && b.can_respond ? `<div class="biz-btns"><button type="button" class="btn small" data-seriesacc="${esc(b.series_id)}" data-id="${esc(b.id)}">${esc(t("wk.acceptAll", { n: b.series.of }))}</button> <button type="button" class="btn ghost small" data-seriesdec="${esc(b.series_id)}" data-id="${esc(b.id)}">${esc(t("wk.declineAll"))}</button></div>` : ""}
    <div class="biz-btns">${upcoming ? `<button type="button" class="btn ghost small" data-lineup="${esc(b.id)}">👥 ${esc(t("crew.lineup"))}</button> ` : ""}${b.can_extra ? `<button type="button" class="btn ghost small" data-extra="${esc(b.id)}">➕ ${esc(t("ex.add"))}</button>` : ""}</div>`;
}
export function wireBiz(root, g, reload) {
  const slotOf = (btn) => btn.closest(".req").querySelector(".biz-slot");
  root.querySelectorAll("[data-lineup]").forEach((btn) => { btn.onclick = () => lineupPanel(slotOf(btn), btn.dataset.lineup, g); });
  root.querySelectorAll("[data-extra]").forEach((btn) => { btn.onclick = () => extraForm(slotOf(btn), btn.dataset.extra, g, reload); });
  // a whole weekly series in one tap: every waiting date of it on this page
  for (const [attr, action] of [["seriesacc", "accept"], ["seriesdec", "decline"]]) root.querySelectorAll(`[data-${attr}]`).forEach((btn) => { btn.onclick = async () => {
    if (action === "decline" && !confirm(t("dash.confirmDecline"))) return;
    const ids = [...new Set([...root.querySelectorAll(`[data-${attr}="${btn.dataset[attr]}"]`)].map((x) => x.dataset.id))];
    btn.disabled = true;
    try { for (const id of ids) await api.patch("/api/bookings/" + encodeURIComponent(id), { action }); toast(t("common.saved")); } catch (e) { toast(e.message, "error"); }
    reload();
  }; });
  const act = (sel, fn) => root.querySelectorAll(sel).forEach((btn) => { btn.onclick = async () => { try { await fn(btn); reload(); } catch (e) { toast(e.message, "error"); } }; });
  act("[data-exacc]", async (btn) => { const cur = Number(btn.dataset.amt) / 100; const v = prompt(t("ex.priceAsk"), cur || ""); if (v === null) throw new Error(t("ex.notChanged")); await api.post(`/api/extras/${encodeURIComponent(btn.dataset.exacc)}/accept`, { amount: Number(v) }); });
  act("[data-excash]", async (btn) => { if (!confirm(t("ex.confirmCash"))) throw new Error(t("ex.notChanged")); await api.post(`/api/extras/${encodeURIComponent(btn.dataset.excash)}/cash`); });
  act("[data-excan]", async (btn) => { await api.post(`/api/extras/${encodeURIComponent(btn.dataset.excan)}/cancel`); });
}

function extraForm(slot, bookingId, g, reload) {
  slot.innerHTML = `<form class="exform" novalidate><h3>${esc(t("ex.add"))}</h3>
    <label for="ex-kind-${bookingId}">${esc(t("ex.what"))}</label><select id="ex-kind-${bookingId}" name="kind">
      ${g.hourly && g.rate_cents ? `<option value="hour">${esc(t("ex.hour", { price: money(g.rate_cents) }))}</option>` : ""}
      ${(g.addons || []).map((a) => `<option value="addon:${a.id}">${esc(a.name)} · ${money(a.price_cents)}</option>`).join("")}
      <option value="other">${esc(t("ex.other"))}</option></select>
    <div class="row"><div><label for="ex-label-${bookingId}">${esc(t("ex.label"))}</label><input id="ex-label-${bookingId}" name="label" maxlength="60"></div>
      <div><label for="ex-amt-${bookingId}">${esc(t("ex.price"))}</label><input id="ex-amt-${bookingId}" name="amount" type="number" min="1" max="5000" inputmode="numeric"></div></div>
    <p class="dim small">${esc(t("ex.hint"))}</p><div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("ex.send"))}</button></form>`;
  const form = slot.querySelector("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form)), err = form.querySelector(".err"); err.textContent = "";
    const [kind, addonId] = f.kind.split(":");
    try { await api.post(`/api/bookings/${encodeURIComponent(bookingId)}/extras`, { kind, ...(addonId ? { addonId: Number(addonId) } : {}), label: f.label, ...(f.amount ? { amount: Number(f.amount) } : {}) }); toast(t("ex.sent")); reload(); }
    catch (ex) { err.textContent = ex.message; }
  };
}

async function lineupPanel(slot, bookingId, g) {
  const id = encodeURIComponent(bookingId);
  const [{ crew }, L] = await Promise.all([api.get(`/api/groups/${encodeURIComponent(g.id)}/crew`), api.get(`/api/bookings/${id}/lineup`)]);
  const on = new Map(L.lineup.map((x) => [x.crew_id, x]));
  const roster = crew.filter((c) => c.active || on.has(c.id));
  const bk = L.booking;
  const arrive = bk.arrive ? (() => { const [h, m] = bk.arrive.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; })() : "";
  const msgFor = (x) => t("crew.waMsg", { name: x.name.split(" ")[0], group: bk.group_name, event: t("event." + bk.event_type), date: fmtDate(bk.date), time: bk.time, len: lenLabel(bk.minutes), address: bk.address || t("crew.addrLater"), arrive: arrive ? t("crew.arriveBy", { time: arrive }) : "", pay: money(x.pay_cents) });
  slot.innerHTML = `<div class="lineup"><h3>👥 ${esc(t("crew.lineup"))}</h3>
    ${roster.length ? `<form class="luform">${roster.map((c) => { const x = on.get(c.id); return `<div class="lu-row"><label class="chk"><input type="checkbox" name="m" value="${c.id}"${x ? " checked" : ""}${x && x.paid_at ? " disabled" : ""}> <span>${esc(c.name)}${c.role ? ` · <span class="dim">${esc(c.role)}</span>` : ""}</span></label>
      <input type="number" class="lu-pay" data-pay="${c.id}" min="0" max="5000" value="${(x ? x.pay_cents : c.pay_cents) / 100}" aria-label="${esc(t("crew.payFor", { name: c.name }))}"${x && x.paid_at ? " disabled" : ""}>
      ${x ? `${x.phone ? `<a class="btn ghost small wa" data-sent="${c.id}" href="${esc(waLink(x.phone, msgFor(x)))}" target="_blank" rel="noopener">WhatsApp${x.sent_at ? " ✓" : ""}</a>` : ""} <button type="button" class="btn ghost small" data-paidtoggle="${c.id}" data-on="${x.paid_at ? 1 : 0}">${esc(t(x.paid_at ? "crew.isPaid" : "crew.markPaid"))}</button>` : ""}</div>`; }).join("")}
      <div class="dim small">${esc(t("crew.total", { amount: money(L.total_cents) }))}</div><div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("crew.saveLineup"))}</button></form>`
      : `<p class="dim">${esc(t("crew.noneYet"))} <a href="#/dashboard?g=${esc(g.id)}&tab=business">${esc(t("crew.addFirst"))}</a></p>`}
    ${!bk.address ? `<p class="dim small">${esc(t("crew.addrNote"))}</p>` : ""}</div>`;
  const form = slot.querySelector(".luform");
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const members = [...form.querySelectorAll('input[name="m"]:checked')].map((c) => ({ crewId: Number(c.value), pay: Number(form.querySelector(`[data-pay="${c.value}"]`).value) }));
    try { await api.put(`/api/bookings/${id}/lineup`, { members }); toast(t("common.saved")); lineupPanel(slot, bookingId, g); } catch (ex) { form.querySelector(".err").textContent = ex.message; }
  };
  slot.querySelectorAll("[data-sent]").forEach((a) => { a.addEventListener("click", () => { api.post(`/api/bookings/${id}/lineup/${a.dataset.sent}/sent`).catch(() => {}); }); });
  slot.querySelectorAll("[data-paidtoggle]").forEach((b) => { b.onclick = async () => { await api.post(`/api/bookings/${id}/lineup/${b.dataset.paidtoggle}/paid`, { paid: b.dataset.on !== "1" }); lineupPanel(slot, bookingId, g); }; });
}

// ======================= on each booking (family side) =======================
export function customerBizBox(b) {
  const extras = (b.extras || []).filter((x) => !["cancelled", "declined"].includes(x.status));
  const nextWeek = (() => { const [y, m, d] = b.date.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + 7)); return x.toISOString().slice(0, 10); })();
  return `${b.series ? `<div class="dim small">🔁 ${esc(t("wk.tag", { n: b.series.n, of: b.series.of }))}</div>` : ""}
    ${b.series && b.series.last && ["requested", "confirmed"].includes(b.status) ? `<a class="btn ghost small" href="#/group/${esc(b.group_id)}?date=${esc(nextWeek)}&repeat=${b.series.of}&event=${encodeURIComponent(b.event_type)}">🔁 ${esc(t("wk.more", { n: b.series.of }))}</a>` : ""}
    ${(b.needs || []).length && ["requested", "confirmed"].includes(b.status) ? `<div class="dim small">📋 ${esc(t("needs.yours", { list: b.needs.join("; ") }))}</div>` : ""}
    ${extras.map((x) => `<div class="small">➕ ${esc(x.label)} · ${x.amount_cents ? money(x.amount_cents) : ""} · <span class="badge ${["paid", "cash"].includes(x.status) ? "confirmed" : "requested"}">${esc(exStatus(x))}</span>
      ${x.status === "offered" ? ` <button type="button" class="btn small" data-expay="${esc(x.id)}">${esc(t("ex.pay", { amount: money(x.amount_cents) }))}</button> <button type="button" class="linkbtn" data-excan="${esc(x.id)}">${esc(t("ex.noThanks"))}</button>` : ""}
      ${x.status === "asked" ? ` <button type="button" class="linkbtn" data-excan="${esc(x.id)}">${esc(t("ex.cancel"))}</button>` : ""}</div>`).join("")}
    ${b.can_extra ? `<button type="button" class="btn ghost small" data-askhour="${esc(b.id)}">➕ ${esc(t("ex.askHour"))}</button>` : ""}
    ${(b.tips || []).map((x) => `<div class="small">💝 ${esc(t("tip.gave", { amount: money(x.amount_cents) }))}</div>`).join("")}
    ${b.can_tip ? `<div class="tipbox"><button type="button" class="btn ghost small" data-tip="${esc(b.id)}">💝 ${esc(t("tip.leave"))}</button><div class="tip-form" hidden></div></div>` : ""}`;
}
export function wireCustomerBiz(root, reload) {
  root.querySelectorAll("[data-tip]").forEach((btn) => { btn.onclick = () => {
    const box = btn.parentElement.querySelector(".tip-form"), id = btn.dataset.tip;
    box.hidden = false;
    box.innerHTML = `<form novalidate><p class="dim small">${esc(t("tip.hint"))}</p><div class="chips">${[20, 50, 100].map((n) => `<button type="button" class="chip" data-amt="${n}">${money(n * 100)}</button>`).join("")}</div>
      <div class="row"><div><label for="tip-a-${esc(id)}">${esc(t("tip.amount"))}</label><input id="tip-a-${esc(id)}" name="amount" type="number" min="5" max="2000" inputmode="numeric" required></div>
      <div><label for="tip-n-${esc(id)}">${esc(t("tip.note"))}</label><input id="tip-n-${esc(id)}" name="note" maxlength="200" placeholder="${esc(t("tip.notePh"))}"></div></div>
      <div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("tip.send"))}</button></form>`;
    const form = box.querySelector("form");
    box.querySelectorAll("[data-amt]").forEach((c) => { c.onclick = () => { form.amount.value = c.dataset.amt; }; });
    form.onsubmit = async (e) => {
      e.preventDefault();
      try { goto((await api.post(`/api/bookings/${encodeURIComponent(id)}/tips`, { amount: Number(form.amount.value), note: form.note.value })).payment.url); }
      catch (ex) { form.querySelector(".err").textContent = ex.message; }
    };
  }; });
  root.querySelectorAll("[data-expay]").forEach((btn) => { btn.onclick = async () => { try { goto((await api.post(`/api/extras/${encodeURIComponent(btn.dataset.expay)}/pay`)).payment.url); } catch (e) { toast(e.message, "error"); } }; });
  root.querySelectorAll("[data-excan]").forEach((btn) => { btn.onclick = async () => { try { await api.post(`/api/extras/${encodeURIComponent(btn.dataset.excan)}/cancel`); reload(); } catch (e) { toast(e.message, "error"); } }; });
  root.querySelectorAll("[data-askhour]").forEach((btn) => { btn.onclick = async () => { try { await api.post(`/api/bookings/${encodeURIComponent(btn.dataset.askhour)}/extras`, { kind: "hour" }); toast(t("ex.asked")); reload(); } catch (e) { toast(e.message, "error"); } }; });
}

// ======================= pages opened from a link =======================
export async function teamInvitePage(app, token) {
  let inv;
  try { inv = (await api.get(`/api/team-invite/${encodeURIComponent(token)}`)).invite; } catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  app.innerHTML = `<div class="panel narrow"><h1>🤝 ${esc(t("team.joinTitle", { group: inv.group }))}</h1><p>${esc(t("team.joinText", { from: inv.from, group: inv.group }))}</p>
    ${state.user ? `<button class="btn wide" id="tm-join">${esc(t("team.join"))}</button>` : `<p>${esc(t("team.loginFirst"))}</p><a class="btn" href="#/login?next=${encodeURIComponent("#/team/" + token)}">${esc(t("nav.login"))}</a> <a class="btn ghost" href="#/signup?next=${encodeURIComponent("#/team/" + token)}">${esc(t("nav.signup"))}</a>`}
    <div class="err" role="alert"></div></div>`;
  const j = document.getElementById("tm-join");
  if (j) j.onclick = async () => { try { const r = await api.post(`/api/team-invite/${encodeURIComponent(token)}/accept`); toast(t("team.joined")); location.hash = `#/dashboard?g=${encodeURIComponent(r.group_id)}`; } catch (e) { app.querySelector(".err").textContent = e.message; } };
}

export async function payLinkPage(app, token) {
  let l;
  try { l = (await api.get(`/api/pay-link/${encodeURIComponent(token)}`)).link; } catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  document.title = `${l.group.name} · Bella's Música`;
  const user = state.user, next = encodeURIComponent("#/pay-link/" + token);
  const head = `<div class="pl-head">${l.group.photo ? `<img src="${esc(l.group.photo)}" alt="" class="pl-photo">` : ""}<div><h1>${esc(l.group.name)}</h1><div class="dim">${esc(t("type." + l.group.type))}</div></div></div>`;
  const details = `<div class="sum"><span>${esc(t("pl.for"))}</span><span>${esc(l.title)}</span></div>
    <div class="sum"><span>${esc(t("f.date"))}</span><span>${esc(fmtDate(l.date))} · ${esc(l.time)} · ${esc(lenLabel(l.minutes))}</span></div>
    <div class="sum"><span>${esc(t("f.guests"))}</span><span>${l.guests}</span></div>
    ${l.address ? `<div class="sum"><span>${esc(t("g.address"))}</span><span>${esc(l.address)}</span></div>` : ""}
    <div class="sum"><span>${esc(t("q.total"))}</span><span>${money(l.total_cents)}</span></div>
    <div class="sum strong"><span>${esc(t("pl.depositNow"))}</span><span>${money(l.deposit_cents)}</span></div>
    <div class="sum"><span>${esc(t("q.balance"))}</span><span>${money(l.balance_cents)}</span></div>
    ${l.note ? `<p class="note small">“${esc(l.note)}”</p>` : ""}`;
  if (l.paid || l.booking_id && l.status === "used" && l.paid) { app.innerHTML = `<div class="panel narrow">${head}<div class="note ok">${esc(t("pl.alreadyPaid"))}</div>${l.booking_id ? `<a class="btn" href="#/booking/${esc(l.booking_id)}">${esc(t("pl.seeBooking"))}</a>` : ""}</div>`; return; }
  if (l.status === "expired" || l.status === "cancelled" || (l.status === "used" && !l.booking_id)) { app.innerHTML = `<div class="panel narrow">${head}<div class="note warn">${esc(t("pl.gone." + (l.status === "used" ? "used" : l.status)))}</div></div>`; return; }
  app.innerHTML = `<div class="panel narrow">${head}<p>${esc(t("pl.hello", { name: l.client_name.split(" ")[0], group: l.group.name }))}</p>${details}
    <div class="policy"><strong>${esc(t("g.policy"))}: ${esc(t("policy." + l.policy.key))}</strong><br>${esc(l.policy.text[lang()])}<ul>${l.policy.rows.map((row) => `<li>${esc(t("q.policyRow", { days: row.days, pct: row.pct }))}</li>`).join("")}<li>${esc(t("q.policyNone"))}</li></ul></div>
    ${user ? `<form id="plpay" novalidate>
      <label for="plp-name">${esc(t("g.yourName"))}</label><input id="plp-name" name="name" maxlength="80" value="${esc(user.name || l.client_name)}">
      <label for="plp-phone">${esc(t("g.yourPhone"))}</label><input id="plp-phone" name="phone" inputmode="tel" maxlength="20" required value="${esc(fmtPhone(user.phone))}">
      ${l.address ? "" : `<label for="plp-addr">${esc(t("g.address"))}</label><input id="plp-addr" name="address" maxlength="160" required>`}
      ${(l.needs || []).length ? `<div class="needs-box"><strong>📋 ${esc(t("needs.publicTitle"))}</strong><ul>${l.needs.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><label class="chk"><input type="checkbox" name="needs"> <span>${esc(t("needs.agree"))}</span></label></div>` : ""}
      <label class="chk"><input type="checkbox" name="agree"> <span>${esc(t("g.agree"))}</span></label>
      <div class="err" role="alert"></div><button class="btn wide" type="submit">${esc(t("pl.pay", { amount: money(l.deposit_cents) }))}</button></form>`
      : `<div class="note">${esc(t("pl.loginFirst"))}</div><a class="btn" href="#/signup?next=${next}">${esc(t("nav.signup"))}</a> <a class="btn ghost" href="#/login?next=${next}">${esc(t("nav.login"))}</a>`}</div>`;
  const form = document.getElementById("plpay");
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form)), err = form.querySelector(".err"); err.textContent = "";
    if (!form.agree.checked) { err.textContent = t("g.mustAgree"); return; }
    if (form.needs && !form.needs.checked) { err.textContent = t("needs.must"); return; }
    try {
      const r = await api.post(`/api/pay-link/${encodeURIComponent(token)}/book`, { name: f.name, phone: f.phone, address: f.address, acceptPolicy: true, acceptNeeds: Boolean(form.needs && form.needs.checked) });
      if (r.paid) { location.hash = `#/booking/${r.booking_id}`; return; }
      goto(r.payment.url);
    } catch (ex) { err.textContent = ex.message; }
  };
}

export async function specialsPage(app, key, params) {
  const zip = params.get("zip") || state.meta.market.center_zip;
  let r;
  try { r = await api.get(`/api/specials/${encodeURIComponent(key)}?zip=${encodeURIComponent(zip)}`); } catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  document.title = `${t("sp." + key)} · Bella's Música`;
  app.innerHTML = `<div class="panel"><h1>🌹 ${esc(t("sp.pageTitle." + key))}</h1><p>${esc(t("sp.pageText." + key, { date: fmtDate(r.date) }))}</p></div>
    ${r.vendors.length ? `<div class="cards">${r.vendors.map((v) => `<div class="card sp-card">${v.photo ? `<img src="${esc(v.photo)}" alt="" loading="lazy">` : ""}<div class="card-b"><strong>${esc(v.name)}</strong> <span class="dim small">${esc(t("type." + v.type))}${v.city ? " · " + esc(v.city) : ""}${v.distance !== null ? " · " + esc(t("sp.miles", { n: v.distance })) : ""}</span>
      <div>${esc(v.special.name)} · ${esc(lenLabel(v.special.minutes))} · <strong>${money(v.special.price_cents)}</strong></div>
      <div class="dim small">${v.open ? esc(t("sp.open", { n: v.open, from: v.first, to: v.last })) : esc(t("sp.full"))}</div>
      ${v.open ? `<a class="btn small" href="#/group/${esc(v.id)}?date=${esc(r.date)}&pkg=${v.special.id}&event=Serenata">${esc(t("sp.book"))}</a>` : ""}</div></div>`).join("")}</div>`
      : `<div class="panel empty">${esc(t("sp.none"))}</div>`}`;
}

// A banner on the home page in the weeks before a holiday, once someone offers serenatas for it.
export function holidayBanner() {
  const h = (state.meta.holidays || []).find((x) => x.days <= 45 && x.offering > 0);
  return h ? `<a class="note holiday-banner" href="#/specials/${esc(h.key)}">🌹 <strong>${esc(t("sp.bannerTitle." + h.key))}</strong> ${esc(t("sp.bannerText", { n: h.offering, days: h.days }))} →</a>` : "";
}
