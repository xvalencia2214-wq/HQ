import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang, setWho, currentScreen } from "../i18n.js";
import { esc, money, fmtDate, fmtPhone, lenLabel, minutesOf, toast } from "../ui.js";

// A one-page summary of a confirmed booking that either side can print or save as a PDF, built from the booking record.
export async function agreement(app, id, params) {
  const screen = currentScreen();
  let b = null, asOwner = false;
  try { b = (await api.get("/api/my/bookings")).bookings.find((x) => x.id === id) || null; } catch { /* not a customer of it */ }
  if (!b && params.get("g")) { try { b = (await api.get(`/api/groups/${encodeURIComponent(params.get("g"))}/bookings`)).bookings.find((x) => x.id === id) || null; asOwner = Boolean(b); } catch { /* not the owner */ } }
  if (!b) { app.innerHTML = `<div class="panel empty">${esc(t("common.notFound"))}</div>`; return; }
  if (b.status !== "confirmed") { app.innerHTML = `<div class="panel empty">${esc(t("agr.notConfirmed"))} <a href="#/bookings">${esc(t("bk.all"))}</a></div>`; return; }
  document.title = `${t("agr.title")} ${b.id} · Bella's Fiestas`;
  setWho(b.category, screen);
  const policy = (state.meta.policies[b.policy] || {})[lang()] || "";
  const customer = asOwner ? b.customer_name : state.user.name;
  const balanceWord = b.balance_cents <= 0 ? "" : b.balance_status === "paid" ? t("agr.balPaid") : b.balance_status === "offline" ? t("agr.balOffline") : t("agr.balDue");
  const row = (k, v) => `<tr><th scope="row">${esc(t(k))}</th><td>${v}</td></tr>`;
  app.innerHTML = `<div class="titlebar noprint"><a class="back" href="#/${asOwner ? "dashboard?g=" + esc(params.get("g")) : "bookings"}">← ${esc(t("common.back"))}</a><button type="button" class="btn" id="printbtn">${esc(t("agr.print"))}</button></div>
    <article class="agreement panel"><h1>${esc(t("agr.title"))}</h1><p class="dim small">${esc(t("agr.id"))}: ${esc(b.id)}</p>
    <h2>${esc(t("agr.parties"))}</h2><table class="kv"><tbody>${row("agr.customer", esc(customer) + (asOwner && b.phone ? ` · ${esc(fmtPhone(b.phone))}` : ""))}${row("agr.group", esc(b.group_name))}</tbody></table>
    <h2>${esc(t("agr.event"))}</h2><table class="kv"><tbody>${row("f.event", esc(t("event." + b.event_type)))}${row("f.date", esc(fmtDate(b.date)) + " · " + esc(b.time))}${row("g.hoursLabel", esc(lenLabel(minutesOf(b))) + (b.package_name ? ` · ${esc(b.package_name)}` : ""))}${row("f.guests", esc(b.guests))}${row("g.address", esc(b.address))}${b.message ? row("g.special", esc(b.message)) : ""}</tbody></table>
    <h2>${esc(t("agr.price"))}</h2><table class="kv"><tbody>${row("q.subtotal", money(b.subtotal_cents))}${(b.addons || []).map((a) => `<tr><th scope="row">${esc(a.name)}</th><td>${a.price_cents ? money(a.price_cents) : esc(t("ao.included"))}</td></tr>`).join("")}${b.travel_fee_cents ? row("q.travel", money(b.travel_fee_cents)) : ""}${row("q.total", `<strong>${money(b.total_cents)}</strong>`)}${row("agr.depositPaid", money(b.deposit_cents))}${b.balance_cents > 0 ? row("q.balance", `${money(b.balance_cents)} · ${esc(balanceWord)}`) : ""}</tbody></table>
    <h2>${esc(t("agr.policy"))}</h2><p><strong>${esc(t("policy." + b.policy))}.</strong> ${esc(policy)}</p>
    <h2>${esc(t("agr.guarantee"))}</h2><p>${esc(t("agr.guaranteeText"))}</p>
    <section id="agr-sign"></section>
    <p class="dim small">${esc(t("agr.note"))}</p></article>`;
  document.getElementById("printbtn").onclick = () => window.print();
  const box = document.getElementById("agr-sign");
  const draw = (s) => {
    const loc = lang() === "es" ? "es-US" : "en-US";
    const line = (who, sig) => `<tr><th scope="row">${esc(t(who === "customer" ? "agr.customer" : "agr.group"))}</th><td>${!sig ? `<span class="dim">${esc(t("agr.notSigned"))}</span>`
      : sig.current ? `✍️ ${esc(t("agr.signedBy", { name: sig.name, date: new Date(sig.signed_at * 1000).toLocaleString(loc) }))}` : `<span class="warn">${esc(t("agr.oldVersion", { date: new Date(sig.signed_at * 1000).toLocaleDateString(loc) }))}</span>`}</td></tr>`;
    const mine = s[s.side], done = mine && mine.current;
    box.innerHTML = `<h2>${esc(t("agr.signTitle"))}</h2><table class="kv"><tbody>${line("customer", s.customer)}${line("group", s.group)}</tbody></table>
      ${s.customer && s.customer.current && s.group && s.group.current ? `<p class="note ok">${esc(t("agr.both"))}</p>` : ""}
      ${done ? "" : `<form id="signform" class="noprint signform"><label for="sg-name">${esc(t("agr.yourName"))}</label><input id="sg-name" required minlength="3" maxlength="80" autocomplete="name" value="${esc(s.side === "customer" ? state.user.name : "")}">
        <label class="chk"><input type="checkbox" id="sg-ok" required> <span>${esc(t("agr.agree"))}</span></label><p class="dim small">${esc(t("agr.signHint"))}</p>
        <button class="btn" type="submit">${esc(t("agr.sign"))}</button></form>`}`;
    const f = document.getElementById("signform");
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      try { draw(await api.post(`/api/bookings/${encodeURIComponent(b.id)}/agreement/sign`, { name: document.getElementById("sg-name").value, agree: document.getElementById("sg-ok").checked, terms_hash: s.terms_hash })); toast(t("agr.signedToast")); }
      catch (ex) { toast(ex.message, "error"); if (ex.status === 409) api.get(`/api/bookings/${encodeURIComponent(b.id)}/agreement`).then(draw).catch(() => {}); }
    };
  };
  try { draw(await api.get(`/api/bookings/${encodeURIComponent(b.id)}/agreement`)); } catch { box.remove(); }
}
