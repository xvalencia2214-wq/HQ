import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, money, share } from "../ui.js";
import { waitlistBox } from "./waitlist.js";
import { heart, loadFavs, wireHearts } from "../fav.js";
import { catChips } from "../cats.js";

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};
const okEmbed = (u) => /^https:\/\/(www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/|www\.tiktok\.com\/embed\/v2\/|www\.instagram\.com\/(reel|p)\/[\w-]+\/embed)/.test(u || "");
// Only YouTube and Vimeo players let us control sound from here; TikTok and Instagram show their own controls.
const soundControl = (v) => v && (v.provider === "youtube" || v.provider === "vimeo");
const playerQuery = (v, sound) => v.provider === "youtube"
  ? `?autoplay=1&mute=${sound ? 0 : 1}&loop=1&playlist=${v.id}&controls=0&playsinline=1&modestbranding=1&rel=0&enablejsapi=1`
  : v.provider === "vimeo" ? `?autoplay=1&muted=${sound ? 0 : 1}&loop=1&playsinline=1&title=0&byline=0&portrait=0`
    : v.provider === "tiktok" ? "?autoplay=1&loop=1&rel=0&music_info=0&description=0" : "";
const send = (win, msg) => { try { win.postMessage(JSON.stringify(msg), "*"); } catch { /* frame gone */ } };
const track = (kind, groupId) => { api.post("/api/feed/event", { kind, groupId }).catch(() => {}); };

// One reel: poster (photo or logo), the group's clip on top once it is the card in view, and the buttons that matter.
function reel(g, i) {
  const bg = g.photo ? `style="background-image:url('${esc(g.photo)}')"` : "";
  const tags = [
    g.promoted ? `<span class="pill promo">${esc(t("feed.promoted"))}</span>` : "",
    g.demo ? `<span class="pill">${esc(t("card.sample"))}</span>` : "",
    g.verified ? `<span class="pill trust">✓ ${esc(t("badge.verified"))}</span>` : "",
    g.insured ? `<span class="pill trust">🛡 ${esc(t("badge.insured"))}</span>` : ""
  ].join("");
  const rating = g.reviews ? `★ ${g.rating.toFixed(1)} (${g.reviews})` : `★ ${esc(t("card.new"))}`;
  return `<article class="reel" data-i="${i}" data-id="${esc(g.id)}" aria-label="${esc(g.name)}" aria-posinset="${i + 1}">
    <div class="reel-media${g.photo ? "" : " ph"}" ${bg}>${g.photo ? "" : `<img src="logo.svg" alt="" width="150" height="150">`}</div>
    <div class="reel-shade" aria-hidden="true"></div>
    <div class="reel-rail">${soundControl(g.video) ? `<button type="button" class="rail-btn" data-sound aria-pressed="false" aria-label="${esc(t("feed.sound"))}">🔇</button>` : ""}${heart(g.id, "rail-btn")}</div>
    <div class="reel-info">
      <div class="pills">${tags}</div>
      <h2>${esc(g.name)}</h2>
      <div class="reel-meta">${esc(t("type." + g.type))} · ${esc(g.city)}, ${esc(g.state)} · ${esc(g.distance_miles < 1 ? t("card.nearby") : t("card.away", { n: g.distance_miles }))}</div>
      <div class="reel-meta">${rating} · <strong>${esc(t("feed.from", { price: money(g.from_cents) }))}</strong></div>
      ${g.story ? `<p class="reel-story">${esc(g.story)}</p>` : ""}
      <div class="reel-actions"><a class="btn" data-tap href="#/group/${esc(g.id)}?chat=1">${esc(t("feed.message"))}</a>
      <a class="btn ghost" data-tap href="#/group/${esc(g.id)}">${esc(t("feed.profile"))}</a>
      <button type="button" class="btn ghost" data-share aria-label="${esc(t("share.share"))}">↗</button></div>
    </div>
  </article>`;
}

