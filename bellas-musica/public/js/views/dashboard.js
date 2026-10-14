import { api } from "../api.js";
import { storeApp } from "../appmode.js";
import { state } from "../state.js";
import { t, lang, setWho, currentScreen } from "../i18n.js";
import { esc, money, fmtDate, statusBadge, toast, today, dkey, sel, goto, fmtPhone, shareButtons, wireShare, stars, lenLabel, minutesOf } from "../ui.js";
import { calendar, monthKey } from "../calendar.js";
import { renderChat } from "../chat.js";
import { CAT_ORDER, catLabel, catOfType } from "../cats.js";
import { businessTab, bizBox, wireBiz, ownerOnly } from "./business.js";
import { pushPanel } from "./app.js";

// Type picker grouped by category (music, food, rentals...).
const typeOptions = (meta, current) => CAT_ORDER.map((c) => `<optgroup label="${esc(catLabel(c))}">${meta.categories[c].map((x) => `<option value="${esc(x)}"${x === current ? " selected" : ""}>${esc(t("type." + x))}</option>`).join("")}</optgroup>`).join("");

const TABS = ["requests", "calendar", "listing", "extras", "business", "media", "reviews", "payments", "messages"];
// On a phone the nine tabs become five, the bigger ones opening a second row: fewer, larger choices.
const TAB_GROUPS = [["requests", ["requests"]], ["calendar", ["calendar"]], ["page", ["listing", "extras", "media", "reviews"]], ["money", ["payments", "business"]], ["messages", ["messages"]]];

export async function dashboard(app, params) {
  const screen = currentScreen();
  const { groups } = await api.get("/api/my/groups");
  if (!groups.length) { createForm(app); return; }
  const g = groups.find((x) => x.id === params.get("g")) || groups[0];
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "requests";
  setWho(g.category, screen); // "Reply from the venue"…
  const link = (over) => { const q = new URLSearchParams({ g: g.id, tab, ...over }); return "#/dashboard?" + q.toString(); };
  const dot = (k) => (k === "requests" && g.pending_requests ? `<span class="dot">${g.pending_requests}</span>` : k === "messages" && g.unread_threads ? `<span class="dot">${g.unread_threads}</span>` : "");

  app.innerHTML = `<div class="titlebar"><h1>${esc(g.name)} <small class="dim">${esc(t("dash.title"))}</small></h1>
    <div class="seg">${groups.length > 1 ? `<select id="gpick" aria-label="${esc(t("dash.pick"))}">${groups.map((x) => `<option value="${esc(x.id)}"${sel(x.id, g.id)}>${esc(x.name)}${x.my_role === "manager" ? ` (${esc(t("team.manager"))})` : ""}</option>`).join("")}</select>` : ""}<a href="#/dashboard?new=1" id="newg">+ ${esc(t("dash.add"))}</a><a href="#/group/${esc(g.id)}">${esc(t("dash.view"))}</a></div></div>
    ${g.stripe.mode === "stripe" && !g.stripe.ready ? `<div class="note warn">${esc(t("dash.needPayout"))} <a href="${esc(link({ tab: "payments" }))}">${esc(t("dash.setUp"))}</a></div>` : ""}
    ${statusBanner(g)}
    ${tab === "requests" && g.status !== "draft" ? todayCard(g) : ""}
    <div id="pushnudge" hidden></div>
    ${g.status === "draft" ? "" : checklistCard(g, link)}
    <div class="tabs tabs-full" role="tablist">${TABS.map((k) => `<a role="tab" class="${k === tab ? "on" : ""}" href="${esc(link({ tab: k }))}">${esc(t("tab." + k))}${dot(k)}</a>`).join("")}</div>
    <div class="tabs tabs-grouped" role="tablist">${TAB_GROUPS.map(([k, tabs]) => `<a role="tab" class="${tabs.includes(tab) ? "on" : ""}" href="${esc(link({ tab: tabs[0] }))}">${esc(t(tabs.length > 1 ? "tabg." + k : "tab." + k))}${dot(k)}</a>`).join("")}</div>
    ${(() => { const grp = TAB_GROUPS.find(([, tabs]) => tabs.includes(tab))[1]; return grp.length > 1 ? `<div class="tabs tabs-sub" role="tablist">${grp.map((k) => `<a role="tab" class="${k === tab ? "on" : ""}" href="${esc(link({ tab: k }))}">${esc(t("tab." + k))}</a>`).join("")}</div>` : ""; })()}
    <div id="tabbody"></div>`;
  wireShare(app);
  pushPanel(document.getElementById("pushnudge"), { compact: true });
  const pick = document.getElementById("gpick"); if (pick) pick.onchange = () => { location.hash = `#/dashboard?g=${pick.value}`; };
  const body = document.getElementById("tabbody");
  const refresh = () => dashboard(app, new URLSearchParams(location.hash.split("?")[1] || ""));
  const ctx = { g, body, refresh };
  wireStatus(app, g, refresh);
  await ({ requests, calendar: calTab, listing, extras, business: businessTab, media, reviews, payments, messages }[tab])(ctx);
}

