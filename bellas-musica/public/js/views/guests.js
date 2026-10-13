import { api } from "../api.js";
import { t, lang } from "../i18n.js";
import { esc, fmtDate, toast, sel } from "../ui.js";

// Roles at a quinceañera, wedding or bautizo (Spanish terms, used the same way in both languages).
const COURT_ROLES = ["Chambelán de honor", "Dama", "Chambelán", "Padrino de velación", "Madrina de velación", "Padrino de anillo", "Madrina de cojín", "Madrina de última muñeca",
  "Padrino de pastel", "Padrino de brindis", "Madrina de corona", "Madrina de zapatilla", "Padrino de música", "Padrino de lazo", "Madrina de arras", "Padrino de bautizo", "Madrina de bautizo"];
const waNumber = (phone) => (phone && phone.length === 10 ? "1" + phone : "");
const fmtPhone = (p) => (p && p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p || "");

// On a saved party: the guest list with WhatsApp invitations and answers, and the court of honor / padrinos.
export async function guestPanels(box, P, { setGuestCount } = {}) {
  const gurl = `/api/parties/${encodeURIComponent(P.id)}`;
  let L;
  try { L = await api.get(`${gurl}/guests`); } catch (e) { box.innerHTML = ""; return; }
  const title = P.title || t("pp.untitled"), date = fmtDate(P.date);

  function draw() {
    const T = L.totals;
    const status = (g) => (g.rsvp === "yes" ? `<span class="tag trust">${esc(t("gl.comingN", { n: g.coming }))}</span>` : g.rsvp === "no" ? `<span class="tag">${esc(t("gl.no"))}</span>` : g.rsvp === "maybe" ? `<span class="tag past">${esc(t("gl.maybe"))}</span>` : `<span class="dim small">${esc(t("gl.waiting"))}</span>`);
    const row = (g) => {
      const msg = t("gl.wa", { name: g.name.split(" ")[0], title, date, url: g.url });
      return `<li class="guest" data-gid="${g.id}"><div class="g-main"><strong>${esc(g.name)}</strong> <span class="dim small">· ${esc(t("gl.seats"))}: ${g.seats}${g.side ? ` · ${esc(g.side)}` : ""}${g.phone ? ` · ${esc(fmtPhone(g.phone))}` : ""}${g.source === "open" ? ` · ${esc(t("gl.fromLink"))}` : ""}</span>${g.note ? `<div class="small">“${esc(g.note)}”</div>` : ""}</div>
        <div class="g-act">${status(g)}<select class="g-rsvp" aria-label="${esc(t("rsvp.q"))} ${esc(g.name)}"><option value=""${sel("", g.rsvp)}>${esc(t("gl.waiting"))}</option><option value="yes"${sel("yes", g.rsvp)}>${esc(t("gl.yes"))}</option><option value="maybe"${sel("maybe", g.rsvp)}>${esc(t("gl.maybe"))}</option><option value="no"${sel("no", g.rsvp)}>${esc(t("gl.no"))}</option></select>
        <a class="btn ghost small" target="_blank" rel="noopener noreferrer" href="https://wa.me/${waNumber(g.phone)}?text=${encodeURIComponent(msg)}">${esc(t("gl.send"))}</a><button type="button" class="btn ghost small g-copy" data-url="${esc(g.url)}">${esc(t("gl.copyOne"))}</button><button type="button" class="linkbtn g-del" aria-label="${esc(t("gl.del"))} ${esc(g.name)}">✕</button></div></li>`;
    };
    const courtRow = (c = {}) => `<div class="tlrow court-row"><input class="c-role" list="court-roles" maxlength="60" aria-label="${esc(t("court.role"))}" placeholder="${esc(t("court.role"))}" value="${esc(c.role || "")}"><input class="c-name" maxlength="60" aria-label="${esc(t("court.name"))}" placeholder="${esc(t("court.name"))}" value="${esc(c.name || "")}"><input class="c-phone" inputmode="tel" maxlength="14" aria-label="${esc(t("gl.phone"))}" placeholder="${esc(t("gl.phone"))}" value="${esc(fmtPhone(c.phone))}"><button type="button" class="linkbtn c-del" aria-label="${esc(t("pp.remove"))}">✕</button></div>`;
    box.innerHTML = `<div class="panel" id="pp-guests"><h2 class="sec">💌 ${esc(t("gl.title"))}</h2><p class="dim small">${esc(t("gl.hint"))}</p>
      <p><strong>${esc(t("gl.totals", T))}</strong> <span class="dim small">· ${esc(t("gl.invited", { n: T.invited }))}</span>
        ${T.yes && T.yes !== P.guests ? ` <button type="button" class="btn ghost small" id="gl-count">${esc(t("gl.useCount", { n: T.yes }))}</button>` : ""}</p>
      <details class="gl-open"><summary>🔗 ${esc(t("gl.openTitle"))}</summary><p class="dim small">${esc(t("gl.openHint"))}</p>
        <div class="copyrow"><input readonly value="${esc(L.rsvp_url)}" id="gl-openurl" aria-label="${esc(t("gl.openTitle"))}"><button type="button" class="btn small" id="gl-opencopy">${esc(t("pp.copy"))}</button><a class="btn ghost small" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(t("gl.waOpen", { title, date, url: L.rsvp_url }))}">WhatsApp</a></div>
        <form id="gl-noteform"><label for="gl-note">${esc(t("gl.note"))}</label><textarea id="gl-note" maxlength="400" placeholder="${esc(t("gl.notePh"))}">${esc(L.rsvp_note)}</textarea>
          <div class="row"><div><label for="gl-by">${esc(t("gl.by"))}</label><input id="gl-by" type="date" max="${esc(P.date)}" value="${esc(L.rsvp_by)}"></div></div>
          <button class="btn small" type="submit">${esc(t("common.save"))}</button> <button type="button" class="linkbtn small" id="gl-newlink">${esc(t("gl.newLink"))}</button></form></details>
      <form id="gl-add" class="gl-add"><div><label for="ga-name">${esc(t("gl.name"))}</label><input id="ga-name" required maxlength="60"></div><div class="narrowf"><label for="ga-seats">${esc(t("gl.seats"))}</label><input id="ga-seats" type="number" min="1" max="20" value="1"></div>
        <div><label for="ga-side">${esc(t("gl.side"))}</label><input id="ga-side" maxlength="40" placeholder="${esc(t("gl.sidePh"))}"></div><div><label for="ga-phone">${esc(t("gl.phone"))}</label><input id="ga-phone" inputmode="tel" maxlength="14"></div>
        <button class="btn small" type="submit">${esc(t("gl.add"))}</button></form>
      <details><summary>${esc(t("gl.bulk"))}</summary><form id="gl-bulk"><p class="dim small">${esc(t("gl.bulkHint"))}</p><textarea id="gl-lines" rows="5" aria-label="${esc(t("gl.bulk"))}" placeholder="${esc(t("gl.bulkPh"))}"></textarea><button class="btn small" type="submit">${esc(t("gl.bulkAdd"))}</button></form></details>
      <div class="err" id="gl-err" role="alert"></div>
      ${L.guests.length ? `<ul class="guests">${L.guests.map(row).join("")}</ul>` : `<p class="dim">${esc(t("gl.none"))}</p>`}</div>
    <div class="panel" id="pp-court"><h2 class="sec">👑 ${esc(t("court.title"))}</h2><p class="dim small">${esc(t("court.hint"))}</p>
      <datalist id="court-roles">${COURT_ROLES.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>
      <div id="court">${(L.court.length ? L.court : [{}]).map(courtRow).join("")}</div>
      <div class="btnrow"><button type="button" class="btn ghost small" id="court-add">${esc(t("court.add"))}</button><button type="button" class="btn small" id="court-save">${esc(t("court.save"))}</button></div><div class="err" id="court-err" role="alert"></div></div>`;
    wire(courtRow);
  }

  const err = (m) => { const e = document.getElementById("gl-err"); if (e) e.textContent = m || ""; };
  const run = async (fn) => { err(""); try { L = await fn(); draw(); } catch (ex) { err(ex.message); toast(ex.message, "error"); } };
  const copy = async (url) => { try { await navigator.clipboard.writeText(url); toast(t("share.copied")); } catch { window.prompt(t("pp.copy"), url); } };
  function wire(courtRow) {
    const $ = (id) => document.getElementById(id);
    $("gl-add").onsubmit = (e) => { e.preventDefault(); run(() => api.post(`${gurl}/guests`, { name: $("ga-name").value, seats: Number($("ga-seats").value || 1), side: $("ga-side").value, phone: $("ga-phone").value })).then(() => { const n = $("ga-name"); if (n) n.focus(); }); };
    $("gl-bulk").onsubmit = (e) => { e.preventDefault(); run(() => api.post(`${gurl}/guests`, { lines: $("gl-lines").value })); };
    $("gl-noteform").onsubmit = (e) => { e.preventDefault(); run(() => api.patch(`${gurl}/rsvp`, { note: $("gl-note").value, by: $("gl-by").value })).then(() => toast(t("common.saved"))); };
    $("gl-newlink").onclick = () => { if (confirm(t("gl.newLink") + "?")) run(() => api.patch(`${gurl}/rsvp`, { newLink: true })); };
    $("gl-opencopy").onclick = () => copy(L.rsvp_url);
    if ($("gl-count")) $("gl-count").onclick = async () => { if (setGuestCount) await setGuestCount(L.totals.yes); };
    box.querySelectorAll(".guest").forEach((li) => {
      const id = li.dataset.gid;
      li.querySelector(".g-rsvp").onchange = (e) => run(() => api.patch(`${gurl}/guests/${id}`, { rsvp: e.target.value }));
      li.querySelector(".g-copy").onclick = (e) => copy(e.target.dataset.url);
      li.querySelector(".g-del").onclick = () => { if (confirm(t("common.confirmDelete"))) run(() => api.del(`${gurl}/guests/${id}`)); };
    });
    const court = $("court");
    const wireRows = () => court.querySelectorAll(".c-del").forEach((b) => { b.onclick = () => b.parentElement.remove(); });
    wireRows();
    $("court-add").onclick = () => { const d = document.createElement("div"); d.innerHTML = courtRow({}); court.appendChild(d.firstChild); wireRows(); court.lastChild.querySelector(".c-role").focus(); };
    $("court-save").onclick = async () => {
      const items = [...court.querySelectorAll(".court-row")].map((r) => ({ role: r.querySelector(".c-role").value.trim(), name: r.querySelector(".c-name").value.trim(), phone: r.querySelector(".c-phone").value.trim() })).filter((r) => r.role || r.name);
      try { L = await api.put(`${gurl}/court`, { items }); toast(t("court.saved")); draw(); } catch (ex) { $("court-err").textContent = ex.message; }
    };
  }
  draw();
}

