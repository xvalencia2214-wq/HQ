import { api } from "../api.js";
import { t } from "../i18n.js";
import { esc, money, fmtDate, toast } from "../ui.js";
import { CAT_ICON } from "../cats.js";
import { commentList } from "./myparty.js";

const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};
// One anonymous id per browser, so a person's ♥ can be counted once and taken back.
function voterId() {
  let v = store.get("bm_voter");
  if (!/^[\w-]{8,40}$/.test(v)) { v = "v-" + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8); store.set("bm_voter", v); }
  return v;
}

// The family link: see the plan, vote with ♥, comment. No account needed; no address, phone or money paid is shown.
export async function familyParty(app, token) {
  const voter = voterId();
  let P;
  try { P = (await api.get(`/api/fp/${encodeURIComponent(token)}?voter=${encodeURIComponent(voter)}`)).party; }
  catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  const base = `/api/fp/${encodeURIComponent(token)}`;
  function draw() {
    document.title = `${P.title || t("pp.untitled")} · Bella's Música`;
    const name = store.get("bm_party_name");
    const nameField = (id) => `<input name="name" id="${id}" maxlength="40" required placeholder="${esc(t("pp.yourName"))}" aria-label="${esc(t("pp.yourName"))}" value="${esc(name)}">`;
    app.innerHTML = `<section class="hero party-hero"><img class="hero-logo" src="logo.svg" alt="" width="84" height="84"><h1>${esc(P.title || t("pp.untitled"))}</h1>
      <p>${esc(t("fam.title", { name: P.host }))} · 📅 ${esc(fmtDate(P.date))}${P.event ? " · " + esc(t("event." + P.event)) : ""}</p></section>
      <div class="panel"><h2 class="sec">✅ ${esc(t("fam.booked"))}</h2>${P.vendors.filter((v) => v.status !== "unpaid").length ? `<ul class="plist">${P.vendors.filter((v) => v.status !== "unpaid").map((v) => `<li><span>${CAT_ICON[v.category] || ""} <a href="#/group/${esc(v.group_id)}">${esc(v.group_name)}</a> <span class="dim small">· ${esc(t("type." + v.type))}</span></span></li>`).join("")}</ul>` : `<p class="dim">${esc(t("fam.none"))}</p>`}</div>
      <div class="panel"><h2 class="sec">♥ ${esc(t("pp.picks"))}</h2><p class="dim small">${esc(t("fam.voteHint"))}</p>
      ${P.picks.length ? `<div class="picks">${P.picks.map((k) => `<div class="pick"><div class="pick-h"><a href="#/group/${esc(k.id)}"><strong>${esc(k.name)}</strong></a> <span class="dim small">${CAT_ICON[k.category] || ""} ${esc(t("type." + k.type))} · ${esc(t("card.from", { price: money(k.from_cents) }))}</span>
        <button type="button" class="btn small ${k.my_vote ? "" : "ghost"} votebtn" data-vote="${esc(k.id)}" aria-pressed="${k.my_vote}">♥ ${k.votes}</button></div>
        ${k.added_by ? `<div class="dim small">${esc(t("pp.by", { name: k.added_by }))}</div>` : ""}${commentList(k.comments)}
        <form class="cform" data-g="${esc(k.id)}">${nameField("n-" + k.id)}<input name="text" maxlength="300" required placeholder="${esc(t("pp.commentPh"))}" aria-label="${esc(t("pp.comment"))}"><button class="btn small" type="submit">${esc(t("pp.send"))}</button></form></div>`).join("")}</div>` : `<p class="dim">${esc(t("pp.noPicks"))}</p>`}</div>
      <div class="panel"><h2 class="sec">💬 ${esc(t("pp.chat"))}</h2>${commentList(P.comments)}
        <form class="cform" data-g="">${nameField("n-chat")}<input name="text" maxlength="300" required placeholder="${esc(t("pp.commentPh"))}" aria-label="${esc(t("pp.chat"))}"><button class="btn small" type="submit">${esc(t("pp.send"))}</button></form></div>
      ${P.timeline.length ? `<div class="panel"><h2 class="sec">🕒 ${esc(t("pp.timeline"))}</h2><ul class="tlview">${P.timeline.map((r) => `<li><strong>${esc(r.at)}</strong> ${esc(r.label)}${r.vendor ? ` <span class="dim small">· ${esc(r.vendor)}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
      <p class="center"><a class="btn ghost" href="#/party">${esc(t("thanks.cta"))}</a></p>`;
    app.querySelectorAll("[data-vote]").forEach((b) => { b.onclick = async () => { try { P = (await api.post(base + "/vote", { groupId: b.dataset.vote, voter })).party; draw(); } catch (e) { toast(e.message, "error"); } }; });
    app.querySelectorAll(".cform").forEach((f) => { f.onsubmit = async (e) => {
      e.preventDefault(); const nm = f.name.value.trim(), text = f.text.value.trim(); if (!nm || !text) return;
      store.set("bm_party_name", nm);
      try { P = (await api.post(base + "/comments", { name: nm, text, groupId: f.dataset.g || undefined, voter })).party; draw(); } catch (ex) { toast(ex.message, "error"); }
    }; });
  }
  draw();
}

// "This party was planned on Bella's Música": what guests see when they scan the sign.
export async function thanksPage(app, id) {
  let P;
  try { P = (await api.get(`/api/thanks/${encodeURIComponent(id)}`)).party; }
  catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)} <a href="#/party">${esc(t("party.nav"))}</a></div>`; return; }
  app.innerHTML = `<section class="hero party-hero"><img class="hero-logo" src="logo.svg" alt="" width="84" height="84"><h1>${esc(P.title || t("pp.untitled"))}</h1><p>${esc(t("thanks.title"))}</p></section>
    <div class="panel"><h2 class="sec">${esc(t("thanks.sub"))}</h2>${P.vendors.length ? `<ul class="plist">${P.vendors.map((v) => `<li><span>${CAT_ICON[v.category] || ""} <a href="#/group/${esc(v.group_id)}"><strong>${esc(v.group_name)}</strong></a> <span class="dim small">· ${esc(t("type." + v.type))}</span></span><a class="btn ghost small" href="#/group/${esc(v.group_id)}">${esc(t("card.book"))}</a></li>`).join("")}</ul>` : ""}</div>
    <p class="center"><a class="btn" href="#/party">🎉 ${esc(t("thanks.cta"))}</a></p>`;
}
