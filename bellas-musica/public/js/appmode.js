// The site as a phone app: the service worker (offline page, notifications), the "Install the app" button, and knowing
// when we run inside the Google Play / App Store version.
import { api } from "./api.js";

// ---- inside a store app? ----
// The store versions open the site with ?app=android or ?app=ios (set in PWABuilder); an Android store app also shows
// itself through the referrer. Remembered on this device, so it holds after moving around the site.
const store = (() => {
  try {
    const q = new URLSearchParams(location.search).get("app");
    if (q === "android" || q === "ios") localStorage.setItem("bm_app", q);
    else if (document.referrer.startsWith("android-app://")) localStorage.setItem("bm_app", "android");
    return localStorage.getItem("bm_app") || "";
  } catch { return ""; }
})();
export const storeApp = () => store;

// ---- installed? ----
const ua = navigator.userAgent;
export const isIos = () => /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => Boolean(store) || window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

let deferred = null; // Android/Chrome's own install prompt, kept until the person presses our button
const listeners = new Set();
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((f) => f()); });
export const onInstallChange = (f) => listeners.add(f);
// "prompt" (Android/Chrome can install with one tap), "ios" (Share → Add to Home Screen), "manual" (use the browser
// menu), or "" (already installed)
export function installMode() {
  if (isStandalone()) return "";
  if (deferred) return "prompt";
  return isIos() ? "ios" : "manual";
}
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice.catch(() => ({ outcome: "dismissed" }));
  deferred = null; listeners.forEach((f) => f());
  return outcome === "accepted";
}

// ---- service worker ----
let reg = null;
export const swReady = ("serviceWorker" in navigator && window.isSecureContext)
  ? navigator.serviceWorker.register("/sw.js").then((r) => (reg = r)).catch(() => null)
  : Promise.resolve(null);

// ---- phone notifications ----
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
// "on", "off", "denied" (blocked in the phone's settings), "install" (iPhone: only works once added to the Home Screen),
// or "unsupported"
export async function pushState() {
  if (!pushSupported()) return isIos() && !isStandalone() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const r = await swReady;
  const sub = r && (await r.pushManager.getSubscription().catch(() => null));
  return sub && Notification.permission === "granted" ? "on" : "off";
}
const deviceName = () => (isIos() ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Browser") + (store ? ` (${store} app)` : "");
export async function pushOn() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const r = await swReady;
  if (!r) return "unsupported";
  const { key } = await api.get("/api/push/key");
  let sub = await r.pushManager.getSubscription();
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.post("/api/push/subscribe", { ...sub.toJSON(), device: deviceName() });
  return "on";
}
export async function pushOff() {
  const r = await swReady;
  const sub = r && (await r.pushManager.getSubscription());
  if (sub) { await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  return "off";
}
// After logging in on a phone that already has notifications on, make sure they go to the person now logged in.
export async function syncPush() {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const r = await swReady;
  const sub = r && (await r.pushManager.getSubscription().catch(() => null));
  if (sub) await api.post("/api/push/subscribe", { ...sub.toJSON(), device: deviceName() }).catch(() => {});
}
