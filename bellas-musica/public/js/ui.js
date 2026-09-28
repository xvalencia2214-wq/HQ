import { t, lang } from "./i18n.js";
import { state } from "./state.js";

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const money = (cents) => new Intl.NumberFormat(lang() === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
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
  const url = location.origin + "/" + path;
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
    : `<div class="photo ph"><img src="logo.svg" alt="" width="56" height="56"></div>`;
}
