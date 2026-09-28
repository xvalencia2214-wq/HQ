import { api } from "../api.js";
import { state, setUser } from "../state.js";
import { t } from "../i18n.js";
import { esc, toast } from "../ui.js";

// "Forgot password?" asks for an email and always answers the same way, so it can't be used to find out who has an account.
export function forgotView(app) {
  const sim = state.meta.email !== "resend";
  app.innerHTML = `<div class="panel narrow"><h1>${esc(t("rec.forgotTitle"))}</h1><p class="dim">${esc(t("rec.forgotSub"))}</p>
    ${sim ? `<div class="note">${esc(t("rec.simNote"))}</div>` : ""}
    <form id="fform" novalidate><label for="f-email">${esc(t("auth.email"))}</label><input id="f-email" name="email" type="email" required maxlength="254" autocomplete="email">
    <div id="ferr" class="err" role="alert"></div><button class="btn wide" type="submit">${esc(t("rec.send"))}</button></form>
    <p class="dim"><a href="#/login">${esc(t("rec.backLogin"))}</a></p></div>`;
  document.getElementById("fform").onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById("ferr"); err.textContent = "";
    try {
      await api.post("/api/auth/forgot", { email: new FormData(e.target).get("email") });
      e.target.outerHTML = `<div class="note ok" role="status">${esc(t("rec.sent"))}</div>`;
    } catch (ex) { err.textContent = ex.message; }
  };
}

export function resetView(app, token) {
  app.innerHTML = `<div class="panel narrow"><h1>${esc(t("rec.resetTitle"))}</h1>
    <form id="rform" novalidate><label for="r-pw">${esc(t("rec.newPw"))}</label><input id="r-pw" name="password" type="password" required minlength="8" maxlength="200" autocomplete="new-password">
    <div class="dim small">${esc(t("auth.pwHint"))}</div>
    <label for="r-pw2">${esc(t("rec.confirmPw"))}</label><input id="r-pw2" name="again" type="password" required minlength="8" maxlength="200" autocomplete="new-password">
    <div id="rerr" class="err" role="alert"></div><button class="btn wide" type="submit">${esc(t("rec.resetBtn"))}</button></form></div>`;
  document.getElementById("rform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = document.getElementById("rerr"); err.textContent = "";
    if (f.password !== f.again) { err.textContent = t("rec.mismatch"); return; }
    try {
      await api.post("/api/auth/reset", { token, password: f.password });
      setUser(null); // the server signs the account out everywhere
      toast(t("rec.resetDone")); location.hash = "#/login";
    } catch (ex) { err.textContent = ex.message; }
  };
}

export async function verifyView(app, token) {
  app.innerHTML = `<div class="panel narrow"><h1>${esc(t("rec.verifying"))}</h1></div>`;
  try {
    await api.post("/api/auth/verify", { token });
    try { setUser((await api.get("/api/me")).user); } catch { /* not logged in here: fine */ }
    app.innerHTML = `<div class="panel narrow"><h1>${esc(t("rec.verified"))}</h1><a class="btn" href="#/">${esc(t("rec.continue"))}</a></div>`;
  } catch (e) {
    app.innerHTML = `<div class="panel narrow"><h1>${esc(t("nav.login"))}</h1><div class="note warn" role="alert">${esc(t("rec.verifyFail"))}</div><a class="btn" href="#/login">${esc(t("nav.login"))}</a></div>`;
  }
}

// The strip under the header for people who haven't confirmed their email yet. Only when real email is on.
export function renderVerifyBanner() {
  const el = document.getElementById("vbanner"), u = state.user;
  const show = Boolean(u && !u.email_verified && state.meta && state.meta.email === "resend");
  el.hidden = !show;
  if (!show) return;
  el.innerHTML = `${esc(t("ver.banner", { email: u.email }))} <button type="button" class="linkbtn" id="vresend">${esc(t("ver.resend"))}</button>`;
  document.getElementById("vresend").onclick = async () => {
    try { await api.post("/api/auth/resend-verification"); toast(t("ver.resent")); } catch (e) { toast(e.message, "error"); }
  };
}
