import { api } from "../api.js";
import { setUser, state } from "../state.js";
import { setLang, lang } from "../i18n.js";
import { t } from "../i18n.js";
import { esc, toast } from "../ui.js";

const safeNext = (n) => (n && n.startsWith("#/") ? n : "#/");

export function authView(app, mode, params) {
  const next = safeNext(params.get("next"));
  const signup = mode === "signup";
  app.innerHTML = `<div class="panel narrow"><h1>${esc(t(signup ? "auth.signupTitle" : "auth.loginTitle"))}</h1>
    <form id="authform" novalidate>
      ${signup ? `<label for="a-name">${esc(t("auth.name"))}</label><input id="a-name" name="name" required maxlength="80" autocomplete="name">` : ""}
      <label for="a-email">${esc(t("auth.email"))}</label><input id="a-email" name="email" type="email" required maxlength="254" autocomplete="email">
      <label for="a-pw">${esc(t("auth.password"))}</label><input id="a-pw" name="password" type="password" required minlength="8" maxlength="200" autocomplete="${signup ? "new-password" : "current-password"}">
      ${signup ? `<div class="dim small">${esc(t("auth.pwHint"))}</div>
      <label for="a-phone">${esc(t("auth.phone"))}</label><input id="a-phone" name="phone" inputmode="tel" maxlength="20" autocomplete="tel">
      <label class="chk"><input type="checkbox" name="sms"> <span>${esc(t("auth.smsConsent"))}</span></label>` : ""}
      <div id="autherr" class="err" role="alert"></div>
      <button class="btn wide" type="submit">${esc(t(signup ? "nav.signup" : "nav.login"))}</button>
    </form>
    <p class="dim">${signup ? `${esc(t("auth.have"))} <a href="#/login?next=${encodeURIComponent(next)}">${esc(t("nav.login"))}</a>` : `${esc(t("auth.new"))} <a href="#/signup?next=${encodeURIComponent(next)}">${esc(t("nav.signup"))}</a>`}</p>
    ${signup ? "" : `<p class="dim"><a href="#/forgot">${esc(t("rec.forgotLink"))}</a></p>`}</div>`;
  document.getElementById("authform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = document.getElementById("autherr");
    err.textContent = "";
    try {
      const r = await api.post(signup ? "/api/auth/register" : "/api/auth/login", signup
        ? { email: f.email, password: f.password, name: f.name, phone: f.phone || "", sms_opt_in: f.sms === "on", lang: lang(), ref: params.get("ref") || undefined, source: (() => { try { return localStorage.getItem("bm_src") || undefined; } catch { return undefined; } })() }
        : { email: f.email, password: f.password });
      setUser(r.user);
      if (r.user.lang && r.user.lang !== lang() && !signup) setLang(r.user.lang, { persist: false });
      location.hash = next;
    } catch (ex) { err.textContent = ex.message; }
  };
}

export function accountView(app) {
  const u = state.user;
  app.innerHTML = `<h1 class="sec">${esc(t("acct.title"))}</h1><div class="two"><div class="panel"><h2 class="sec">${esc(t("acct.profile"))}</h2>
    <form id="pform"><label for="p-name">${esc(t("auth.name"))}</label><input id="p-name" name="name" required maxlength="80" value="${esc(u.name)}">
    <label>${esc(t("auth.email"))}</label><input value="${esc(u.email)}" disabled aria-label="${esc(t("auth.email"))}">
    <label for="p-phone">${esc(t("auth.phone"))}</label><input id="p-phone" name="phone" inputmode="tel" maxlength="20" value="${esc(u.phone)}">
    <label class="chk"><input type="checkbox" name="sms"${u.sms_opt_in ? " checked" : ""}> <span>${esc(t("auth.smsConsent"))}</span></label>
    <label class="chk"><input type="checkbox" name="emailnotify"${u.email_notify ? " checked" : ""}> <span>${esc(t("acct.emailNotify"))}</span></label>
    <label class="chk"><input type="checkbox" name="dailytext"${u.daily_text !== false ? " checked" : ""}> <span>${esc(t("acct.dailyText"))}</span></label>
    ${state.meta.whatsapp ? `<fieldset class="chan"><legend>${esc(t("acct.channel"))}</legend><label class="chk"><input type="radio" name="channel" value="sms"${u.notify_channel !== "whatsapp" ? " checked" : ""}> <span>${esc(t("acct.chSms"))}</span></label><label class="chk"><input type="radio" name="channel" value="whatsapp"${u.notify_channel === "whatsapp" ? " checked" : ""}> <span>WhatsApp</span></label></fieldset>` : ""}
    <div class="dim small">${esc(t(u.email_verified ? "acct.verified" : "acct.unverified"))}</div>
    <div id="perr" class="err" role="alert"></div><button class="btn" type="submit">${esc(t("common.save"))}</button></form></div>
    <div class="panel"><h2 class="sec">${esc(t("acct.password"))}</h2><form id="wform">
    <label for="w-cur">${esc(t("acct.current"))}</label><input id="w-cur" name="current" type="password" autocomplete="current-password" required>
    <label for="w-new">${esc(t("acct.new"))}</label><input id="w-new" name="next" type="password" minlength="8" autocomplete="new-password" required>
    <div id="werr" class="err" role="alert"></div><button class="btn" type="submit">${esc(t("acct.change"))}</button></form>
    <p class="dim small">${esc(t("acct.others"))}</p></div></div>
    <details class="panel danger"><summary>${esc(t("acct.delete"))}</summary><p class="dim">${esc(t("acct.deleteWarn"))}</p>
    <form id="dform"><label for="d-pw">${esc(t("acct.deletePw"))}</label><input id="d-pw" name="password" type="password" autocomplete="current-password" required>
    <div id="derr" class="err" role="alert"></div><button class="btn dangerbtn" type="submit">${esc(t("acct.deleteBtn"))}</button></form></details>`;
  document.getElementById("pform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = document.getElementById("perr"); err.textContent = "";
    try { setUser((await api.patch("/api/me", { name: f.name, phone: f.phone, sms_opt_in: f.sms === "on", email_notify: f.emailnotify === "on", daily_text: f.dailytext === "on", ...(f.channel ? { notify_channel: f.channel } : {}) })).user); toast(t("common.saved")); accountView(app); }
    catch (ex) { err.textContent = ex.message; }
  };
  document.getElementById("dform").onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm(t("acct.deleteConfirm"))) return;
    const err = document.getElementById("derr"); err.textContent = "";
    try { await api.post("/api/me/delete", { password: new FormData(e.target).get("password") }); setUser(null); location.hash = "#/"; toast(t("acct.deleted")); }
    catch (ex) { err.textContent = ex.message; }
  };
  document.getElementById("wform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = document.getElementById("werr"); err.textContent = "";
    try { await api.post("/api/me/password", { current: f.current, next: f.next }); e.target.reset(); toast(t("common.saved")); }
    catch (ex) { err.textContent = ex.message; }
  };
}