let cleanup = () => {};
export async function discover(app) {
  cleanup(); // a previous run (e.g. after changing the ZIP) must not keep its listeners
  const zip = store.get("bm_zip") || state.meta.market.center_zip;
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let seed = sessionStorage.getItem("bm_feed_seed"); if (!seed) { seed = Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem("bm_feed_seed", seed); } catch { /* ok */ } }
  const st = { items: [], page: 0, next: 0, loading: false, sound: false, active: -1, origin: null };
  let cat = "all"; try { cat = sessionStorage.getItem("bm_feed_cat") || "all"; } catch { /* ok */ }

  async function load() {
    if (st.loading || st.next === null) return;
    st.loading = true;
    try {
      const r = await api.get(`/api/feed?zip=${encodeURIComponent(zip)}&seed=${encodeURIComponent(seed)}&page=${st.next}${cat !== "all" ? "&category=" + encodeURIComponent(cat) : ""}`);
      st.origin = r.origin; st.next = r.next;
      return r;
    } finally { st.loading = false; }
  }

  app.innerHTML = `<h1 class="sr-only">${esc(t("feed.title"))}</h1><div class="feedbar"><span>📍 <span id="feedplace"></span></span>
    <form id="zipform" class="zipform"><label class="sr-only" for="feed-zip">${esc(t("f.zip"))}</label><input id="feed-zip" inputmode="numeric" maxlength="5" pattern="\\d{5}" value="${esc(zip)}" aria-label="${esc(t("f.zip"))}"><button class="btn small" type="submit">${esc(t("feed.change"))}</button></form></div>
    <div class="feedwrap-cats">${catChips(cat, { withAll: true })}</div>
    <div class="feedwrap"><div class="feed" id="feed" tabindex="0" role="feed" aria-label="${esc(t("feed.title"))}" aria-busy="true"></div>
    <div class="feed-nav"><button type="button" class="rail-btn" id="fprev" aria-label="${esc(t("feed.prev"))}">↑</button><button type="button" class="rail-btn" id="fnext" aria-label="${esc(t("feed.next"))}">↓</button></div></div>`;
  const feed = document.getElementById("feed");
  const fit = () => { const top = feed.getBoundingClientRect().top; feed.style.height = Math.max(420, window.innerHeight - top - 10) + "px"; };
  fit(); window.addEventListener("resize", fit);
  app.querySelectorAll(".feedwrap-cats [data-cat]").forEach((b) => { b.onclick = () => { try { sessionStorage.setItem("bm_feed_cat", b.dataset.cat); } catch { /* ok */ } discover(app); }; });
  document.getElementById("zipform").onsubmit = (e) => {
    e.preventDefault();
    const v = document.getElementById("feed-zip").value.trim();
    if (!/^\d{5}$/.test(v)) { document.getElementById("feed-zip").focus(); return; }
    store.set("bm_zip", v); discover(app);
  };

  let first;
  await loadFavs();
  try { first = await load(); } catch (e) { feed.innerHTML = `<div class="feed-msg">${esc(e.message)}</div>`; feed.setAttribute("aria-busy", "false"); return; }
  document.getElementById("feedplace").textContent = t("feed.near", { city: `${st.origin.city}, ${st.origin.state}` });
  feed.setAttribute("aria-busy", "false");
  if (!first.items.length) {
    feed.outerHTML = `<div id="feed"></div>`;
    document.querySelector(".feed-nav").remove();
    const box = document.getElementById("feed");
    box.innerHTML = `<div class="panel empty">${esc(t("feed.empty", { city: st.origin.city }))}</div>`;
    box.appendChild(waitlistBox(st.origin.zip, `${st.origin.city}, ${st.origin.state}`));
    return;
  }

  // ---- drawing, playing, counting ----
  const add = (items) => { const base = st.items.length; st.items.push(...items); feed.querySelector(".reel.end")?.remove(); feed.insertAdjacentHTML("beforeend", items.map((g, k) => reel(g, base + k)).join("") + (st.next === null ? endCard() : "")); wire(); };
  const endCard = () => `<article class="reel end"><div class="end-in"><img src="logo.svg" alt="" width="96" height="96"><h2>${esc(t("feed.endTitle", { city: st.origin.city }))}</h2><p>${esc(t("feed.endText"))}</p>
    <a class="btn" href="#/?zip=${esc(st.origin.zip)}">${esc(t("feed.search"))}</a> <button type="button" class="btn ghost" id="again">${esc(t("feed.again"))}</button></div></article>`;

  let dwell = null, viewTimer = null, mounted = null;
  function unmount() { if (mounted) { mounted.remove(); mounted = null; } }
  function mount(el, g) {
    unmount();
    if (!g.video || !okEmbed(g.video.embed)) return;
    const q = playerQuery(g.video, st.sound);
    const f = document.createElement("iframe");
    f.className = "reel-video"; f.title = g.name; f.allow = "autoplay; encrypted-media; picture-in-picture"; f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.src = g.video.embed + q;
    el.querySelector(".reel-media").appendChild(f); mounted = f;
  }
  function activate(el) {
    const i = Number(el.dataset.i), g = st.items[i];
    if (!g || st.active === i) return;
    st.active = i;
    clearTimeout(dwell); clearTimeout(viewTimer);
    unmount();
    // a short pause so a fast flick past a card doesn't load its video or count as a view
    if (g.video && !reduceMotion) dwell = setTimeout(() => mount(el, g), 350);
    viewTimer = setTimeout(() => track("view", g.id), 1500);
    if (i >= st.items.length - 2 && st.next !== null) load().then((r) => r && add(r.items)).catch(() => {});
  }
  const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) activate(e.target); }, { root: feed, threshold: [0.6] });

  function wire() {
    feed.querySelectorAll(".reel:not([data-wired])").forEach((el) => {
      el.dataset.wired = "1";
      if (el.classList.contains("end")) { const a = el.querySelector("#again"); if (a) a.onclick = () => { seed = Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem("bm_feed_seed", seed); } catch { /* ok */ } discover(app); }; return; }
      io.observe(el);
      const g = st.items[Number(el.dataset.i)];
      // reduced motion: the person starts the clip themselves
      if (g.video && reduceMotion) el.querySelector(".reel-media").insertAdjacentHTML("beforeend", `<button type="button" class="playbtn" aria-label="${esc(t("feed.play"))}">▶</button>`);
      const pb = el.querySelector(".playbtn"); if (pb) pb.onclick = () => { mount(el, g); pb.remove(); };
      wireHearts(el);
      el.querySelectorAll("[data-tap]").forEach((a) => a.addEventListener("click", () => track("tap", g.id)));
      const sh = el.querySelector("[data-share]"); if (sh) sh.onclick = () => share(g.name, "#/group/" + g.id);
      const so = el.querySelector("[data-sound]");
      if (so) so.onclick = () => {
        st.sound = !st.sound;
        document.querySelectorAll("[data-sound]").forEach((b) => { b.textContent = st.sound ? "🔊" : "🔇"; b.setAttribute("aria-pressed", String(st.sound)); });
        if (mounted && mounted.contentWindow) {
          const provider = st.items[st.active]?.video?.provider;
          if (provider === "youtube") send(mounted.contentWindow, { event: "command", func: st.sound ? "unMute" : "mute", args: "" });
          else send(mounted.contentWindow, { method: "setVolume", value: st.sound ? 1 : 0 });
        }
      };
    });
  }
  add(first.items);

  const step = (dir) => feed.scrollBy({ top: dir * feed.clientHeight, behavior: reduceMotion ? "auto" : "smooth" });
  document.getElementById("fprev").onclick = () => step(-1);
  document.getElementById("fnext").onclick = () => step(1);
  // leaving the page: stop the clip and the listeners
  const stop = () => { clearTimeout(dwell); clearTimeout(viewTimer); unmount(); io.disconnect(); window.removeEventListener("resize", fit); window.removeEventListener("hashchange", stop); };
  window.addEventListener("hashchange", stop);
  cleanup = stop;
}
