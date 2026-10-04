import { init, state, onChange, setUser, refreshMetaIfStale, refreshAttention } from "./state.js";
import { api, ApiError } from "./api.js";
import { t, lang, setLang, initLang } from "./i18n.js";
import { esc, toast } from "./ui.js";
import { killMap } from "./map.js";
import { home } from "./views/home.js";
import { best } from "./views/best.js";
import { group } from "./views/group.js";
import { authView, accountView } from "./views/auth.js";
import { forgotView, resetView, verifyView, renderVerifyBanner } from "./views/recover.js";
import { chicago } from "./views/chicago.js";
import { claim } from "./views/claim.js";
import { discover } from "./views/discover.js";
import { agreement } from "./views/agreement.js";
import { saved, shortlist } from "./views/saved.js";
import { quotes } from "./views/quotes.js";
import { party } from "./views/party.js";
import { myParty, partySign } from "./views/myparty.js";
import { familyParty, thanksPage } from "./views/family.js";
import { myBookings, bookingPage, simulatedPay } from "./views/bookings.js";
import { dashboard, newGroup } from "./views/dashboard.js";
import { messagesView } from "./views/messages.js";
import { admin } from "./views/admin.js";
import { teamInvitePage, payLinkPage, specialsPage } from "./views/business.js";
import { appPage, appLink } from "./views/app.js";
import { syncPush, onInstallChange, isStandalone } from "./appmode.js";

// Shared links (/g/<id>, /b/<zip>) are server-rendered for previews; inside the app they become normal routes.
const landing = /^\/(g|b|c)\/([\w-]+)\/?$/.exec(location.pathname);
if (landing) history.replaceState(null, "", "/#/" + (landing[1] === "g" ? "group/" + landing[2] : landing[1] === "b" ? "best/" + landing[2] : "chicago"));
// /chicago/<neighborhood>[/<event>] pages are for search engines and shared links; inside the app they open a search for that place and event.
const hoodLanding = /^\/chicago\/([\w-]+)(?:\/([\w-]+))?\/?$/.exec(location.pathname);
if (hoodLanding) {
  const EVENT_NAMES = { quinceanera: "Quinceañera", wedding: "Wedding", birthday: "Birthday", serenata: "Serenata", anniversary: "Anniversary", corporate: "Corporate / Restaurant" };
  const meta0 = await fetch("/api/meta").then((r) => r.json()).catch(() => null);
  const hood = meta0 && meta0.market.neighborhoods.find((n) => n.id === hoodLanding[1]);
  history.replaceState(null, "", "/#/" + (hood ? `?zip=${hood.zip}${EVENT_NAMES[hoodLanding[2]] ? "&event=" + encodeURIComponent(EVENT_NAMES[hoodLanding[2]]) : ""}` : "chicago"));
}


// A partner link (?src=iglesia-san-pio or utm_source=...) is remembered so the sign-up can say where the family came from.
try {
  const q = new URLSearchParams(location.search), src = q.get("src") || q.get("utm_source");
  if (src && !localStorage.getItem("bm_src")) localStorage.setItem("bm_src", src.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40));
} catch { /* private mode */ }

// Tell the server when the page itself crashes (at most 3 reports per page load). Our own code only: browser extensions and
// ordinary user-facing API errors (wrong password, a full slot) are not crashes and are skipped.
let reported = 0;
const reportCrash = (message, source, line) => {
  if (reported >= 3 || !message || /ResizeObserver loop|Script error|Connection problem/i.test(message)) return; // no signal isn't a crash
  reported++;
  fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, body: JSON.stringify({ message: String(message).slice(0, 300), source: source || "", line: Number.isInteger(line) ? line : undefined, route: location.hash }) }).catch(() => {});
};
window.addEventListener("error", (e) => { if (e.filename && !e.filename.startsWith(location.origin)) return; reportCrash(e.message, e.filename, e.lineno); });
window.addEventListener("unhandledrejection", (e) => { const r = e.reason; if (r instanceof ApiError && r.status < 500) return; reportCrash(r && r.message ? r.message : String(r), r && r.stack && (/\(?(https?:\/\/[^\s)]+?):\d+:\d+/.exec(r.stack) || [])[1]); });

