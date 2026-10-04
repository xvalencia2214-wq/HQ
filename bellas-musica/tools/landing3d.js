// The 3D scene on the welcome page: a silver charro sombrero turned on a lathe (its profile spun around an axis), with an
// embroidered leather band and silver trim, under a string of papel picado that waves in the breeze. It follows the
// pointer, turns with the scroll, bounces to the music and spins when tapped.
// Bundled with only the parts of three.js it uses:  npm run build:landing  ->  public/vendor/landing3d.js
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector2, Vector3, Color, Fog,
  LatheGeometry, CylinderGeometry, TorusGeometry, PlaneGeometry, SphereGeometry,
  MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial, Mesh, InstancedMesh, Object3D,
  HemisphereLight, DirectionalLight, PointLight, CanvasTexture, SRGBColorSpace, DoubleSide, PMREMGenerator, ACESFilmicToneMapping,
  BufferGeometry, Float32BufferAttribute, LineBasicMaterial, Line, RepeatWrapping, Points, PointsMaterial
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// ---- textures drawn on a canvas ----
function bandTexture() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 128;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, "#c08a5c"); g.addColorStop(1, "#6e4326");
  x.fillStyle = g; x.fillRect(0, 0, 1024, 128);
  x.strokeStyle = "rgba(255,240,220,.85)"; x.lineWidth = 3; x.setLineDash([10, 8]);
  for (const y of [14, 114]) { x.beginPath(); x.moveTo(0, y); x.lineTo(1024, y); x.stroke(); }
  x.setLineDash([]);
  // embroidered flowers and vines (the "pita" stitching on a charro hat band)
  for (let i = 0; i < 8; i++) {
    const cx = 64 + i * 128;
    x.strokeStyle = "#f7efe2"; x.lineWidth = 4;
    x.beginPath(); x.moveTo(cx - 64, 64); x.bezierCurveTo(cx - 40, 30, cx - 20, 98, cx, 64); x.bezierCurveTo(cx + 20, 30, cx + 40, 98, cx + 64, 64); x.stroke();
    for (let p = 0; p < 6; p++) {
      const a = (p / 6) * Math.PI * 2;
      x.fillStyle = "#fffaf0"; x.beginPath(); x.ellipse(cx + Math.cos(a) * 13, 64 + Math.sin(a) * 13, 9, 5, a, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = "#d9b26f"; x.beginPath(); x.arc(cx, 64, 7, 0, Math.PI * 2); x.fill();
  }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.wrapS = RepeatWrapping; t.repeat.set(2, 1);
  return t;
}
// one sheet of papel picado: tissue paper with cut-out shapes (drawn as holes)
function picadoTexture(color, seed) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 320;
  const x = c.getContext("2d");
  x.fillStyle = color; x.fillRect(0, 0, 256, 320);
  x.globalCompositeOperation = "destination-out";
  const rnd = (n) => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280) * n; };
  // border of small diamonds and a big flower or star in the middle
  for (let i = 0; i < 9; i++) { x.save(); x.translate(20 + i * 27, 22); x.rotate(Math.PI / 4); x.fillRect(-6, -6, 12, 12); x.restore(); }
  for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(20 + i * 27, 296, 7, 0, Math.PI * 2); x.fill(); }
  const cx = 128, cy = 165, petals = 6 + Math.floor(rnd(3)) * 2;
  for (let p = 0; p < petals; p++) {
    const a = (p / petals) * Math.PI * 2;
    x.beginPath(); x.ellipse(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46, 30, 13, a, 0, Math.PI * 2); x.fill();
  }
  x.beginPath(); x.arc(cx, cy, 20, 0, Math.PI * 2); x.fill();
  for (let i = 0; i < 14; i++) { const a = rnd(Math.PI * 2), r = 85 + rnd(25); x.beginPath(); x.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.1, 4 + rnd(5), 0, Math.PI * 2); x.fill(); }
  // the wavy cut bottom edge
  x.beginPath(); x.moveTo(0, 320);
  for (let i = 0; i <= 16; i++) x.lineTo(i * 16, i % 2 ? 306 : 320);
  x.lineTo(256, 330); x.lineTo(0, 330); x.fill();
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