// "Today": the next gig, what's waiting for an answer, and money still to come, before anything else.
function todayCard(g) {
  const d = g.today, link = (tab) => `#/dashboard?g=${encodeURIComponent(g.id)}&tab=${tab}`;
  if (!d) return "";
  const when = (ts) => new Date(ts * 1000).toLocaleString(lang() === "es" ? "es-US" : "en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const rows = [];
  if (d.requests_waiting) rows.push(`<a class="today-row hot" href="${esc(link("requests"))}"><span>⏳</span><span>${esc(t(d.requests_waiting === 1 ? "today.reqOne" : "today.req", { n: d.requests_waiting }))} · ${esc(t("today.answerBy", { when: when(d.answer_by) }))}</span></a>`);
  if (d.next_gig) rows.push(`<a class="today-row" href="${esc(link("requests"))}"><span>📅</span><span>${esc(t("today.next"))}: <strong>${esc(fmtDate(d.next_gig.date))} · ${esc(d.next_gig.time)}</strong> · ${esc(t("event." + d.next_gig.event))} · ${esc(d.next_gig.customer)} (${esc(t(d.next_gig.guests === 1 ? "dash.guestsOne" : "dash.guests", { n: d.next_gig.guests }))})</span></a>`);
  if (d.unread_messages) rows.push(`<a class="today-row" href="${esc(link("messages"))}"><span>💬</span><span>${esc(t(d.unread_messages === 1 ? "today.msgOne" : "today.msg", { n: d.unread_messages }))}</span></a>`);
  if (d.to_collect_cents || d.held_cents) rows.push(`<a class="today-row" href="${esc(link("payments"))}"><span>💵</span><span>${d.to_collect_cents ? esc(t("today.collect", { amount: money(d.to_collect_cents) })) : ""}${d.to_collect_cents && d.held_cents ? " · " : ""}${d.held_cents ? esc(t("today.held", { amount: money(d.held_cents) })) : ""}</span></a>`);
  return `<div class="panel today" id="todaybox"><h2 class="sec">${esc(t("today.title"))}</h2>${rows.length ? rows.join("") : `<p class="dim">${esc(t("today.calm"))}</p>`}${d.gigs_30d ? `<p class="dim small">${esc(t(d.gigs_30d === 1 ? "today.gigsOne" : "today.gigs", { n: d.gigs_30d }))}</p>` : ""}</div>`;
}

// Replies vendors send again and again, in both languages: a tap fills the box, the vendor edits and sends.
function quickReplies(g) {
  const music = g.category === "music";
  return [
    { label: t("qr.price"), en: "Thanks for writing! Our prices are on our page, and the total shows as soon as you pick a date. Tell me your date, place and number of guests and I'll confirm.", es: "¡Gracias por escribir! Nuestros precios están en nuestra página y el total aparece en cuanto eliges la fecha. Dime tu fecha, lugar y número de invitados y te confirmo." },
    { label: t("qr.dates"), en: "Good news: we're free that day. You can book right on our page to hold the date with a deposit.", es: "Buenas noticias: estamos libres ese día. Puedes reservar en nuestra página para apartar la fecha con un depósito." },
    { label: t("qr.travel"), en: "Yes, we go to your area. If it's past our free miles, the travel fee shows in the total before you pay.", es: "Sí vamos a tu zona. Si queda más lejos de nuestras millas sin costo, el costo de viaje aparece en el total antes de pagar." },
    music
      ? { label: t("qr.songs"), en: "Yes, we play it! Send me the list of songs you'd like and we'll have them ready.", es: "¡Sí la tocamos! Mándame la lista de canciones que quieras y las tenemos listas." }
      : { label: t("qr.details"), en: "Yes, we can do that. Send me the details and we'll have everything ready.", es: "Sí, podemos hacerlo. Mándame los detalles y tenemos todo listo." },
    { label: t("qr.thanks"), en: "Thank you for choosing us! See you on the big day.", es: "¡Gracias por elegirnos! Nos vemos en el gran día." }
  ];
}

// "Mariachis near you usually start at $X–$Y": shown next to the price fields.
function priceInsightNote(g) {
  const p = g.price_insight;
  if (!p) return "";
  return `<p class="note small" id="priceinsight">📊 ${esc(t("pi.text", { type: t("type." + p.type), low: money(p.low_cents), high: money(p.high_cents), n: p.count }))} ${esc(t("pi.yours", { price: money(p.yours_cents) }))}</p>`;
}

// Draft / paused / live: what customers can see right now, and the one button that changes it.
const PUB_TAB = { photos: "media", story: "listing", events: "listing", packages: "extras", dates: "calendar", payouts: "payments" };
function statusBanner(g) {
  const link = (tab) => `#/dashboard?g=${encodeURIComponent(g.id)}&tab=${tab}`;
  const outside = g.outside_market ? `<div class="note">${esc(t("pub.outside", { market: state.meta.market.name }))}</div>` : "";
  if (g.status === "hidden") return `<div class="note warn" role="alert">${esc(t("pub.hidden"))}</div>`;
  if (g.status === "draft") {
    const fd = state.meta.founding;
    return `<div class="note warn draft"><strong>${esc(t("pub.draftTitle"))}</strong> ${esc(t("pub.draftText"))}
      ${fd && fd.left > 0 ? `<p class="small"><strong>🌟 ${esc(t("fd.draft", { pct: fd.fee_pct, months: Math.round(fd.days / 30), left: fd.left }))}</strong></p>` : ""}
      ${setupSteps(g, link)}
      <button type="button" class="btn small" id="publish"${g.publish_missing.length ? " disabled" : ""}>${esc(t("pub.publish"))}</button></div>${outside}`;
  }
  if (g.status === "paused") return `<div class="note warn"><strong>${esc(t("pub.pausedTitle"))}</strong> ${esc(t("pub.pausedText"))} <button type="button" class="btn small" id="resume">${esc(t("pub.resume"))}</button></div>${outside}`;
  return `<div class="statusline"><span class="tag trust">● ${esc(t("pub.live"))}</span> <button type="button" class="linkbtn" id="pause">${esc(t("pub.pause"))}</button></div>${outside}`;
}
// The draft's setup, as numbered steps: the ones already done are ticked, the rest link to where they are done.
function setupSteps(g, link) {
  const steps = ["photos", "story", "events", ...(!g.hourly || g.publish_missing.includes("packages") ? ["packages"] : []), "dates", ...(state.meta.payments === "stripe" ? ["payouts"] : [])];
  const row = (done, label, href) => `<li class="${done ? "done" : ""}">${done ? `<span aria-hidden="true">✓</span> ${esc(label)} <span class="sr-only">(${esc(t("pub.done"))})</span>` : `<a href="${esc(href)}">${esc(label)}</a>`}</li>`;
  return `<ol class="setup-steps">${row(true, t("pub.basics"))}${steps.map((k) => row(!g.publish_missing.includes(k), t("pub." + k), link(PUB_TAB[k]))).join("")}</ol>`;
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
  const fd = meta.founding;
  app.innerHTML = `<h1 class="sec">${esc(t("dash.create"))}</h1><p class="dim">${esc(t("dash.createSub"))}</p>
    ${fd && fd.left > 0 ? `<div class="note ok narrow">🌟 ${esc(t("fd.offer", { pct: fd.fee_pct, months: Math.round(fd.days / 30), left: fd.left, slots: fd.slots }))}</div>` : ""}<div class="panel narrow"><form id="cform">
    <label for="c-name">${esc(t("dash.name"))}</label><input id="c-name" name="name" required minlength="2" maxlength="80">
    <label for="c-type">${esc(t("f.type"))}</label><select id="c-type" name="type">${typeOptions(meta, "Mariachi")}</select><div class="dim small">${esc(t("dash.typeHint"))}</div>
    <div class="row"><div><label for="c-zip">${esc(t("dash.zip"))}</label><input id="c-zip" name="zip" inputmode="numeric" maxlength="5" required></div>
    <div><label for="c-mem" id="c-mem-l">${esc(t("dash.members"))}</label><input id="c-mem" name="members" type="number" min="1" max="40" value="5" required></div></div>
    <label class="chk"><input type="checkbox" id="c-hourly" name="hourly" checked> <span>${esc(t("dash.hourly"))}</span></label><div class="dim small">${esc(t("dash.hourlyHint"))}</div>
    <div id="c-rate-w"><label for="c-rate">${esc(t("dash.rate"))}</label><input id="c-rate" name="rate" type="number" min="50" max="5000" step="5" value="300"></div>
    <label for="c-story">${esc(t("g.story"))}</label><textarea id="c-story" name="story" maxlength="800"></textarea>
    <div id="cerr" class="err" role="alert"></div><button class="btn wide" type="submit">${esc(t("dash.createBtn"))}</button></form></div>`;
  // choosing a type sets sensible defaults: a tent company sells packages, a mariachi is booked by the hour
  const typeSel = document.getElementById("c-type"), hourlyBox = document.getElementById("c-hourly");
  const syncRate = () => { document.getElementById("c-rate-w").hidden = !hourlyBox.checked; };
  typeSel.onchange = () => { const c = catOfType(typeSel.value); hourlyBox.checked = meta.hourly_by_default[c]; document.getElementById("c-mem-l").textContent = t(c === "music" ? "dash.members" : "dash.team"); syncRate(); };
  hourlyBox.onchange = syncRate;
  document.getElementById("cform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = document.getElementById("cerr"); err.textContent = "";
    try {
      const hourly = hourlyBox.checked;
      const g = await api.post("/api/groups", { name: f.name, type: f.type, zip: f.zip, members: Number(f.members), hourly, ...(hourly ? { rate: Number(f.rate) } : {}), story: f.story });
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
  const showBox = (b) => {
    let out = b.checked_in ? `<br><span class="dim small">✓ ${esc(t("show.checkedInVendor"))}</span>` : "";
    if (b.checkin_locked && !b.checked_in) out += `<div class="note warn small">${esc(t("show.locked"))}</div>`;
    if (b.noshow && b.noshow.status === "reported") out += `<div class="note warn small">${esc(t("show.groupReport", { note: b.noshow.note }))}${b.noshow.reply ? `<br>${esc(t("show.answered", { text: b.noshow.reply }))}` : ""}${b.can_reply_noshow ? `<br><button class="btn small" data-nsreply="${esc(b.id)}">${esc(t("show.answer"))}</button>` : ""}</div>`;
    else if (b.noshow) out += `<div class="dim small">${esc(t(b.noshow.status === "refunded" ? "show.stRefunded" : "show.stRejected"))}</div>`;
    return out + `<div class="ci-slot"></div>`;
  };
  const row = (b) => `<div class="req"><div><strong>${esc(t("event." + b.event_type))}</strong> · ${esc(fmtDate(b.date))} · ${esc(b.time)} · ${esc(lenLabel(minutesOf(b)))} ${statusBadge(b.status)}<br>
      ${esc(b.customer_name)} · ${esc(b.address)} · ${esc(t("dash.guests", { n: b.guests }))}${phone(b)}
      ${(b.parts || []).filter((p) => p.status !== "stray").length ? `<br><span class="small">💵 ${(b.parts || []).filter((p) => p.status !== "stray").map((p) => esc(t("plan.padrinoPaid", { name: p.payer_name, amount: money(p.amount_cents) }))).join(" · ")}</span>` : ""}${b.discount_cents ? `<br><span class="small">🤝 ${esc(t(b.series_id && !b.bundle_id ? "wk.discounted" : "bun.discounted", { amount: money(b.discount_cents) }))}</span>` : ""}${b.arrival ? `<br><strong class="small">🕒 ${esc(t("dash.arrive", { time: b.arrival.at, label: b.arrival.label }))}</strong>` : ""}${b.addons && b.addons.length ? `<br><strong class="small">${esc(t("ao.line", { list: b.addons.map((a) => a.name).join(", ") }))}</strong>` : ""}${b.message ? `<br><span class="dim">“${esc(b.message)}”</span>` : ""}${balLine(b)}${showBox(b)}${rsBox(b)}${bizBox(b)}</div>
      <div class="req-r"><strong>${money(b.total_cents)}</strong><br><span class="dim small">${esc(t("dash.money", { deposit: money(b.deposit_cents), fee: money(b.platform_fee_cents), payout: money(b.payout_cents), balance: money(b.balance_cents) }))}</span><br>${b.payout_held ? `<span class="small hold">${esc(t("hold.vendor", { amount: money(b.payout_cents), n: state.meta.hold_events || 3 }))}</span><br>` : ""}
      ${b.can_respond && b.answer_by ? `<div class="dim small">⏳ ${esc(t("dash.answerBy", { when: new Date(b.answer_by * 1000).toLocaleString(lang() === "es" ? "es-US" : "en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) }))}</div>` : ""}
      ${b.can_respond ? `<button class="btn small" data-act="accept" data-id="${esc(b.id)}">${esc(t("dash.accept"))}</button> <button class="btn ghost small" data-act="decline" data-id="${esc(b.id)}">${esc(t("dash.decline"))}</button>` : ""}
      ${["requested", "confirmed"].includes(b.status) ? `<a class="btn ghost small" href="/api/bookings/${esc(b.id)}/ics" download>${esc(t("bk.ics"))}</a> ` : ""}
      ${b.status === "confirmed" ? `<a class="btn ghost small" href="#/agreement/${esc(b.id)}?g=${esc(g.id)}">${esc(t(b.signed && b.signed.group ? "agr.linkDone" : "agr.linkSign"))}</a> ` : ""}
      ${b.can_checkin ? `<button class="btn small" data-checkin="${esc(b.id)}">${esc(t("show.checkin"))}</button> ` : ""}
      ${b.can_mark_balance_offline && b.date >= dkey(today()) ? `<button class="btn ghost small" data-off="${b.balance_status === "offline" ? "undo" : "mark"}" data-id="${esc(b.id)}" data-amount="${b.balance_cents}">${esc(t(b.balance_status === "offline" ? "bal.undoOffline" : "bal.markOffline"))}</button> ` : ""}
      ${b.status === "confirmed" && b.date > dkey(today()) ? `<button class="btn ghost small" data-act="cancel" data-id="${esc(b.id)}">${esc(t("bk.cancel"))}</button>` : ""}</div><div class="biz-slot"></div></div>`;
  const st30 = g.stats_30d;
  // what the numbers say, in one sentence: few open the page (photo, price), or many look and nobody books (price, dates)
  const tip = st30.seen >= 20 && st30.views < st30.seen * 0.08 ? "stat.tipOpen" : st30.views >= 20 && !st30.requests ? "stat.tipBook" : "";
  body.innerHTML = `<div class="panel"><h2 class="sec">${esc(t("tab.requests"))}</h2>
    <div class="tiles small" aria-label="${esc(t("stat.title"))}">${[["stat.seen", st30.seen], ["stat.views", st30.views], ["stat.feedViews", st30.feed_views], ["stat.feedTaps", st30.feed_taps], ["stat.requests", st30.requests], ["stat.confirmed", st30.confirmed]].map(([k, v]) => `<div class="tile"><div class="tile-l">${esc(t(k))} · ${esc(t("stat.title"))}</div><div class="tile-v">${v}</div></div>`).join("")}</div>${tip ? `<p class="note small" id="stattip">💡 ${esc(t(tip))}</p>` : ""}${bookings.length
    ? sections.filter(([, list]) => list.length).map(([key, list, hot]) => `<div class="sec-h${hot ? " hot" : ""}"><strong>${esc(t(key))}</strong><span class="count">${list.length}</span></div>${list.map(row).join("")}`).join("")
    : `<div class="empty">${esc(t("dash.noReq"))}</div>`}</div>`;
  const slotForm = (btn, html, onSubmit) => {
    const slot = btn.closest(".req").querySelector(".ci-slot");
    slot.innerHTML = html;
    slot.querySelector("input, textarea").focus();
    slot.querySelector("form").onsubmit = async (e) => { e.preventDefault(); try { await onSubmit(new FormData(e.target)); } catch (ex) { slot.querySelector(".err").textContent = ex.message; } };
  };
  body.querySelectorAll("[data-checkin]").forEach((b) => {
    b.onclick = () => slotForm(b, `<form class="note small"><p class="dim small">${esc(t("show.checkinHint"))}</p><label for="ci-${esc(b.dataset.checkin)}">${esc(t("show.checkinCode"))}</label><input id="ci-${esc(b.dataset.checkin)}" name="code" inputmode="numeric" maxlength="4" pattern="\\d{4}" required autocomplete="off"><div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("show.checkinGo"))}</button></form>`,
      async (f) => { await api.post(`/api/bookings/${encodeURIComponent(b.dataset.checkin)}/checkin`, { code: f.get("code") }); toast(t("show.checkinDone")); refresh(); });
  });
  body.querySelectorAll("[data-nsreply]").forEach((b) => {
    b.onclick = () => slotForm(b, `<form class="note small"><label for="nr-${esc(b.dataset.nsreply)}">${esc(t("show.answerLabel"))}</label><textarea id="nr-${esc(b.dataset.nsreply)}" name="reply" maxlength="400" required minlength="5"></textarea><div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("show.answerSend"))}</button></form>`,
      async (f) => { await api.post(`/api/bookings/${encodeURIComponent(b.dataset.nsreply)}/noshow/reply`, { reply: f.get("reply") }); toast(t("show.answerSaved")); refresh(); });
  });
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
  wireBiz(body, g, refresh);
}

// ---- calendar ----
// Two-way calendar: block times from the vendor's own calendar, and a private feed of bookings to add to it.
async function drawSync(g) {
  const box = document.getElementById("calsync"); if (!box) return;
  const gid = encodeURIComponent(g.id);
  let s;
  try { s = (await api.get(`/api/groups/${gid}/calendar-sync`)).sync; } catch { return; }
  const when = s.synced_at ? new Date(s.synced_at * 1000).toLocaleString(lang() === "es" ? "es-US" : "en-US") : "";
  box.innerHTML = `<h2 class="sec">🔄 ${esc(t("cal.syncTitle"))}</h2>
    <h3 class="small-h">${esc(t("cal.importTitle"))}</h3><p class="dim small">${esc(t("cal.importHint"))}</p>
    ${s.import_url ? `<div class="note ${s.error ? "warn" : "ok"} small">${s.error ? esc(t("cal.importError", { error: s.error })) : esc(t("cal.importOk", { n: s.busy_days, when }))}</div>` : ""}
    <form id="calimp" class="cform"><input id="cal-url" type="url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" aria-label="${esc(t("cal.importTitle"))}" value="${esc(s.import_url)}"><button class="btn small" type="submit">${esc(t(s.import_url ? "cal.importAgain" : "cal.import"))}</button>${s.import_url ? `<button type="button" class="linkbtn small" id="cal-stop">${esc(t("cal.stop"))}</button>` : ""}<div class="err" role="alert" id="cal-err" style="flex-basis:100%"></div></form>
    <h3 class="small-h">${esc(t("cal.feedTitle"))}</h3><p class="dim small">${esc(t("cal.feedHint"))}</p>
    ${s.feed_url ? `<div class="copyrow"><input readonly id="cal-feed" value="${esc(s.feed_url)}" aria-label="${esc(t("cal.feedTitle"))}"><button type="button" class="btn small" id="cal-copy">${esc(t("pp.copy"))}</button><button type="button" class="linkbtn small" id="cal-new">${esc(t("pp.newLink"))}</button></div>` : `<button type="button" class="btn small" id="cal-new">${esc(t("cal.feedMake"))}</button>`}`;
  document.getElementById("calimp").onsubmit = async (e) => {
    e.preventDefault(); const err = document.getElementById("cal-err"); err.textContent = t("cal.reading");
    try { await api.put(`/api/groups/${gid}/calendar-sync/import`, { url: document.getElementById("cal-url").value.trim() }); toast(t("common.saved")); location.reload(); } catch (ex) { err.textContent = ex.message; }
  };
  const stop = document.getElementById("cal-stop"); if (stop) stop.onclick = async () => { await api.del(`/api/groups/${gid}/calendar-sync/import`); location.reload(); };
  document.getElementById("cal-new").onclick = async () => { await api.post(`/api/groups/${gid}/calendar-sync/feed`); drawSync(g); };
  const cp = document.getElementById("cal-copy"); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(s.feed_url); toast(t("share.copied")); } catch { document.getElementById("cal-feed").select(); } };
}

async function calTab({ g, body, refresh }) {
  const first = g.next_open ? new Date(Number(g.next_open.slice(0, 4)), Number(g.next_open.slice(5, 7)) - 1, 1) : null;
  const st = { month: first || new Date(today().getFullYear(), today().getMonth(), 1), date: null };
  const times = state.meta.times || state.meta.slots;
  const opts = (v) => times.map((x) => `<option value="${esc(x)}"${x === v ? " selected" : ""}>${esc(x)}</option>`).join("");
  body.innerHTML = `<div class="panel"><h2 class="sec">${esc(t("tab.calendar"))}</h2><div id="calbox"></div><div id="daybox"></div>
    <div class="quick"><button class="btn ghost small" id="fill">${esc(t("dash.fill"))}</button><button class="btn ghost small" id="clear">${esc(t("dash.clear"))}</button></div>
    <div class="legend">${esc(t("dash.calHint"))}</div></div>
    <div class="panel" id="crewpanel"><h2 class="sec">🚚 ${esc(t("cap.title"))}</h2><p class="dim small">${esc(t("cap.hint"))}</p>
      <form id="capform" novalidate><div class="row"><div><label for="cap-n">${esc(t("cap.label"))}</label><select id="cap-n" name="capacity">${Array.from({ length: 20 }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === (g.capacity || 1) ? " selected" : ""}>${n}</option>`).join("")}</select></div>
      <div><label for="cap-b">${esc(t("cap.buffer"))}</label><select id="cap-b" name="buffer_min">${[0, 15, 30, 45, 60, 90, 120].map((m) => `<option value="${m}"${m === (g.buffer_min || 0) ? " selected" : ""}>${esc(m ? lenLabel(m) : t("cap.none"))}</option>`).join("")}</select></div>
      <div><label for="cap-w">${esc(t("wk.discLabel"))}</label><select id="cap-w" name="weekly_discount_pct">${[0, 5, 10, 15, 20, 25, 30].map((p) => `<option value="${p}"${p === (g.weekly_discount_pct || 0) ? " selected" : ""}>${p ? p + "%" : esc(t("cap.none"))}</option>`).join("")}</select></div></div>
      <div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("common.save"))}</button></form></div>
    <div class="panel" id="calsync"></div>`;
  drawSync(g);
  document.getElementById("capform").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, err = f.querySelector(".err"); err.textContent = "";
    try { const r = await api.patch(`/api/groups/${encodeURIComponent(g.id)}`, { capacity: Number(f.capacity.value), buffer_min: Number(f.buffer_min.value), weekly_discount_pct: Number(f.weekly_discount_pct.value) }); g.capacity = r.capacity; g.buffer_min = r.buffer_min; g.weekly_discount_pct = r.weekly_discount_pct; toast(t("common.saved")); }
    catch (ex) { err.textContent = ex.message; }
  };
  let data = { days: {}, booked: {}, lengths: {} };
  async function load() { data = await api.get(`/api/groups/${encodeURIComponent(g.id)}/calendar?month=${monthKey(st.month)}`); draw(); }
  const save = async (dates) => { try { await api.put(`/api/groups/${encodeURIComponent(g.id)}/availability`, { dates }); await load(); } catch (e) { toast(e.message, "error"); } };
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
    const windows = open.filter((x) => x.includes("-")), extra = open.filter((x) => !x.includes("-") && !state.meta.slots.includes(x));
    const dayName = parseKeyLocal(st.date).toLocaleDateString(lang() === "es" ? "es-US" : "en-US", { weekday: "long" });
    db.innerHTML = `<div class="dim" style="margin-top:10px">${esc(t("dash.slotsFor", { date: fmtDate(st.date) }))}</div><div class="slots">${state.meta.slots.map((s) => `<button type="button" class="slot${open.includes(s) ? " sel" : ""}" data-t="${esc(s)}"${booked.includes(s) ? " disabled" : ""}>${esc(s)}${booked.includes(s) ? ` (${esc(t("dash.booked"))})` : ""}</button>`).join("")}</div>
      ${extra.length ? `<div class="slots">${extra.map((s) => `<button type="button" class="slot sel" data-t="${esc(s)}" title="${esc(t("cal.remove"))}">${esc(s)} ✕</button>`).join("")}</div>` : ""}
      ${windows.map((w) => `<div class="win-row"><span>🕒 ${esc(t("cal.window", { from: w.split("-")[0], to: w.split("-")[1] }))}</span> <button type="button" class="linkbtn" data-delwin="${esc(w)}">${esc(t("cal.remove"))}</button></div>`).join("")}
      <details class="cal-more"${windows.length || extra.length ? " open" : ""}><summary>${esc(t("cal.more"))}</summary>
        <p class="dim small">${esc(t("cal.moreHint"))}</p>
        <div class="row"><div><label for="cal-one">${esc(t("cal.oneTime"))}</label><select id="cal-one">${opts("5:00 AM")}</select></div><div class="row-btn"><button type="button" class="btn ghost small" id="cal-add1">${esc(t("cal.add"))}</button></div></div>
        <div class="row"><div><label for="cal-from">${esc(t("cal.from"))}</label><select id="cal-from">${opts("10:00 AM")}</select></div><div><label for="cal-to">${esc(t("cal.to"))}</label><select id="cal-to">${opts("11:00 PM")}</select></div><div class="row-btn"><button type="button" class="btn ghost small" id="cal-addw">${esc(t("cal.addWindow"))}</button></div></div>
        ${open.length ? `<button type="button" class="btn ghost small" id="cal-copy">${esc(t("cal.copy", { day: dayName }))}</button>` : ""}
      </details>
      ${(data.lengths[st.date] || []).length ? `<div class="dim small" style="margin-top:8px">${esc(t("cal.bookedList"))} ${(data.lengths[st.date] || []).map((x) => esc(`${x.time} · ${lenLabel(x.minutes)}`)).join(", ")}</div>` : ""}`;
    db.querySelectorAll(".slot:not([disabled])").forEach((b) => {
      b.onclick = () => { const s = b.dataset.t, cur = data.days[st.date] || []; save({ [st.date]: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] }); };
    });
    db.querySelectorAll("[data-delwin]").forEach((b) => { b.onclick = () => save({ [st.date]: (data.days[st.date] || []).filter((x) => x !== b.dataset.delwin) }); });
    document.getElementById("cal-add1").onclick = () => { const v = document.getElementById("cal-one").value, cur = data.days[st.date] || []; if (!cur.includes(v)) save({ [st.date]: [...cur, v] }); };
    document.getElementById("cal-addw").onclick = () => {
      const a = document.getElementById("cal-from").value, b = document.getElementById("cal-to").value;
      if (times.indexOf(b) <= times.indexOf(a)) { toast(t("cal.badWindow"), "error"); return; }
      save({ [st.date]: [...(data.days[st.date] || []), `${a}-${b}`] });
    };
    const cp = document.getElementById("cal-copy");
    if (cp) cp.onclick = async () => {
      const base = parseKeyLocal(st.date), dates = {};
      for (let i = 1; i <= 8; i++) { const d = new Date(base); d.setDate(d.getDate() + 7 * i); dates[dkey(d)] = data.days[st.date]; }
      await save(dates); toast(t("cal.copied"));
    };
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
const parseKeyLocal = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
function nextWeekendMonth() {
  const d = today(); d.setDate(d.getDate() + 1);
  while (![0, 5, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ---- listing ----
function listing({ g, body, refresh }) {
  const meta = state.meta, music = g.category === "music";
  body.innerHTML = `<div class="panel"><form id="lform">
    <div class="row"><div><label for="l-name">${esc(t("dash.name"))}</label><input id="l-name" name="name" required maxlength="80" value="${esc(g.name)}"></div>
    <div><label for="l-type">${esc(t("f.type"))}</label><select id="l-type" name="type">${typeOptions(meta, g.type)}</select></div></div>
    <div class="row"><div><label for="l-zip">${esc(t("dash.zip"))}</label><input id="l-zip" name="zip" inputmode="numeric" maxlength="5" required value="${esc(g.zip)}"></div>
    <div><label for="l-mem">${esc(t(music ? "dash.members" : "dash.team"))}</label><input id="l-mem" name="members" type="number" min="1" max="40" value="${g.members}"></div></div>
    <label class="chk"><input type="checkbox" id="l-hourly" name="hourly"${g.hourly ? " checked" : ""}> <span>${esc(t("dash.hourly"))}</span></label><div class="dim small">${esc(t("dash.hourlyHint"))}</div>
    <div class="row"><div id="l-rate-w"${g.hourly ? "" : " hidden"}><label for="l-rate">${esc(t("dash.rate"))}</label><input id="l-rate" name="rate" type="number" min="50" max="5000" step="5" value="${g.rate_cents ? g.rate_cents / 100 : ""}"></div>
    <div><label for="l-guests">${esc(t("dash.maxGuests"))}</label><input id="l-guests" name="max_guests" type="number" min="1" max="5000" value="${g.max_guests}"></div></div>
    ${priceInsightNote(g)}
    <div id="l-minh-w"${g.hourly ? "" : " hidden"}><label for="l-minh">${esc(t("dash.minHours"))}</label><select id="l-minh" name="min_hours">${[1, 2, 3, 4, 5, 6].map((h) => `<option value="${h}"${h === g.min_hours ? " selected" : ""}>${esc(t("g.hours", { n: h }))}</option>`).join("")}</select><div class="dim small">${esc(t("dash.minHoursHint"))}</div></div>
    <label for="l-story">${esc(t("g.story"))}</label><textarea id="l-story" name="story" maxlength="800">${esc(g.story)}</textarea>
    <label>${esc(t("dash.eventsDo"))}</label><div class="chips">${meta.events.map((e) => `<label class="chk chip"><input type="checkbox" name="ev" value="${esc(e)}"${g.events.includes(e) ? " checked" : ""}> <span>${esc(t("event." + e))}</span></label>`).join("")}</div>
    <h2 class="sec">${esc(t("dash.extras"))}</h2>
    <div${music ? "" : " hidden"}><label class="chk"><input type="checkbox" name="sound"${g.sound_system ? " checked" : ""}> <span>${esc(t("dash.sound"))}</span></label>
    <div class="row"><div><label for="l-dress">${esc(t("g.dress"))}</label><input id="l-dress" name="dress_code" maxlength="120" value="${esc(g.dress_code)}"></div>
    <div><label for="l-set">${esc(t("dash.setMin"))}</label><input id="l-set" name="set_minutes" type="number" min="10" max="240" value="${g.set_minutes}"></div></div></div>
    <div class="row"><div><label for="l-tm">${esc(t("dash.travelMiles"))}</label><input id="l-tm" name="travel_miles" type="number" min="0" max="500" value="${g.travel_miles}"></div>
    <div><label for="l-tf">${esc(t("dash.travelFee"))}</label><input id="l-tf" name="travel_fee" type="number" min="0" max="2000" value="${g.travel_fee_cents / 100}"></div></div>
    <p class="dim small">${esc(t("dash.reachHint"))}</p>
    <label for="l-wp">${esc(t("wp.label"))}</label><textarea id="l-wp" name="weather_policy" maxlength="300" placeholder="${esc(t("wp.ph"))}">${esc(g.weather_policy || "")}</textarea><div class="dim small">${esc(t("wp.hint"))}</div>
    <h2 class="sec">${esc(t("dash.terms"))}</h2>
    <div class="row"><div><label for="l-dep">${esc(t("dash.depositPct"))}</label><input id="l-dep" name="deposit_pct" type="number" min="20" max="50" value="${g.deposit_pct}"></div>
    <div><label for="l-pol">${esc(t("g.policy"))}</label><select id="l-pol" name="cancel_policy">${["flexible", "moderate", "strict"].map((k) => `<option value="${k}"${sel(k, g.cancel_policy)}>${esc(t("policy." + k))}</option>`).join("")}</select></div></div>
    <div class="dim small" id="polhint"></div>
    <label for="l-phone">${esc(t("dash.contactPhone"))}</label><input id="l-phone" name="contact_phone" inputmode="tel" maxlength="20" value="${esc(fmtPhone(g.contact_phone))}"><div class="dim small">${esc(t("dash.contactHint"))}</div>
    <div id="lerr" class="err" role="alert"></div><button class="btn" type="submit">${esc(t("common.save"))}</button></form></div>`;
  const hint = () => { document.getElementById("polhint").textContent = meta.policies[document.getElementById("l-pol").value][lang()]; };
  document.getElementById("l-pol").onchange = hint; hint();
  const hb = document.getElementById("l-hourly");
  hb.onchange = () => { document.getElementById("l-rate-w").hidden = !hb.checked; document.getElementById("l-minh-w").hidden = !hb.checked; };
  document.getElementById("lform").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), f = Object.fromEntries(fd), err = document.getElementById("lerr"); err.textContent = "";
    try {
      await api.patch(`/api/groups/${encodeURIComponent(g.id)}`, {
        name: f.name, type: f.type, zip: f.zip, members: Number(f.members), hourly: hb.checked, ...(hb.checked ? { rate: Number(f.rate), min_hours: Number(f.min_hours) } : {}), max_guests: Number(f.max_guests), story: f.story,
        events: fd.getAll("ev"), sound_system: f.sound === "on", dress_code: f.dress_code, set_minutes: Number(f.set_minutes),
        travel_miles: Number(f.travel_miles), travel_fee: Number(f.travel_fee), deposit_pct: Number(f.deposit_pct), cancel_policy: f.cancel_policy, contact_phone: f.contact_phone, weather_policy: f.weather_policy
      });
      toast(t("common.saved")); refresh();
    } catch (ex) { err.textContent = ex.message; }
  };
}

// ---- packages + songs ----
function extras({ g, body, refresh }) {
  const have = new Set(g.addons.map((a) => a.name.toLowerCase()));
  const presets = (state.meta.addon_presets[g.type] || state.meta.addon_presets._ || []).filter((p) => !have.has(p.en.toLowerCase()) && !have.has(p.es.toLowerCase()));
  body.innerHTML = `<div class="two"><div class="panel"><h2 class="sec">${esc(t("g.packages"))}</h2>${priceInsightNote(g)}
    ${g.packages.map((p) => `<div class="pkg"><div><strong>${esc(p.name)}</strong><br><span class="dim">${esc(p.description)} · ${esc(lenLabel(minutesOf(p)))}</span></div><div class="pkg-r"><strong>${money(p.price_cents)}</strong><br><button class="btn ghost small" data-del="${p.id}">${esc(t("common.delete"))}</button></div></div>`).join("") || `<div class="dim">${esc(t("dash.noPkg"))}</div>`}
    <form id="pkform"><h3>${esc(t("dash.addPkg"))}</h3><label for="k-name">${esc(t("dash.pkgName"))}</label><input id="k-name" name="name" required maxlength="60" placeholder="${esc(t("dash.pkgEx"))}">
    <label for="k-desc">${esc(t("dash.pkgDesc"))}</label><input id="k-desc" name="description" maxlength="200">
    <div class="row"><div><label for="k-h">${esc(t("g.hoursLabel"))}</label><input id="k-h" name="hours" type="number" min="1" max="12" value="2" required></div><div><label for="k-short">${esc(t("pk.short"))}</label><select id="k-short" name="minutes"><option value="">${esc(t("pk.noShort"))}</option>${(state.meta.short_minutes || [15, 20, 30, 45]).map((m) => `<option value="${m}">${esc(t("g.minutes", { n: m }))}</option>`).join("")}</select></div><div><label for="k-p">${esc(t("dash.price"))}</label><input id="k-p" name="price" type="number" min="20" max="50000" required></div></div>
    <div id="kerr" class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("dash.addPkg"))}</button></form></div>
    <div class="panel"${g.category === "music" ? "" : " hidden"}><h2 class="sec">♪ ${esc(t("g.songs"))}</h2><p class="dim small">${esc(t("dash.songsHint"))}</p><form id="sform2"><textarea id="songs" rows="12" maxlength="6000" aria-label="${esc(t("g.songs"))}">${esc(g.songs.join("\n"))}</textarea><div id="serr" class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("common.save"))}</button></form></div></div>
    <div class="panel" id="addons-panel"><h2 class="sec">${esc(t("ao.manage"))}</h2><p class="dim small">${esc(t("ao.hint"))}${g.type === "DJ" ? " " + esc(t("ao.djTip")) : ""}</p>
    ${g.addons.map((a) => `<div class="pkg"><div><strong>${esc(a.name)}</strong>${a.description ? `<br><span class="dim">${esc(a.description)}</span>` : ""}</div><div class="pkg-r"><strong>${a.price_cents ? money(a.price_cents) : esc(t("ao.included"))}</strong><br><button type="button" class="btn ghost small" data-delao="${a.id}">${esc(t("common.delete"))}</button></div></div>`).join("") || `<div class="dim">${esc(t("ao.none"))}</div>`}
    <form id="aoform" novalidate>${presets.length ? `<div class="dim small">${esc(t("ao.quick"))}</div><div class="chips" id="ao-presets">${presets.map((p) => `<button type="button" class="chip" data-preset="${esc(p[lang()])}">+ ${esc(p[lang()])}</button>`).join("")}</div>` : ""}
    <label for="ao-name">${esc(t("ao.name"))}</label><input id="ao-name" name="name" required maxlength="60">
    <label for="ao-desc">${esc(t("ao.desc"))}</label><input id="ao-desc" name="description" maxlength="160">
    <label for="ao-price">${esc(t("ao.price"))}</label><input id="ao-price" name="price" type="number" min="0" max="5000" step="5" inputmode="numeric" value="0" required>
    <div id="aoerr" class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("ao.add"))}</button></form></div>
    <div class="panel" id="bundles-panel"><h2 class="sec">🤝 ${esc(t("bun.manage"))}</h2><p class="dim small">${esc(t("bun.manageHint"))}</p><div id="bun-list" class="dim">…</div>
    <form id="bunform" novalidate><h3>${esc(t("bun.new"))}</h3><label for="bu-name">${esc(t("bun.name"))}</label><input id="bu-name" maxlength="60" placeholder="${esc(t("bun.namePh"))}">
    <div class="row"><div><label for="bu-pct">${esc(t("bun.pct"))}</label><input id="bu-pct" type="number" min="5" max="30" value="10"></div><div><label for="bu-partners">${esc(t("bun.partners"))}</label><input id="bu-partners" placeholder="${esc(t("bun.partnersPh"))}"></div></div>
    <div id="bu-err" class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("bun.create"))}</button></form></div>`;
  const drawBundles = async () => {
    const box = document.getElementById("bun-list"); if (!box) return;
    let list = [];
    try { list = (await api.get(`/api/groups/${encodeURIComponent(g.id)}/bundles`)).bundles; } catch { /* shown empty */ }
    box.innerHTML = list.length ? `<ul class="plist">${list.map((b) => `<li><span><strong>${esc(b.name)}</strong> · ${b.discount_pct}% <span class="badge ${b.active ? "confirmed" : "requested"}">${esc(t(b.active ? "bun.active" : "bun.waiting"))}</span><br><span class="small">${b.members.map((m) => `${esc(m.name)}${m.accepted ? " ✓" : " …"}`).join(" + ")}</span></span>
      <span>${b.mine_accepted ? "" : `<button type="button" class="btn small" data-bacc="${esc(b.id)}">${esc(t("bun.accept"))}</button> `}<button type="button" class="linkbtn small" data-bleave="${esc(b.id)}">${esc(t(b.created_by === g.id ? "bun.end" : "bun.leave"))}</button></span></li>`).join("")}</ul>` : `<span class="dim">${esc(t("bun.none"))}</span>`;
    box.querySelectorAll("[data-bacc]").forEach((x) => { x.onclick = async () => { try { await api.post(`/api/bundles/${encodeURIComponent(x.dataset.bacc)}/accept`, { groupId: g.id }); drawBundles(); } catch (e) { toast(e.message, "error"); } }; });
    box.querySelectorAll("[data-bleave]").forEach((x) => { x.onclick = async () => { if (!confirm(t("bun.confirmLeave"))) return; try { await api.del(`/api/bundles/${encodeURIComponent(x.dataset.bleave)}?groupId=${encodeURIComponent(g.id)}`); drawBundles(); } catch (e) { toast(e.message, "error"); } }; });
  };
  drawBundles();
  document.getElementById("bunform").onsubmit = async (e) => {
    e.preventDefault();
    const partners = document.getElementById("bu-partners").value.split(/[\s,]+/).filter(Boolean);
    try { await api.post(`/api/groups/${encodeURIComponent(g.id)}/bundles`, { name: document.getElementById("bu-name").value, discount_pct: Number(document.getElementById("bu-pct").value), partners }); e.target.reset(); toast(t("bun.sent")); drawBundles(); }
    catch (ex) { document.getElementById("bu-err").textContent = ex.message; }
  };
  body.querySelectorAll("[data-preset]").forEach((b) => { b.onclick = () => { const n = document.getElementById("ao-name"); n.value = b.dataset.preset; document.getElementById("ao-price").focus(); document.getElementById("ao-price").select(); }; });
  body.querySelectorAll("[data-delao]").forEach((b) => { b.onclick = async () => { if (!confirm(t("common.confirmDelete"))) return; try { await api.del("/api/addons/" + b.dataset.delao); refresh(); } catch (e) { toast(e.message, "error"); } }; });
  document.getElementById("aoform").onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await api.post(`/api/groups/${encodeURIComponent(g.id)}/addons`, { name: f.name, description: f.description, price: Number(f.price) }); refresh(); }
    catch (ex) { document.getElementById("aoerr").textContent = ex.message; }
  };
  body.querySelectorAll("[data-del]").forEach((b) => { b.onclick = async () => { if (!confirm(t("common.confirmDelete"))) return; try { await api.del("/api/packages/" + b.dataset.del); refresh(); } catch (e) { toast(e.message, "error"); } }; });
  document.getElementById("pkform").onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await api.post(`/api/groups/${encodeURIComponent(g.id)}/packages`, { name: f.name, description: f.description, hours: Number(f.hours), ...(f.minutes ? { minutes: Number(f.minutes) } : {}), price: Number(f.price) }); refresh(); }
    catch (ex) { document.getElementById("kerr").textContent = ex.message; }
  };
  document.getElementById("sform2").onsubmit = async (e) => {
    e.preventDefault();
    try { await api.patch(`/api/groups/${encodeURIComponent(g.id)}`, { songs: document.getElementById("songs").value.split("\n").map((s) => s.trim()).filter(Boolean) }); toast(t("common.saved")); refresh(); }
    catch (ex) { document.getElementById("serr").textContent = ex.message; }
  };
}

// ---- photos + video ----
export async function shrink(file, maxSide = 1600) {
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
    ${g.video ? `<div class="video${["tiktok", "instagram"].includes(g.video.provider) ? " tall" : ""}"><iframe src="${esc(g.video.url)}" title="video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ""}</div></div>`;
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
async function reviews({ g, body, refresh }) {
  const list = g.recent_reviews;
  const replyUrl = (id) => (String(id).startsWith("c") ? `/api/client-reviews/${encodeURIComponent(String(id).slice(1))}/reply` : `/api/reviews/${id}/reply`);
  const when = (ts) => new Date(ts * 1000).toLocaleDateString(lang() === "es" ? "es-US" : "en-US");
  body.innerHTML = `<div class="panel"><h2 class="sec">${esc(t("tab.reviews"))}</h2><p class="dim small">${esc(t("rv.noContact"))}</p>${list.length ? list.map((r) => `<div class="review" data-id="${r.id}">${stars(r.rating)} <strong>${esc(r.name)}</strong> ${r.past_client ? `<span class="tag past">${esc(t("pr.label"))}</span> ` : ""}<span class="dim">${esc(when(r.created_at))}</span>${r.text ? `<p>${esc(r.text)}</p>` : ""}
    ${r.reply ? `<div class="reply"><strong>${esc(t("rv.ownerReply"))}</strong><p>${esc(r.reply.text)}</p></div>` : ""}
    <div class="rv-actions"><button type="button" class="btn ghost small" data-edit="${r.id}">${esc(r.reply ? t("rv.edit") : t("rv.reply"))}</button>${r.reply ? ` <button type="button" class="btn ghost small" data-rm="${r.id}">${esc(t("rv.remove"))}</button>` : ""}</div><div class="rv-form"></div></div>`).join("") : `<div class="empty">${esc(t("rv.none"))}</div>`}</div>`;
  body.querySelectorAll("[data-edit]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.edit, r = list.find((x) => String(x.id) === id), holder = b.closest(".review").querySelector(".rv-form");
      holder.innerHTML = `<form><label for="rv-${id}">${esc(t("rv.replyTitle"))}</label><textarea id="rv-${id}" name="text" maxlength="500" required>${esc(r.reply ? r.reply.text : "")}</textarea><div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("rv.replyBtn"))}</button></form>`;
      holder.querySelector("form").onsubmit = async (e) => {
        e.preventDefault();
        try { await api.post(replyUrl(id), { text: new FormData(e.target).get("text") }); toast(t("rv.saved")); refresh(); }
        catch (ex) { holder.querySelector(".err").textContent = ex.message; }
      };
    };
  });
  body.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => { if (!confirm(t("common.confirmDelete"))) return; try { await api.del(replyUrl(b.dataset.rm)); toast(t("rv.removed")); refresh(); } catch (e) { toast(e.message, "error"); } }; });
  if (!g.demo) await pastClientPanel({ g, body });
}

