import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, toast } from "../ui.js";

// A group opens the private link you gave them, logs in, and the draft listing you made becomes theirs.
export async function claim(app, token) {
  let info;
  try { info = (await api.get("/api/claim/" + encodeURIComponent(token))).group; }
  catch { app.innerHTML = `<div class="panel narrow"><h1>${esc(t("claim.title"))}</h1><div class="note warn" role="alert">${esc(t("claim.bad"))}</div></div>`; return; }
  const next = encodeURIComponent("#/claim/" + token);
  app.innerHTML = `<div class="panel narrow"><h1>${esc(t("claim.title"))}</h1><p>${esc(t("claim.text", { name: info.name, city: info.city }))}</p>
    ${info.story ? `<p class="dim">${esc(info.story)}</p>` : ""}
    ${state.user ? `<div id="cerr" class="err" role="alert"></div><button class="btn wide" id="claimbtn">${esc(t("claim.btn"))}</button>`
      : `<div class="note">${esc(t("claim.login"))}</div><a class="btn" href="#/signup?next=${next}">${esc(t("nav.signup"))}</a> <a class="btn ghost" href="#/login?next=${next}">${esc(t("nav.login"))}</a>`}</div>`;
  const btn = document.getElementById("claimbtn");
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    try { const r = await api.post("/api/claim/" + encodeURIComponent(token)); toast(t("claim.done")); location.hash = `#/dashboard?g=${r.group_id}&tab=listing`; }
    catch (e) { document.getElementById("cerr").textContent = e.message; btn.disabled = false; }
  };
}