export function mountSombrero(canvas, { reduced = false, lowPower = false } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: !lowPower, alpha: true, powerPreference: lowPower ? "low-power" : "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 2));
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new Scene();
  scene.fog = new Fog(new Color("#070b1a"), 9, 22);
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 1.4, 9.5);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  scene.add(new HemisphereLight("#bcd4ff", "#0b1022", 0.6));
  const key = new DirectionalLight("#ffffff", 1.6); key.position.set(4, 6, 5); scene.add(key);
  const rim = new PointLight("#4f8dff", 30, 20); rim.position.set(-4, 2, -3); scene.add(rim);
  const warm = new PointLight("#ffb347", 18, 16); warm.position.set(3.5, -1, 3); scene.add(warm);

  // ---- the sombrero: a profile (radius, height) spun around the vertical axis ----
  const hat = new Group();
  const profile = [
    [0.0, 1.95], [0.32, 1.93], [0.58, 1.84], [0.74, 1.62], [0.82, 1.25], [0.88, 0.85], [0.96, 0.5], [1.02, 0.32],   // the tall crown
    [1.2, 0.26], [1.7, 0.22], [2.3, 0.2], [2.8, 0.23], [3.15, 0.32], [3.36, 0.5], [3.42, 0.62], [3.38, 0.7],          // the brim curling up at the edge
    [3.26, 0.62], [3.1, 0.42], [2.75, 0.3], [2.2, 0.26], [1.6, 0.27], [1.15, 0.3], [1.0, 0.25]                        // its underside
  ].map(([r, y]) => new Vector2(r, y));
  const felt = new MeshPhysicalMaterial({ color: "#9fb0d0", roughness: 0.5, metalness: 0.55, sheen: 1, sheenColor: new Color("#dfe8ff"), sheenRoughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.7, side: DoubleSide });
  const body = new Mesh(new LatheGeometry(profile, reduced || lowPower ? 64 : 128), felt);
  hat.add(body);
  const band = new Mesh(new CylinderGeometry(0.985, 1.03, 0.36, 128, 1, true), new MeshStandardMaterial({ map: bandTexture(), roughness: 0.65, metalness: 0.1 }));
  band.position.y = 0.5; hat.add(band);
  const silver = new MeshPhysicalMaterial({ color: "#f4f7ff", metalness: 1, roughness: 0.18, clearcoat: 1 });
  const trim = new Mesh(new TorusGeometry(3.36, 0.06, 16, 200), silver); trim.rotation.x = Math.PI / 2; trim.position.y = 0.66; hat.add(trim);
  const trim2 = new Mesh(new TorusGeometry(1.02, 0.035, 12, 120), silver); trim2.rotation.x = Math.PI / 2; trim2.position.y = 0.68; hat.add(trim2);
  // little silver studs (botonadura) around the brim
  const studGeo = new SphereGeometry(0.05, 12, 8), studs = new InstancedMesh(studGeo, silver, 36), dummy = new Object3D();
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; dummy.position.set(Math.cos(a) * 2.6, 0.27, Math.sin(a) * 2.6); dummy.updateMatrix(); studs.setMatrixAt(i, dummy.matrix); }
  hat.add(studs);
  hat.position.set(2.9, -0.7, 0); hat.rotation.x = 0.32;
  scene.add(hat);

  // ---- papel picado: a string across the top with paper flags that wave ----
  const flags = [], colors = ["#2f6bff", "#ff3d8b", "#f4f7ff", "#18c2a7", "#ffb020", "#7b5cff", "#4fa3ff"];
  const strand = new Group(); scene.add(strand);
  const N = lowPower ? 9 : 13;
  const linePts = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), xPos = -7 + t * 14, sag = Math.sin(t * Math.PI) * 0.7;
    linePts.push(new Vector3(xPos, 3.65 - sag, -2));
    const geo = new PlaneGeometry(0.9, 1.12, 8, 10);
    geo.translate(0, -0.56, 0); // hang from the top edge
    const mat = new MeshBasicMaterial({ map: picadoTexture(colors[i % colors.length], i * 97 + 13), transparent: true, side: DoubleSide, alphaTest: 0.1, fog: true });
    const m = new Mesh(geo, mat);
    m.position.set(xPos, 3.65 - sag, -2);
    m.userData = { base: geo.attributes.position.array.slice(), phase: i * 0.7 };
    strand.add(m); flags.push(m);
  }
  const string = new Line(new BufferGeometry().setFromPoints(linePts), new LineBasicMaterial({ color: "#c9d3e6", transparent: true, opacity: 0.5 }));
  strand.add(string);

  // ---- stars far behind ----
  const starGeo = new BufferGeometry(), sp = [];
  for (let i = 0; i < (lowPower ? 300 : 900); i++) sp.push((Math.random() - 0.5) * 40, Math.random() * 18 - 4, -8 - Math.random() * 10);
  starGeo.setAttribute("position", new Float32BufferAttribute(sp, 3));
  const stars = new Points(starGeo, new PointsMaterial({ color: "#cfe0ff", size: 0.05, transparent: true, opacity: 0.8, fog: false }));
  scene.add(stars);

  // ---- state from the page ----
  let pointerX = 0, pointerY = 0, scroll = 0, level = 0, spin = 0, visible = true, raf = 0, last = performance.now(), t0 = last;
  // where the hat sits: beside the headline on a wide screen, small above it on a phone
  let lay = { x: 2.9, y: -0.7, s: 0.8, sy: 4.45 };
  const resize = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const wide = w / h > 1.05;
    camera.position.z = wide ? 9.5 : 13;
    lay = wide ? { x: Math.min(2.9, (w / h) * 1.9), y: -0.7, s: 0.8, sy: 4.45 } : { x: 0, y: 2.05, s: 0.44, sy: 4.75 };
    strand.position.x = 0; strand.scale.setScalar(wide ? 1 : 0.62);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) loop(); }, { threshold: 0 });
  io.observe(canvas);
  const onVis = () => { if (!document.hidden && visible && !raf) loop(); };
  document.addEventListener("visibilitychange", onVis);

  function loop() {
    raf = 0;
    if (!visible || document.hidden) return;
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000), t = (now - t0) / 1000; last = now;
    const idle = reduced ? 0 : 1;
    spin *= Math.pow(0.04, dt);
    hat.rotation.y += dt * (0.25 * idle + spin) + 0;
    const tx = 0.32 + pointerY * 0.25 + scroll * 0.6, tz = -pointerX * 0.2;
    hat.rotation.x += (tx - hat.rotation.x) * Math.min(1, dt * 4);
    hat.rotation.z += (tz - hat.rotation.z) * Math.min(1, dt * 4);
    const bounce = level * 0.35;
    hat.position.x += (lay.x - hat.position.x) * Math.min(1, dt * 3);
    hat.position.y = lay.y + Math.sin(t * 1.4) * 0.12 * idle + bounce * lay.s - scroll * 2.2;
    const s = lay.s * (1 + level * 0.08 - scroll * 0.25); hat.scale.setScalar(Math.max(0.2, s));
    // the paper flags wave: each vertex swings more the lower it hangs
    if (!reduced) for (const f of flags) {
      const pos = f.geometry.attributes.position, base = f.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const by = base[i * 3 + 1], bx = base[i * 3], depth = -by;
        pos.array[i * 3 + 2] = Math.sin(t * 2.2 + f.userData.phase + bx * 2) * 0.16 * depth * (1 + level * 2);
        pos.array[i * 3] = bx + Math.sin(t * 1.7 + f.userData.phase) * 0.05 * depth;
      }
      pos.needsUpdate = true;
    }
    strand.position.y = lay.sy - 3.65 + scroll * 2.5;
    stars.rotation.y = t * 0.01 + pointerX * 0.05;
    camera.position.x += (pointerX * 0.6 - camera.position.x) * Math.min(1, dt * 2);
    camera.lookAt(0, 0.2 - scroll, 0);
    warm.intensity = 18 + level * 60; rim.intensity = 30 + level * 40;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    setPointer(x, y) { pointerX = x; pointerY = y; },
    setScroll(p) { scroll = Math.max(0, Math.min(1, p)); },
    setLevel(a) { level = a; },
    toss() { spin += 9; },
    destroy() {
      cancelAnimationFrame(raf); raf = 0; ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis);
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) [].concat(m).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
      pmrem.dispose(); renderer.dispose();
    }
  };
}
