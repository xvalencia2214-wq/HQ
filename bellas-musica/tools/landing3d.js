// The 3D scene on the welcome page: a navy charro sombrero turned on a lathe (its profile spun around an axis): a smooth
// rounded crown, a cream band embroidered with flowers and gold scrolls under a wavy braided gold cord, the knot with its
// tassels on the side, and gold trim, under a string of papel picado that waves in the breeze. It follows the pointer,
// turns with the scroll, bounces to the music and spins when tapped.
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
  // a cream band whose top edge waves up and down under a braided gold cord (above the wave is cut away), with navy
  // flowers and gold scrolls stitched between the waves, like the "pita" embroidery of a charro hat
  const W = 1024, H = 256, WAVES = 8, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const top = (px) => 64 - 30 * Math.cos((px / W) * WAVES * Math.PI * 2); // the wave: 34 at its peaks, 94 in its dips
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#fbf4e2"); g.addColorStop(1, "#e6d3a8");
  x.fillStyle = g; x.beginPath(); x.moveTo(0, H);
  for (let px = 0; px <= W; px += 4) x.lineTo(px, top(px));
  x.lineTo(W, H); x.closePath(); x.fill();
  const cord = (path, w) => { x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = "#d4a53c"; x.lineWidth = w; x.beginPath(); path(); x.stroke();
    x.strokeStyle = "rgba(122,87,16,.6)"; x.lineWidth = w; x.setLineDash([4, 7]); x.beginPath(); path(); x.stroke(); x.setLineDash([]); };
  cord(() => { x.moveTo(0, top(0)); for (let px = 4; px <= W; px += 4) x.lineTo(px, top(px)); }, 16);
  cord(() => { x.moveTo(0, H - 12); x.lineTo(W, H - 12); }, 18);
  for (let i = 0; i < WAVES; i++) {
    const cx = (i + 0.5) * (W / WAVES), cy = 168; // under each dip of the wave: a flower, with gold scrolls either side
    x.strokeStyle = "#b8862a"; x.lineWidth = 5; x.lineCap = "round";
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(cx + s * 22, cy + 6); x.bezierCurveTo(cx + s * 40, cy + 30, cx + s * 58, cy - 6, cx + s * 46, cy - 18); x.stroke(); x.beginPath(); x.arc(cx + s * 40, cy - 12, 7, 0, Math.PI * 1.5); x.stroke(); }
    x.fillStyle = "#14285e";
    for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2 - Math.PI / 2; x.beginPath(); x.arc(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 10, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = "#e6c063"; x.beginPath(); x.arc(cx, cy, 7, 0, Math.PI * 2); x.fill();
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
    [0.0, 2.2], [0.22, 2.18], [0.42, 2.1], [0.58, 1.94], [0.71, 1.66], [0.81, 1.28], [0.89, 0.88], [0.96, 0.52], [1.02, 0.32], // the tall, smoothly rounded crown
    [1.2, 0.26], [1.7, 0.22], [2.3, 0.2], [2.8, 0.23], [3.15, 0.32], [3.36, 0.5], [3.42, 0.62], [3.38, 0.7],          // the brim curling up at the edge
    [3.26, 0.62], [3.1, 0.42], [2.75, 0.3], [2.2, 0.26], [1.6, 0.27], [1.15, 0.3], [1.0, 0.25]                        // its underside
  ].map(([r, y]) => new Vector2(r, y));
  const felt = new MeshPhysicalMaterial({ color: "#0c1a44", roughness: 0.62, metalness: 0.08, sheen: 0.8, sheenColor: new Color("#3a55a0"), sheenRoughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.5, envMapIntensity: 0.45, side: DoubleSide });
  // A lathe is the same all the way round; a charro brim is not: its back sweeps up. Every point of the brim is lifted,
  // more the farther out and the nearer the back it is (nothing within the crown moves), and the trim and studs follow.
  const BACK = -Math.PI / 2; // the back of the hat: -z, away from the camera at the start
  const lift = (x, z) => {
    const r = Math.hypot(x, z); if (r <= 1.25) return 0;
    const out = Math.min(1, (r - 1.25) / 2.15), back = (1 + Math.cos(Math.atan2(z, x) - BACK)) / 2;
    return 2.5 * out * out * out * back * back;
  };
  const curl = (geo) => { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + lift(p.getX(i), p.getZ(i))); geo.computeVertexNormals(); return geo; };
  const body = new Mesh(curl(new LatheGeometry(profile, reduced || lowPower ? 96 : 160)), felt);
  hat.add(body);
  // the band wraps the bottom of the crown (from 0.32 up to 0.98), a hair outside the felt
  const band = new Mesh(new CylinderGeometry(0.905, 1.04, 0.66, 128, 1, true), new MeshStandardMaterial({ map: bandTexture(), roughness: 0.7, metalness: 0.05, transparent: true, alphaTest: 0.5, side: DoubleSide }));
  band.position.y = 0.65; hat.add(band);
  const silver = new MeshPhysicalMaterial({ color: "#e0b04a", metalness: 1, roughness: 0.22, clearcoat: 1 }); // gold trim
  const trim = new Mesh(curl(new TorusGeometry(3.36, 0.06, 16, 200).rotateX(Math.PI / 2).translate(0, 0.66, 0)), silver); hat.add(trim);
  const trim2 = new Mesh(new TorusGeometry(1.02, 0.035, 12, 120), silver); trim2.rotation.x = Math.PI / 2; trim2.position.y = 0.34; hat.add(trim2);
  // little gold studs (botonadura) around the brim
  const studGeo = new SphereGeometry(0.05, 12, 8), studs = new InstancedMesh(studGeo, silver, 36), dummy = new Object3D();
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; dummy.position.set(Math.cos(a) * 2.6, 0.27 + lift(Math.cos(a) * 2.6, Math.sin(a) * 2.6), Math.sin(a) * 2.6); dummy.updateMatrix(); studs.setMatrixAt(i, dummy.matrix); }
  hat.add(studs);
  // the knot on the side of the band, with two tassels hanging from it
  const knot = new Mesh(new SphereGeometry(0.11, 16, 12), silver); knot.scale.set(0.8, 1.3, 0.6); knot.position.set(1.0, 0.62, 0.02); hat.add(knot);
  for (const [dz, len] of [[-0.05, 0.3], [0.07, 0.24]]) {
    const cord = new Mesh(new CylinderGeometry(0.012, 0.012, len, 6), silver); cord.position.set(1.07, 0.56 - len / 2, dz); hat.add(cord);
    const tassel = new Mesh(new CylinderGeometry(0.025, 0.05, 0.1, 10), silver); tassel.position.set(1.07, 0.5 - len, dz); hat.add(tassel);
  }
  hat.position.set(2.9, -0.7, 0); hat.rotation.x = 0.32;
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
