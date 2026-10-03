import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang } from "../i18n.js";
import { esc, money, fmtDate, stars, toast, today, goto, shareButtons, wireShare, fmtPhone, tomorrowKey, sel } from "../ui.js";
import { calendar, monthKey } from "../calendar.js";
import { renderChat } from "../chat.js";
import { heart, loadFavs, wireHearts } from "../fav.js";

const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

export async function group(app, id, params = new URLSearchParams()) {
  let g;
  try { g = await api.get("/api/groups/" + encodeURIComponent(id)); }
  catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)} <a href="#/">${esc(t("common.back"))}</a></div>`; return; }
  document.title = `${g.name} · Bella's Música`;
  const meta = state.meta, user = state.user;
  await loadFavs();
  // Private offers the group made this customer (if any).
  let offers = [];
  if (user && !g.is_owner) { try { offers = (await api.get(`/api/groups/${encodeURIComponent(g.id)}/offers`)).offers; } catch { /* no offers */ } }
  let deals = [];
  try { deals = (await api.get(`/api/groups/${encodeURIComponent(g.id)}/bundle-deals`)).bundles; } catch { /* none */ }
  const badges = (g.pro ? `<span class="tag pro" title="${esc(t("badge.proTip"))}">★ Pro</span>` : "") + (g.licensed ? `<span class="tag trust" title="${esc(t("badge.licensedTip"))}">📄 ${esc(t("badge.licensed"))}</span>` : "") + (g.verified ? `<span class="tag trust" title="${esc(t("badge.verifiedTip"))}">✓ ${esc(t("badge.verified"))}</span>` : "") + (g.insured ? `<span class="tag trust" title="${esc(t("badge.insuredTip"))}">🛡 ${esc(t("badge.insured"))}</span>` : "");
  const replies = g.response ? `<span class="dim">${esc(t("resp." + g.response.bucket))}</span>` : "";
  const st = { month: new Date(today().getFullYear(), today().getMonth(), 1), date: null, time: null, days: {} };
  // What the customer already told us on the search page.
  const ctx = { event: params.get("event") || "", guests: params.get("guests") || "", zip: params.get("zip") || "", date: params.get("date") || "" };
  const monthOf = (k) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1);
  const policy = meta.policies[g.cancel_policy] || {};

  const music = g.category === "music";
  const fact = (k, v) => `<div class="fact"><span>${esc(t(k))}</span><strong>${v}</strong></div>`;
  const gallery = g.photos.length ? `<div class="gallery"><img id="hero-img" src="${esc(g.photos[0].url)}" alt="${esc(g.name)}">${g.photos.length > 1 ? `<div class="thumbs">${g.photos.map((p, i) => `<button type="button" class="thumb" data-i="${i}" aria-label="${esc(t("g.photo", { n: i + 1 }))}"><img src="${esc(p.url)}" alt=""></button>`).join("")}</div>` : ""}</div>` : "";
  const video = g.video ? `<div class="video${["tiktok", "instagram"].includes(g.video.provider) ? " tall" : ""}"><iframe src="${esc(g.video.url)}" title="${esc(g.name)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : "";

  app.innerHTML = `<a class="back" href="#/">← ${esc(t("common.back"))}</a>
  <div class="gp"><div class="gp-main">
  <div class="panel"><div class="titlebar"><h1>${esc(g.name)}${g.promoted ? ` <span class="feat inline">${esc(t("card.featured"))}</span>` : ""}${g.demo ? ` <span class="tag sample">${esc(t("card.sample"))}</span>` : ""}</h1><div class="titlebtns">${g.is_owner ? "" : heart(g.id, "big")}${shareButtons(g.name, "#/group/" + g.id)}</div></div>
    <div class="meta">${g.reviews ? `<span class="stars">★ ${g.rating.toFixed(1)}</span><span>(${esc(t("g.reviews", { n: g.reviews }))})</span>` : `<span class="stars">★ ${esc(t("card.new"))}</span>`}<span class="tag">${esc(t("type." + g.type))}</span>${g.events_done ? `<span class="tag trust">${esc(g.events_done === 1 ? t("card.doneOne") : t("card.done", { n: g.events_done }))}</span>` : ""}${g.min_hours > 1 ? `<span class="tag">${esc(t("g.minHours", { n: g.min_hours }))}</span>` : ""}${badges}<span>${esc(g.city)}, ${esc(g.state)}</span>${replies}</div>
    ${gallery}${video}
    <div class="facts">
      ${fact(music ? "g.members" : "g.team", g.members)}${fact("g.guests", esc(t("g.upto", { n: g.max_guests })))}${music ? fact("g.set", esc(t("g.minutes", { n: g.set_minutes }))) : ""}
      ${music ? fact("g.sound", g.sound_system ? esc(t("common.yes")) : esc(t("common.no"))) : ""}${music && g.dress_code ? fact("g.dress", esc(g.dress_code)) : ""}
      ${fact("g.travel", esc(g.travel_fee_cents ? t("g.travelFee", { miles: g.travel_miles, fee: money(g.travel_fee_cents) }) : t("g.travelFree", { miles: g.travel_miles })))}
      ${fact("g.deposit", `${g.deposit_pct}%`)}${fact("g.policy", esc(t("policy." + g.cancel_policy)))}
    </div>
    <p class="dim">${esc(policy[lang()] || "")}</p>${g.weather_policy ? `<p class="small"><strong>🌦 ${esc(t("wp.label"))}:</strong> ${esc(g.weather_policy)}</p>` : ""}
    <h2 class="sec">${esc(t("g.story"))}</h2><p>${esc(g.story || t("g.noStory"))}</p>
    ${g.events.length ? `<div class="chips">${g.events.map((e) => `<span class="tag">${esc(t("event." + e))}</span>`).join("")}</div>` : ""}
  </div>
  ${music && g.songs.length ? `<div class="panel"><h2 class="sec">♪ ${esc(t("g.songs"))} (${g.songs.length})</h2><input id="songfilter" placeholder="${esc(t("g.songFilter"))}" aria-label="${esc(t("g.songFilter"))}"><ul class="songs" id="songlist"></ul></div>` : ""}
  ${offers.length ? `<div class="panel offer"><h2 class="sec">${esc(t("off.title"))}</h2><div class="pkgs">${offers.map((o) => `<div class="pkg"><div><span class="tag trust">${esc(t("off.tag"))}</span> <strong>${esc(o.name)}</strong><br><span class="dim">${o.description ? esc(o.description) + " · " : ""}${esc(t("g.hours", { n: o.hours }))} · ${esc(t("off.until", { date: new Date(o.expires_at * 1000).toLocaleDateString(lang() === "es" ? "es-US" : "en-US") }))}</span></div><div class="pkg-r"><strong>${money(o.price_cents)}</strong><br><button type="button" class="btn small" data-pkg="${o.id}">${esc(t("off.book"))}</button></div></div>`).join("")}</div></div>` : ""}
  ${deals.map((d) => `<div class="panel deal"><h2 class="sec">🤝 ${esc(t("bun.title", { pct: d.discount_pct }))}</h2><p><strong>${esc(d.name)}</strong></p><ul class="plist">${d.members.map((m) => `<li><span>${m.id === g.id ? `<strong>${esc(m.name)}</strong>` : `<a href="#/group/${esc(m.id)}">${esc(m.name)}</a>`} <span class="dim small">· ${esc(t("type." + m.type))}</span></span></li>`).join("")}</ul><p class="dim small">${esc(t("bun.how", { pct: d.discount_pct }))}</p></div>`).join("")}
  ${g.addons.length ? `<div class="panel"><h2 class="sec">${esc(t("ao.title"))}</h2><div class="pkgs">${g.addons.map((a) => `<div class="pkg"><div><strong>${esc(a.name)}</strong>${a.description ? `<br><span class="dim">${esc(a.description)}</span>` : ""}</div><div class="pkg-r"><strong>${a.price_cents ? money(a.price_cents) : esc(t("ao.included"))}</strong></div></div>`).join("")}</div></div>` : ""}
  ${g.packages.length ? `<div class="panel"><h2 class="sec">${esc(t("g.packages"))}</h2><div class="pkgs">${g.packages.map((p) => `<div class="pkg"><div><strong>${esc(p.name)}</strong><br><span class="dim">${esc(p.description)} · ${esc(t("g.hours", { n: p.hours }))}</span></div><div class="pkg-r"><strong>${money(p.price_cents)}</strong><br><button type="button" class="btn ghost small" data-pkg="${p.id}">${esc(t("g.choose"))}</button></div></div>`).join("")}</div></div>` : ""}
  ${g.recent_reviews.length ? `<div class="panel"><h2 class="sec">${esc(t("g.reviewsTitle"))}</h2>${g.recent_reviews.map((r) => `<div class="review">${stars(r.rating)} <strong>${esc(r.name)}</strong> <span class="dim">${esc(new Date(r.created_at * 1000).toLocaleDateString(lang() === "es" ? "es-US" : "en-US"))}</span>${r.text ? `<p>${esc(r.text)}</p>` : ""}${r.photos && r.photos.length ? `<div class="rphotos">${r.photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(t("rv.photo", { name: r.name }))}" loading="lazy"></a>`).join("")}</div>` : ""}${r.reply ? `<div class="reply"><strong>${esc(t("rv.ownerReply"))}</strong><p>${esc(r.reply.text)}</p></div>` : ""}</div>`).join("")}</div>` : ""}
  </div><aside class="gp-side">
    <div class="panel" id="calpanel"><h2>${esc(t("g.dates"))}</h2><div id="calbox"></div><div id="slotbox"></div><div class="legend">${esc(t("g.datesHint"))}</div></div>
    <div class="panel" id="bookpanel"><h2>${esc(t(music ? "g.request" : "g.requestAny"))}</h2><div id="bookbox"></div></div>
    <div class="panel" id="chatpanel"><h2>${esc(t("g.message"))}</h2><div id="quotebox"></div><div id="chatbox"></div></div>
  </aside></div>
  ${g.is_owner ? "" : `<div class="cta-space"></div><div class="cta-bar" id="ctabar"><span><strong>${esc(t("card.from", { price: money(g.packages.length ? Math.min(...g.packages.map((p) => p.price_cents)) : g.rate_cents) }))}</strong></span><button type="button" class="btn" id="ctabtn">${esc(t("g.checkDates"))}</button></div>`}`;
  wireShare(app); wireHearts(app);
  app.querySelectorAll(".thumb").forEach((b) => { b.onclick = () => { document.getElementById("hero-img").src = g.photos[Number(b.dataset.i)].url; }; });

  // songs
  const drawSongs = (f = "") => {
    const list = document.getElementById("songlist"); if (!list) return;
    const n = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    list.innerHTML = g.songs.filter((s) => n(s).includes(n(f))).map((s) => `<li>${esc(s)}</li>`).join("") || `<li class="dim">${esc(t("g.noSong"))}</li>`;
  };
  drawSongs();
  const sf = document.getElementById("songfilter"); if (sf) sf.oninput = () => drawSongs(sf.value);

  // calendar
  async function loadMonth() {
    const k = monthKey(st.month);
    if (!st.days[k]) { try { st.days[k] = (await api.get(`/api/groups/${encodeURIComponent(g.id)}/availability?month=${k}`)).days; } catch { st.days[k] = {}; } }
  }
  async function drawCal() {
    await loadMonth();
    const days = st.days[monthKey(st.month)];
    calendar(document.getElementById("calbox"), st, {
      dayState: (d) => { const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; const ok = Boolean(days[key]); return { enabled: ok, open: ok }; },
      onPick: (k) => { st.date = k; st.time = null; drawCal(); drawBook(); },
      onMonth: drawCal
    });
    const sb = document.getElementById("slotbox");
    const slots = st.date ? (st.days[st.date.slice(0, 7)] || {})[st.date] || [] : [];
    sb.innerHTML = st.date ? `<div class="slots">${slots.map((s) => `<button type="button" class="slot${st.time === s ? " sel" : ""}" data-t="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : "";
    sb.querySelectorAll(".slot").forEach((b) => { b.onclick = () => { st.time = b.dataset.t; drawCal(); drawBook(); document.getElementById("bookpanel")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }; });
  }

  // booking form
  let pkgChoice = "";
  app.querySelectorAll("[data-pkg]").forEach((b) => { b.onclick = () => { pkgChoice = b.dataset.pkg; drawBook(); document.getElementById("bookpanel").scrollIntoView({ behavior: "smooth" }); if (!st.date) toast(t("g.pickFirst")); }; });

  function drawBook() {
    const box = document.getElementById("bookbox");
    if (g.is_owner) { box.innerHTML = `<div class="note">${esc(t("g.yours"))} <a href="#/dashboard?g=${esc(g.id)}">${esc(t("nav.groups"))}</a></div>`; return; }
    if (!g.bookable) { box.innerHTML = `<div class="note">${esc(t("g.notBookable"))}</div>`; return; }
    if (!user) { box.innerHTML = `<div class="note">${esc(t("g.loginToBook"))}</div><a class="btn" href="#/login?next=${encodeURIComponent("#/group/" + g.id)}">${esc(t("nav.login"))}</a> <a class="btn ghost" href="#/signup?next=${encodeURIComponent("#/group/" + g.id)}">${esc(t("nav.signup"))}</a>`; return; }
    if (!st.date || !st.time) { box.innerHTML = `<div class="empty small">${esc(t("g.pickDate"))}</div>`; return; }
    const prev = box.querySelector("form") ? Object.fromEntries(new FormData(box.querySelector("form"))) : {};
    const prevAddons = box.querySelector("form") ? new FormData(box.querySelector("form")).getAll("addon") : [];
    const hourChoices = Array.from({ length: Math.max(6, g.min_hours) - g.min_hours + 1 }, (_, i) => g.min_hours + i);
    const v = (k, d = "") => esc(prev[k] ?? d);
    box.innerHTML = `<form id="bookform" novalidate><div class="sum"><span>${esc(t("f.date"))}</span><span>${esc(fmtDate(st.date))} · ${esc(st.time)}</span></div>
      <label for="b-pkg">${esc(t(g.hourly ? "g.package" : "g.pickPackage"))}</label><select id="b-pkg" name="packageId">${g.hourly ? `<option value="">${esc(g.min_hours > 1 ? t("g.hourlyMin", { price: money(g.rate_cents), n: g.min_hours }) : t("g.hourly", { price: money(g.rate_cents) }))}</option>` : ""}${[...offers.map((o) => ({ ...o, name: `${t("off.tag")}: ${o.name}` })), ...g.packages].map((p) => `<option value="${p.id}"${String(p.id) === String(pkgChoice) ? " selected" : ""}>${esc(p.name)} · ${esc(t("g.hours", { n: p.hours }))} · ${money(p.price_cents)}</option>`).join("")}</select>
      <div id="hrs-wrap"><label for="b-hrs">${esc(t(music ? "g.hoursLabel" : "g.hoursAny"))}</label><select id="b-hrs" name="hours">${hourChoices.map((h) => `<option value="${h}"${h === Number(prev.hours || Math.max(2, g.min_hours)) ? " selected" : ""}>${esc(t("g.hours", { n: h }))}</option>`).join("")}</select></div>
      ${g.addons.length ? `<fieldset class="addons"><legend>${esc(t("ao.pick"))}</legend>${g.addons.map((a) => `<label class="chk addon"><input type="checkbox" name="addon" value="${a.id}"${prevAddons.includes(String(a.id)) ? " checked" : ""}> <span>${esc(a.name)}</span><span class="addon-p">${a.price_cents ? "+" + money(a.price_cents) : esc(t("ao.included"))}</span></label>`).join("")}</fieldset>` : ""}
      <label for="b-ev">${esc(t("f.event"))}</label><select id="b-ev" name="event">${meta.events.map((e) => `<option value="${esc(e)}"${e === (prev.event || ctx.event) ? " selected" : ""}>${esc(t("event." + e))}</option>`).join("")}</select>
      <div class="row"><div><label for="b-guests">${esc(t("f.guests"))}</label><input id="b-guests" name="guests" type="number" min="1" max="${g.max_guests}" inputmode="numeric" required value="${v("guests", ctx.guests)}"></div>
      <div><label for="b-ezip">${esc(t("g.eventZip"))}</label><input id="b-ezip" name="eventZip" inputmode="numeric" maxlength="5" required value="${v("eventZip", ctx.zip || g.zip)}"></div></div>
      <label for="b-name">${esc(t("g.yourName"))}</label><input id="b-name" name="name" required maxlength="80" autocomplete="name" value="${v("name", user.name)}">
      <label for="b-phone">${esc(t("g.yourPhone"))}</label><input id="b-phone" name="phone" required inputmode="tel" maxlength="20" autocomplete="tel" value="${v("phone", fmtPhone(user.phone))}">
      <label for="b-addr">${esc(t("g.address"))}</label><input id="b-addr" name="address" required maxlength="160" value="${v("address")}">
      <label for="b-msg">${esc(t("g.special"))}</label><textarea id="b-msg" name="message" maxlength="500" placeholder="${esc(t("g.specialHint"))}">${v("message")}</textarea>
      <div id="quote" class="quote"></div>
      <label class="chk"><input type="checkbox" id="b-agree" name="agree"> <span>${esc(t("g.agree"))}</span></label>
      <div id="bookerr" class="err" role="alert"></div>
      <button class="btn wide" type="submit" id="bookbtn">${esc(t("g.pay"))}</button></form>`;
    const form = document.getElementById("bookform");
    const syncHours = () => { const w = document.getElementById("hrs-wrap"); if (w) w.hidden = Boolean(form.packageId.value); };
    syncHours();
    const refresh = debounce(async () => {
      if (!form.isConnected) return; // the page changed while we were waiting
      pkgChoice = form.packageId.value; syncHours();
      const q = document.getElementById("quote"); if (!q) return;
      const f = Object.fromEntries(new FormData(form));
      if (!/^\d{5}$/.test(f.eventZip) || !Number(f.guests)) { q.innerHTML = `<div class="dim">${esc(t("g.quoteHint"))}</div>`; return; }
      try {
        const r = await api.post("/api/quote", { groupId: g.id, date: st.date, time: st.time, packageId: f.packageId || null, hours: Number(f.hours), addonIds: new FormData(form).getAll("addon").map(Number), event: f.event, guests: Number(f.guests), eventZip: f.eventZip });
        const qt = r.quote;
        if (!form.isConnected) return;
        q.innerHTML = `<div class="sum"><span>${esc(t("q.subtotal"))}</span><span>${money(qt.subtotal_cents)}</span></div>` +
          (qt.travel_fee_cents ? `<div class="sum"><span>${esc(t("q.travel"))}</span><span>${money(qt.travel_fee_cents)}</span></div>` : "") +
          qt.addons.map((a) => `<div class="sum"><span>${esc(a.name)}</span><span>${a.price_cents ? money(a.price_cents) : esc(t("ao.included"))}</span></div>`).join("") +
          `<div class="sum"><span>${esc(t("q.total"))}</span><span>${money(qt.total_cents)}</span></div>
           <div class="sum strong"><span>${esc(t("q.deposit", { pct: qt.deposit_pct }))}</span><span>${money(qt.deposit_cents)}</span></div>
           <div class="sum"><span>${esc(t("q.balance"))}</span><span>${money(qt.balance_cents)}</span></div>
           <div class="policy"><strong>${esc(t("g.policy"))}: ${esc(t("policy." + r.policy.key))}</strong><br>${esc(r.policy.text[lang()])}
           <ul>${r.policy.rows.map((row) => `<li>${esc(t("q.policyRow", { days: row.days, pct: row.pct }))}</li>`).join("")}<li>${esc(t("q.policyNone"))}</li></ul>${esc(t("q.declined"))}</div>`;
      } catch (e) { q.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    }, 250);
    form.addEventListener("input", refresh); form.addEventListener("change", refresh);
    refresh();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form)), err = document.getElementById("bookerr"), btn = document.getElementById("bookbtn");
      err.textContent = "";
      if (!document.getElementById("b-agree").checked) { err.textContent = t("g.mustAgree"); return; }
      btn.disabled = true;
      try {
        const r = await api.post("/api/bookings", { groupId: g.id, date: st.date, time: st.time, packageId: f.packageId || null, hours: Number(f.hours), addonIds: new FormData(form).getAll("addon").map(Number), event: f.event, guests: Number(f.guests), eventZip: f.eventZip, name: f.name, phone: f.phone, address: f.address, message: f.message, acceptPolicy: true });
        goto(r.payment.url);
      } catch (ex) {
        err.textContent = ex.message; btn.disabled = false;
        st.days = {}; await drawCal(); // the slot may have been taken
      }
    });
  }

  // One-tap "ask for a quote": the event details go to the group as a chat message.
  function drawQuoteRequest() {
    const qb = document.getElementById("quotebox"); if (!qb || !user || g.is_owner) return;
    const open = qb.querySelector("details")?.open;
    qb.innerHTML = `<details class="quote-req"${open ? " open" : ""}><summary>${esc(t("quote.ask"))}</summary><p class="dim small">${esc(t("quote.text"))}</p>
      <form novalidate><label for="qr-ev">${esc(t("f.event"))}</label><select id="qr-ev" name="event">${meta.events.map((e) => `<option value="${esc(e)}"${sel(e, ctx.event)}>${esc(t("event." + e))}</option>`).join("")}</select>
      <div class="row"><div><label for="qr-date">${esc(t("f.date"))}</label><input id="qr-date" name="date" type="date" min="${tomorrowKey()}" value="${esc(st.date || ctx.date || "")}" required></div>
      <div><label for="qr-guests">${esc(t("f.guests"))}</label><input id="qr-guests" name="guests" type="number" min="1" max="${g.max_guests}" inputmode="numeric" value="${esc(ctx.guests)}" required></div></div>
      <label for="qr-hrs">${esc(t(music ? "g.hoursLabel" : "g.hoursAny"))}</label><select id="qr-hrs" name="hours">${Array.from({ length: Math.max(6, g.min_hours) - g.min_hours + 1 }, (_, i) => g.min_hours + i).map((h) => `<option value="${h}"${h === Math.max(2, g.min_hours) ? " selected" : ""}>${esc(t("g.hours", { n: h }))}</option>`).join("")}</select>
      <label for="qr-note">${esc(t("quote.note"))}</label><input id="qr-note" name="note" maxlength="200"><div class="err" role="alert"></div>
      <button class="btn small" type="submit">${esc(t("quote.send"))}</button></form></details>`;
    qb.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target)), err = qb.querySelector(".err"); err.textContent = "";
      try { await api.post(`/api/groups/${encodeURIComponent(g.id)}/quote-request`, { event: f.event, date: f.date, guests: Number(f.guests), hours: Number(f.hours), note: f.note }); toast(t("quote.sent")); await drawChat(); }
      catch (ex) { err.textContent = ex.message; }
    };
  }

  // chat
  async function drawChat() {
    const box = document.getElementById("chatbox");
    if (g.is_owner) { document.getElementById("chatpanel").hidden = true; return; }
    if (!user) { box.innerHTML = `<div class="dim">${esc(t("g.loginToChat"))}</div>`; return; }
    drawQuoteRequest();
    let msgs = [];
    try { msgs = (await api.get(`/api/groups/${encodeURIComponent(g.id)}/messages`)).messages; } catch { /* empty */ }
    renderChat(box, { messages: msgs, mine: "customer", send: (text) => api.post(`/api/groups/${encodeURIComponent(g.id)}/messages`, { text }), note: `<div class="note">${esc(t("g.privacy"))}</div>` });
    window.dispatchEvent(new CustomEvent("bm:attention"));
  }

  // Open on a month that has something to click, or on the date the customer searched for.
  async function initCalendar() {
    if (ctx.date && /^\d{4}-\d{2}-\d{2}$/.test(ctx.date)) {
      st.month = monthOf(ctx.date); await loadMonth();
      if ((st.days[monthKey(st.month)] || {})[ctx.date]) { st.date = ctx.date; return; }
    }
    if (g.next_open) st.month = monthOf(g.next_open);
  }
  await initCalendar();
  await drawCal(); drawBook(); await drawChat();
  if (params.get("chat")) { const cp = document.getElementById("chatpanel"); if (cp && !cp.hidden) { cp.scrollIntoView({ behavior: "smooth", block: "center" }); document.getElementById("chatin")?.focus({ preventScroll: true }); } }

  const ctaBtn = document.getElementById("ctabtn");
  if (ctaBtn) {
    ctaBtn.onclick = () => document.getElementById("calpanel").scrollIntoView({ behavior: "smooth" });
    if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => { document.getElementById("ctabar")?.toggleAttribute("hidden", e.isIntersecting); }, { threshold: 0.15 }).observe(document.getElementById("calpanel"));
  }
}