const app = document.getElementById("app");
// Every page needs one level-1 heading for screen readers; views title themselves with <h2>, so promote the first one.
const ensureH1 = () => { if (!app.querySelector("h1")) { const h = app.querySelector("h2"); if (h && h.getAttribute("aria-level") !== "1") { h.setAttribute("role", "heading"); h.setAttribute("aria-level", "1"); } } };
new MutationObserver(ensureH1).observe(app, { childList: true, subtree: true });
let routeToken = 0;
let viewCleanup = null; // a view that runs animations (the welcome page) leaves a function that stops them

function renderChrome() {
  const u = state.user;
  const a = state.attention;
  const dot = (n) => (n > 0 ? `<span class="dot" aria-label="${n}">${n}</span>` : "");
  const managerCount = a ? a.manager.requests + a.manager.messages : 0;
  document.getElementById("nav").innerHTML =
    `<a href="#/" data-r="home">${esc(t("nav.find"))}</a><a href="#/quotes" data-r="quotes">${esc(t("nav.quotes"))}</a><a href="#/discover" data-r="discover">${esc(t("nav.discover"))}</a><a href="#/party" data-r="party">${esc(t("party.nav"))}</a>` +
    (u ? `<a href="#/saved" data-r="saved">♥ ${esc(t("nav.saved"))}</a><a href="#/bookings" data-r="bookings">${esc(t("nav.bookings"))}</a><a href="#/messages" data-r="messages">${esc(t("nav.messages"))}${dot(a ? a.messages : 0)}</a>` : "") +
    `<a href="#/dashboard" data-r="dashboard">${esc(t("nav.groups"))}${dot(managerCount)}</a>` +
    (u && u.is_admin ? `<a href="#/admin" data-r="admin">${esc(t("nav.admin"))}</a>` : "") +
    (u ? `<a href="#/account" data-r="account">${esc(u.name.split(" ")[0])}</a><button type="button" id="logout" class="linkbtn">${esc(t("nav.logout"))}</button>`
      : `<a href="#/login" data-r="login">${esc(t("nav.login"))}</a><a href="#/signup" data-r="signup" class="cta">${esc(t("nav.signup"))}</a>`) +
    `<button type="button" id="langbtn" class="linkbtn" aria-label="Español / English">${lang() === "es" ? "EN" : "ES"}</button>`;
  const lo = document.getElementById("logout");
  if (lo) lo.onclick = async () => { await api.post("/api/auth/logout"); setUser(null); location.hash = "#/"; toast(t("nav.loggedOut")); };
  document.getElementById("langbtn").onclick = () => setLang(lang() === "es" ? "en" : "es");
  document.getElementById("foot").innerHTML = `${esc(t("foot"))} · <a href="terms.html">${esc(t("foot.terms"))}</a> · <a href="privacy.html">${esc(t("foot.privacy"))}</a>${appLink()}`;
  const banner = document.getElementById("banner");
  banner.hidden = state.meta.payments !== "simulated";
  banner.textContent = t("banner.test");
  renderVerifyBanner();
  const nav = document.getElementById("nav"), tog = document.getElementById("navtoggle");
  nav.classList.remove("open"); tog.setAttribute("aria-expanded", "false"); tog.setAttribute("aria-label", t("nav.menu"));
  const cur0 = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] || "home", cur = cur0 === "my-party" ? "party" : cur0;
  document.querySelectorAll("#nav a[data-r]").forEach((a) => a.classList.toggle("on", a.dataset.r === cur));
}

const needsLogin = new Set(["my-party", "bookings", "booking", "agreement", "saved", "pay", "dashboard", "account", "messages", "admin"]);

