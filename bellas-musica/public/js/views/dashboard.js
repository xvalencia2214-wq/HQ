import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang } from "../i18n.js";
import { esc, money, fmtDate, statusBadge, toast, today, dkey, sel, goto, fmtPhone, shareButtons, wireShare, stars } from "../ui.js";
import { calendar, monthKey } from "../calendar.js";
import { renderChat } from "../chat.js";

const TABS = ["requests", "calendar", "listing", "extras", "media", "reviews", "payments", "messages"];

export async function dashboard(app, params) {
  const { groups } = await api.get("/api/my/groups");
  if (!groups.length) { createForm(app); return; }
  const g = groups.find((x) => x.id === params.get("g")) || groups[0];
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "requests";
  const link = (over) => { const q = new URLSearchParams({ g: g.id, tab, ...over }); return "#/dashboard?" + q.toString(); };

  app.innerHTML = `<div class="titlebar"><h1>${esc(g.name)} <small class="dim">${esc(t("dash.title"))}</small></h1>
    <div class="seg">${groups.length > 1 ? `<select id="gpick" aria-label="${esc(t("dash.pick"))}">${groups.map((x) => `<option value="${esc(x.id)}"${sel(x.id, g.id)}>${esc(x.name)}</option>`).join("")}</select>` : ""}<a href="#/dashboard?new=1" id="newg">+ ${esc(t("dash.add"))}</a><a href="#/group/${esc(g.id)}">${esc(t("dash.view"))}</a></div></div>
    ${g.stripe.mode === "stripe" && !g.stripe.ready ? `<div class="note warn">${esc(t("dash.needPayout"))} <a href="${esc(link({ tab: "payments" }))}">${esc(t("dash.setUp"))}</a></div>` : ""}
    ${statusBanner(g)}
    ${g.status === "draft" ? "" : checklistCard(g, link)}
    <div class="tabs" role="tablist">${TABS.map((k) => `<a role="tab" class="${k === tab ? "on" : ""}" href="${esc(link({ tab: k }))}">${esc(t("tab." + k))}${k === "requests" && g.pending_requests ? `<span class="dot">${g.pending_requests}</span>` : ""}${k === "messages" && g.unread_threads ? `<span class="dot">${g.unread_threads}</span>` : ""}</a>`).join("")}</div>
    <div id="tabbody"></div>`;
  wireShare(app);
  const pick = document.getElementById("gpick"); if (pick) pick.onchange = () => { location.hash = `#/dashboard?g=${pick.value}`; };
  const body = document.getElementById("tabbody");
  const refresh = () => dashboard(app, new URLSearchParams(location.hash.split("?")[1] || ""));
  const ctx = { g, body, refresh };
  wireStatus(app, g, refresh);
  await ({ requests, calendar: calTab, listing, extras, media, reviews, payments, messages }[tab])(ctx);
}

// Draft / paused / live: what customers can see right now, and the one button that changes it.
const PUB_TAB = { photos: "media", story: "listing", events: "listing", dates: "calendar", payouts: "payments" };
function statusBanner(g) {
  const link = (tab) => `#/dashboard?g=${encodeURIComponent(g.id)}&tab=${tab}`;
  const outside = g.outside_market ? `<div class="note">${esc(t("pub.outside", { market: state.meta.market.name }))}</div>` : "";
  if (g.status === "hidden") return `<div class="note warn" role="alert">${esc(t("pub.hidden"))}</div>`;
  if (g.status === "draft") {
    return `<div class="note warn draft"><strong>${esc(t("pub.draftTitle"))}</strong> ${esc(t("pub.draftText"))}
      ${g.publish_missing.length ? `<ul>${g.publish_missing.map((k) => `<li><a href="${esc(link(PUB_TAB[k]))}">${esc(t("pub." + k))}</a></li>`).join("")}</ul>` : ""}
      <button type="button" class="btn small" id="publish"${g.publish_missing.length ? " disabled" : ""}>${esc(t("pub.publish"))}</button></div>${outside}`;
  }
  if (g.status === "paused") return `<div class="note warn"><strong>${esc(t("pub.pausedTitle"))}</strong> ${esc(t("pub.pausedText"))} <button type="button" class="btn small" id="resume">${esc(t("pub.resume"))}</button></div>${outside}`;
  return `<div class="statusline"><span class="tag trust">● ${esc(t("pub.live"))}</span> <button type="button" class="linkbtn" id="pause">${esc(t("pub.pause"))}</button></div>${outside}`;
}
function wireStatus(root, g, refresh) {
  const gid = encodeURIComponent(g.id);
  const on = (id, fn) => { const el = root.querySelector("#" + id); if (el) el.onclick = fn; };
  on("publish", async () => { try { await api.post(`/api/groups/${gid}/publish`); toast(t("pub.published")); refresh(); } catch (e) { toast(e.message, "error"); } });
  on("resume", async () => { try { await api.post(`/api/groups/${gid}/pause`, { paused: false }); refresh(); } catch (e) { toast(e.message, "error"); } });
  on("pause", async () => { if (!confirm(t("pub.confirmPause"))) return; try { await api.post(`/api/groups/${gid}/pause`, { paused: true }); refresh(); } catch (e) { toast(e.message, "error"); } });
}

