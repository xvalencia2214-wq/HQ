import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang } from "../i18n.js";
import { esc } from "../ui.js";

// "Tell me when you reach my city." Doubles as a demand map for choosing the next market.
export function waitlistBox(zip, city) {
  const m = state.meta.market;
  const box = document.createElement("div");
  box.className = "panel waitlist";
  box.innerHTML = `<h2 class="sec">${esc(t("wl.title", { market: m.name }))}</h2><p>${esc(t("wl.text", { city }))}</p>
    <form novalidate><div class="row"><div><label for="w-email">${esc(t("wl.email"))}</label><input id="w-email" name="email" type="email" required maxlength="254" autocomplete="email" value="${esc(state.user ? state.user.email : "")}"></div>
    <div><label for="w-kind">${esc(t("wl.iam"))}</label><select id="w-kind" name="kind"><option value="customer">${esc(t("wl.customer"))}</option><option value="group">${esc(t("wl.group"))}</option></select></div></div>
    <div class="err" role="alert"></div><button class="btn" type="submit">${esc(t("wl.join"))}</button> <a class="btn ghost" href="#/chicago">${esc(t("wl.seeMarket", { market: m.name }))}</a></form>`;
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = box.querySelector(".err"); err.textContent = "";
    try {
      await api.post("/api/waitlist", { email: f.email, zip, kind: f.kind, lang: lang() });
      e.target.outerHTML = `<div class="note ok" role="status">${esc(t("wl.thanks", { city }))}</div>`;
    } catch (ex) { err.textContent = ex.message; }
  };
  return box;
}
