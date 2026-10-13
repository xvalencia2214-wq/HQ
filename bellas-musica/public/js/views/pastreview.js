import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang } from "../i18n.js";
import { esc, toast } from "../ui.js";

export const monthLabel = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(lang() === "es" ? "es-US" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// A past client writes a review from the link the business sent (#/review/<token>).
export async function pastReview(app, token) {
  let r;
  try { r = await api.get(`/api/past-review/${encodeURIComponent(token)}`); }
  catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  document.title = `${t("pr.pageTitle", { group: r.group.name })} · Bella's Música`;
  const head = `<h1 class="sec">${esc(t("pr.pageTitle", { group: r.group.name }))}</h1><p>${esc(t("pr.pageLead", { group: r.group.name, event: t("event." + r.event).toLowerCase(), when: monthLabel(r.when) }))}</p>`;
  const page = `<a class="btn ghost" href="#/group/${esc(r.group.id)}">${esc(t("pr.see"))}</a>`;
  if (r.status === "done") { app.innerHTML = `<div class="panel narrow">${head}<p class="note ok">${esc(t("pr.already"))}</p>${page}</div>`; return; }
  if (r.status === "expired") { app.innerHTML = `<div class="panel narrow">${head}<p class="note warn">${esc(t("pr.expired"))}</p></div>`; return; }
  if (!state.user) {
    const next = encodeURIComponent(location.hash);
    app.innerHTML = `<div class="panel narrow">${head}<p>${esc(t("pr.loginFirst"))}</p><a class="btn" href="#/signup?next=${next}">${esc(t("nav.signup"))}</a> <a class="btn ghost" href="#/login?next=${next}">${esc(t("nav.login"))}</a></div>`;
    return;
  }
  app.innerHTML = `<div class="panel narrow">${head}<form id="prform">
    <p class="starlabel" id="pr-stars-l">${esc(t("pr.stars"))}</p><fieldset class="starpick" aria-labelledby="pr-stars-l">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="pr-s${n}" value="${n}" required${n === 5 ? " checked" : ""}><label for="pr-s${n}" title="${n}">★<span class="sr-only">${n}</span></label>`).join("")}</fieldset>
    <label for="pr-text">${esc(t("pr.textLabel"))}</label><textarea id="pr-text" name="text" required minlength="10" maxlength="800" placeholder="${esc(t("pr.textPh"))}"></textarea>
    <div class="err" role="alert"></div><button class="btn wide" type="submit">${esc(t("pr.send"))}</button></form></div>`;
  document.getElementById("prform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = e.target.querySelector(".err"); err.textContent = "";
    try {
      await api.post(`/api/past-review/${encodeURIComponent(token)}`, { rating: Number(f.rating), text: f.text });
      app.innerHTML = `<div class="panel narrow">${head}<p class="note ok">${esc(t("pr.thanks"))}</p>${page}</div>`; toast(t("pr.thanks"));
    } catch (ex) { err.textContent = ex.message; }
  };
}
