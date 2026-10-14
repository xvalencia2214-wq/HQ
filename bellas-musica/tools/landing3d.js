// The 3D scene on the welcome page: the logo's black and gold sombrero, seen from the side (front of the brim swept up, a dented
// crown peaking toward the front, a gold flower), turned on a lathe (its profile spun around an
// axis): a smooth rounded crown in black felt, a gold band embroidered with black flowers and scrolls under a wavy braided
// gold cord, the knot with its tassels on the side, a gold zigzag around the brim, and gold trim, under a string of papel picado that waves in the breeze. It follows the pointer,
// sways side-on like the logo, follows the pointer, turns with the scroll, bounces to the music and spins once round when tapped.
// Bundled with only the parts of three.js it uses:  npm run build:landing  ->  public/vendor/landing3d.js
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector2, Vector3, Color, Fog,
  LatheGeometry, CylinderGeometry, TorusGeometry, PlaneGeometry, SphereGeometry,
  MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial, Mesh, InstancedMesh, Object3D, Quaternion,
  HemisphereLight, DirectionalLight, PointLight, CanvasTexture, SRGBColorSpace, DoubleSide, PMREMGenerator, ACESFilmicToneMapping,
  BufferGeometry, Float32BufferAttribute, LineBasicMaterial, Line, RepeatWrapping, Points, PointsMaterial
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// ---- textures drawn on a canvas ----
function bandTexture() {
  // a braided gold band, like the logo's: gold with slanted strands, a fine dark edge above and below
  const W = 1024, H = 128, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#f3d27a"); g.addColorStop(0.5, "#d4a53c"); g.addColorStop(1, "#a87a1f");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = "rgba(92,66,16,.55)"; x.lineWidth = 6; x.lineCap = "round";
  for (let px = -H; px < W + H; px += 26) { x.beginPath(); x.moveTo(px, H - 14); x.lineTo(px + 40, 14); x.stroke(); } // the braid's strands
  x.fillStyle = "rgba(255,240,190,.5)"; x.fillRect(0, 10, W, 3);
  x.fillStyle = "#5c4210"; x.fillRect(0, 0, W, 6); x.fillRect(0, H - 6, W, 6);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.wrapS = RepeatWrapping; t.repeat.set(3, 1);
  return t;
}

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
  scene.fog = new Fog(new Color("#fdfbf6"), 9, 22);
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 1.4, 9.5);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  scene.add(new HemisphereLight("#fff6e0", "#c9b68a", 0.9));
  const key = new DirectionalLight("#ffffff", 1.6); key.position.set(4, 6, 5); scene.add(key);
  const rim = new PointLight("#ffd27a", 30, 20); rim.position.set(-4, 2, -3); scene.add(rim);
  const warm = new PointLight("#ffb347", 18, 16); warm.position.set(3.5, -1, 3); scene.add(warm);

  // ---- the sombrero: a profile (radius, height) spun around the vertical axis ----
  const hat = new Group();
  const profile = [
    [0.0, 2.07], [0.22, 2.09], [0.46, 2.14], [0.64, 2.12], [0.76, 2.02], [0.82, 1.78], [0.87, 1.3], [0.92, 0.8], [0.97, 0.3], // the tall crown, its top dented in the middle (like the logo)
    [1.15, 0.24], [1.8, 0.2], [2.4, 0.23], [2.8, 0.32], [3.05, 0.48], [3.2, 0.68], [3.26, 0.86], [3.3, 0.9],  // a thin brim that curls up at its edge
    [3.33, 0.85], [3.28, 0.66], [3.12, 0.45], [2.86, 0.28], [2.45, 0.18], [1.8, 0.15], [1.15, 0.18], [0.97, 0.22] // its outside, a hair below
  ].map(([r, y]) => new Vector2(r, y));
  const felt = new MeshPhysicalMaterial({ color: "#060606", roughness: 0.55, metalness: 0.05, sheen: 0.45, sheenColor: new Color("#3a3a3a"), sheenRoughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.5, envMapIntensity: 0.45, side: DoubleSide });
  // A lathe is the same all the way round; the logo's brim is not: seen from the side, its front sweeps up high and its back stays low.
  // Every point of the brim is lifted, more the farther out and the nearer the front it is (the crown doesn't move), and the trim,
  // studs and zigzag follow.
  const FRONT = 0; // the front of the hat points to the right of the screen (+x), as in the logo
  const lift = (x, z) => {
    const r = Math.hypot(x, z); if (r <= 1.2) return 0;
    const out = Math.min(1, (r - 1.2) / 2.1), front = Math.max(0, Math.cos(Math.atan2(z, x) - FRONT)); // 1 at the front, 0 from the sides back
    return out * out * (0.08 + 0.95 * front * front * front); // the front sweeps up like the logo; the back keeps only its small curl
  };
  const curl = (geo) => { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + lift(p.getX(i), p.getZ(i))); geo.computeVertexNormals(); return geo; };
  // the logo's crown: its top dips behind the middle and rises to a peak toward the front, its back wall leans a little
  const dent = (geo) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), x = p.getX(i); if (y < 1.0 || Math.hypot(x, p.getZ(i)) > 1.0) continue;
      const k = (y - 1.0) / 1.15, xn = x / 0.8;
      p.setY(i, y + k * k * (0.2 * Math.exp(-(((xn - 0.45) / 0.35) ** 2)) - 0.13 * Math.exp(-(((xn + 0.15) / 0.3) ** 2))));
      p.setX(i, x + k * 0.06); // leaning a touch toward the front
    }
    geo.computeVertexNormals(); return geo;
  };
  const body = new Mesh(curl(dent(new LatheGeometry(profile, reduced || lowPower ? 96 : 160))), felt);
  hat.add(body);
  // the band wraps the bottom of the crown (from 0.32 up to 0.98), a hair outside the felt
  const band = new Mesh(new CylinderGeometry(0.965, 0.99, 0.3, 128, 1, true), new MeshStandardMaterial({ map: bandTexture(), roughness: 0.7, metalness: 0.05, transparent: true, alphaTest: 0.5, side: DoubleSide }));
  band.position.y = 0.46; hat.add(band);
  const silver = new MeshPhysicalMaterial({ color: "#e0b04a", metalness: 1, roughness: 0.22, clearcoat: 1 }); // gold trim
  // the gold flower on the front of the crown, facing the viewer (+z)
  const flower = new Group(), petal = new SphereGeometry(0.1, 16, 12);
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + Math.PI / 2, m = new Mesh(petal, silver); m.scale.set(0.75, 1.15, 0.35); m.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0); m.rotation.z = a - Math.PI / 2; flower.add(m); }
  const heart = new Mesh(new SphereGeometry(0.05, 12, 10), new MeshStandardMaterial({ color: "#111111", roughness: 0.4 })); heart.scale.z = 0.5; flower.add(heart);
  flower.scale.setScalar(1.55); flower.position.set(0.05, 1.18, 0.9); flower.rotation.x = -0.05; hat.add(flower);
  const trim = new Mesh(curl(new TorusGeometry(3.31, 0.045, 16, 200).rotateX(Math.PI / 2).translate(0, 0.89, 0)), silver); hat.add(trim);
  const trim2 = new Mesh(new TorusGeometry(1.0, 0.035, 12, 120), silver); trim2.rotation.x = Math.PI / 2; trim2.position.y = 0.3; hat.add(trim2);
  // little gold studs (botonadura) around the brim
  const studGeo = new SphereGeometry(0.05, 12, 8), studs = new InstancedMesh(studGeo, silver, 36), dummy = new Object3D();
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; dummy.position.set(Math.cos(a) * 2.1, 0.23 + lift(Math.cos(a) * 2.1, Math.sin(a) * 2.1), Math.sin(a) * 2.1); dummy.updateMatrix(); studs.setMatrixAt(i, dummy.matrix); }
  hat.add(studs);
  // a gold zigzag all the way around the outside of the brim's upturned edge: the band you see on the front of the logo's brim
  const ZIG = 120, zigPts = [];
  for (let i = 0; i <= ZIG; i++) {
    const a = (i / ZIG) * Math.PI * 2, [r, y] = i % 2 ? [3.335, 0.74] : [3.2, 0.5]; // high and low points, a hair outside the felt
    const xx = Math.cos(a) * r, zz = Math.sin(a) * r; zigPts.push(new Vector3(xx, y + lift(xx, zz), zz));
  }
  const zigGeo = new CylinderGeometry(0.032, 0.032, 1, 6), zig = new InstancedMesh(zigGeo, silver, ZIG), up = new Vector3(0, 1, 0);
  for (let i = 0; i < ZIG; i++) {
    const a = zigPts[i], b = zigPts[i + 1], dir = new Vector3().subVectors(b, a), len = dir.length();
    dummy.position.copy(a).addScaledVector(dir, 0.5); dummy.quaternion.copy(new Quaternion().setFromUnitVectors(up, dir.normalize())); dummy.scale.set(1, len, 1);
    dummy.updateMatrix(); zig.setMatrixAt(i, dummy.matrix);
  }
  hat.add(zig);
  // the knot on the side of the band, with two tassels hanging from it
  const knot = new Mesh(new SphereGeometry(0.11, 16, 12), silver); knot.scale.set(0.8, 1.3, 0.6); knot.position.set(1.0, 0.48, 0.02); hat.add(knot);
  for (const [dz, len] of [[-0.05, 0.3], [0.07, 0.24]]) {
    const cord = new Mesh(new CylinderGeometry(0.012, 0.012, len, 6), silver); cord.position.set(1.07, 0.42 - len / 2, dz); hat.add(cord);
    const tassel = new Mesh(new CylinderGeometry(0.025, 0.05, 0.1, 10), silver); tassel.position.set(1.07, 0.36 - len, dz); hat.add(tassel);
  }
  hat.position.set(2.05, -0.3, 0); hat.rotation.x = 0.07;
  scene.add(hat);

  // ---- papel picado: a string across the top with paper flags that wave ----
  const flags = [], colors = ["#14285e", "#d6336c", "#d4a53c", "#0f8a78", "#e8833a", "#6a4cc9", "#2f6bff"];
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
  const string = new Line(new BufferGeometry().setFromPoints(linePts), new LineBasicMaterial({ color: "#8a7a55", transparent: true, opacity: 0.6 }));
  strand.add(string);

  // ---- gold dust far behind ----
  const starGeo = new BufferGeometry(), sp = [];
  for (let i = 0; i < (lowPower ? 300 : 900); i++) sp.push((Math.random() - 0.5) * 40, Math.random() * 18 - 4, -8 - Math.random() * 10);
  starGeo.setAttribute("position", new Float32BufferAttribute(sp, 3));
  const stars = new Points(starGeo, new PointsMaterial({ color: "#c9962b", size: 0.045, transparent: true, opacity: 0.45, fog: false }));
  scene.add(stars);

  // ---- state from the page ----
  let pointerX = 0, pointerY = 0, scroll = 0, level = 0, spin = 0, turn = 0, visible = true, raf = 0, last = performance.now(), t0 = last;
  // where the hat sits: beside the headline on a wide screen, small above it on a phone
  let lay = { x: 2.05, y: -0.3, s: 0.54, sy: 4.45 };
  const resize = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const wide = w / h > 1.05;
    camera.position.z = wide ? 9.5 : 13;
    lay = wide ? { x: Math.min(2.05, (w / h) * 1.4), y: -0.3, s: 0.54, sy: 4.45 } : { x: 0, y: 2.05, s: 0.38, sy: 4.75 };
    strand.position.x = 0; strand.scale.setScalar(wide ? 1 : 0.62);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  hat.position.x = lay.x; // start where it belongs on this screen (it glides only when the screen changes shape)
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
    turn += dt * spin;
    if (Math.abs(spin) < 0.6) turn += (Math.round(turn / (Math.PI * 2)) * Math.PI * 2 - turn) * Math.min(1, dt * 2.5); // settle back side-on
    hat.rotation.y = -0.32 + Math.sin(t * 0.45) * 0.28 * idle + pointerX * 0.25 + turn; // seen from the side, a little toward us, swaying
    const tx = 0.07 + pointerY * 0.18 + scroll * 0.6, tz = -pointerX * 0.2;
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
