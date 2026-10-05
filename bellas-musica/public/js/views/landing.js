// The welcome page: the front door for new visitors (and #/welcome for anyone). A 3D sombrero under papel picado, a
// fanfare you can play, scroll-told sections, real prices and real groups from the site. Everything it starts is
// stopped by the function it returns, so the rest of the app never pays for it.
import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang, setLang } from "../i18n.js";
import { esc, money } from "../ui.js";
import { reducedMotion, finePointer, clamp, customCursor, magnetic, tilt, spotlight, scramble, countUp, onceVisible, marquees, wordReveal, dragScroll, ParticleMorph, diana } from "../fx.js";

const GENRES = [
  ["Mariachi", "🎺", "#2f6bff"], ["Banda", "🥁", "#ff3d8b"], ["Norteño", "🪗", "#18c2a7"], ["Trío romántico", "🎸", "#ffb020"],
  ["DJ", "🎧", "#7b5cff"], ["Grupera", "🎤", "#4fa3ff"], ["food", "🌮", "#ff7a3d"], ["rentals", "⛺", "#a3b4d6"]
];
const EVENTS = ["Quinceañera", "Wedding", "Birthday", "Serenata", "Anniversary", "Corporate / Restaurant"];
const CATS = ["music", "food", "rentals", "decor", "photo", "services", "venues"];
const CAT_COLORS = { music: "#2a5ff5", food: "#ff7a3d", rentals: "#18c2a7", decor: "#ff3d8b", photo: "#ffb020", services: "#7b5cff", venues: "#a3b4d6" };
// text on a selected chip: white on the dark blues, night ink on the light colours (both at least 4.5:1)
const CAT_TEXT = { music: "#fff", services: "#fff", food: "#070b1a", rentals: "#070b1a", decor: "#070b1a", photo: "#070b1a", venues: "#070b1a" };
const TYPE_EMOJI = Object.fromEntries(GENRES.map(([k, e]) => [k, e]));

function ensureStyles() {
  if (document.getElementById("landing-css")) return Promise.resolve();
  return new Promise((r) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "landing.css"; l.id = "landing-css";
    l.onload = l.onerror = () => r(); document.head.appendChild(l);
  });
}

