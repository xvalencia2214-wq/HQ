import { api } from "../api.js";
import { t } from "../i18n.js";
import { esc, shareButtons, wireShare } from "../ui.js";
import { groupCard } from "./home.js";

export async function best(app, zip) {
  let data;
  try { data = await api.get("/api/best?zip=" + encodeURIComponent(zip)); }
  catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)} <a href="#/">${esc(t("nav.find"))}</a></div>`; return; }
  const title = t("best.title", { city: data.city, state: data.state });
  app.innerHTML = `<a class="back" href="#/">← ${esc(t("common.back"))}</a>
    <div class="titlebar"><h1>🏆 ${esc(title)}</h1>${shareButtons(title, "#/best/" + zip)}</div>
    <p class="dim">${esc(t("best.sub"))}</p>
    ${data.groups.length ? `<h2 class="sr-only">${esc(t("home.top", { city: data.city }))}</h2><div class="grid">${data.groups.map(groupCard).join("")}</div>` : `<div class="panel empty">${esc(t("home.none"))}</div>`}`;
  wireShare(app);
}