// Nudges a new group toward a profile that earns bookings.
function checklistCard(g, link) {
  const ck = g.checklist, pct = Math.round((ck.done / ck.total) * 100);
  if (ck.done === ck.total) return `<div class="note ok">✓ ${esc(t("chk.complete"))} ${shareButtons(g.name, "#/group/" + g.id)}</div>`;
  const todo = ck.items.filter((i) => !i.done);
  return `<details class="checklist"${pct < 70 ? " open" : ""}><summary><strong>${esc(t("chk.title"))}</strong> · ${esc(t("chk.progress", { done: ck.done, total: ck.total }))}<span class="bar" aria-hidden="true"><i style="width:${pct}%"></i></span></summary>
    <ul>${todo.map((i) => `<li><a href="${i.key === "alerts" ? "#/account" : esc(link({ tab: i.tab }))}">${esc(t("chk." + i.key))}</a></li>`).join("")}</ul></details>`;
}

export function newGroup(app) { createForm(app); }

function createForm(app) {
  const meta = state.meta;
  app.innerHTML = `<h1 class="sec">${esc(t("dash.create"))}</h1><p class="dim">${esc(t("dash.createSub"))}</p><div class="panel narrow"><form id="cform">
    <label for="c-name">${esc(t("dash.name"))}</label><input id="c-name" name="name" required minlength="2" maxlength="80">
    <label for="c-type">${esc(t("f.type"))}</label><select id="c-type" name="type">${meta.group_types.map((x) => `<option value="${esc(x)}">${esc(t("type." + x))}</option>`).join("")}</select>
    <div class="row"><div><label for="c-zip">${esc(t("dash.zip"))}</label><input id="c-zip" name="zip" inputmode="numeric" maxlength="5" required></div>
    <div><label for="c-mem">${esc(t("dash.members"))}</label><input id="c-mem" name="members" type="number" min="1" max="40" value="5" required></div></div>
    <label for="c-rate">${esc(t("dash.rate"))}</label><input id="c-rate" name="rate" type="number" min="50" max="5000" step="5" value="300" required>
    <label for="c-story">${esc(t("g.story"))}</label><textarea id="c-story" name="story" maxlength="800"></textarea>
    <div id="cerr" class="err" role="alert"></div><button class="btn wide" type="submit">${esc(t("dash.createBtn"))}</button></form></div>`;
  document.getElementById("cform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = document.getElementById("cerr"); err.textContent = "";
    try {
      const g = await api.post("/api/groups", { name: f.name, type: f.type, zip: f.zip, members: Number(f.members), rate: Number(f.rate), story: f.story });
      toast(t("dash.created")); location.hash = `#/dashboard?g=${g.id}&tab=calendar`;
    } catch (ex) { err.textContent = ex.message; }
  };
}

