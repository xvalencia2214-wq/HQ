import { api } from "../api.js";
import { t } from "../i18n.js";
import { esc, money, fmtDate, toast, goto } from "../ui.js";
import { state } from "../state.js";
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
      <div class="panel"><h2 class="sec">✅ ${esc(t("fam.booked"))}</h2>${P.vendors.filter((v) => v.status !== "unpaid").length ? `<ul class="plist">${P.vendors.filter((v) => v.status !== "unpaid").map((v) => `<li><span>${CAT_ICON[v.category] || ""} <a href="#/group/${esc(v.group_id)}">${esc(v.group_name)}</a> <span class="dim small">· ${esc(t("type." + v.type))}</span>
        ${v.padrinos.length ? `<br><span class="small">🎁 ${esc(t("pad.list", { names: v.padrinos.map((x) => x.name).join(", ") }))}</span>` : ""}
        ${v.balance_left_cents ? `<br><span class="dim small">${esc(t("pp.balanceLeft", { amount: money(v.balance_left_cents) }))}</span>` : ""}</span>
        ${v.balance_left_cents ? `<button type="button" class="btn small" data-padrino="${esc(v.id)}" data-left="${v.balance_left_cents}" data-name="${esc(v.group_name)}">🎁 ${esc(t("pad.be"))}</button>` : ""}<div class="padform" hidden></div></li>`).join("")}</ul>
        <p class="dim small">${esc(t("pad.hint"))}</p>` : `<p class="dim">${esc(t("fam.none"))}</p>`}</div>
      <div class="panel"><h2 class="sec">♥ ${esc(t("pp.picks"))}</h2><p class="dim small">${esc(t("fam.voteHint"))}</p>
      ${P.picks.length ? `<div class="picks">${P.picks.map((k) => `<div class="pick"><div class="pick-h"><a href="#/group/${esc(k.id)}"><strong>${esc(k.name)}</strong></a> <span class="dim small">${CAT_ICON[k.category] || ""} ${esc(t("type." + k.type))} · ${esc(t("card.from", { price: money(k.from_cents) }))}</span>
        <button type="button" class="btn small ${k.my_vote ? "" : "ghost"} votebtn" data-vote="${esc(k.id)}" aria-pressed="${k.my_vote}">♥ ${k.votes}</button></div>
        ${k.added_by ? `<div class="dim small">${esc(t("pp.by", { name: k.added_by }))}</div>` : ""}${commentList(k.comments)}
        <form class="cform" data-g="${esc(k.id)}">${nameField("n-" + k.id)}<input name="text" maxlength="300" required placeholder="${esc(t("pp.commentPh"))}" aria-label="${esc(t("pp.comment"))}"><button class="btn small" type="submit">${esc(t("pp.send"))}</button></form></div>`).join("")}</div>` : `<p class="dim">${esc(t("pp.noPicks"))}</p>`}</div>
      <div class="panel"><h2 class="sec">💬 ${esc(t("pp.chat"))}</h2>${commentList(P.comments)}
        <form class="cform" data-g="">${nameField("n-chat")}<input name="text" maxlength="300" required placeholder="${esc(t("pp.commentPh"))}" aria-label="${esc(t("pp.chat"))}"><button class="btn small" type="submit">${esc(t("pp.send"))}</button></form></div>
      ${P.timeline.length ? `<div class="panel"><h2 class="sec">🕒 ${esc(t("pp.timeline"))}</h2><ul class="tlview">${P.timeline.map((r) => `<li><strong>${esc(r.at)}</strong> ${esc(r.label)}${r.vendor ? ` <span class="dim small">· ${esc(r.vendor)}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
      <p class="center"><a class="btn ghost" href="#/party">${esc(t("thanks.cta"))}</a></p>`;
    app.querySelectorAll("[data-padrino]").forEach((b) => { b.onclick = () => {
      if (!state.user) { location.hash = `#/signup?next=${encodeURIComponent(location.hash)}`; toast(t("pad.login")); return; }
      const box = b.parentElement.querySelector(".padform"), left = Number(b.dataset.left);
      box.hidden = false;
      box.innerHTML = `<form class="cform"><p class="small" style="flex-basis:100%">${esc(t("pad.for", { name: b.dataset.name, amount: money(left) }))}</p>
        <input name="name" maxlength="40" required aria-label="${esc(t("pp.yourName"))}" placeholder="${esc(t("pad.yourName"))}" value="${esc(store.get("bm_party_name") || state.user.name.split(" ")[0])}">
        <input name="note" maxlength="60" aria-label="${esc(t("pad.note"))}" placeholder="${esc(t("pad.notePh"))}">
        <input name="amount" type="number" min="20" max="${Math.ceil(left / 100)}" inputmode="numeric" aria-label="${esc(t("plan.amount"))}" placeholder="${esc(t("plan.amount"))}" value="${Math.min(Math.ceil(left / 100), 100)}">
        <button class="btn small" type="submit">${esc(t("plan.pay"))}</button><button type="button" class="btn ghost small" data-rest>${esc(t("plan.rest", { amount: money(left) }))}</button><div class="err" role="alert" style="flex-basis:100%"></div></form>`;
      const go = async (extra) => {
        const f = box.querySelector("form");
        store.set("bm_party_name", f.name.value.trim());
        try { goto((await api.post(base + "/padrino", { bookingId: b.dataset.padrino, name: f.name.value.trim(), note: f.note.value.trim(), ...extra })).payment.url); }
        catch (ex) { box.querySelector(".err").textContent = ex.message; }
      };
      box.querySelector("form").onsubmit = (e) => { e.preventDefault(); go({ amount: Number(box.querySelector("[name=amount]").value) }); };
      box.querySelector("[data-rest]").onclick = () => go({ rest: true });
    }; });
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
