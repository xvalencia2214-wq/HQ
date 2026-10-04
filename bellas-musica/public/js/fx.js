// Motion toolkit for the welcome page: every effect returns a function that removes it, so leaving the page leaves
// nothing running. Each one respects "reduce motion" (the caller decides) and pauses when it can't be seen.

export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export const finePointer = () => window.matchMedia?.("(pointer: fine)").matches;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (t) => 1 - Math.pow(1 - t, 3);

// ---- a cursor that follows with a little lag, grows over things you can press, and can show a word ----
export function customCursor(root) {
  const dot = document.createElement("div"), ring = document.createElement("div");
  dot.className = "cur-dot"; ring.className = "cur-ring"; ring.innerHTML = "<span></span>";
  document.body.append(dot, ring);
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y, raf = 0, shown = false;
  const move = (e) => { x = e.clientX; y = e.clientY; if (!shown) { shown = true; dot.classList.add("on"); ring.classList.add("on"); } };
  const over = (e) => {
    const el = e.target.closest?.("a, button, input, select, label, summary, [data-cursor]");
    ring.classList.toggle("big", Boolean(el));
    const word = el?.getAttribute?.("data-cursor") || "";
    ring.classList.toggle("word", Boolean(word)); ring.firstChild.textContent = word;
  };
  const leave = () => { shown = false; dot.classList.remove("on"); ring.classList.remove("on"); };
  const tick = () => { rx = lerp(rx, x, 0.18); ry = lerp(ry, y, 0.18); dot.style.transform = `translate(${x}px,${y}px)`; ring.style.transform = `translate(${rx}px,${ry}px)`; raf = requestAnimationFrame(tick); };
  root.addEventListener("pointermove", move); root.addEventListener("pointerover", over); document.addEventListener("pointerleave", leave);
  tick();
  return () => { cancelAnimationFrame(raf); root.removeEventListener("pointermove", move); root.removeEventListener("pointerover", over); document.removeEventListener("pointerleave", leave); dot.remove(); ring.remove(); };
}