// ---- requests ----
async function requests({ g, body, refresh }) {
  const { bookings } = await api.get(`/api/groups/${encodeURIComponent(g.id)}/bookings`);
  const byDate = (dir) => (x, y) => (x.date < y.date ? -dir : x.date > y.date ? dir : 0);
  const sections = [
    ["dash.secNew", bookings.filter((b) => b.status === "requested").sort(byDate(1)), true],
    ["dash.secUpcoming", bookings.filter((b) => b.status === "confirmed").sort(byDate(1)), false],
    ["dash.secPast", bookings.filter((b) => !["requested", "confirmed"].includes(b.status)).sort(byDate(-1)), false]
  ];
  const phone = (b) => (b.phone ? ` · <a href="tel:${esc(b.phone)}">${esc(fmtPhone(b.phone))}</a>` : b.status === "requested" ? ` · <span class="dim">${esc(t("dash.phoneLater"))}</span>` : "");
  const balLine = (b) => (b.status === "confirmed" && b.balance_cents > 0
    ? `<br><span class="dim small">${esc(t(b.balance_status === "paid" ? "bal.groupPaid" : b.balance_status === "offline" ? "bal.groupOffline" : "bal.groupOwed", { amount: money(b.balance_cents) }))}</span>` : "");
  const rsBox = (b) => (b.reschedule && b.can_respond_reschedule
    ? `<div class="note small"><strong>${esc(t("rs.asks", { date: fmtDate(b.reschedule.date), time: b.reschedule.time }))}</strong>${b.reschedule.note ? `<br>“${esc(b.reschedule.note)}”` : ""}<br>
       <button class="btn small" data-rs="accept" data-id="${esc(b.id)}">${esc(t("rs.accept"))}</button> <button class="btn ghost small" data-rs="decline" data-id="${esc(b.id)}">${esc(t("rs.decline"))}</button></div>` : "");
  const row = (b) => `<div class="req"><div><strong>${esc(t("event." + b.event_type))}</strong> · ${esc(fmtDate(b.date))} · ${esc(b.time)} · ${esc(t("g.hours", { n: b.hours }))} ${statusBadge(b.status)}<br>
      ${esc(b.customer_name)} · ${esc(b.address)} · ${esc(t("dash.guests", { n: b.guests }))}${phone(b)}
      ${b.message ? `<br><span class="dim">“${esc(b.message)}”</span>` : ""}${balLine(b)}${rsBox(b)}</div>
      <div class="req-r"><strong>${money(b.total_cents)}</strong><br><span class="dim small">${esc(t("dash.money", { deposit: money(b.deposit_cents), fee: money(b.platform_fee_cents), payout: money(b.payout_cents), balance: money(b.balance_cents) }))}</span><br>
      ${b.can_respond ? `<button class="btn small" data-act="accept" data-id="${esc(b.id)}">${esc(t("dash.accept"))}</button> <button class="btn ghost small" data-act="decline" data-id="${esc(b.id)}">${esc(t("dash.decline"))}</button>` : ""}
      ${["requested", "confirmed"].includes(b.status) ? `<a class="btn ghost small" href="/api/bookings/${esc(b.id)}/ics" download>${esc(t("bk.ics"))}</a> ` : ""}
      ${b.can_mark_balance_offline ? `<button class="btn ghost small" data-off="${b.balance_status === "offline" ? "undo" : "mark"}" data-id="${esc(b.id)}" data-amount="${b.balance_cents}">${esc(t(b.balance_status === "offline" ? "bal.undoOffline" : "bal.markOffline"))}</button> ` : ""}
      ${b.status === "confirmed" && b.date > dkey(today()) ? `<button class="btn ghost small" data-act="cancel" data-id="${esc(b.id)}">${esc(t("bk.cancel"))}</button>` : ""}</div></div>`;
  const st30 = g.stats_30d;
  body.innerHTML = `<div class="panel"><h2 class="sec">${esc(t("tab.requests"))}</h2>
    <div class="tiles small" aria-label="${esc(t("stat.title"))}">${[["stat.views", st30.views], ["stat.requests", st30.requests], ["stat.confirmed", st30.confirmed]].map(([k, v]) => `<div class="tile"><div class="tile-l">${esc(t(k))} · ${esc(t("stat.title"))}</div><div class="tile-v">${v}</div></div>`).join("")}</div>${bookings.length
    ? sections.filter(([, list]) => list.length).map(([key, list, hot]) => `<div class="sec-h${hot ? " hot" : ""}"><strong>${esc(t(key))}</strong><span class="count">${list.length}</span></div>${list.map(row).join("")}`).join("")
    : `<div class="empty">${esc(t("dash.noReq"))}</div>`}</div>`;
  body.querySelectorAll("[data-off]").forEach((b) => {
    b.onclick = async () => {
      const mark = b.dataset.off === "mark";
      if (mark && !confirm(t("bal.confirmOffline", { amount: money(Number(b.dataset.amount)) }))) return;
      try { await api.post(`/api/bookings/${encodeURIComponent(b.dataset.id)}/balance-offline`, { received: mark }); toast(t("common.saved")); refresh(); } catch (e) { toast(e.message, "error"); }
    };
  });
  body.querySelectorAll("[data-rs]").forEach((b) => {
    b.onclick = async () => {
      const accept = b.dataset.rs === "accept";
      if (!accept && !confirm(t("rs.confirmDecline"))) return;
      try { await api.post(`/api/bookings/${encodeURIComponent(b.dataset.id)}/reschedule/respond`, { accept }); toast(t(accept ? "rs.accepted" : "rs.declined")); refresh(); } catch (e) { toast(e.message, "error"); }
    };
  });
  body.querySelectorAll("[data-act]").forEach((b) => {
    b.onclick = async () => {
      const act = b.dataset.act;
      if (act !== "accept" && !confirm(t(act === "decline" ? "dash.confirmDecline" : "dash.confirmCancel"))) return;
      try { await api.patch("/api/bookings/" + b.dataset.id, { action: act }); toast(t("common.saved")); refresh(); } catch (e) { toast(e.message, "error"); }
    };
  });
}

