// "Get the app": install Bella's Música on the phone, and the phone-notifications switch (also on the Account page and
// the vendor dashboard).
import { api } from "../api.js";
import { state, setUser } from "../state.js";
import { t } from "../i18n.js";
import { esc, toast } from "../ui.js";
import { installMode, promptInstall, onInstallChange, pushState, pushOn, pushOff, storeApp } from "../appmode.js";

function installBlock() {
  const mode = installMode(), m = state.meta || {};
  const stores = [m.play_url ? `<a class="btn ghost" href="${esc(m.play_url)}" rel="noopener">▶ ${esc(t("app.play"))}</a>` : "", m.app_store_url ? `<a class="btn ghost" href="${esc(m.app_store_url)}" rel="noopener"> ${esc(t("app.appStore"))}</a>` : ""].filter(Boolean).join(" ");
  if (!mode) return `<div class="note ok">✓ ${esc(t("app.installed"))}</div>`;
  const how = mode === "prompt" ? `<button type="button" class="btn wide" id="app-install">📲 ${esc(t("app.install"))}</button>`
    : mode === "ios" ? `<ol class="app-steps"><li>${t("app.ios1")}</li><li>${t("app.ios2")}</li><li>${esc(t("app.ios3"))}</li></ol>`
    : `<ol class="app-steps"><li>${esc(t("app.manual1"))}</li><li>${esc(t("app.manual2"))}</li></ol>`;
  return `${how}${stores ? `<p class="dim small">${esc(t("app.orStore"))}</p><p>${stores}</p>` : ""}`;
}

export async function appPage(app) {
  document.title = `${t("app.title")} · Bella's Música`;
  app.innerHTML = `<div class="panel narrow app-page"><img src="icon-192.png" alt="" width="96" height="96" class="app-icon"><h1>${esc(t("app.title"))}</h1>
    <p>${esc(t("app.lead"))}</p><div id="app-install-box">${installBlock()}</div></div>
    <div class="panel narrow"><h2 class="sec">🔔 ${esc(t("push.title"))}</h2><div id="pushbox"></div></div>`;
  const wire = () => {
    const b = document.getElementById("app-install");
    if (b) b.onclick = async () => { if (await promptInstall()) toast(t("app.thanks")); redraw(); };
  };
  const redraw = () => { const box = document.getElementById("app-install-box"); if (box) { box.innerHTML = installBlock(); wire(); } };
  wire(); onInstallChange(redraw);
  await pushPanel(document.getElementById("pushbox"));
}

// The notifications switch. compact = the one-line nudge on the dashboard (hidden once they're on or blocked).
export async function pushPanel(box, { compact = false } = {}) {
  if (!box) return;
  const st = await pushState(), user = state.user;
  if (!box.isConnected) return;
  if (compact) {
    if (!user || st !== "off") { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="note push-nudge">🔔 ${esc(t("push.nudge"))} <button type="button" class="btn small" id="push-nudge-on">${esc(t("push.turnOn"))}</button> <button type="button" class="linkbtn" id="push-nudge-x">${esc(t("push.later"))}</button></div>`;
    document.getElementById("push-nudge-on").onclick = async () => { try { const r = await pushOn(); toast(t(r === "on" ? "push.onToast" : "push.blocked"), r === "on" ? undefined : "error"); } catch (e) { toast(e.message, "error"); } pushPanel(box, { compact }); };
    document.getElementById("push-nudge-x").onclick = () => { try { localStorage.setItem("bm_push_later", String(Date.now())); } catch { /* storage blocked */ } box.hidden = true; };
    try { if (Date.now() - Number(localStorage.getItem("bm_push_later") || 0) < 14 * 86400000) box.hidden = true; } catch { /* storage blocked */ }
    return;
  }
  const status = {
    on: `<div class="note ok">✓ ${esc(t("push.isOn"))}</div>`,
    off: `<p>${esc(t("push.why"))}</p>`,
    denied: `<div class="note warn">${esc(t("push.denied"))}</div>`,
    install: `<div class="note">${esc(t("push.iosInstall"))} <a href="#/app">${esc(t("app.how"))}</a></div>`,
    unsupported: `<div class="note">${esc(t("push.unsupported"))}</div>`
  }[st];
  box.innerHTML = `${status}
    ${!user ? `<p class="dim small">${esc(t("push.loginFirst"))}</p>`
      : st === "off" ? `<button type="button" class="btn" id="push-on">🔔 ${esc(t("push.turnOn"))}</button>`
      : st === "on" ? `<button type="button" class="btn ghost small" id="push-test">${esc(t("push.test"))}</button> <button type="button" class="btn ghost small" id="push-off">${esc(t("push.turnOff"))}</button>
        <label class="chk"><input type="checkbox" id="push-only"${user.push_only ? " checked" : ""}> <span>${esc(t("push.only"))}</span></label><div class="dim small">${esc(t("push.onlyHint"))}</div>` : ""}`;
  const on = document.getElementById("push-on"), off = document.getElementById("push-off"), test = document.getElementById("push-test"), only = document.getElementById("push-only");
  if (on) on.onclick = async () => { on.disabled = true; try { const r = await pushOn(); toast(t(r === "on" ? "push.onToast" : "push.blocked"), r === "on" ? undefined : "error"); } catch (e) { toast(e.message, "error"); } pushPanel(box); };
  if (off) off.onclick = async () => { await pushOff(); if (state.user?.push_only) setUser({ ...state.user, push_only: false }); toast(t("push.offToast")); pushPanel(box); };
  if (test) test.onclick = async () => { try { await api.post("/api/push/test"); toast(t("push.sent")); } catch (e) { toast(e.message, "error"); } };
  if (only) only.onchange = async () => {
    try { setUser((await api.patch("/api/me", { push_only: only.checked })).user); toast(t("common.saved")); }
    catch (e) { toast(e.message, "error"); }
  };
}

// The footer link, only where installing makes sense.
export const appLink = () => (installMode() && !storeApp() ? ` · <a href="#/app">📲 ${esc(t("app.get"))}</a>` : "");
