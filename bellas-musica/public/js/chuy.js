// Don Chuy, the friendly AI helper: a smiling sombrero button in the corner of every screen that opens a chat. People
// can type or tap the microphone, tap a ready-made question, and have answers read aloud. He answers in the screen's
// language, simpler with Bigger text on, and his links open the right screen. The server (server/helper.js) only lets
// him look things up: he never books, pays or cancels. The conversation stays in this tab (sessionStorage) only.
import { api } from "./api.js";
import { state } from "./state.js";
import { t, lang } from "./i18n.js";
import { esc } from "./ui.js";

const KEY = "bm_chuy", VOICE = "bm_chuy_voice", MAX = 19;
let history = [], busy = false, open = false, listening = null, drawnLang = "";
const $ = (id) => document.getElementById(id);
const big = () => document.documentElement.classList.contains("big");
const store = (k, v) => { try { v === undefined ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const voiceOn = () => { try { return localStorage.getItem(VOICE) === "1"; } catch { return false; } };
const Rec = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
const vendorScreen = () => /^#\/dashboard/.test(location.hash);

// His answers are plain text with [label](#/path) links, **bold** and "- " lists. Everything is escaped first; only links
// to the app's own screens become links.
export function chuyFormat(text) {
  return esc(text)
    .replace(/\[([^\]\n]{1,80})\]\((#\/[\w\-/?=&;.%]{0,160})\)/g, (_, label, href) => `<a class="chuy-link" href="${href}">${label}</a>`)
    .replace(/\*\*([^*\n]{1,120})\*\*/g, "<b>$1</b>")
    .replace(/^[-•] /gm, "• ")
    .replace(/\n/g, "<br>");
}
const plain = (text) => String(text).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").replace(/^[-•] /gm, "");

function speak(text) {
  if (!voiceOn() || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(plain(text));
    u.lang = lang() === "es" ? "es-MX" : "en-US"; u.rate = big() ? 0.9 : 1;
    speechSynthesis.speak(u);
  } catch { /* no voice on this device */ }
}

function bubble(role, html, cls = "") {
  const d = document.createElement("div");
  d.className = `chuy-msg ${role}${cls ? " " + cls : ""}`;
  d.innerHTML = role === "bot" ? `<img src="don-chuy.svg" alt="" class="chuy-av"><div class="chuy-b">${html}</div>` : `<div class="chuy-b">${html}</div>`;
  $("chuy-log").appendChild(d);
  d.scrollIntoView({ block: "end" });
  return d;
}

function chips() {
  const keys = vendorScreen() ? ["more", "payouts", "fees"] : [...(state.user ? ["mine"] : []), "find", "deposit", "cancel", "quince"];
  $("chuy-chips").innerHTML = history.length ? "" : keys.map((k) => `<button type="button" class="chuy-chip" data-q="${esc(t("chuy.q." + k))}">${esc(t("chuy.q." + k))}</button>`).join("");
}

function drawLog() {
  drawnLang = lang();
  const log = $("chuy-log");
  log.innerHTML = "";
  bubble("bot", esc(t(vendorScreen() ? "chuy.helloVendor" : "chuy.hello")) + (state.meta && state.meta.helper === "test" ? `<span class="chuy-test">${esc(t("chuy.test"))}</span>` : ""), "hello");
  for (const m of history) bubble(m.role === "user" ? "me" : "bot", m.role === "user" ? esc(m.text) : chuyFormat(m.text));
  chips();
}

async function send(text) {
  text = String(text || "").trim().slice(0, 1000);
  if (!text || busy) return;
  busy = true; $("chuy-send").disabled = true;
  $("chuy-in").value = ""; grow();
  history.push({ role: "user", text });
  while (history.length > MAX) history.shift();
  while (history.length && history[0].role !== "user") history.shift(); // the server wants the person first
  bubble("me", esc(text)); chips();
  const wait = bubble("bot", `<span class="chuy-dots" role="status" aria-label="${esc(t("chuy.thinking"))}"><i></i><i></i><i></i></span>`, "wait");
  try {
    const r = await api.post("/api/helper", { messages: history, lang: lang(), big: big(), page: location.hash.slice(0, 160) || "#/" });
    wait.remove();
    history.push({ role: "assistant", text: r.reply });
    store(KEY, history);
    bubble("bot", chuyFormat(r.reply));
    speak(r.reply);
  } catch (e) {
    wait.remove();
    history.pop(); // not answered: take it back so the conversation stays person, helper, person...
    $("chuy-in").value = text; grow();
    bubble("bot", esc(e && e.message ? e.message : t("chuy.error")), "err");
  } finally { busy = false; $("chuy-send").disabled = false; }
}

function grow() { const i = $("chuy-in"); if (!i) return; i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, 140) + "px"; }

function listen() {
  const R = Rec();
  if (!R) return;
  if (listening) { listening.stop(); return; }
  const rec = new R();
  rec.lang = lang() === "es" ? "es-MX" : "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
  const mic = $("chuy-mic");
  rec.onresult = (e) => { const said = e.results[0][0].transcript; if (said) send(said); };
  rec.onend = () => { listening = null; mic.setAttribute("aria-pressed", "false"); mic.querySelector(".l").textContent = t("chuy.mic"); };
  rec.onerror = rec.onend;
  try { rec.start(); listening = rec; mic.setAttribute("aria-pressed", "true"); mic.querySelector(".l").textContent = t("chuy.listening"); } catch { listening = null; }
}

export function setChuy(show) {
  open = show;
  $("chuy").hidden = !show;
  $("chuyfab").setAttribute("aria-expanded", String(show));
  document.body.classList.toggle("chuy-open", show);
  if (show) { drawLog(); $("chuy-in").focus({ preventScroll: true }); }
  else {
    try { speechSynthesis.cancel(); } catch { /* none */ }
    if (listening) listening.stop();
    $("chuyfab").focus({ preventScroll: true });
  }
}

// Labels in the screen's language, and whether he shows at all (AI_HELPER=0 hides him; the owner's office has its own
// chat). Called on every redraw.
export function refreshChuy() {
  const fab = $("chuyfab");
  if (!fab) return;
  const off = !state.meta || state.meta.helper === "off" || /^#\/(office|flyer)\b/.test(location.hash);
  fab.hidden = off;
  if (off && open) setChuy(false);
  fab.setAttribute("aria-label", t("chuy.open"));
  fab.querySelector(".chuy-fab-l").textContent = t("chuy.fab");
  $("chuy-sub").textContent = t("chuy.sub");
  $("chuy-in").placeholder = t("chuy.placeholder"); $("chuy-in").setAttribute("aria-label", t("chuy.label"));
  $("chuy-send").querySelector(".l").textContent = t("chuy.send");
  $("chuy-mic").querySelector(".l").textContent = listening ? t("chuy.listening") : t("chuy.mic");
  $("chuy-voice").setAttribute("aria-label", t("chuy.voice")); $("chuy-voice").title = t("chuy.voice");
  $("chuy-new").setAttribute("aria-label", t("chuy.new")); $("chuy-new").title = t("chuy.new");
  $("chuy-close").setAttribute("aria-label", t("chuy.close"));
  const support = state.meta && state.meta.support_email;
  $("chuy-foot").innerHTML = `${esc(t("chuy.foot"))} <a href="privacy.html" target="_blank" rel="noopener">${esc(t("chuy.privacy"))}</a>${support ? ` · <a href="mailto:${esc(support)}">${esc(t("chuy.person"))}</a>` : ""}`;
  if (open && drawnLang !== lang()) drawLog(); // a language switch redraws; a badge refresh or a new screen doesn't
  else if (open && !busy) chips();
}

export function mountChuy() {
  if ($("chuyfab")) return;
  try { history = JSON.parse(sessionStorage.getItem(KEY) || "[]").filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string"); } catch { history = []; }
  const wrap = document.createElement("div");
  wrap.innerHTML = `<button type="button" id="chuyfab" class="chuy-fab" aria-haspopup="dialog" aria-expanded="false" aria-controls="chuy" hidden><img src="don-chuy.svg" alt="" width="56" height="56"><span class="chuy-fab-l"></span></button>
  <section id="chuy" class="chuy" role="dialog" aria-labelledby="chuy-h" hidden>
    <header class="chuy-top"><img src="don-chuy.svg" alt="" width="52" height="52"><div class="chuy-who"><h2 id="chuy-h">Don Chuy</h2><p id="chuy-sub"></p></div>
      <button type="button" id="chuy-voice" class="chuy-ic" aria-pressed="${voiceOn()}"><span aria-hidden="true">🔊</span></button>
      <button type="button" id="chuy-new" class="chuy-ic"><span aria-hidden="true">↺</span></button>
      <button type="button" id="chuy-close" class="chuy-ic"><span aria-hidden="true">✕</span></button></header>
    <div id="chuy-log" class="chuy-log" role="log" aria-live="polite"></div>
    <div id="chuy-chips" class="chuy-chips"></div>
    <form id="chuy-form" class="chuy-form"><textarea id="chuy-in" rows="1" maxlength="1000" enterkeyhint="send"></textarea>
      <button type="button" id="chuy-mic" class="chuy-mic" aria-pressed="false"${Rec() ? "" : " hidden"}><span aria-hidden="true">🎤</span><span class="l"></span></button>
      <button type="submit" id="chuy-send" class="btn chuy-send"><span class="l"></span> <span aria-hidden="true">➤</span></button></form>
    <p id="chuy-foot" class="chuy-foot"></p>
  </section>`;
  document.body.append(...wrap.children);
  $("chuyfab").onclick = () => setChuy(!open);
  $("chuy-close").onclick = () => setChuy(false);
  $("chuy-new").onclick = () => { history = []; store(KEY); try { speechSynthesis.cancel(); } catch { /* none */ } drawLog(); $("chuy-in").focus(); };
  $("chuy-voice").onclick = () => {
    const on = !voiceOn();
    try { localStorage.setItem(VOICE, on ? "1" : "0"); } catch { /* private mode */ }
    $("chuy-voice").setAttribute("aria-pressed", String(on));
    if (!on) { try { speechSynthesis.cancel(); } catch { /* none */ } }
  };
  $("chuy-mic").onclick = listen;
  $("chuy-form").onsubmit = (e) => { e.preventDefault(); send($("chuy-in").value); };
  $("chuy-in").addEventListener("input", grow);
  $("chuy-in").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($("chuy-in").value); } });
  $("chuy-chips").addEventListener("click", (e) => { const b = e.target.closest(".chuy-chip"); if (b) send(b.dataset.q); });
  // a link in his answer opens that screen (as a hash change, never a page reload: the page has <base href="/">, so an
  // address with ?src=... would otherwise reload); on a phone the chat steps aside so the screen can be seen
  $("chuy-log").addEventListener("click", (e) => {
    const a = e.target.closest(".chuy-link");
    if (!a) return;
    e.preventDefault();
    location.hash = a.getAttribute("href").slice(1);
    if (window.innerWidth < 700) setChuy(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open && !document.body.classList.contains("nav-open")) setChuy(false); });
  refreshChuy();
}
