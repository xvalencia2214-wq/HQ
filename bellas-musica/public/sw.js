// Bella's Música service worker: a friendly page when there's no signal, faster maps, and phone notifications.
// Pages and data always come fresh from the server when online (nothing stale is ever shown); only the offline page,
// the icons and the map library are kept on the phone.
const CACHE = "bm-v1";
const KEEP = ["/offline.html", "/logo.svg", "/icon-192.png", "/style.css"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(KEEP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return; // the network as usual
  if (req.mode === "navigate") {
    // straight to the server (not the browser's saved copy): with no signal, the offline page instead of an app that can't load
    e.respondWith(fetch(req, { cache: "no-store" }).catch(() => caches.match("/offline.html")));
    return;
  }
  if (KEEP.includes(url.pathname)) { // what the offline page needs: fresh when online (and saved again), the saved copy when not
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); } return r; }).catch(() => caches.match(url.pathname)));
    return;
  }
  if (url.pathname.startsWith("/vendor/")) { // the map library: from the phone, refreshed in the background
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});

// ---- phone notifications ----
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Bella's Música", {
    body: d.body || "", icon: "/icon-192.png", badge: "/badge.png", tag: d.tag || undefined, renotify: Boolean(d.tag),
    data: { url: d.url || "/" }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "/", location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((w) => new URL(w.url).origin === location.origin);
    if (open) return open.focus().then((w) => w.navigate ? w.navigate(target) : w);
    return self.clients.openWindow(target);
  }));
});
// The browser replaced this phone's push address: tell the server the new one.
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    const { key } = await fetch("/api/push/key").then((r) => r.json());
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  })().catch(() => {}));
});
