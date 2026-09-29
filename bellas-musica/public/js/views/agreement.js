import { api } from "../api.js";
import { state } from "../state.js";
import { t, lang } from "../i18n.js";
import { esc, money, fmtDate, fmtPhone } from "../ui.js";

// A one-page summary of a confirmed booking that either side can print or save as a PDF, built from the booking record.
export async function agreement(app, id, params) {
  let b = null, asOwner = false;
  try { b = (await api.get("/api/my/bookings")).bookings.find((x) => x.id === id) || null; } catch { /* not a customer of it */ }
  if (!b && params.get("g")) { try { b = (await api.get(`/api/groups/${encodeURIComponent(params.get("g"))}/bookings`)).bookings.find((x) => x.id === id) || null; asOwner = Boolean(b); } catch { /* not the owner */ } }
  if (!b) { app.innerHTML = `<div class="panel empty">${esc(t("common.notFound"))}</div>`; return; }
  if (b.status !== "confirmed") { app.innerHTML = `<div class="panel empty">${esc(t("agr.notConfirmed"))} <a href="#/bookings">${esc(t("bk.all"))}</a></div>`; return; }
  document.title = `${t("agr.title")} ${b.id} · Bella's Música`;
  const policy = (state.meta.policies[b.policy] || {})[lang()] || "";
  const customer = asOwner ? b.customer_name : state.user.name;
  const balanceWord = b.balance_cents <= 0 ? "" : b.balance_status === "paid" ? t("agr.balPaid") : b.balance_status === "offline" ? t("agr.balOffline") : t("agr.balDue");
  const row = (k, v) => `<tr><th scope="row">${esc(t(k))}</th><td>${v}</td></tr>`;
  app.innerHTML = `<div class="titlebar noprint"><a class="back" href="#/${asOwner ? "dashboard?g=" + esc(params.get("g")) : "bookings"}">← ${esc(t("common.back"))}</a><button type="button" class="btn" id="printbtn">${esc(t("agr.print"))}</button></div>
    <article class="agreement panel"><h1>${esc(t("agr.title"))}</h1><p class="dim small">${esc(t("agr.id"))}: ${esc(b.id)}</p>
    <h2>${esc(t("agr.parties"))}</h2><table class="kv"><tbody>${row("agr.customer", esc(customer) + (asOwner && b.phone ? ` · ${esc(fmtPhone(b.phone))}` : ""))}${row("agr.group", esc(b.group_name))}</tbody></table>
    <h2>${esc(t("agr.event"))}</h2><table class="kv"><tbody>${row("f.event", esc(t("event." + b.event_type)))}${row("f.date", esc(fmtDate(b.date)) + " · " + esc(b.time))}${row("g.hoursLabel", esc(t("g.hours", { n: b.hours })) + (b.package_name ? ` · ${esc(b.package_name)}` : ""))}${row("f.guests", esc(b.guests))}${row("g.address", esc(b.address))}${b.message ? row("g.special", esc(b.message)) : ""}</tbody></table>
    <h2>${esc(t("agr.price"))}</h2><table class="kv"><tbody>${row("q.subtotal", money(b.subtotal_cents))}${b.travel_fee_cents ? row("q.travel", money(b.travel_fee_cents)) : ""}${row("q.total", `<strong>${money(b.total_cents)}</strong>`)}${row("agr.depositPaid", money(b.deposit_cents))}${b.balance_cents > 0 ? row("q.balance", `${money(b.balance_cents)} · ${esc(balanceWord)}`) : ""}</tbody></table>
    <h2>${esc(t("agr.policy"))}</h2><p><strong>${esc(t("policy." + b.policy))}.</strong> ${esc(policy)}</p>
    <h2>${esc(t("agr.guarantee"))}</h2><p>${esc(t("agr.guaranteeText"))}</p>
    <p class="dim small">${esc(t("agr.note"))}</p></article>`;
  document.getElementById("printbtn").onclick = () => window.print();
}