// ---- buttons that lean toward the pointer ----
export function magnetic(els, strength = 0.35) {
  const offs = [];
  for (const el of els) {
    const move = (e) => { const r = el.getBoundingClientRect(); el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * strength}px,${(e.clientY - r.top - r.height / 2) * strength}px)`; };
    const out = () => { el.style.transform = ""; };
    el.addEventListener("pointermove", move); el.addEventListener("pointerleave", out);
    offs.push(() => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", out); });
  }
  return () => offs.forEach((f) => f());
}

// ---- cards that tilt in 3D under the pointer, with a glare that follows it ----
export function tilt(els, max = 12) {
  const offs = [];
  for (const el of els) {
    const move = (e) => {
      const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--rx", `${(0.5 - py) * max}deg`); el.style.setProperty("--ry", `${(px - 0.5) * max}deg`);
      el.style.setProperty("--gx", `${px * 100}%`); el.style.setProperty("--gy", `${py * 100}%`); el.classList.add("tilting");
    };
    const out = () => { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); el.classList.remove("tilting"); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerleave", out);
    offs.push(() => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", out); });
  }
  return () => offs.forEach((f) => f());
}

// ---- a glow that follows the pointer across a grid of tiles (each tile lights the part of its border nearest it) ----
export function spotlight(grid) {
  const move = (e) => { for (const t of grid.children) { const r = t.getBoundingClientRect(); t.style.setProperty("--mx", `${e.clientX - r.left}px`); t.style.setProperty("--my", `${e.clientY - r.top}px`); } };
  grid.addEventListener("pointermove", move);
  return () => grid.removeEventListener("pointermove", move);
}

// ---- headings that decode from random letters ----
const GLYPHS = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ¡!¿?#%&*+=";
export function scramble(el, { duration = 900 } = {}) {
  const final = el.textContent; let raf = 0;
  const start = performance.now();
  const step = (now) => {
    const p = clamp((now - start) / duration);
    const n = Math.floor(final.length * ease(p));
    el.textContent = final.slice(0, n) + [...final.slice(n)].map((c) => (c === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");
    if (p < 1) raf = requestAnimationFrame(step); else el.textContent = final;
  };
  raf = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(raf); el.textContent = final; };
}

// ---- numbers that count up ----
export function countUp(el, to, { duration = 1600, format = (n) => Math.round(n).toLocaleString() } = {}) {
  let raf = 0; const start = performance.now();
  const step = (now) => { const p = clamp((now - start) / duration); el.textContent = format(to * ease(p)); if (p < 1) raf = requestAnimationFrame(step); };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

// ---- run something once, the first time an element scrolls into view ----
export function onceVisible(els, fn, { threshold = 0.25, rootMargin = "0px" } = {}) {
  const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); fn(e.target); } }, { threshold, rootMargin });
  for (const el of els) io.observe(el);
  return () => io.disconnect();
}

// ---- endless marquees whose speed (and direction) follow how fast you scroll ----
export function marquees(rows) {
  const items = [...rows].map((row) => ({ row, track: row.querySelector(".mq-track"), x: 0, dir: Number(row.dataset.dir || 1), w: 0 }));
  let lastY = scrollY, vel = 0, raf = 0, last = performance.now(), visible = true;
  const measure = () => items.forEach((it) => { it.w = it.track.scrollWidth / 2; });
  measure(); addEventListener("resize", measure);
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible && !raf) tick(); });
  rows.forEach((r) => io.observe(r));
  const tick = () => {
    raf = 0; if (!visible) return;
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    const dy = scrollY - lastY; lastY = scrollY;
    vel = lerp(vel, dy / Math.max(dt, 0.001), 0.1);
    const boost = clamp(Math.abs(vel) / 900, 0, 6), sign = vel < -5 ? -1 : 1;
    for (const it of items) {
      it.x -= it.dir * sign * (60 + boost * 240) * dt;
      if (it.w) { if (it.x <= -it.w) it.x += it.w; if (it.x > 0) it.x -= it.w; }
      it.track.style.transform = `translate3d(${it.x}px,0,0) skewX(${clamp(-vel / 120, -12, 12)}deg)`;
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { cancelAnimationFrame(raf); io.disconnect(); removeEventListener("resize", measure); };
}

// ---- a paragraph whose words light up one by one as you scroll through it ----
export function wordReveal(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.innerHTML = words.map((w) => `<span class="w">${w.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))} </span>`).join("");
  const spans = [...el.children];
  return (progress) => { const lit = Math.floor(progress * spans.length * 1.05); spans.forEach((s, i) => s.classList.toggle("lit", i < lit)); };
}

// ---- drag to scroll, with a throw that slows down ----
export function dragScroll(el) {
  let down = false, sx = 0, sl = 0, v = 0, lx = 0, raf = 0, moved = false;
  const dn = (e) => { if (e.pointerType !== "mouse") return; down = true; moved = false; sx = lx = e.clientX; sl = el.scrollLeft; v = 0; cancelAnimationFrame(raf); el.classList.add("grabbing"); };
  const mv = (e) => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 4) moved = true; el.scrollLeft = sl - dx; v = e.clientX - lx; lx = e.clientX; };
  const up = () => { if (!down) return; down = false; el.classList.remove("grabbing"); const glide = () => { el.scrollLeft -= v; v *= 0.93; if (Math.abs(v) > 0.4) raf = requestAnimationFrame(glide); }; glide(); };
  const click = (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } };
  el.addEventListener("pointerdown", dn); addEventListener("pointermove", mv); addEventListener("pointerup", up); el.addEventListener("click", click, true);
  return () => { cancelAnimationFrame(raf); el.removeEventListener("pointerdown", dn); removeEventListener("pointermove", mv); removeEventListener("pointerup", up); el.removeEventListener("click", click, true); };
}

// ---- particles that gather into shapes (emoji or words) and scatter from the pointer ----
export class ParticleMorph {
  constructor(canvas, { count = 1600, reduced = false } = {}) {
    this.c = canvas; this.x = canvas.getContext("2d"); this.reduced = reduced;
    this.dpr = Math.min(devicePixelRatio || 1, 2); this.count = count; this.shapes = []; this.target = 0; this.level = 0;
    this.mouse = { x: -9999, y: -9999 }; this.p = [];
    this.resize(); this.visible = true; this.raf = 0;
    this.ro = new ResizeObserver(() => { this.resize(); this.reshape(); }); this.ro.observe(canvas);
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible && !this.raf) this.loop(); }); this.io.observe(canvas);
    this.onMove = (e) => { const r = canvas.getBoundingClientRect(); this.mouse.x = (e.clientX - r.left) * this.dpr; this.mouse.y = (e.clientY - r.top) * this.dpr; };
    this.onLeave = () => { this.mouse.x = this.mouse.y = -9999; };
    canvas.addEventListener("pointermove", this.onMove); canvas.addEventListener("pointerleave", this.onLeave);
  }
  resize() { const r = this.c.getBoundingClientRect(); this.w = this.c.width = Math.max(1, r.width * this.dpr); this.h = this.c.height = Math.max(1, r.height * this.dpr); }
  // sample a shape: draw it big off screen, keep points where it is drawn, with that pixel's colour
  sample(kind, value) {
    const off = document.createElement("canvas"), W = 360, H = 360; off.width = W; off.height = H;
    const x = off.getContext("2d", { willReadFrequently: true });
    x.textAlign = "center"; x.textBaseline = "middle";
    if (kind === "emoji") { x.font = "280px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif"; x.fillText(value, W / 2, H / 2 + 14); }
    else { x.fillStyle = "#cfe0ff"; let size = 150; x.font = `800 ${size}px 'Bricolage Grotesque Variable',system-ui,sans-serif`; while (x.measureText(value).width > W - 20 && size > 30) { size -= 6; x.font = `800 ${size}px 'Bricolage Grotesque Variable',system-ui,sans-serif`; } x.fillText(value, W / 2, H / 2); }
    const d = x.getImageData(0, 0, W, H).data, pts = [];
    for (let yy = 0; yy < H; yy += 2) for (let xx = 0; xx < W; xx += 2) { const i = (yy * W + xx) * 4; if (d[i + 3] > 140) { const k = Math.max(d[i], d[i + 1], d[i + 2]) < 90 ? 2.2 : 1; pts.push([xx / W, yy / H, Math.min(255, d[i] * k + 30), Math.min(255, d[i + 1] * k + 30), Math.min(255, d[i + 2] * k + 40)]); } }
    if (!pts.length) return null;
    // the same number of points for every shape (repeat or thin out evenly)
    return Array.from({ length: this.count }, (_, i) => pts[Math.floor((i * pts.length) / this.count) % pts.length]);
  }
  setShapes(list) { this.raw = list; this.reshape(); if (!this.p.length) this.seed(); }
  reshape() {
    if (!this.raw) return;
    const s = Math.min(this.w, this.h) * 0.86, ox = (this.w - s) / 2, oy = (this.h - s) / 2;
    this.shapes = this.raw.map(([k, v]) => this.sample(k, v)).map((pts) => pts && pts.map(([u, v, r, g, b]) => ({ x: ox + u * s, y: oy + v * s, r, g, b })));
  }
  seed() {
    this.p = Array.from({ length: this.count }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, vx: 0, vy: 0, r: 120, g: 160, b: 255, j: Math.random() }));
    this.loop();
  }
  show(i) { this.target = i; }
  loop() {
    this.raf = 0;
    if (!this.visible) return;
    const shape = this.shapes[this.target] || this.shapes.find(Boolean); if (!shape) { this.raf = requestAnimationFrame(() => this.loop()); return; }
    const x = this.x, mx = this.mouse.x, my = this.mouse.y, R = 90 * this.dpr, pulse = 1 + this.level * 0.25;
    x.clearRect(0, 0, this.w, this.h);
    const cx = this.w / 2, cy = this.h / 2, size = 2.2 * this.dpr;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i], t = shape[i];
      const tx = cx + (t.x - cx) * pulse, ty = cy + (t.y - cy) * pulse;
      if (this.reduced) { p.x = tx; p.y = ty; }
      else {
        p.vx += (tx - p.x) * 0.022 * (0.7 + p.j * 0.6); p.vy += (ty - p.y) * 0.022 * (0.7 + p.j * 0.6);
        const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy;
        if (d2 < R * R) { const f = (1 - Math.sqrt(d2) / R) * 6; p.vx += (dx / (Math.sqrt(d2) + 1)) * f; p.vy += (dy / (Math.sqrt(d2) + 1)) * f; }
        p.vx *= 0.8; p.vy *= 0.8; p.x += p.vx; p.y += p.vy;
      }
      p.r += (t.r - p.r) * 0.08; p.g += (t.g - p.g) * 0.08; p.b += (t.b - p.b) * 0.08;
      x.fillStyle = `rgb(${p.r | 0},${p.g | 0},${p.b | 0})`;
      x.fillRect(p.x, p.y, size, size);
    }
    this.raf = requestAnimationFrame(() => this.loop());
  }
  destroy() { cancelAnimationFrame(this.raf); this.raf = 0; this.visible = false; this.ro.disconnect(); this.io.disconnect(); this.c.removeEventListener("pointermove", this.onMove); this.c.removeEventListener("pointerleave", this.onLeave); }
}

// ---- "la diana": a short mariachi fanfare made in the browser (trumpets, violins, guitarrón) with a level meter ----
export function diana({ onLevel, onEnd }) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ac = new AC(), master = ac.createGain(), analyser = ac.createAnalyser(), comp = ac.createDynamicsCompressor();
  master.gain.value = 0.55; analyser.fftSize = 256;
  master.connect(comp); comp.connect(analyser); analyser.connect(ac.destination);
  // a little room so it doesn't sound dry
  const delay = ac.createDelay(), fb = ac.createGain(), wet = ac.createGain(); delay.delayTime.value = 0.13; fb.gain.value = 0.25; wet.gain.value = 0.18;
  master.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(comp);
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const voice = (type, freq, start, dur, vol, { attack = 0.02, vibrato = 0, filter = 0 } = {}) => {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = freq;
    let out = o;
    if (filter) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filter; f.Q.value = 2; o.connect(f); out = f; }
    if (vibrato) { const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5.8; lg.gain.value = freq * vibrato; lfo.connect(lg); lg.connect(o.frequency); lfo.start(start); lfo.stop(start + dur + 0.1); }
    out.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(vol, start + attack); g.gain.setValueAtTime(vol, start + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0008, start + dur);
    o.start(start); o.stop(start + dur + 0.05);
  };
  const trumpet = (n, s, d) => { voice("sawtooth", midi(n), s, d, 0.16, { attack: 0.03, vibrato: 0.006, filter: 2600 }); voice("sawtooth", midi(n - 4), s, d, 0.09, { attack: 0.03, vibrato: 0.006, filter: 2200 }); };
  const violin = (n, s, d) => voice("sawtooth", midi(n + 12), s, d, 0.05, { attack: 0.08, vibrato: 0.01, filter: 4000 });
  const bass = (n, s) => voice("triangle", midi(n - 24), s, 0.32, 0.32, { attack: 0.005 });
  const strum = (notes, s) => notes.forEach((n, i) => voice("triangle", midi(n), s + i * 0.012, 0.25, 0.06, { attack: 0.002 }));
  const t = ac.currentTime + 0.08, beat = 0.19;
  // the fanfare: a bugle-call flourish on the chord, answered and held, over an oom-pah-pah in 3/4
  const melody = [[67, 0, 1], [67, 1, 1], [67, 2, 1], [72, 3, 2], [67, 5, 1], [72, 6, 1], [76, 7, 1], [79, 8, 3], [76, 11, 1], [72, 12, 1], [76, 13, 1], [79, 14, 2], [84, 16, 5]];
  for (const [n, b, len] of melody) { trumpet(n, t + b * beat, len * beat * 0.95); violin(n, t + b * beat, len * beat * 0.95); }
  for (let bar = 0; bar < 7; bar++) {
    const s = t + bar * 3 * beat, root = bar % 2 ? 55 : 48;
    bass(root, s); strum([60, 64, 67], s + beat); strum([60, 64, 67], s + 2 * beat);
  }
  const end = t + 21 * beat + 0.6;
  const buf = new Uint8Array(analyser.frequencyBinCount); let raf = 0, stopped = false;
  const meter = () => { analyser.getByteFrequencyData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i]; onLevel?.(Math.min(1, sum / buf.length / 90), buf); if (ac.currentTime < end && !stopped) raf = requestAnimationFrame(meter); else stop(); };
  const stop = () => { if (stopped) return; stopped = true; cancelAnimationFrame(raf); onLevel?.(0, null); ac.close().catch(() => {}); onEnd?.(); };
  meter();
  return { stop };
}