// ---- calendar ----
async function calTab({ g, body }) {
  const first = g.next_open ? new Date(Number(g.next_open.slice(0, 4)), Number(g.next_open.slice(5, 7)) - 1, 1) : null;
  const st = { month: first || new Date(today().getFullYear(), today().getMonth(), 1), date: null };
  body.innerHTML = `<div class="panel"><h2 class="sec">${esc(t("tab.calendar"))}</h2><div id="calbox"></div><div id="daybox"></div>
    <div class="quick"><button class="btn ghost small" id="fill">${esc(t("dash.fill"))}</button><button class="btn ghost small" id="clear">${esc(t("dash.clear"))}</button></div>
    <div class="legend">${esc(t("dash.calHint"))}</div></div>`;
  let data = { days: {}, booked: {} };
  async function load() { data = await api.get(`/api/groups/${encodeURIComponent(g.id)}/calendar?month=${monthKey(st.month)}`); draw(); }
  function draw() {
    const t0 = today();
    calendar(document.getElementById("calbox"), st, {
      dayState: (d) => ({ enabled: d > t0, open: Boolean((data.days[dkey(d)] || []).length) }),
      onPick: (k) => { st.date = k; draw(); },
      onMonth: load
    });
    const db = document.getElementById("daybox");
    if (!st.date) { db.innerHTML = ""; return; }
    const open = data.days[st.date] || [], booked = data.booked[st.date] || [];
    db.innerHTML = `<div class="dim" style="margin-top:10px">${esc(t("dash.slotsFor", { date: fmtDate(st.date) }))}</div><div class="slots">${state.meta.slots.map((s) => `<button type="button" class="slot${open.includes(s) ? " sel" : ""}" data-t="${esc(s)}"${booked.includes(s) ? " disabled" : ""}>${esc(s)}${booked.includes(s) ? ` (${esc(t("dash.booked"))})` : ""}</button>`).join("")}</div>`;
    db.querySelectorAll(".slot:not([disabled])").forEach((b) => {
      b.onclick = async () => {
        const s = b.dataset.t, cur = data.days[st.date] || [];
        const next = cur.includes(s) ? cur.filter((x) => x !== s) : state.meta.slots.filter((x) => cur.includes(x) || x === s);
        try { await api.put(`/api/groups/${encodeURIComponent(g.id)}/availability`, { dates: { [st.date]: next } }); if (next.length) data.days[st.date] = next; else delete data.days[st.date]; draw(); }
        catch (e) { toast(e.message, "error"); }
      };
    });
  }
  document.getElementById("fill").onclick = async () => {
    try { await api.post(`/api/groups/${encodeURIComponent(g.id)}/availability/weekends`, { weeks: 8 }); toast(t("common.saved")); st.month = nextWeekendMonth(); await load(); } catch (e) { toast(e.message, "error"); }
  };
  document.getElementById("clear").onclick = async () => {
    if (!confirm(t("dash.confirmClear"))) return;
    try { await api.del(`/api/groups/${encodeURIComponent(g.id)}/availability`); await load(); } catch (e) { toast(e.message, "error"); }
  };
  await load();
}
function nextWeekendMonth() {
  const d = today(); d.setDate(d.getDate() + 1);
  while (![0, 5, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ---- listing ----
function listing({ g, body, refresh }) {
  const meta = state.meta;
  body.innerHTML = `<div class="panel"><form id="lform">
    <div class="row"><div><label for="l-name">${esc(t("dash.name"))}</label><input id="l-name" name="name" required maxlength="80" value="${esc(g.name)}"></div>
    <div><label for="l-type">${esc(t("f.type"))}</label><select id="l-type" name="type">${meta.group_types.map((x) => `<option value="${esc(x)}"${sel(x, g.type)}>${esc(t("type." + x))}</option>`).join("")}</select></div></div>
    <div class="row"><div><label for="l-zip">${esc(t("dash.zip"))}</label><input id="l-zip" name="zip" inputmode="numeric" maxlength="5" required value="${esc(g.zip)}"></div>
    <div><label for="l-mem">${esc(t("dash.members"))}</label><input id="l-mem" name="members" type="number" min="1" max="40" value="${g.members}"></div></div>
    <div class="row"><div><label for="l-rate">${esc(t("dash.rate"))}</label><input id="l-rate" name="rate" type="number" min="50" max="5000" step="5" value="${g.rate_cents / 100}"></div>
    <div><label for="l-guests">${esc(t("dash.maxGuests"))}</label><input id="l-guests" name="max_guests" type="number" min="1" max="5000" value="${g.max_guests}"></div></div>
    <label for="l-story">${esc(t("g.story"))}</label><textarea id="l-story" name="story" maxlength="800">${esc(g.story)}</textarea>
    <label>${esc(t("dash.eventsDo"))}</label><div class="chips">${meta.events.map((e) => `<label class="chk chip"><input type="checkbox" name="ev" value="${esc(e)}"${g.events.includes(e) ? " checked" : ""}> <span>${esc(t("event." + e))}</span></label>`).join("")}</div>
    <h2 class="sec">${esc(t("dash.extras"))}</h2>
    <label class="chk"><input type="checkbox" name="sound"${g.sound_system ? " checked" : ""}> <span>${esc(t("dash.sound"))}</span></label>
    <div class="row"><div><label for="l-dress">${esc(t("g.dress"))}</label><input id="l-dress" name="dress_code" maxlength="120" value="${esc(g.dress_code)}"></div>
    <div><label for="l-set">${esc(t("dash.setMin"))}</label><input id="l-set" name="set_minutes" type="number" min="10" max="240" value="${g.set_minutes}"></div></div>
    <div class="row"><div><label for="l-tm">${esc(t("dash.travelMiles"))}</label><input id="l-tm" name="travel_miles" type="number" min="0" max="500" value="${g.travel_miles}"></div>
    <div><label for="l-tf">${esc(t("dash.travelFee"))}</label><input id="l-tf" name="travel_fee" type="number" min="0" max="2000" value="${g.travel_fee_cents / 100}"></div></div>
    <h2 class="sec">${esc(t("dash.terms"))}</h2>
    <div class="row"><div><label for="l-dep">${esc(t("dash.depositPct"))}</label><input id="l-dep" name="deposit_pct" type="number" min="20" max="50" value="${g.deposit_pct}"></div>
    <div><label for="l-pol">${esc(t("g.policy"))}</label><select id="l-pol" name="cancel_policy">${["flexible", "moderate", "strict"].map((k) => `<option value="${k}"${sel(k, g.cancel_policy)}>${esc(t("policy." + k))}</option>`).join("")}</select></div></div>
    <div class="dim small" id="polhint"></div>
    <label for="l-phone">${esc(t("dash.contactPhone"))}</label><input id="l-phone" name="contact_phone" inputmode="tel" maxlength="20" value="${esc(fmtPhone(g.contact_phone))}"><div class="dim small">${esc(t("dash.contactHint"))}</div>
    <div id="lerr" class="err" role="alert"></div><button class="btn" type="submit">${esc(t("common.save"))}</button></form></div>`;
  const hint = () => { document.getElementById("polhint").textContent = meta.policies[document.getElementById("l-pol").value][lang()]; };
  document.getElementById("l-pol").onchange = hint; hint();
  document.getElementById("lform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), f = Object.fromEntries(fd), err = document.getElementById("lerr"); err.textContent = "";
    try {
      await api.patch(`/api/groups/${encodeURIComponent(g.id)}`, {
        name: f.name, type: f.type, zip: f.zip, members: Number(f.members), rate: Number(f.rate), max_guests: Number(f.max_guests), story: f.story,
        events: fd.getAll("ev"), sound_system: f.sound === "on", dress_code: f.dress_code, set_minutes: Number(f.set_minutes),
        travel_miles: Number(f.travel_miles), travel_fee: Number(f.travel_fee), deposit_pct: Number(f.deposit_pct), cancel_policy: f.cancel_policy, contact_phone: f.contact_phone
      });
      toast(t("common.saved")); refresh();
    } catch (ex) { err.textContent = ex.message; }
  };
}

// ---- packages + songs ----
function extras({ g, body, refresh }) {
  body.innerHTML = `<div class="two"><div class="panel"><h2 class="sec">${esc(t("g.packages"))}</h2>
    ${g.packages.map((p) => `<div class="pkg"><div><strong>${esc(p.name)}</strong><br><span class="dim">${esc(p.description)} · ${esc(t("g.hours", { n: p.hours }))}</span></div><div class="pkg-r"><strong>${money(p.price_cents)}</strong><br><button class="btn ghost small" data-del="${p.id}">${esc(t("common.delete"))}</button></div></div>`).join("") || `<div class="dim">${esc(t("dash.noPkg"))}</div>`}
    <form id="pkform"><h3>${esc(t("dash.addPkg"))}</h3><label for="k-name">${esc(t("dash.pkgName"))}</label><input id="k-name" name="name" required maxlength="60" placeholder="${esc(t("dash.pkgEx"))}">
    <label for="k-desc">${esc(t("dash.pkgDesc"))}</label><input id="k-desc" name="description" maxlength="200">
    <div class="row"><div><label for="k-h">${esc(t("g.hoursLabel"))}</label><input id="k-h" name="hours" type="number" min="1" max="12" value="2" required></div><div><label for="k-p">${esc(t("dash.price"))}</label><input id="k-p" name="price" type="number" min="20" max="50000" required></div></div>
    <div id="kerr" class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("dash.addPkg"))}</button></form></div>
    <div class="panel"><h2 class="sec">♪ ${esc(t("g.songs"))}</h2><p class="dim small">${esc(t("dash.songsHint"))}</p><form id="sform2"><textarea id="songs" rows="12" maxlength="6000" aria-label="${esc(t("g.songs"))}">${esc(g.songs.join("\n"))}</textarea><div id="serr" class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("common.save"))}</button></form></div></div>`;
  body.querySelectorAll("[data-del]").forEach((b) => { b.onclick = async () => { if (!confirm(t("common.confirmDelete"))) return; try { await api.del("/api/packages/" + b.dataset.del); refresh(); } catch (e) { toast(e.message, "error"); } }; });
  document.getElementById("pkform").onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await api.post(`/api/groups/${encodeURIComponent(g.id)}/packages`, { name: f.name, description: f.description, hours: Number(f.hours), price: Number(f.price) }); refresh(); }
    catch (ex) { document.getElementById("kerr").textContent = ex.message; }
  };
  document.getElementById("sform2").onsubmit = async (e) => {
    e.preventDefault();
    try { await api.patch(`/api/groups/${encodeURIComponent(g.id)}`, { songs: document.getElementById("songs").value.split("\n").map((s) => s.trim()).filter(Boolean) }); toast(t("common.saved")); refresh(); }
    catch (ex) { document.getElementById("serr").textContent = ex.message; }
  };
}

// ---- photos + video ----
async function shrink(file, maxSide = 1600) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
  return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
}
function media({ g, body, refresh }) {
  body.innerHTML = `<div class="two"><div class="panel"><h2 class="sec">${esc(t("dash.photos"))} (${g.photos.length}/10)</h2><p class="dim small">${esc(t("dash.photosHint"))}</p>
    <div class="photogrid">${g.photos.map((p, i) => `<div class="ph-item"><img src="${esc(p.url)}" alt="" loading="lazy"><div>${i > 0 ? `<button class="btn ghost small" data-cover="${esc(p.id)}">${esc(t("dash.cover"))}</button>` : `<span class="tag">${esc(t("dash.isCover"))}</span>`} <button class="btn ghost small" data-rm="${esc(p.id)}">${esc(t("common.delete"))}</button></div></div>`).join("")}</div>
    ${g.photos.length < 10 ? `<label class="btn ghost" for="file">${esc(t("dash.addPhoto"))}</label><input type="file" id="file" accept="image/*" multiple hidden>` : ""}<div id="uerr" class="err" role="alert"></div></div>
    <div class="panel"><h2 class="sec">${esc(t("dash.video"))}</h2><p class="dim small">${esc(t("dash.videoHint"))}</p>
    <form id="vform"><input id="v-url" name="video_url" placeholder="https://youtu.be/…" value="" aria-label="${esc(t("dash.video"))}"><div id="verr" class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("common.save"))}</button></form>
    ${g.video ? `<div class="video"><iframe src="${esc(g.video.url)}" title="video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ""}</div></div>`;
  const gid = encodeURIComponent(g.id);
  body.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => { if (!confirm(t("common.confirmDelete"))) return; try { await api.del(`/api/groups/${gid}/photos/${b.dataset.rm}`); refresh(); } catch (e) { toast(e.message, "error"); } }; });
  body.querySelectorAll("[data-cover]").forEach((b) => { b.onclick = async () => { try { await api.post(`/api/groups/${gid}/photos/${b.dataset.cover}/cover`); refresh(); } catch (e) { toast(e.message, "error"); } }; });
  const file = document.getElementById("file");
  if (file) file.onchange = async () => {
    const err = document.getElementById("uerr"); err.textContent = "";
    for (const f of file.files) {
      try { await api.post(`/api/groups/${gid}/photos`, { data: await shrink(f) }); } catch (e) { err.textContent = e.message; break; }
    }
    refresh();
  };
  document.getElementById("vform").onsubmit = async (e) => {
    e.preventDefault();
    try { await api.patch(`/api/groups/${gid}`, { video_url: document.getElementById("v-url").value }); toast(t("common.saved")); refresh(); }
    catch (ex) { document.getElementById("verr").textContent = ex.message; }
  };
}

