// A one-page flyer to sign up vendors (bandas, mariachis, DJs, food, tents, photographers, venues...), Spanish first with
// English under it, made to print on letter paper and hand out at party halls, quinceañera expos and gigs. Its QR code
// is the vendor sign-up link of THIS site (location.origin), so a flyer printed from the real site always points to it.
// Open it from the Admin page ("Print a flyer"), or at #/flyer.
import { esc } from "../ui.js";
import { state } from "../state.js";
import { qrSvg } from "../qr.js";

const joinLink = () => `${location.origin}/?src=vendor-flyer#/signup?next=${encodeURIComponent("#/dashboard?new=1")}`;

export async function flyer(app) {
  const meta = state.meta || {};
  const f = meta.founding && meta.founding.left > 0 ? meta.founding : null;
  const months = f ? Math.max(1, Math.round(f.days / 30)) : 0;
  const host = location.host.replace(/^www\./, "");
  const perk = (es, en) => `<li><strong>${esc(es)}</strong><span lang="en">${esc(en)}</span></li>`;
  app.innerHTML = `<div class="flyer-tools noprint">
      <p>Print this on letter paper and hand it out at party halls, expos and gigs. The QR code opens the sign-up page on <strong>${esc(host)}</strong>${/onrender\.com|localhost|127\.0\.0\.1/.test(host) ? ` <span class="warn">(this is not your own domain yet: print from your real site once it's live, so vendors sign up there)</span>` : ""}.</p>
      <button type="button" class="btn" id="flyerprint">🖨️ Print / Imprimir</button> <a class="btn ghost" id="flyerqr" download="bellas-fiestas-vendor-qr.svg">Download the QR code</a>
    </div>
    <article class="flyer" lang="es" aria-label="Vendor flyer">
      <div class="fl-head"><img src="logo.svg" alt="" width="72" height="72"><div><div class="fl-brand">Bella's Fiestas</div><div class="fl-tag">Música y todo para tu fiesta · <span lang="en">Music and everything for your fiesta</span></div></div></div>
      <h1 class="fl-title">¿Tu negocio trabaja en fiestas?<br>Consigue más reservas.</h1>
      <p class="fl-sub" lang="en">Do you work parties? Get booked more.</p>
      <p class="fl-who">Mariachi · Banda · Norteño · Sierreño · DJ · Comida · Carpas y renta · Decoración · Fotógrafos y videógrafos · Salones</p>
      <div class="fl-body">
        <ul class="fl-perks">
          ${perk("Tu página gratis, con tus fotos, precios y fechas libres", "Your free page with your photos, prices and open dates")}
          ${perk("Las familias reservan con depósito: se acabaron los “te aviso”", "Families book with a deposit: no more maybes")}
          ${perk("Nunca pagas por clientes: solo una comisión cuando te contratan", "Never pay for leads: only a fee when you get booked")}
          ${perk("Tu calendario, sin reservas dobles", "Your calendar, never double-booked")}
          ${perk("Todo en español y en inglés", "Everything in Spanish and English")}
        </ul>
        <div class="fl-qrbox">
          <div class="fl-qr" id="flyer-qr" role="img" aria-label="QR code: sign up on ${esc(host)}"></div>
          <div class="fl-scan">Escanea y regístrate gratis</div>
          <div class="fl-scan-en" lang="en">Scan to sign up free</div>
          <div class="fl-url">${esc(host)}</div>
        </div>
      </div>
      ${f ? `<div class="fl-offer"><strong>Oferta de fundadores:</strong> solo ${f.fee_pct}% por ${months} meses para los primeros ${f.slots} negocios.<br><span lang="en">Founding offer: only ${f.fee_pct}% for ${months} months for the first ${f.slots} businesses.</span></div>` : ""}
      <div class="fl-foot">Listo en unos 10 minutos · <span lang="en">Ready in about 10 minutes</span>${meta.support_email ? ` · ¿Preguntas? <span lang="en">Questions?</span> ${esc(meta.support_email)}` : ""}</div>
    </article>`;
  const svg = await qrSvg(joinLink(), { cell: 8, margin: 2 });
  if (!app.isConnected) return;
  document.getElementById("flyer-qr").innerHTML = svg;
  document.getElementById("flyerqr").href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  document.getElementById("flyerprint").onclick = () => window.print();
}