// Ask clients from before Bella's Fiestas for a review: a one-time link by email or WhatsApp.
async function pastClientPanel({ g, body }) {
  const gid = encodeURIComponent(g.id);
  let data;
  try { data = await api.get(`/api/groups/${gid}/client-reviews`); } catch { return; }
  const thisMonth = new Date().toISOString().slice(0, 7);
  const st = (i) => (i.status === "done" ? `${t("pr.st.done")} ${"★".repeat(i.rating)}` : t("pr.st." + i.status));
  const box = document.createElement("div"); box.className = "panel"; box.id = "pastrev";
  box.innerHTML = `<h2 class="sec">💬 ${esc(t("pr.title"))}</h2><p>${esc(t("pr.text", { max: data.max }))}</p><p class="dim small">${esc(t("pr.count", { done: data.done, max: data.max }))}</p>
    ${data.done >= data.max ? `<p class="note">${esc(t("pr.max", { max: data.max }))}</p>` : `<form id="prinv"><div class="row"><div><label for="pi-name">${esc(t("pr.name"))}</label><input id="pi-name" name="name" required minlength="2" maxlength="60"></div>
      <div><label for="pi-email">${esc(t("pr.email"))}</label><input id="pi-email" name="email" type="email" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="120"></div></div><div class="dim small">${esc(t("pr.emailHint"))}</div>
      <div class="row"><div><label for="pi-event">${esc(t("pr.event"))}</label><select id="pi-event" name="event">${state.meta.events.map((x) => `<option value="${esc(x)}">${esc(t("event." + x))}</option>`).join("")}</select></div>
      <div><label for="pi-when">${esc(t("pr.when"))}</label><input id="pi-when" name="when" type="month" max="${thisMonth}" value="${thisMonth}" required></div></div>
      <div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("pr.create"))}</button></form>`}
    <div id="prlink"></div>
    ${data.invites.length ? `<div class="plist">${data.invites.map((i) => `<div class="req"><div><strong>${esc(i.client_name)}</strong> <span class="dim small">${esc(t("event." + i.event))} · ${esc(i.when)}${i.email ? ` · ${esc(i.email)}` : ""}</span></div>
      <div><span class="tag${i.status === "done" ? " trust" : ""}">${esc(st(i))}</span>${i.status !== "done" ? ` <button type="button" class="btn ghost small" data-prnew="${esc(i.id)}" data-name="${esc(i.client_name)}" data-event="${esc(i.event)}">${esc(t("pr.newLink"))}</button> <button type="button" class="linkbtn" data-prdel="${esc(i.id)}">${esc(t("pr.cancel"))}</button>` : ""}</div></div>`).join("")}</div>` : ""}`;
  body.appendChild(box);
  const show = (url, name, event, emailed) => {
    const msg = `${t("pr.wa", { name, event: t("event." + event).toLowerCase() })} ${url}`;
    box.querySelector("#prlink").innerHTML = `<div class="note ok">${esc(t("pr.made", { name }))}<div class="copyrow"><input readonly value="${esc(url)}" id="prurl" aria-label="${esc(t("pr.title"))}"><button type="button" class="btn small" id="prcopy">${esc(t("pp.copy"))}</button><a class="btn ghost small" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(msg)}">WhatsApp</a></div>${emailed ? `<p class="small">${esc(t("pr.emailed"))}</p>` : ""}</div>`;
    box.querySelector("#prcopy").onclick = async () => { try { await navigator.clipboard.writeText(url); toast(t("share.copied")); } catch { window.prompt(t("pp.copy"), url); } };
  };
  const f = box.querySelector("#prinv");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target)), err = f.querySelector(".err"); err.textContent = "";
    try { const r = await api.post(`/api/groups/${gid}/client-reviews`, { ...v, lang: lang() }); box.remove(); const fresh = await pastClientPanel({ g, body }); if (fresh) fresh.show(r.url, v.name, v.event, r.emailed); document.getElementById("pastrev").scrollIntoView({ block: "nearest" }); }
    catch (ex) { err.textContent = ex.message; }
  };
  box.querySelectorAll("[data-prnew]").forEach((b) => { b.onclick = async () => { try { show((await api.post(`/api/client-reviews/${encodeURIComponent(b.dataset.prnew)}/link`)).url, b.dataset.name, b.dataset.event, false); } catch (e) { toast(e.message, "error"); } }; });
  box.querySelectorAll("[data-prdel]").forEach((b) => { b.onclick = async () => { if (!confirm(t("common.confirmDelete"))) return; try { await api.del(`/api/client-reviews/${encodeURIComponent(b.dataset.prdel)}`); box.remove(); await pastClientPanel({ g, body }); } catch (e) { toast(e.message, "error"); } }; });
  return { show };
}