// ---- reviews: answer them in public ----
function reviews({ g, body, refresh }) {
  const list = g.recent_reviews;
  const when = (ts) => new Date(ts * 1000).toLocaleDateString(lang() === "es" ? "es-US" : "en-US");
  body.innerHTML = `<div class="panel"><h2 class="sec">${esc(t("tab.reviews"))}</h2><p class="dim small">${esc(t("rv.noContact"))}</p>${list.length ? list.map((r) => `<div class="review" data-id="${r.id}">${stars(r.rating)} <strong>${esc(r.name)}</strong> <span class="dim">${esc(when(r.created_at))}</span>${r.text ? `<p>${esc(r.text)}</p>` : ""}
    ${r.reply ? `<div class="reply"><strong>${esc(t("rv.ownerReply"))}</strong><p>${esc(r.reply.text)}</p></div>` : ""}
    <div class="rv-actions"><button type="button" class="btn ghost small" data-edit="${r.id}">${esc(r.reply ? t("rv.edit") : t("rv.reply"))}</button>${r.reply ? ` <button type="button" class="btn ghost small" data-rm="${r.id}">${esc(t("rv.remove"))}</button>` : ""}</div><div class="rv-form"></div></div>`).join("") : `<div class="empty">${esc(t("rv.none"))}</div>`}</div>`;
  body.querySelectorAll("[data-edit]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.edit, r = list.find((x) => String(x.id) === id), holder = b.closest(".review").querySelector(".rv-form");
      holder.innerHTML = `<form><label for="rv-${id}">${esc(t("rv.replyTitle"))}</label><textarea id="rv-${id}" name="text" maxlength="500" required>${esc(r.reply ? r.reply.text : "")}</textarea><div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("rv.replyBtn"))}</button></form>`;
      holder.querySelector("form").onsubmit = async (e) => {
        e.preventDefault();
        try { await api.post(`/api/reviews/${id}/reply`, { text: new FormData(e.target).get("text") }); toast(t("rv.saved")); refresh(); }
        catch (ex) { holder.querySelector(".err").textContent = ex.message; }
      };
    };
  });
  body.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => { if (!confirm(t("common.confirmDelete"))) return; try { await api.del(`/api/reviews/${b.dataset.rm}/reply`); toast(t("rv.removed")); refresh(); } catch (e) { toast(e.message, "error"); } }; });
}

