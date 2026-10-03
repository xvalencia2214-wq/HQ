import { t, lang } from "./i18n.js";
import { state } from "./state.js";

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const money = (cents) => new Intl.NumberFormat(lang() === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
// A length: "3 hr" or, for a short set, "20 min".
export const lenLabel = (min) => (min % 60 === 0 ? t("g.hours", { n: min / 60 }) : t("g.minutes", { n: min }));
// A package's or booking's length in minutes (older ones only have hours).
export const minutesOf = (x) => (x.duration_min > 0 ? x.duration_min : x.minutes > 0 ? x.minutes : x.hours * 60);
// "2:00 PM" -> minutes after midnight
export const timeMin = (s) => { const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(s || ""); return m ? ((Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + Number(m[2]) : -1; };
// Start-time buttons. A few are shown in one row; many (a vendor open all day) are grouped: early morning (mañanitas),
// daytime, evening and night (serenatas).
const PERIODS = [["t.early", 0, 540], ["t.day", 540, 1020], ["t.evening", 1020, 1260], ["t.night", 1260, 1440]];
export function slotButtons(times, selected) {
  const btn = (s) => `<button type="button" class="slot${selected === s ? " sel" : ""}" data-t="${esc(s)}">${esc(s)}</button>`;
  if (times.length <= 6) return `<div class="slots">${times.map(btn).join("")}</div>`;
  return PERIODS.map(([key, a, b]) => { const part = times.filter((s) => timeMin(s) >= a && timeMin(s) < b); return part.length ? `<div class="slot-period"><div class="dim small">${esc(t(key))}</div><div class="slots">${part.map(btn).join("")}</div></div>` : ""; }).join("");
}
export const pad = (n) => (n < 10 ? "0" + n : "" + n);
export const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
// The business calendar day from the server (falls back to the browser clock before meta has loaded).
export const today = () => { const k = state.meta && state.meta.today; if (k) return parseKey(k); const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const tomorrowKey = () => { const d = today(); d.setDate(d.getDate() + 1); return dkey(d); };
export const fmtDate = (k) => parseKey(k).toLocaleDateString(lang() === "es" ? "es-US" : "en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
export const fmtMonth = (d) => d.toLocaleString(lang() === "es" ? "es-US" : "en-US", { month: "long", year: "numeric" });
export const dowLetters = () => (lang() === "es" ? ["D", "L", "M", "M", "J", "V", "S"] : ["S", "M", "T", "W", "T", "F", "S"]);

// +13125550142 -> (312) 555-0142 (display only; the server accepts any format)
export const fmtPhone = (p) => { const d = String(p || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || ""); };

// Attribute-safe "selected" helper for <option>.
export const sel = (a, b) => (String(a) === String(b) ? " selected" : "");

let toastTimer;
export function toast(message, kind = "info") {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
  el.className = "toast " + kind;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === "error" ? 6000 : 3500);
}

export const stars = (n) => `<span class="stars" aria-label="${esc(n)} / 5">${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}</span>`;

export function statusBadge(status) {
  return `<span class="badge ${esc(status)}">${esc(t("status." + status))}</span>`;
}

// Navigate to a URL the server gave us: same-app hash routes stay in-app, anything else is a full redirect (Stripe).
export function goto(url) {
  const u = new URL(url, location.href);
  if (u.origin === location.origin) location.hash = u.hash;
  else location.href = u.href;
}

export function shareLinks(name, path) {
  // Group and best-of links point at the server-rendered preview routes so chat apps show a photo card.
  const pretty = path.replace(/^#\/group\//, "g/").replace(/^#\/best\//, "b/");
  const url = location.origin + "/" + pretty;
  const text = `${name} · Bella's Música`;
  return { url, text, wa: `https://wa.me/?text=${encodeURIComponent(text + " " + url)}` };
}
export async function share(name, path) {
  const s = shareLinks(name, path);
  if (navigator.share) { try { await navigator.share({ title: s.text, url: s.url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(s.url); toast(t("share.copied")); } catch { window.prompt(t("share.copy"), s.url); }
}
export function shareButtons(name, path) {
  const s = shareLinks(name, path);
  return `<div class="share"><button type="button" class="btn ghost small" data-share="${esc(path)}" data-name="${esc(name)}">${esc(t("share.share"))}</button>` +
    `<a class="btn ghost small" href="${esc(s.wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></div>`;
}
export function wireShare(root) {
  root.querySelectorAll("[data-share]").forEach((b) => { b.onclick = () => share(b.getAttribute("data-name"), b.getAttribute("data-share")); });
}

export function groupPhoto(g) {
  return g.photo
    ? `<div class="photo" role="img" aria-label="${esc(g.name)}" style="background-image:url('${esc(g.photo)}')"></div>`
    : `<div class="photo ph"><img src="logo.svg" alt="" width="104" height="104"></div>`;
}