async function route() {
  const token = ++routeToken;
  killMap();
  if (viewCleanup) { const stop = viewCleanup; viewCleanup = null; stop(); }
  document.title = "Bella's Música";
  const raw = location.hash.replace(/^#/, "") || "/";
  const qi = raw.indexOf("?");
  const path = qi === -1 ? raw : raw.slice(0, qi);
  const params = new URLSearchParams(qi === -1 ? "" : raw.slice(qi + 1));
  const seg = path.split("/").filter(Boolean);
  await refreshMetaIfStale();
  if (token !== routeToken) return;
  renderChrome();
  refreshAttention();
  window.scrollTo(0, 0);
  if (needsLogin.has(seg[0]) && !state.user) { location.hash = "#/login?next=" + encodeURIComponent(location.hash); return; }
  const box = document.createElement("div");
  app.replaceChildren(box);
  try {
    // the welcome page: #/welcome, and the bare address for a new visitor (not logged in, not the installed app)
    if (seg[0] === "welcome" || ((location.hash === "" || location.hash === "#") && !state.user && !isStandalone())) {
      const { landing } = await import("./views/landing.js");
      const stop = await landing(box);
      if (token !== routeToken) stop?.(); else viewCleanup = stop;
    }
    else if (seg[0] === "group" && seg[1]) await group(box, seg[1], params);
    else if (seg[0] === "best" && seg[1]) await best(box, seg[1]);
    else if (seg[0] === "login" || seg[0] === "signup") authView(box, seg[0], params);
    else if (seg[0] === "forgot") forgotView(box);
    else if (seg[0] === "reset" && seg[1]) resetView(box, seg[1]);
    else if (seg[0] === "verify" && seg[1]) await verifyView(box, seg[1]);
    else if (seg[0] === "chicago") await chicago(box);
    else if (seg[0] === "discover") await discover(box);
    else if (seg[0] === "party") await party(box, params);
    else if (seg[0] === "my-party" && seg[1] && seg[2] === "sign") await partySign(box, seg[1]);
    else if (seg[0] === "my-party" && seg[1]) await myParty(box, seg[1]);
    else if (seg[0] === "fp" && seg[1]) await familyParty(box, seg[1]);
    else if (seg[0] === "thanks" && seg[1]) await thanksPage(box, seg[1]);
    else if (seg[0] === "team" && seg[1]) await teamInvitePage(box, seg[1]);
    else if (seg[0] === "pay-link" && seg[1]) await payLinkPage(box, seg[1]);
    else if (seg[0] === "specials" && seg[1]) await specialsPage(box, seg[1], params);
    else if (seg[0] === "agreement" && seg[1]) await agreement(box, seg[1], params);
    else if (seg[0] === "saved") await saved(box);
    else if (seg[0] === "quotes") await quotes(box, params);
    else if (seg[0] === "shortlist" && seg[1]) await shortlist(box, seg[1]);
    else if (seg[0] === "claim" && seg[1]) await claim(box, seg[1]);
    else if (seg[0] === "bookings") await myBookings(box);
    else if (seg[0] === "messages") await messagesView(box, params);
    else if (seg[0] === "admin") await admin(box);
    else if (seg[0] === "booking" && seg[1]) await bookingPage(box, seg[1], params);
    else if (seg[0] === "pay" && seg[1] && seg[2]) await simulatedPay(box, seg[1], seg[2]);
    else if (seg[0] === "dashboard") { if (params.get("new")) newGroup(box); else await dashboard(box, params); }
    else if (seg[0] === "account") accountView(box);
    else if (seg[0] === "app") await appPage(box);
    else await home(box, params);
  } catch (e) {
    if (token !== routeToken) return; // the user already moved on
    console.error(e);
    box.innerHTML = `<div class="panel empty">${esc(e && e.message ? e.message : t("common.error"))}</div>`;
  }
}

document.getElementById("navtoggle").onclick = () => {
  const nav = document.getElementById("nav"), open = nav.classList.toggle("open");
  document.getElementById("navtoggle").setAttribute("aria-expanded", String(open));
};
window.addEventListener("bm:unauth", () => {
  if (!state.user) return;
  setUser(null);
  toast(t("common.sessionExpired"), "error");
  location.hash = "#/login?next=" + encodeURIComponent(location.hash);
});

initLang(() => { renderChrome(); route(); });
await init();
if (state.user && state.user.lang && !localStorage.getItem("bm_lang")) setLang(state.user.lang, { persist: false });
onChange(renderChrome);
onInstallChange(renderChrome);
// a phone that already has notifications on: they follow whoever is logged in on it
let lastUserId = state.user?.id || null;
if (lastUserId) syncPush();
onChange(() => { const id = state.user?.id || null; if (id && id !== lastUserId) syncPush(); lastUserId = id; });
window.addEventListener("bm:attention", () => refreshAttention());
setInterval(() => { if (!document.hidden) refreshAttention(); }, 60_000);
refreshAttention();
window.addEventListener("hashchange", route);
// the signal drops while using the app: say so (and say when it's back) instead of failing quietly
window.addEventListener("offline", () => toast(t("app.offline"), "error"));
window.addEventListener("online", () => toast(t("app.online")));
route();