// ---- payouts + featured ----
async function payments({ g, body, refresh }) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  if (params.get("stripe") === "return" || params.get("stripe") === "refresh") { try { await api.post(`/api/groups/${encodeURIComponent(g.id)}/stripe/refresh`); } catch { /* shown below */ } }
  if (params.get("feature")) { try { await api.post(`/api/feature/${encodeURIComponent(params.get("feature"))}/refresh`); } catch { /* shown below */ } }
  const { groups } = await api.get("/api/my/groups");
  const cur = groups.find((x) => x.id === g.id) || g;
  const until = cur.promoted_until * 1000;
  body.innerHTML = `<div class="two"><div class="panel"><h2 class="sec">${esc(t("dash.payouts"))}</h2>
    ${cur.stripe.mode === "simulated" ? `<div class="note">${esc(t("dash.payTest"))}</div>` : cur.stripe.ready ? `<div class="note ok">✓ ${esc(t("dash.payReady"))}</div>` : `<div class="note warn">${esc(t("dash.payNeeded"))}</div><button class="btn" id="onboard">${esc(cur.stripe.connected ? t("dash.payContinue") : t("dash.payStart"))}</button>`}
    <p class="dim small">${esc(t("dash.feeExplain"))}</p></div>
    <div class="panel"><h2 class="sec">⭐ ${esc(t("dash.featureTitle"))}</h2><p>${esc(t("dash.featureText"))}</p>
    ${until > Date.now() ? `<div class="note ok">${esc(t("dash.featuredUntil", { date: new Date(until).toLocaleDateString(lang() === "es" ? "es-US" : "en-US") }))}</div>` : ""}
    <button class="btn" id="feature">${esc(t("dash.buyFeature", { price: money(state.meta.feature_price_cents) }))}</button></div></div>`;
  const ob = document.getElementById("onboard");
  if (ob) ob.onclick = async () => { try { const r = await api.post(`/api/groups/${encodeURIComponent(g.id)}/stripe/onboard`); if (r.url) goto(r.url); else refresh(); } catch (e) { toast(e.message, "error"); } };
  document.getElementById("feature").onclick = async () => { try { const r = await api.post(`/api/groups/${encodeURIComponent(g.id)}/feature`); goto(r.url); } catch (e) { toast(e.message, "error"); } };
}

