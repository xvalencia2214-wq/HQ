import { init, state, onChange, setUser, refreshMetaIfStale } from "./state.js";
import { api } from "./api.js";
import { t, lang, setLang, initLang } from "./i18n.js";
import { esc, toast } from "./ui.js";
import { killMap } from "./map.js";
import { home } from "./views/home.js";
import { best } from "./views/best.js";
import { group } from "./views/group.js";
import { authView, accountView } from "./views/auth.js";
import { myBookings, bookingPage, simulatedPay } from "./views/bookings.js";
import { dashboard, newGroup } from "./views/dashboard.js";

const app = document.getElementById("app");
let routeToken = 0;

function renderChrome() {
  const u = state.user;
  document.getElementById("nav").innerHTML =
    `<a href="#/" data-r="home">${esc(t("nav.find"))}</a>` +
    (u ? `<a href="#/bookings" data-r="bookings">${esc(t("nav.bookings"))}</a>` : "") +
    `<a href="#/dashboard" data-r="dashboard">${esc(t("nav.groups"))}</a>` +
    (u ? `<a href="#/account" data-r="account">${esc(u.name.split(" ")[0])}</a><button type="button" id="logout" class="linkbtn">${esc(t("nav.logout"))}</button>`
      : `<a href="#/login" data-r="login">${esc(t("nav.login"))}</a><a href="#/signup" data-r="signup" class="cta">${esc(t("nav.signup"))}</a>`) +
    `<button type="button" id="langbtn" class="linkbtn" aria-label="Español / English">${lang() === "es" ? "EN" : "ES"}</button>`;
  const lo = document.getElementById("logout");
  if (lo) lo.onclick = async () => { await api.post("/api/auth/logout"); setUser(null); location.hash = "#/"; toast(t("nav.loggedOut")); };
  document.getElementById("langbtn").onclick = () => setLang(lang() === "es" ? "en" : "es");
  document.getElementById("foot").innerHTML = `${esc(t("foot"))} · <a href="terms.html">${esc(t("foot.terms"))}</a> · <a href="privacy.html">${esc(t("foot.privacy"))}</a>`;
  const banner = document.getElementById("banner");
  banner.hidden = state.meta.payments !== "simulated";
  banner.textContent = t("banner.test");
  const cur = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] || "home";
  document.querySelectorAll("#nav a[data-r]").forEach((a) => a.classList.toggle("on", a.dataset.r === cur));
}

const needsLogin = new Set(["bookings", "booking", "pay", "dashboard", "account"]);

async function route() {
  const token = ++routeToken;
  killMap();
  document.title = "Bella's Música";
  const raw = location.hash.replace(/^#/, "") || "/";
  const qi = raw.indexOf("?");
  const path = qi === -1 ? raw : raw.slice(0, qi);
  const params = new URLSearchParams(qi === -1 ? "" : raw.slice(qi + 1));
  const seg = path.split("/").filter(Boolean);
  await refreshMetaIfStale();
  if (token !== routeToken) return;
  renderChrome();
  window.scrollTo(0, 0);
  if (needsLogin.has(seg[0]) && !state.user) { location.hash = "#/login?next=" + encodeURIComponent(location.hash); return; }
  const box = document.createElement("div");
  app.replaceChildren(box);
  try {
    if (seg[0] === "group" && seg[1]) await group(box, seg[1]);
    else if (seg[0] === "best" && seg[1]) await best(box, seg[1]);
    else if (seg[0] === "login" || seg[0] === "signup") authView(box, seg[0], params);
    else if (seg[0] === "bookings") await myBookings(box);
    else if (seg[0] === "booking" && seg[1]) await bookingPage(box, seg[1], params);
    else if (seg[0] === "pay" && seg[1] && seg[2]) await simulatedPay(box, seg[1], seg[2]);
    else if (seg[0] === "dashboard") { if (params.get("new")) newGroup(box); else await dashboard(box, params); }
    else if (seg[0] === "account") accountView(box);
    else await home(box, params);
  } catch (e) {
    if (token !== routeToken) return; // the user already moved on
    console.error(e);
    box.innerHTML = `<div class="panel empty">${esc(e && e.message ? e.message : t("common.error"))}</div>`;
  }
}

initLang(() => { renderChrome(); route(); });
await init();
if (state.user && state.user.lang && !localStorage.getItem("bm_lang")) setLang(state.user.lang, { persist: false });
onChange(renderChrome);
window.addEventListener("hashchange", route);
route();