// ---- payouts + featured ----
async function payments({ g, body, refresh }) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  if (params.get("stripe") === "return" || params.get("stripe") === "refresh") { try { await api.post(`/api/groups/${encodeURIComponent(g.id)}/stripe/refresh`); } catch { /* shown below */ } }
  if (params.get("feature")) { try { await api.post(`/api/feature/${encodeURIComponent(params.get("feature"))}/refresh`); } catch { /* shown below */ } }
  const { groups } = await api.get("/api/my/groups");
  const cur = groups.find((x) => x.id === g.id) || g;
  const until = cur.promoted_until * 1000, spotUntil = (cur.spotlight_until || 0) * 1000, loc = lang() === "es" ? "es-US" : "en-US";
  const perks = (keys) => `<ul class="perks">${keys.map((k) => `<li>${esc(t(k))}</li>`).join("")}</ul>`;
  body.innerHTML = `<div class="two"><div class="panel"><h2 class="sec">${esc(t("dash.payouts"))}</h2>
    ${cur.stripe.mode === "simulated" ? `<div class="note">${esc(t("dash.payTest"))}</div>` : cur.stripe.ready ? `<div class="note ok">✓ ${esc(t("dash.payReady"))}</div>` : `<div class="note warn">${esc(t("dash.payNeeded"))}</div><button class="btn" id="onboard">${esc(cur.stripe.connected ? t("dash.payContinue") : t("dash.payStart"))}</button>`}
    <p class="dim small">${esc(t("dash.feeExplain"))}</p>${state.meta.hold_events && !g.demo && (g.events_done || 0) < state.meta.hold_events ? `<p class="note small">🔒 ${esc(t("hold.payTab", { n: state.meta.hold_events }))}</p>` : ""}</div>
    <div class="panel" id="seen"><h2 class="sec">⭐ ${esc(t("seen.title"))}</h2><p class="small">${esc(t("seen.text"))}</p>
    ${spotUntil > Date.now() ? `<div class="note ok">${esc(t("seen.spotUntil", { date: new Date(spotUntil).toLocaleDateString(loc) }))}</div>` : ""}
    ${until > Date.now() ? `<div class="note ok">${esc(t("dash.featuredUntil", { date: new Date(until).toLocaleDateString(loc) }))}</div>` : ""}
    <div class="levels"><div class="level"><h3>${esc(t("seen.feat"))} <span class="lv-price">${money(state.meta.feature_price_cents)}</span></h3>${perks(["seen.f1", "seen.f2", "seen.f3"])}${spotUntil > Date.now() ? `<p class="dim small">${esc(t("seen.afterSpot"))}</p>` : ""}
        ${storeApp() ? "" : `<button class="btn ghost wide" id="feature">${esc(t("seen.buyFeat", { price: money(state.meta.feature_price_cents) }))}</button>`}</div>
      <div class="level best"><span class="lv-tag">${esc(t("seen.best"))}</span><h3>★ ${esc(t("seen.spot"))} <span class="lv-price">${money(state.meta.spotlight_price_cents)}</span></h3>${perks(["seen.s1", "seen.s2", "seen.s3", "seen.s4"])}
        ${storeApp() ? "" : `<button class="btn wide" id="spotlight">${esc(t("seen.buySpot", { price: money(state.meta.spotlight_price_cents) }))}</button>`}</div></div>
    ${storeApp() ? `<p class="note small">${esc(t("app.buyOnWeb"))}</p>` : ""}</div></div>`;
  const ob = document.getElementById("onboard");
  if (ob) ob.onclick = async () => { try { const r = await api.post(`/api/groups/${encodeURIComponent(g.id)}/stripe/onboard`); if (r.url) goto(r.url); else refresh(); } catch (e) { toast(e.message, "error"); } };
  const buy = (level) => async () => { try { const r = await api.post(`/api/groups/${encodeURIComponent(g.id)}/feature`, { level }); goto(r.url); } catch (e) { toast(e.message, "error"); } };
  if (document.getElementById("feature")) document.getElementById("feature").onclick = buy("feature");
  if (document.getElementById("spotlight")) document.getElementById("spotlight").onclick = buy("spotlight");
  await growPanels({ g: cur, body, refresh });
  ownerOnly(body, cur); // payouts, Pro and Featured are the owner's
}