// ---- messages (and custom offers) ----
async function messages({ g, body, refresh }) {
  const gid = encodeURIComponent(g.id);
  const { threads } = await api.get(`/api/groups/${gid}/threads`);
  const until = (ts) => new Date(ts * 1000).toLocaleDateString(lang() === "es" ? "es-US" : "en-US");
  body.innerHTML = `<div class="two"><div><div class="panel"><h2 class="sec">${esc(t("tab.messages"))}</h2>${threads.length ? threads.map((th) => `<button class="thread${th.unread ? " unread" : ""}" data-c="${th.customer_id}"><strong>${esc(th.name)}</strong>${th.unread ? `<span class="dot">${esc(t("msg.new"))}</span>` : ""}<br><span class="dim small">${esc(th.last.text.slice(0, 60))}</span></button>`).join("") : `<div class="empty small">${esc(t("dash.noThreads"))}</div>`}</div>
    <div class="panel"><h2 class="sec">${esc(t("off.open"))}</h2>${g.open_offers.length ? g.open_offers.map((o) => `<div class="req"><div><strong>${esc(o.name)}</strong> · ${money(o.price_cents)}<br><span class="dim small">${esc(o.customer)} · ${esc(t("off.until", { date: until(o.expires_at) }))}</span></div><button class="btn ghost small" data-wd="${o.id}">${esc(t("off.withdraw"))}</button></div>`).join("") : `<div class="dim small">${esc(t("off.none"))}</div>`}</div></div>
    <div class="panel" id="conv" hidden></div></div>`;
  body.querySelectorAll("[data-wd]").forEach((b) => { b.onclick = async () => { try { await api.del(`/api/groups/${gid}/offers/${b.dataset.wd}`); refresh(); } catch (e) { toast(e.message, "error"); } }; });
  body.querySelectorAll(".thread").forEach((b) => {
    b.onclick = async () => {
      const cid = b.dataset.c, conv = document.getElementById("conv");
      const { messages: ms } = await api.get(`/api/groups/${gid}/threads/${cid}`);
      conv.hidden = false;
      conv.innerHTML = `<div id="convchat"></div><details class="quote-req"><summary>${esc(t("off.send"))}</summary><p class="dim small">${esc(t("off.hint"))}</p>
        <form novalidate><label for="of-name">${esc(t("off.name"))}</label><input id="of-name" name="name" required maxlength="60" placeholder="${esc(t("off.namePh"))}">
        <div class="row"><div><label for="of-h">${esc(t("off.hours"))}</label><input id="of-h" name="hours" type="number" min="1" max="12" value="3" required></div><div><label for="of-p">${esc(t("off.price"))}</label><input id="of-p" name="price" type="number" min="20" max="50000" required></div></div>
        <label for="of-n">${esc(t("off.note"))}</label><input id="of-n" name="note" maxlength="200"><div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("off.submit"))}</button></form></details>`;
      renderChat(document.getElementById("convchat"), { messages: ms, mine: "group", formId: "rform", inputId: "rin", send: (text) => api.post(`/api/groups/${gid}/threads/${cid}`, { text }) });
      conv.querySelector("details form").onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target)), err = conv.querySelector("details .err"); err.textContent = "";
        try { await api.post(`/api/groups/${gid}/offers`, { customerId: Number(cid), name: f.name, hours: Number(f.hours), price: Number(f.price), note: f.note }); toast(t("off.sent")); refresh(); }
        catch (ex) { err.textContent = ex.message; }
      };
      b.classList.remove("unread"); b.querySelector(".dot")?.remove();
      window.dispatchEvent(new CustomEvent("bm:attention"));
    };
  });
}