export async function landing(app) {
  const bag = []; // everything to undo when leaving
  const reduced = reducedMotion(), fine = finePointer();
  await ensureStyles();
  document.body.classList.add("is-landing");
  bag.push(() => document.body.classList.remove("is-landing", "lp-intro"));
  document.title = t("land.title");
  const m = state.meta || {};
  const user = state.user;
  const groupsHref = user ? "#/dashboard?new=1" : `#/signup?next=${encodeURIComponent("#/dashboard?new=1")}`;
  const marqueeWords = t("land.marquee").split(",");
  const mq = (dir, cls) => `<div class="mq ${cls}" data-dir="${dir}" aria-hidden="true"><div class="mq-track">${[0, 1].map(() => marqueeWords.map((w) => `<span>${esc(w)}</span><i>✦</i>`).join("")).join("")}</div></div>`;

  app.innerHTML = `<div class="lp${reduced ? " lp-reduced" : ""}">
    <a class="lp-skip" href="#/">${esc(t("land.skip"))}</a>
    <div class="lp-progress" aria-hidden="true"><i></i></div>
    <header class="lp-nav" id="lp-nav">
      <a class="lp-brand" href="#/welcome" aria-label="Bella's Música"><img src="logo.svg" alt="" width="34" height="34"><span>Bella's Música</span></a>
      <nav aria-label="Main">
        <a href="#/">${esc(t("land.nav.find"))}</a><a href="#/party">${esc(t("land.nav.party"))}</a><a href="${groupsHref}">${esc(t("land.nav.groups"))}</a>
      </nav>
      <div class="lp-nav-r">
        <button type="button" class="lp-lang" id="lp-lang" aria-label="Español / English">${lang() === "es" ? "EN" : "ES"}</button>
        ${user ? `<a class="lp-pill" href="#/bookings">${esc(user.name.split(" ")[0])}</a>` : `<a class="lp-link" href="#/login">${esc(t("land.nav.login"))}</a><a class="lp-pill mag" href="#/signup">${esc(t("land.nav.start"))}</a>`}
      </div>
    </header>

    <section class="lp-hero" id="lp-hero">
      <canvas class="lp-3d" id="lp-3d" aria-hidden="true"></canvas>
      <img class="lp-3d-fallback" src="logo.svg" alt="" hidden>
      <div class="lp-glow" aria-hidden="true"></div>
      <div class="lp-hero-in">
        <p class="lp-kicker"><span class="dotlive"></span>${esc(t("land.kicker"))}</p>
        <h1 class="lp-h1" aria-label="${esc(`${t("land.h1a")} ${t("land.h1b")} ${t("land.h1c")}`)}">
          <span class="row" aria-hidden="true">${split(t("land.h1a"))} <em class="serif">${split(t("land.h1b"))}</em></span>
          <span class="row" aria-hidden="true">${split(t("land.h1c"))}</span>
        </h1>
        <p class="lp-lead">${esc(t("land.lead"))}</p>
        <form class="lp-search glass" id="lp-search">
          <label class="sr-only" for="lp-ev">${esc(t("land.event"))}</label>
          <select id="lp-ev" name="event">${EVENTS.map((e) => `<option value="${esc(e)}">${esc(t("event." + e))}</option>`).join("")}</select>
          <label class="sr-only" for="lp-zip">${esc(t("land.zip"))}</label>
          <input id="lp-zip" name="zip" inputmode="numeric" maxlength="5" placeholder="${esc(t("land.zip"))}" value="60608" autocomplete="postal-code">
          <button class="lp-btn mag" type="submit">${esc(t("land.go"))} →</button>
        </form>
        <div class="lp-hero-acts">
          <button type="button" class="lp-play" id="lp-play" aria-pressed="false"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="lbl">🎺 ${esc(t("land.play"))}</span></button>
          <span class="lp-hint">${esc(t("land.toss"))} ↑</span>
        </div>
        <dl class="lp-stats">
          <div><dt><span data-count="${Number(m.zip_count) || 0}">0</span></dt><dd>${esc(t("land.stat.zips"))}</dd></div>
          <div><dt><span id="lp-gcount">0</span>+</dt><dd>${esc(t("land.stat.groups"))}</dd></div>
          <div><dt>2</dt><dd>${esc(t("land.stat.langs"))}</dd></div>
        </dl>
      </div>
      <a class="lp-scroll" href="#lp-manifesto" aria-label="${esc(t("land.scroll"))}"><span>${esc(t("land.scroll"))}</span><i></i></a>
      <canvas class="lp-viz" id="lp-viz" aria-hidden="true"></canvas>
    </section>

    ${mq(1, "mq-a")}${mq(-1, "mq-b")}

    <section class="lp-manifesto" id="lp-manifesto"><div class="sticky"><p class="lp-mtext" id="lp-mtext">${esc(t("land.manifesto"))}</p></div></section>

    <section class="lp-morph" id="lp-morph">
      <div class="sticky">
        <h2 class="lp-k">${esc(t("land.morph.k"))}</h2>
        <canvas id="lp-particles" data-cursor="✦" aria-hidden="true"></canvas>
        <div class="lp-morph-caps">${[0, 1, 2, 3].map((i) => `<div class="cap" data-i="${i}"><h3>${esc(t(`land.morph.${i}`))}</h3><p>${esc(t(`land.morph.${i}t`))}</p></div>`).join("")}</div>
        <ol class="lp-dots" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<li data-i="${i}"></li>`).join("")}</ol>
      </div>
    </section>

    <section class="lp-genres" id="lp-genres">
      <div class="sticky">
        <div class="lp-sec-head"><p class="lp-k">${esc(t("land.genres.k"))}</p><h2 class="scr">${esc(t("land.genres.h"))}</h2></div>
        <div class="lp-track" id="lp-track">${GENRES.map(([k, e, c]) => `
          <a class="gcard tilt" data-type="${esc(k)}" href="${k === "food" || k === "rentals" ? "#/party" : "#/?zip=60608"}" style="--c:${c}" data-cursor="${esc(t("land.genres.see"))}">
            <span class="glare"></span><span class="emo">${e}</span>
            <h3>${esc(k === "food" || k === "rentals" ? t("land.cat." + k) : t("type." + k) || k)}</h3>
            <p>${esc(t("land.g." + k))}</p><span class="from" data-from="${esc(k)}"></span>
          </a>`).join("")}</div>
      </div>
    </section>

    <section class="lp-story" id="lp-story">
      <div class="lp-sec-head center"><p class="lp-k">${esc(t("land.story.k"))}</p><h2 class="scr">${esc(t("land.story.h"))}</h2></div>
      <div class="lp-story-grid">
        <ol class="lp-steps">${[1, 2, 3, 4].map((i) => `<li class="step" data-i="${i}"><span class="num">0${i}</span><h3>${esc(t(`land.step${i}`))}</h3><p>${esc(t(`land.step${i}t`))}</p></li>`).join("")}</ol>
        <div class="lp-phone-wrap"><div class="lp-phone" aria-hidden="true"><div class="notch"></div>${["1-find", "2-group", "3-bookings", "4-vendor-es"].map((s, i) => `<img src="screens/${s}.webp" alt="" decoding="async" data-i="${i + 1}"${i ? "" : ' class="on"'}>`).join("")}</div></div>
      </div>
    </section>

    <section class="lp-bento-sec">
      <div class="lp-sec-head"><p class="lp-k">${esc(t("land.bento.k"))}</p><h2 class="scr">${esc(t("land.bento.h"))}</h2></div>
      <div class="lp-bento" id="lp-bento">
        <article class="tile t1"><div class="art shield"><span>🔒</span><i></i><i></i></div><h3>${esc(t("land.b1"))}</h3><p>${esc(t("land.b1t"))}</p></article>
        <article class="tile t2"><div class="art flip"><b>¡Hola!</b><b>Hello!</b></div><h3>${esc(t("land.b2"))}</h3><p>${esc(t("land.b2t"))}</p></article>
        <article class="tile t3"><div class="art bar"><div class="fill"></div><span>👨🏽</span><span>👩🏻</span><span>👴🏾</span><span>👵🏽</span></div><h3>${esc(t("land.b3"))}</h3><p>${esc(t("land.b3t"))}</p></article>
        <article class="tile t4"><div class="art notes"><div class="n">🔔 ${esc(t("land.n1"))}</div><div class="n">💵 ${esc(t("land.n2"))}</div><div class="n">✅ ${esc(t("land.n3"))}</div></div><h3>${esc(t("land.b4"))}</h3><p>${esc(t("land.b4t"))}</p></article>
        <article class="tile t5"><div class="art cal">${Array.from({ length: 28 }, (_, i) => `<i${i % 7 === 4 ? ' class="fri"' : ""}></i>`).join("")}</div><h3>${esc(t("land.b5"))}</h3><p>${esc(t("land.b5t"))}</p></article>
        <article class="tile t6"><div class="art clock"><span>+1</span></div><h3>${esc(t("land.b6"))}</h3><p>${esc(t("land.b6t"))}</p></article>
      </div>
    </section>

    <section class="lp-build" id="lp-build">
      <div class="lp-build-l">
        <p class="lp-k">${esc(t("land.build.k"))}</p><h2 class="scr">${esc(t("land.build.h"))}</h2><p class="dim">${esc(t("land.build.t"))}</p>
        <div class="chips" id="lp-cats">${CATS.map((c) => `<button type="button" class="chip" data-cat="${c}" aria-pressed="${c === "music" || c === "food" ? "true" : "false"}" style="--c:${CAT_COLORS[c]};--t:${CAT_TEXT[c]}">${esc(t("land.cat." + c))}</button>`).join("")}</div>
        <label for="lp-guests" class="lp-range-l">${esc(t("land.build.guests"))}: <b id="lp-gv">150</b></label>
        <input type="range" id="lp-guests" min="30" max="400" step="10" value="150">
      </div>
      <div class="lp-build-r glass">
        <svg viewBox="0 0 200 200" class="donut" id="lp-donut" aria-hidden="true"><circle cx="100" cy="100" r="78" class="track"/></svg>
        <div class="lp-total"><span>${esc(t("land.build.total"))}</span><b id="lp-total">$0</b><small id="lp-range"></small></div>
        <ul class="legend" id="lp-legend"></ul>
        <a class="lp-btn mag" href="#/party" id="lp-plan">${esc(t("land.build.cta"))} →</a>
      </div>
    </section>

    <section class="lp-live">
      <div class="lp-sec-head"><p class="lp-k"><span class="dotlive"></span>${esc(t("land.live.k"))}</p><h2 class="scr">${esc(t("land.live.h"))}</h2><p class="dim">${esc(t("land.live.drag"))} ↔</p></div>
      <div class="lp-carousel" id="lp-carousel" data-cursor="↔"></div>
    </section>

    <section class="lp-vendors">
      <div class="lp-vendors-l">
        <p class="lp-k">${esc(t("land.vendors.k"))}</p><h2 class="scr">${esc(t("land.vendors.h"))}</h2><p>${esc(t("land.vendors.t"))}</p>
        <ul class="ticks"><li>${esc(t("land.vendors.p1", { pct: m.fee_pct ?? 10 }))}</li><li>${esc(t("land.vendors.p2"))}</li><li>${esc(t("land.vendors.p3"))}</li></ul>
        <a class="lp-btn mag" href="${groupsHref}">${esc(t("land.vendors.cta"))} →</a>
      </div>
      <div class="lp-vendors-r" aria-hidden="true"><div class="stack">
        <div class="push">🔔 <b>${esc(t("land.n1"))}</b><span>Sáb 7:00 PM · $450</span></div>
        <div class="push">💵 <b>${esc(t("land.n2"))}</b><span>Tío Juan</span></div>
        <div class="push">✅ <b>${esc(t("land.n3"))}</b><span>Boda · 200</span></div>
      </div></div>
    </section>

    <section class="lp-faq"><h2 class="scr">${esc(t("land.faq.h"))}</h2>${[1, 2, 3, 4].map((i) => `<details><summary>${esc(t(`land.faq.q${i}`))}<i aria-hidden="true"></i></summary><p>${esc(t(`land.faq.a${i}`))}</p></details>`).join("")}</section>

    <section class="lp-final" id="lp-final">
      <h2 class="lp-giant" aria-label="${esc(t("land.final"))}"><span aria-hidden="true">${split(t("land.final"))}</span></h2>
      <p>${esc(t("land.final.t"))}</p>
      <a class="lp-btn big mag" href="#/">${esc(t("land.final.cta"))} →</a>
    </section>

    <footer class="lp-foot">
      <div class="lp-foot-links"><a href="#/">${esc(t("land.nav.find"))}</a><a href="#/party">${esc(t("land.nav.party"))}</a><a href="${groupsHref}">${esc(t("land.nav.groups"))}</a><a href="#/app">📲 ${esc(t("app.get"))}</a><a href="terms.html">${esc(t("foot.terms"))}</a><a href="privacy.html">${esc(t("foot.privacy"))}</a></div>
      <p class="dim">${esc(t("land.foot"))}</p>
      <div class="lp-outline" aria-hidden="true">BELLA'S MÚSICA</div>
    </footer>
    <div class="lp-wipe" aria-hidden="true"></div>
  </div>`;
  const root = app.querySelector(".lp");
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];

  // ---- intro (once per visit): a curtain counts to 100 while the 3D loads ----
  let introDone = Promise.resolve();
  let seenIntro = true; try { seenIntro = sessionStorage.getItem("bm_intro") === "1"; sessionStorage.setItem("bm_intro", "1"); } catch { /* storage blocked */ }
  if (!reduced && !seenIntro) {
    const cur = document.createElement("div"); cur.className = "lp-curtain"; cur.innerHTML = `<img src="logo.svg" alt="" width="84" height="84"><b>0</b><span>${esc(t("land.loading"))}…</span>`;
    root.appendChild(cur); document.body.classList.add("lp-intro");
    introDone = new Promise((done) => {
      const b = cur.querySelector("b"), start = performance.now();
      const step = (now) => { const p = clamp((now - start) / 1100); b.textContent = Math.round(p * 100); if (p < 1) requestAnimationFrame(step); else { cur.classList.add("out"); document.body.classList.remove("lp-intro"); setTimeout(() => { cur.remove(); done(); }, 700); } };
      requestAnimationFrame(step);
    });
    bag.push(() => cur.remove());
  }
  introDone.then(() => root.classList.add("in"));
  if (reduced || seenIntro) root.classList.add("in");

  // ---- language, search, page wipe on the way into the app ----
  $("#lp-lang").onclick = () => setLang(lang() === "es" ? "en" : "es");
  $("#lp-search").onsubmit = (e) => { e.preventDefault(); const f = e.target; const zip = /^\d{5}$/.test(f.zip.value) ? f.zip.value : "60608"; go(`#/?zip=${zip}&event=${encodeURIComponent(f.event.value)}`); };
  const go = (hash) => {
    if (reduced) { location.hash = hash; return; }
    root.classList.add("leaving"); setTimeout(() => { location.hash = hash; }, 420);
  };
  const onClick = (e) => {
    const a = e.target.closest("a[href^='#/']"); if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    if (a.getAttribute("href") === "#/welcome") return;
    e.preventDefault(); go(a.getAttribute("href"));
  };
  root.addEventListener("click", onClick); bag.push(() => root.removeEventListener("click", onClick));

  // ---- the nav: glass that hides going down and comes back going up; the progress line ----
  const nav = $("#lp-nav"), bar = $(".lp-progress i");
  let lastY = scrollY;
  const onScrollNav = () => {
    const y = scrollY; nav.classList.toggle("hide", y > lastY && y > 300); nav.classList.toggle("solid", y > 40); lastY = y;
    bar.style.transform = `scaleX(${clamp(y / Math.max(1, document.documentElement.scrollHeight - innerHeight))})`;
  };
  addEventListener("scroll", onScrollNav, { passive: true }); bag.push(() => removeEventListener("scroll", onScrollNav));

  // ---- 3D sombrero ----
  let hat = null;
  const canvas3d = $("#lp-3d");
  const webgl = (() => { try { const c = document.createElement("canvas"); return Boolean(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })();
  if (webgl) {
    import("/vendor/landing3d.js").then(({ mountSombrero }) => {
      if (!root.isConnected) return;
      hat = mountSombrero(canvas3d, { reduced, lowPower: innerWidth < 760 || (navigator.hardwareConcurrency || 8) <= 4 });
      canvas3d.classList.add("ready");
    }).catch(() => { canvas3d.hidden = true; $(".lp-3d-fallback").hidden = false; });
  } else { canvas3d.hidden = true; $(".lp-3d-fallback").hidden = false; }
  bag.push(() => hat?.destroy());
  const onPointer = (e) => hat?.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  addEventListener("pointermove", onPointer, { passive: true }); bag.push(() => removeEventListener("pointermove", onPointer));
  canvas3d.addEventListener("click", () => { hat?.toss(); confetti(); });

  // tossing the sombrero throws papel picado confetti
  const confetti = () => {
    if (reduced) return;
    const box = document.createElement("div"); box.className = "lp-confetti"; $("#lp-hero").appendChild(box);
    const colors = ["#2f6bff", "#ff3d8b", "#18c2a7", "#ffb020", "#7b5cff", "#f4f7ff"];
    for (let i = 0; i < 70; i++) { const s = document.createElement("i"); s.style.cssText = `--x:${(Math.random() - 0.5) * 900}px;--y:${-200 - Math.random() * 500}px;--r:${Math.random() * 720}deg;--d:${0.9 + Math.random() * 0.9}s;background:${colors[i % colors.length]};left:50%;top:55%`; box.appendChild(s); }
    setTimeout(() => box.remove(), 2200);
  };

  // ---- la diana: the music moves the sombrero, the particles and a meter ----
  const viz = $("#lp-viz"), vctx = viz.getContext("2d");
  let song = null, morph = null;
  const drawViz = (bins) => {
    const w = viz.width = viz.clientWidth * 2, h = viz.height = viz.clientHeight * 2; vctx.clearRect(0, 0, w, h);
    if (!bins) return;
    const n = 48, bw = w / n;
    for (let i = 0; i < n; i++) { const v = bins[Math.floor((i / n) * bins.length * 0.7)] / 255; const g = vctx.createLinearGradient(0, h, 0, h - v * h); g.addColorStop(0, "rgba(47,107,255,.0)"); g.addColorStop(1, "rgba(127,176,255,.85)"); vctx.fillStyle = g; vctx.fillRect(i * bw + 2, h - v * h, bw - 4, v * h); }
  };
  const playBtn = $("#lp-play");
  playBtn.onclick = () => {
    if (song) { song.stop(); return; }
    song = diana({
      onLevel: (lvl, bins) => { hat?.setLevel(lvl); if (morph) morph.level = lvl; playBtn.style.setProperty("--lvl", lvl); drawViz(bins); },
      onEnd: () => { song = null; playBtn.classList.remove("on"); playBtn.setAttribute("aria-pressed", "false"); playBtn.querySelector(".lbl").textContent = "🎺 " + t("land.play"); }
    });
    if (song) { playBtn.classList.add("on"); playBtn.setAttribute("aria-pressed", "true"); playBtn.querySelector(".lbl").textContent = "■ " + t("land.stop"); hat?.toss(); }
  };
  bag.push(() => song?.stop());

  // ---- the numbers count up; headings decode ----
  bag.push(onceVisible($$("[data-count]"), (el) => { const off = countUp(el, Number(el.dataset.count)); bag.push(off); }));
  if (!reduced) bag.push(onceVisible($$(".scr"), (el) => bag.push(scramble(el)), { threshold: 0.6 }));

  // ---- marquees, tilt, spotlight, magnetic, cursor ----
  if (!reduced) bag.push(marquees($$(".mq")));
  if (fine && !reduced) { bag.push(tilt($$(".tilt"))); bag.push(customCursor(root)); bag.push(magnetic($$(".mag"))); root.classList.add("has-cursor"); }
  bag.push(spotlight($("#lp-bento")));
  bag.push(onceVisible($$(".tile, .gcard, .step, .push, .lp-final p, details"), (el) => el.classList.add("seen"), { threshold: 0.2 }));

  // ---- particles that become a trumpet, an accordion, a rose and ¡VIVA! ----
  const pc = $("#lp-particles");
  morph = new ParticleMorph(pc, { count: innerWidth < 760 ? 1300 : 2600, reduced });
  morph.setShapes([["emoji", "🎺"], ["emoji", "🪗"], ["emoji", "🌹"], ["text", "¡VIVA!"]]);
  // a device without colour emoji draws nothing: fall back to symbols
  morph.raw = morph.raw.map(([k, v], i) => (k === "emoji" && !morph.sample(k, v) ? ["text", ["♪♫", "♫", "✿", "¡VIVA!"][i]] : [k, v])); morph.reshape();
  bag.push(() => morph.destroy());

  // ---- one scroll loop drives everything tied to scroll position ----
  const sec = (id) => $(id);
  const hero = sec("#lp-hero"), man = sec("#lp-manifesto"), mor = sec("#lp-morph"), gen = sec("#lp-genres"), track = $("#lp-track");
  const reveal = wordReveal($("#lp-mtext"));
  const caps = $$(".lp-morph-caps .cap"), dots = $$(".lp-dots li");
  const prog = (el) => { const r = el.getBoundingClientRect(); return clamp(-r.top / Math.max(1, r.height - innerHeight)); };
  let stage = -1, raf = 0;
  const frame = () => {
    raf = 0;
    hat?.setScroll(clamp(scrollY / Math.max(1, hero.offsetHeight)));
    reveal(reduced ? 1 : prog(man));
    const s = Math.min(3, Math.floor(prog(mor) * 4));
    if (s !== stage) { stage = s; morph.show(s); caps.forEach((c, i) => c.classList.toggle("on", i === s)); dots.forEach((d, i) => d.classList.toggle("on", i <= s)); }
    if (!reduced && innerWidth >= 760) { const p = prog(gen); track.style.transform = `translate3d(${-p * Math.max(0, track.scrollWidth - innerWidth + 80)}px,0,0)`; }
    else track.style.transform = "";
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener("scroll", onScroll, { passive: true }); addEventListener("resize", onScroll);
  bag.push(() => { cancelAnimationFrame(raf); removeEventListener("scroll", onScroll); removeEventListener("resize", onScroll); });
  frame();

  // ---- how it works: the phone shows the step you're reading ----
  const shots = $$(".lp-phone img"), steps = $$(".step");
  // A picture that doesn't load tries once more (the full-size one), then the phone shows a plain screen, never a broken icon.
  for (const im of shots) {
    const fail = () => {
      if (!im.dataset.retry) { im.dataset.retry = "1"; im.src = im.getAttribute("src").replace(/\.webp$/, ".png"); return; }
      im.classList.add("gone");
    };
    im.addEventListener("error", fail);
    if (im.complete && !im.naturalWidth && im.getAttribute("src")) fail();
  }
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const i = e.target.dataset.i; steps.forEach((s) => s.classList.toggle("on", s.dataset.i === i)); shots.forEach((im) => im.classList.toggle("on", im.dataset.i === i)); } }, { rootMargin: "-45% 0px -45% 0px" });
  steps.forEach((s) => io.observe(s)); bag.push(() => io.disconnect());

  // ---- live data: real groups and real prices (loaded in the background; the page is already up) ----
  let dead = false; bag.push(() => { dead = true; });
  loadLive();
  return () => bag.splice(0).reverse().forEach((f) => { try { f(); } catch { /* already gone */ } });

  async function loadLive() {
  const guides = {};
  const [search] = await Promise.all([
    api.get("/api/search?zip=60608").catch(() => ({ results: [] })),
    ...CATS.map((c) => api.get(`/api/price-guide?category=${c}`).then((r) => { guides[c] = r.guide; }).catch(() => {}))
  ]);
  if (dead || !root.isConnected) return;
  const results = search.results || [];
  countUp($("#lp-gcount"), results.length);
  // the cheapest "from" price per type, on the genre cards
  for (const el of $$("[data-from]")) {
    const k = el.dataset.from, prices = k === "food" || k === "rentals" ? [guides[k]?.low].filter(Boolean) : results.filter((g) => g.type === k).map((g) => g.from_cents).filter(Boolean);
    if (prices.length) el.textContent = t("land.genres.from", { price: money(Math.min(...prices)) });
  }
  // the carousel of real groups
  const car = $("#lp-carousel");
  car.innerHTML = results.slice(0, 12).map((g, i) => `<a class="lcard" href="#/group/${esc(g.id)}" style="--c:${GENRES[i % GENRES.length][2]}">
      <div class="ph">${g.photo ? `<img src="${esc(g.photo)}" alt="" loading="lazy">` : `<span>${TYPE_EMOJI[g.type] || "🎶"}</span>`}${g.demo ? `<em>${esc(t("card.sample"))}</em>` : ""}</div>
      <h3>${esc(g.name)}</h3><p>${esc(t("type." + g.type) || g.type)} · ${esc(g.city || "")}</p>
      <p class="row2"><b>${g.reviews ? `★ ${g.rating}` : esc(t("land.live.new"))}</b>${g.reviews ? `<span>${esc(t("land.live.reviews", { n: g.reviews }))}</span>` : ""}${g.from_cents ? `<span class="pr">${esc(t("land.genres.from", { price: money(g.from_cents) }))}</span>` : ""}</p>
    </a>`).join("");
  bag.push(dragScroll(car));
  if (fine && !reduced) bag.push(tilt($$(".lcard"), 8));

  // ---- the party budget: real price ranges, a donut that redraws ----
  const chips = $$("#lp-cats .chip"), guests = $("#lp-guests"), donut = $("#lp-donut");
  const scale = (c, n) => (c === "food" ? n / 100 : c === "rentals" || c === "services" ? Math.max(0.6, n / 150) : 1);
  let shown = 0, anim = 0;
  const budget = () => {
    const n = Number(guests.value); $("#lp-gv").textContent = n;
    const on = chips.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.cat).filter((c) => guides[c]);
    const parts = on.map((c) => ({ c, mid: guides[c].mid * scale(c, n), low: guides[c].low * scale(c, n), high: guides[c].high * scale(c, n) }));
    const total = parts.reduce((s, p) => s + p.mid, 0), low = parts.reduce((s, p) => s + p.low, 0), high = parts.reduce((s, p) => s + p.high, 0);
    const C = 2 * Math.PI * 78; let acc = 0;
    donut.querySelectorAll(".seg").forEach((x) => x.remove());
    for (const p of parts) {
      const len = total ? (p.mid / total) * C : 0, seg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      seg.setAttribute("cx", 100); seg.setAttribute("cy", 100); seg.setAttribute("r", 78); seg.setAttribute("class", "seg");
      seg.style.stroke = CAT_COLORS[p.c]; seg.style.strokeDasharray = `${Math.max(0, len - 3)} ${C}`; seg.style.strokeDashoffset = String(-acc);
      donut.appendChild(seg); acc += len;
    }
    $("#lp-legend").innerHTML = parts.map((p) => `<li><i style="background:${CAT_COLORS[p.c]}"></i>${esc(t("land.cat." + p.c))}<b>${money(Math.round(p.mid / 100) * 100)}</b></li>`).join("");
    $("#lp-range").textContent = parts.length ? t("land.build.range", { low: money(Math.round(low / 1000) * 1000), high: money(Math.round(high / 1000) * 1000) }) : "";
    $("#lp-plan").setAttribute("href", `#/party?guests=${n}`);
    const from = shown, to = total, start = performance.now(); cancelAnimationFrame(anim);
    const step = (now) => { const k = clamp((now - start) / 600); shown = from + (to - from) * (1 - Math.pow(1 - k, 3)); $("#lp-total").textContent = money(Math.round(shown / 100) * 100); if (k < 1) anim = requestAnimationFrame(step); };
    anim = requestAnimationFrame(step);
  };
  chips.forEach((c) => { c.onclick = () => { c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") === "true" ? "false" : "true"); budget(); }; });
  guests.oninput = budget; budget();
  bag.push(() => cancelAnimationFrame(anim));
  }
}

// letters wrapped one by one so they can rise in, one after another
function split(text) {
  return [...text].map((ch, i) => (ch === " " ? " " : `<span class="ch" style="--i:${i}">${esc(ch)}</span>`)).join("");
}
