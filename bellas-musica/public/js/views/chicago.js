import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, sel } from "../ui.js";
import { groupCard } from "./home.js";

const POPULAR = ["Quinceañera", "Wedding", "Birthday", "Serenata", "Anniversary", "Corporate / Restaurant"];

// The launch-city page: what it is, how it works, neighborhoods, top groups, questions, and a door for groups.
export async function chicago(app) {
  const m = state.meta.market;
  document.title = `${t("chi.title")} · Bella's Música`;
  let top = [];
  try { top = (await api.get("/api/best?zip=" + encodeURIComponent(m.center_zip))).groups.slice(0, 6); } catch { /* the page still works without the list */ }
  const anySample = top.some((g) => g.demo);
  app.innerHTML = `<section class="hero"><img class="hero-logo" src="logo.svg" alt="" width="84" height="84"><h1>${esc(t("chi.title"))}</h1><p>${esc(t("chi.sub"))}</p>
    <form class="search" id="cform" novalidate><label for="c-zip">${esc(t("f.zip"))}</label><input id="c-zip" inputmode="numeric" maxlength="5" pattern="\\d{5}" required value="${esc(m.center_zip)}" autocomplete="postal-code">
      <label for="c-ev">${esc(t("f.event"))}</label><select id="c-ev"><option value="">${esc(t("f.anyEvent"))}</option>${state.meta.events.map((e) => `<option value="${esc(e)}">${esc(t("event." + e))}</option>`).join("")}</select>
      <button class="btn" type="submit">${esc(t("chi.zipBtn"))}</button></form></section>
    <section class="panel"><h2 class="sec">${esc(t("chi.hoods"))}</h2><div class="chips">${m.neighborhoods.map((n) => `<a class="tag chip-link" href="#/?zip=${esc(n.zip)}">${esc(n.name)}</a>`).join("")}</div></section>
    <section class="steps" aria-labelledby="how-h"><h2 class="sec" id="how-h">${esc(t("chi.how"))}</h2><div class="three">${[["chi.step1t", "chi.step1"], ["chi.step2t", "chi.step2"], ["chi.step3t", "chi.step3"]].map(([h, p]) => `<div class="panel"><h3>${esc(t(h))}</h3><p class="dim">${esc(t(p))}</p></div>`).join("")}</div></section>
    <section class="steps" aria-labelledby="why-h"><h2 class="sec" id="why-h">${esc(t("chi.why"))}</h2><div class="why">${[["chi.w1t", "chi.w1"], ["chi.w2t", "chi.w2"], ["chi.w3t", "chi.w3"], ["chi.w4t", "chi.w4"], ["chi.w5t", "chi.w5"]].map(([h, p]) => `<div class="panel"><h3>${esc(t(h))}</h3><p class="dim">${esc(t(p))}</p></div>`).join("")}</div></section>
    <section class="panel"><h2 class="sec">${esc(t("chi.events"))}</h2><div class="chips">${POPULAR.filter((e) => state.meta.events.includes(e)).map((e) => `<a class="tag chip-link" href="#/?zip=${esc(m.center_zip)}&event=${encodeURIComponent(e)}">${esc(t("event." + e))}</a>`).join("")}</div></section>
    ${top.length ? `<section><h2 class="sec">${esc(t("chi.top"))}</h2><div class="grid">${top.map((g, i) => groupCard(g, i)).join("")}</div>${anySample ? `<p class="dim small">${esc(t("chi.note"))}</p>` : ""}</section>` : ""}
    <section class="panel"><h2 class="sec">${esc(t("chi.faq"))}</h2>${[["chi.q1", "chi.a1"], ["chi.q2", "chi.a2"], ["chi.q3", "chi.a3"], ["chi.q4", "chi.a4"]].map(([q, a]) => `<details class="faq"><summary>${esc(t(q))}</summary><p>${esc(t(a))}</p></details>`).join("")}</section>
    <section class="panel cta-groups"><h2 class="sec">${esc(t("chi.groups"))}</h2><p>${esc(t("chi.groupsText"))}</p><a class="btn" href="#/${state.user ? "dashboard?new=1" : "signup?next=" + encodeURIComponent("#/dashboard?new=1")}">${esc(t("chi.groupsBtn"))}</a></section>`;
  document.getElementById("cform").onsubmit = (e) => {
    e.preventDefault();
    const zip = document.getElementById("c-zip").value.trim(), ev = document.getElementById("c-ev").value;
    if (!/^\d{5}$/.test(zip)) { document.getElementById("c-zip").focus(); return; }
    location.hash = `#/?zip=${zip}${ev ? "&event=" + encodeURIComponent(ev) : ""}`;
  };
}
