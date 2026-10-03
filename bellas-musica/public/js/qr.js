// QR codes, drawn in the browser by the bundled qrcode-generator (MIT, vendor/qrcode/qrcode.js), loaded only when needed.
let loading = null;
function loadQr() {
  return loading ||= new Promise((resolve, reject) => {
    if (window.qrcode) { resolve(window.qrcode); return; }
    const s = document.createElement("script");
    s.src = "vendor/qrcode/qrcode.js";
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => { loading = null; reject(new Error("QR code library failed to load")); };
    document.head.appendChild(s);
  });
}
export async function qrSvg(text, { cell = 6, margin = 4 } = {}) {
  const qrcode = await loadQr();
  const q = qrcode(0, "M");
  q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin, scalable: true, alt: text });
}