// Pro, referrals, the free website page, earnings and licenses: everything that helps a vendor grow, under Payments.
async function growPanels({ g, body, refresh }) {
  const gid = encodeURIComponent(g.id), meta = state.meta, loc = lang() === "es" ? "es-US" : "en-US";
  const [ref, docs, earn] = await Promise.all([api.get("/api/my/referral").catch(() => null), api.get(`/api/groups/${gid}/documents`).catch(() => ({ documents: [], needed: [] })), api.get(`/api/groups/${gid}/earnings`).catch(() => null)]);
  const proUntil = g.pro_until * 1000, discountUntil = g.fee_discount_until * 1000;
  const site = `${location.origin}/v/${g.id}`;
  const e = earn && earn.earnings;
  body.insertAdjacentHTML("beforeend", `<div class="two">
    <div class="panel"><h2 class="sec">★ ${esc(t("pro.title"))}</h2><p>${esc(t("pro.text", { fee: meta.pro_fee_pct, base: meta.fee_pct }))}</p>
      <p class="small">${esc(t("pro.feeNow", { pct: g.fee_pct }))}${discountUntil > Date.now() ? ` · ${esc(t("ref.activeUntil", { date: new Date(discountUntil).toLocaleDateString(loc) }))}` : ""}</p>
      ${g.founding_until * 1000 > Date.now() ? `<div class="note ok">${esc(t("fd.you", { n: g.founding_no, pct: meta.founding ? meta.founding.fee_pct : g.fee_pct, date: new Date(g.founding_until * 1000).toLocaleDateString(loc) }))}</div>` : ""}
      ${proUntil > Date.now() ? `<div class="note ok">${esc(t("pro.until", { date: new Date(proUntil).toLocaleDateString(loc) }))}</div>` : ""}
      ${storeApp() ? `<p class="note small">${esc(t("app.buyOnWeb"))}</p>` : `<button class="btn" id="buypro">${esc(t("pro.buy", { price: money(meta.pro_price_cents) }))}</button>`}</div>
    <div class="panel"><h2 class="sec">🤝 ${esc(t("ref.title"))}</h2><p>${esc(t("ref.text", { days: ref ? ref.days : 30 }))}</p>
      ${ref ? `<div class="copyrow"><input readonly value="${esc(ref.url)}" aria-label="${esc(t("ref.title"))}" id="reflink"><button type="button" class="btn small" data-copy="reflink">${esc(t("pp.copy"))}</button><a class="btn ghost small" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(t("ref.wa") + " " + ref.url)}">WhatsApp</a></div>
      <p class="dim small">${esc(t("ref.stats", { invited: ref.invited, live: ref.live }))}</p>` : ""}</div>
  </div>
  <div class="two">
    <div class="panel"><h2 class="sec">🌐 ${esc(t("site.title"))}</h2><p>${esc(t("site.text"))}</p>
      <div class="copyrow"><input readonly value="${esc(site)}" aria-label="${esc(t("site.title"))}" id="sitelink"><button type="button" class="btn small" data-copy="sitelink">${esc(t("pp.copy"))}</button><a class="btn ghost small" href="/v/${esc(g.id)}" target="_blank" rel="noopener">${esc(t("site.open"))}</a></div>
      <p class="dim small">${esc(t("site.hint"))}</p></div>
    <div class="panel"><h2 class="sec">📄 ${esc(t("doc.title"))}</h2><p class="small">${esc(t("doc.text"))}</p>
      ${docs.needed.length ? `<p class="small"><strong>${esc(t("doc.needed"))}</strong> ${docs.needed.map((k) => esc(t("doc." + k))).join(", ")}</p>` : ""}
      ${docs.documents.length ? `<ul class="plist">${docs.documents.map((d) => `<li><span>${esc(t("doc." + d.kind))}${d.expires ? ` · ${esc(t("doc.expires", { date: d.expires }))}` : ""}${d.note ? `<br><span class="dim small">${esc(d.note)}</span>` : ""}</span><span class="badge ${d.status === "approved" ? "confirmed" : d.status === "pending" ? "requested" : "cancelled"}">${esc(t("doc.st." + d.status))}</span></li>`).join("")}</ul>` : ""}
      <form id="docform" class="cform"><label class="sr-only" for="doc-kind">${esc(t("doc.kind"))}</label><select id="doc-kind">${["insurance", "health_permit", "business_license", "security_license", "other"].map((k) => `<option value="${k}">${esc(t("doc." + k))}</option>`).join("")}</select>
        <label class="btn ghost small" for="doc-file">${esc(t("doc.upload"))}</label><input type="file" id="doc-file" accept="application/pdf,image/*" hidden><div class="err" id="doc-err" role="alert" style="flex-basis:100%"></div></form></div>
  </div>
  ${e ? `<div class="panel"><div class="titlebar"><h2 class="sec">💵 ${esc(t("earn.title", { year: e.year }))}</h2><a class="btn ghost small" href="/api/groups/${esc(g.id)}/earnings.csv?year=${e.year}" download>${esc(t("earn.csv"))}</a></div>
    <div class="tablewrap" tabindex="0" role="region" aria-label="${esc(t("earn.title", { year: e.year }))}"><table class="earn"><thead><tr><th scope="col">${esc(t("earn.month"))}</th><th scope="col">${esc(t("earn.events"))}</th><th scope="col">${esc(t("earn.deposits"))}</th><th scope="col">${esc(t("earn.balances"))}</th><th scope="col">${esc(t("earn.extras"))}</th><th scope="col">${esc(t("earn.tips"))}</th><th scope="col">${esc(t("earn.offline"))}</th><th scope="col">${esc(t("earn.fees"))}</th></tr></thead>
    <tbody>${e.months.filter((m) => m.events || m.deposits_cents || m.balances_cents || m.extras_cents || m.tips_cents || m.offline_cents).map((m) => `<tr><th scope="row">${esc(new Date(m.month + "-15").toLocaleDateString(loc, { month: "long" }))}</th><td>${m.events}</td><td>${money(m.deposits_cents)}</td><td>${money(m.balances_cents)}</td><td>${money(m.extras_cents || 0)}</td><td>${money(m.tips_cents || 0)}</td><td>${money(m.offline_cents)}</td><td>${money(m.fees_cents)}</td></tr>`).join("") || `<tr><td colspan="8" class="dim">${esc(t("earn.none"))}</td></tr>`}</tbody>
    <tfoot><tr><th scope="row">${esc(t("earn.total"))}</th><td>${e.total.events}</td><td>${money(e.total.deposits_cents)}</td><td>${money(e.total.balances_cents)}</td><td>${money(e.total.extras_cents || 0)}</td><td>${money(e.total.tips_cents || 0)}</td><td>${money(e.total.offline_cents)}</td><td>${money(e.total.fees_cents)}</td></tr></tfoot></table></div>
    <p class="dim small">${esc(t("earn.note"))}</p></div>` : ""}`);
  body.querySelectorAll("[data-copy]").forEach((b) => { b.onclick = async () => { const i = document.getElementById(b.dataset.copy); try { await navigator.clipboard.writeText(i.value); toast(t("share.copied")); } catch { i.select(); } }; });
  if (document.getElementById("buypro")) document.getElementById("buypro").onclick = async () => { try { goto((await api.post(`/api/groups/${gid}/pro`)).url); } catch (ex) { toast(ex.message, "error"); } };
  document.getElementById("doc-file").onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const err = document.getElementById("doc-err"); err.textContent = "";
    if (f.size > 5 * 1024 * 1024) { err.textContent = t("doc.tooBig"); return; }
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
    try { await api.post(`/api/groups/${gid}/documents`, { kind: document.getElementById("doc-kind").value, data }); toast(t("doc.sent")); refresh(); } catch (ex) { err.textContent = ex.message; }
  };
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
      renderChat(document.getElementById("convchat"), { messages: ms, mine: "group", formId: "rform", inputId: "rin", quick: quickReplies(g), send: (text) => api.post(`/api/groups/${gid}/threads/${cid}`, { text }) });
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
