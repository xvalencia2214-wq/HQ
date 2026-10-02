import { api } from "../api.js";
import { state, setUser, refreshAttention } from "../state.js";
import { t, lang } from "../i18n.js";
import { esc, money, fmtDate, sel, tomorrowKey, toast } from "../ui.js";

// "Get quotes": one question per screen with a progress ring. The account comes last, after the person has invested a minute,
// and their answers survive a refresh. The request goes only to the few groups that can really do the job.
const SLOTS = ["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"];
const KEY = "bm_rq";
const HINTS = new Set(["time", "zip", "budget", "stage"]); // steps that have a line of help under the question
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const save = (a) => { try { sessionStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode: answers just won't survive a refresh */ } };

export async function quotes(app, params) {
  const meta = state.meta;
  const p = Object.fromEntries(params);
  const saved = load();
  const zip0 = p.zip || (() => { try { return localStorage.getItem("bm_zip"); } catch { return null; } })() || meta.market.center_zip;
  const a = { event: p.event || saved.event || "Quinceañera", date: p.date || saved.date || "", time: saved.time || "", hours: saved.hours || "3", zip: p.zip || saved.zip || zip0, guests: p.guests || saved.guests || "",
    size: saved.size || "", budgetMin: saved.budgetMin || "", budgetMax: saved.budgetMax || "", stage: saved.stage || "", note: saved.note || "" };
  let requests = [];
  if (state.user) { try { requests = (await api.get("/api/my/requests")).requests; } catch { /* the form still works */ } }

  const opt = (v, label, cur) => `<option value="${esc(v)}"${sel(v, cur)}>${esc(label)}</option>`;
  const steps = [
    { key: "event", html: () => `<select id="f-event" name="event" aria-labelledby="wiz-h">${meta.events.map((e) => opt(e, t("event." + e), a.event)).join("")}</select>`, read: (f) => { a.event = f.event; } },
    { key: "date", html: () => `<input id="f-date" name="date" type="date" min="${tomorrowKey()}" required aria-labelledby="wiz-h" value="${esc(a.date)}">`, read: (f) => { if (!f.date || f.date < tomorrowKey()) return "rq.need"; a.date = f.date; } },
    { key: "time", html: () => `<select id="f-time" name="time" aria-labelledby="wiz-h">${opt("", t("rq.time.any"), a.time)}${SLOTS.map((x) => opt(x, x, a.time)).join("")}</select>`, read: (f) => { a.time = f.time; } },
    { key: "hours", html: () => `<select id="f-hours" name="hours" aria-labelledby="wiz-h">${[1, 2, 3, 4, 5, 6, 7, 8].map((h) => opt(String(h), t("g.hours", { n: h }), a.hours)).join("")}</select>`, read: (f) => { a.hours = f.hours; } },
    { key: "zip", html: () => `<input id="f-zip" name="zip" inputmode="numeric" maxlength="5" pattern="\\d{5}" required autocomplete="postal-code" aria-labelledby="wiz-h" value="${esc(a.zip)}">`, read: (f) => { if (!/^\d{5}$/.test(f.zip)) return "rq.needZip"; a.zip = f.zip; } },
    { key: "guests", html: () => `<input id="f-guests" name="guests" type="number" min="1" max="5000" inputmode="numeric" required aria-labelledby="wiz-h" value="${esc(a.guests)}">`, read: (f) => { if (!(Number(f.guests) >= 1)) return "rq.need"; a.guests = f.guests; } },
    { key: "size", html: () => `<select id="f-size" name="size" aria-labelledby="wiz-h">${opt("", t("rq.size.any"), a.size)}${["solo-duo", "trio", "small", "large"].map((k) => opt(k, t("rq.size." + k), a.size)).join("")}</select>`, read: (f) => { a.size = f.size; } },
    { key: "budget", html: () => `<div class="row"><div><label for="f-bmin">${esc(t("rq.min"))}</label><input id="f-bmin" name="budgetMin" type="number" min="0" max="100000" inputmode="numeric" value="${esc(a.budgetMin)}"></div><div><label for="f-bmax">${esc(t("rq.max"))}</label><input id="f-bmax" name="budgetMax" type="number" min="0" max="100000" inputmode="numeric" value="${esc(a.budgetMax)}"></div></div>`,
      read: (f) => { if (f.budgetMax && Number(f.budgetMin || 0) > Number(f.budgetMax)) return "rq.needBudget"; a.budgetMin = f.budgetMin; a.budgetMax = f.budgetMax; } },
    { key: "stage", html: () => `<select id="f-stage" name="stage" aria-labelledby="wiz-h">${opt("", t("rq.stage.any"), a.stage)}${["just-looking", "comparing", "ready"].map((k) => opt(k, t("rq.stage." + k), a.stage)).join("")}</select>
      <label for="f-note">${esc(t("rq.note"))}</label><textarea id="f-note" name="note" maxlength="300" placeholder="${esc(t("rq.notePh"))}">${esc(a.note)}</textarea>`, read: (f) => { a.stage = f.stage; a.note = f.note; } }
  ];
  if (!state.user) steps.push({ key: "account", account: true });
  let i = Math.min(Number(saved._i || 0), steps.length - 1), mode = "signup";

  app.innerHTML = `<div class="titlebar"><h1>${esc(t("rq.title"))}</h1></div><p class="dim">${esc(t("rq.sub"))}</p>
    <div class="panel narrow wizpanel" id="wizbox"></div><div id="rqresult"></div>
    ${requests.length ? `<h2 class="sec">${esc(t("rq.yours"))}</h2>${requests.map(card).join("")}` : ""}`;

  function draw() {
    const st = steps[i], pct = Math.round((i / steps.length) * 100), last = i === steps.length - 1;
    const stepText = t("rq.step", { i: i + 1, n: steps.length });
    const acct = st.account ? `<p class="dim small">${esc(t("rq.privacy"))}</p>${mode === "signup"
      ? `<label for="f-name">${esc(t("auth.name"))}</label><input id="f-name" name="name" required maxlength="80" autocomplete="name">`
      : ""}<label for="f-email">${esc(t("auth.email"))}</label><input id="f-email" name="email" type="email" required maxlength="254" autocomplete="email">
      <label for="f-pw">${esc(t("auth.password"))}</label><input id="f-pw" name="password" type="password" required minlength="8" maxlength="200" autocomplete="${mode === "signup" ? "new-password" : "current-password"}">
      ${mode === "signup" ? `<div class="dim small">${esc(t("auth.pwHint"))}</div>` : ""}<p><button type="button" class="linkbtn-dark" id="swap">${esc(t(mode === "signup" ? "rq.hasAcct" : "rq.newAcct"))}</button></p>` : "";
    document.getElementById("wizbox").innerHTML = `<form id="wiz" novalidate><div class="wiz-top"><div class="ring" style="--p:${pct}" aria-hidden="true"><span>${pct}%</span></div><div class="wiz-step" role="status">${esc(stepText)}</div></div>
      <h2 id="wiz-h" class="wiz-h">${esc(t("rq.q." + st.key))}</h2>${HINTS.has(st.key) ? `<p class="dim small">${esc(t("rq.h." + st.key))}</p>` : ""}
      ${st.account ? acct : st.html()}
      <div id="rqerr" class="err" role="alert"></div>
      <div class="wiz-nav">${i > 0 ? `<button type="button" class="btn ghost" id="wback">${esc(t("rq.back"))}</button>` : "<span></span>"}<button class="btn" type="submit" id="wnext">${esc(last ? t(st.account ? "rq.sendAcct" : "rq.send") : t("rq.next"))}</button></div></form>`;
    const first = document.querySelector("#wiz input:not([type=hidden]), #wiz select, #wiz textarea"); if (first) first.focus({ preventScroll: true });
    const back = document.getElementById("wback"); if (back) back.onclick = () => { readCurrent(true); i--; save({ ...a, _i: i }); draw(); };
    const swap = document.getElementById("swap"); if (swap) swap.onclick = () => { mode = mode === "signup" ? "login" : "signup"; draw(); };
    document.getElementById("wiz").onsubmit = onSubmit;
  }
  const formData = () => Object.fromEntries(new FormData(document.getElementById("wiz")));
  function readCurrent(soft) { const st = steps[i]; if (st.account) return null; const err = st.read(formData()); return soft ? null : err; }

  async function onSubmit(e) {
    e.preventDefault();
    const err = document.getElementById("rqerr"), btn = document.getElementById("wnext"), st = steps[i];
    err.textContent = "";
    if (!st.account) { const bad = readCurrent(false); if (bad) { err.textContent = t(bad); return; } }
    if (i < steps.length - 1) { i++; save({ ...a, _i: i }); draw(); return; } // saved only when the person moves on, so sending leaves nothing behind
    btn.disabled = true;
    try {
      if (st.account) {
        const f = formData();
        const r = await api.post(mode === "signup" ? "/api/auth/register" : "/api/auth/login", mode === "signup" ? { email: f.email, password: f.password, name: f.name, lang: lang() } : { email: f.email, password: f.password });
        setUser(r.user); refreshAttention();
      }
      const r = await api.post("/api/requests", { event: a.event, date: a.date, time: a.time, hours: Number(a.hours), zip: a.zip, guests: Number(a.guests), size: a.size, budgetMin: a.budgetMin, budgetMax: a.budgetMax, stage: a.stage, note: a.note });
      if (!r.sent) { document.getElementById("rqresult").innerHTML = `<div class="note warn" role="status">${esc(t("rq.none"))} <a href="#/?zip=${esc(a.zip)}&date=${esc(a.date)}">${esc(t("rq.wider"))}</a></div>`; btn.disabled = false; return; }
      try { sessionStorage.removeItem(KEY); } catch { /* ok */ }
      toast(t("rq.sent", { n: r.sent })); location.hash = "#/quotes?sent=" + r.id; // the route change redraws the page with the new request on top
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  }
  draw();
}

function card(r) {
  const answered = r.groups.filter((g) => g.replied || g.offers.length).length;
  return `<div class="panel rq-card${r.past ? " past" : ""}"><div class="titlebar"><h3>${esc(t("event." + r.event))} · ${esc(fmtDate(r.date))}</h3><span class="dim small">${esc(t("rq.summary", { guests: r.guests, n: r.groups.length, a: answered }))}</span></div>
    ${r.groups.map((g) => `<div class="req"><div><strong><a href="#/group/${esc(g.id)}?event=${encodeURIComponent(r.event)}&date=${esc(r.date)}&guests=${r.guests}&zip=${esc(r.zip)}">${esc(g.name)}</a></strong> <span class="tag">${esc(t("type." + g.type))}</span>
      <div class="dim small">${!g.live ? esc(t("rq.gone")) : g.offers.length ? "" : g.replied ? esc(t("rq.replied", { n: g.reply_minutes })) : esc(t("rq.waiting")) + (g.usually ? " · " + esc(t("resp." + g.usually)) : "")}${g.later ? ` · <span class="tag">${esc(t("rq.later"))}</span>` : ""}</div>
      ${g.offers.map((o) => `<div class="note ok small"><strong>${esc(o.name)}</strong> · ${esc(t("g.hours", { n: o.hours }))} · <strong>${money(o.price_cents)}</strong> <span class="dim">· ${esc(t("off.until", { date: new Date(o.expires_at * 1000).toLocaleDateString(lang() === "es" ? "es-US" : "en-US") }))}</span></div>`).join("")}</div>
      <div class="req-r">${g.live ? `<a class="btn small${g.offers.length ? "" : " ghost"}" href="#/group/${esc(g.id)}?event=${encodeURIComponent(r.event)}&date=${esc(r.date)}&guests=${r.guests}&zip=${esc(r.zip)}">${esc(g.offers.length ? t("off.book") : t("rq.open"))}</a> ` : ""}${g.live && g.replied ? `<a class="btn ghost small" href="#/messages?g=${esc(g.id)}">${esc(t("nav.messages"))}</a>` : ""}</div></div>`).join("")}</div>`;
}