// The invitation page a guest opens from WhatsApp (#/rsvp/<token>): no account needed.
export async function rsvpPage(app, token) {
  let R;
  try { R = await api.get(`/api/rsvp/${encodeURIComponent(token)}`); }
  catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  const P = R.party, title = P.title || t("pp.untitled");
  document.title = `${title} · Bella's Música`;
  const head = `<p class="dim">${esc(t("rsvp.from", { host: P.host }))}</p><h1 class="sec rsvp-title">🎉 ${esc(title)}</h1>
    <p class="rsvp-when">📅 <strong>${esc(fmtDate(P.date))}</strong>${P.event ? ` · ${esc(t("event." + P.event))}` : ""}</p>
    ${P.note ? `<p class="rsvp-note">${esc(P.note)}</p>` : ""}${P.by && !P.past ? `<p class="small">${esc(t("rsvp.by", { date: fmtDate(P.by) }))}</p>` : ""}`;
  const draw = (answered) => {
    const g = R.guest;
    if (P.past) { app.innerHTML = `<div class="panel narrow rsvp">${head}<p class="note">${esc(t("rsvp.past"))}</p></div>`; return; }
    if (answered && g && g.rsvp) {
      app.innerHTML = `<div class="panel narrow rsvp">${head}<p class="note ok">${esc(t("rsvp.thanks." + g.rsvp))}${g.rsvp === "yes" ? ` (${esc(t("gl.comingN", { n: g.coming }))})` : ""}</p><p class="dim small">${esc(t("rsvp.keep"))}</p><button type="button" class="btn ghost" id="rsvp-change">${esc(t("rsvp.change"))}</button></div>`;
      document.getElementById("rsvp-change").onclick = () => draw(false);
      return;
    }
    const max = g ? g.seats : 10, cur = g && g.rsvp === "yes" ? g.coming : g ? g.seats : 1;
    app.innerHTML = `<div class="panel narrow rsvp">${head}${g ? `<p><strong>${esc(t("rsvp.hi", { name: g.name.split(" ")[0] }))}</strong></p>` : ""}
      <form id="rsvpform">${g ? "" : `<label for="rv-name">${esc(t("rsvp.yourName"))}</label><input id="rv-name" required minlength="2" maxlength="60" autocomplete="name">`}
        <fieldset class="rsvp-pick"><legend>${esc(t("rsvp.q"))}</legend>${["yes", "no", "maybe"].map((v) => `<label class="chk"><input type="radio" name="rsvp" value="${v}" required${g && g.rsvp === v ? " checked" : ""}> <span>${esc(t("rsvp." + v))}</span></label>`).join("")}</fieldset>
        <div id="rv-howmany"><label for="rv-coming">${esc(t("rsvp.howMany"))}</label><input id="rv-coming" type="number" min="1" max="${max}" value="${cur}"><div class="dim small">${esc(t("rsvp.upTo", { n: max }))}</div></div>
        <label for="rv-note">${esc(t("rsvp.note"))}</label><input id="rv-note" maxlength="200" placeholder="${esc(t("rsvp.notePh"))}" value="${esc(g ? g.note : "")}">
        <div class="err" role="alert"></div><button class="btn wide" type="submit">${esc(t("rsvp.send"))}</button></form></div>`;
    const f = document.getElementById("rsvpform"), how = document.getElementById("rv-howmany");
    const sync = () => { const v = (f.querySelector("input[name=rsvp]:checked") || {}).value; how.hidden = v !== "yes"; };
    f.querySelectorAll("input[name=rsvp]").forEach((i) => { i.onchange = sync; });
    sync();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const rsvp = f.querySelector("input[name=rsvp]:checked").value;
      try {
        const r = await api.post(`/api/rsvp/${encodeURIComponent(token)}`, { rsvp, coming: Number(document.getElementById("rv-coming").value || 1), note: document.getElementById("rv-note").value, ...(g ? {} : { name: document.getElementById("rv-name").value }) });
        R = r;
        // from the open link: their own link from now on, so they can change the answer later
        if (!g && r.token && r.token !== token) { history.replaceState(null, "", `#/rsvp/${r.token}`); token = r.token; }
        draw(true);
      } catch (ex) { f.querySelector(".err").textContent = ex.message; }
    };
  };
  draw(Boolean(R.guest && R.guest.rsvp));
}
