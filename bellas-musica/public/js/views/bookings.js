import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, money, fmtDate, statusBadge, toast } from "../ui.js";

function payBadge(b) {
  const k = b.payment_status;
  return `<span class="badge pay-${esc(k)}">${esc(t("pay." + k))}</span>`;
}

function card(b) {
  const cancelNote = b.can_cancel && b.status !== "pending_payment" ? `<div class="dim small">${esc(t("bk.cancelNote", { amount: money(b.refund_if_cancel_cents), pct: b.refund_percent_now }))}</div>` : "";
  return `<div class="req" data-id="${esc(b.id)}"><div><strong><a href="#/group/${esc(b.group_id)}">${esc(b.group_name)}</a></strong> ${statusBadge(b.status)} ${payBadge(b)}<br>
    ${esc(t("event." + b.event_type))} · ${esc(fmtDate(b.date))} · ${esc(b.time)} · ${esc(t("g.hours", { n: b.hours }))}${b.package_name ? ` · ${esc(b.package_name)}` : ""}<br>
    <span class="dim">${esc(b.address)}</span>${cancelNote}</div>
    <div class="req-r"><strong>${money(b.total_cents)}</strong><br><span class="dim small">${esc(t("bk.deposit"))} ${money(b.deposit_cents)}${b.refund_cents ? ` · ${esc(t("bk.refunded", { amount: money(b.refund_cents) }))}` : ""}</span><br>
      ${b.status === "pending_payment" ? `<a class="btn small" href="#/booking/${esc(b.id)}">${esc(t("bk.payNow"))}</a> ` : ""}
      ${["requested", "confirmed"].includes(b.status) ? `<a class="btn ghost small" href="/api/bookings/${esc(b.id)}/ics" download>${esc(t("bk.ics"))}</a> ` : ""}
      ${b.can_cancel ? `<button class="btn ghost small" data-cancel="${esc(b.id)}" data-refund="${b.refund_if_cancel_cents}">${esc(t("bk.cancel"))}</button>` : ""}
      ${b.can_review ? `<button class="btn small" data-review="${esc(b.id)}">${esc(t("bk.review"))}</button>` : ""}
      ${b.reviewed ? `<span class="dim small">✓ ${esc(t("bk.reviewed"))}</span>` : ""}</div>
    <div class="review-form" hidden></div></div>`;
}

export async function myBookings(app) {
  const { bookings } = await api.get("/api/my/bookings");
  app.innerHTML = `<h2 class="sec">${esc(t("bk.title"))}</h2><div class="panel">${bookings.length ? bookings.map(card).join("") : `<div class="empty">${esc(t("bk.none"))} <a href="#/">${esc(t("nav.find"))}</a></div>`}</div>`;
  wire(app, () => myBookings(app));
}

function wire(root, reload) {
  root.querySelectorAll("[data-cancel]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm(t("bk.confirmCancel", { amount: money(Number(b.dataset.refund)) }))) return;
      try { await api.patch("/api/bookings/" + b.dataset.cancel, { action: "cancel" }); toast(t("bk.cancelled")); reload(); }
      catch (e) { toast(e.message, "error"); }
    };
  });
  root.querySelectorAll("[data-review]").forEach((b) => {
    b.onclick = () => {
      const holder = b.closest(".req").querySelector(".review-form");
      holder.hidden = false;
      holder.innerHTML = `<form><label>${esc(t("bk.rating"))}</label><select name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${"★".repeat(n)} (${n})</option>`).join("")}</select>
        <label>${esc(t("bk.comment"))}</label><textarea name="text" maxlength="800"></textarea><div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("bk.submitReview"))}</button></form>`;
      holder.querySelector("form").onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try { await api.post(`/api/bookings/${b.dataset.review}/review`, { rating: Number(f.rating), text: f.text }); toast(t("bk.thanks")); reload(); }
        catch (ex) { holder.querySelector(".err").textContent = ex.message; }
      };
    };
  });
}

// Landing page after Stripe (?paid=1) and for paying a held booking.
export async function bookingPage(app, id, params) {
  let b;
  try { b = (await api.post(`/api/bookings/${encodeURIComponent(id)}/refresh`)).booking; }
  catch (e) { app.innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  const msg = b.payment_status !== "unpaid" ? `<div class="note ok"><strong>${esc(t("bk.paidTitle"))}</strong> ${esc(t("bk.paidText"))}</div>`
    : params.get("cancelled") ? `<div class="note">${esc(t("bk.payCancelled"))}</div>` : "";
  app.innerHTML = `<h2 class="sec">${esc(t("bk.detail"))}</h2>${msg}<div class="panel">${card(b)}
    ${b.status === "pending_payment" && b.pay_url ? `<a class="btn" href="${esc(b.pay_url)}">${esc(t("bk.payNow"))}</a>` : ""}
    <p><a href="#/bookings">${esc(t("bk.all"))}</a></p></div>`;
  wire(app, () => bookingPage(app, id, new URLSearchParams()));
}

// Test-mode payment page (only used when Stripe isn't configured).
export async function simulatedPay(app, kind, id) {
  let title, amount, summary;
  if (kind === "booking") {
    const { bookings } = await api.get("/api/my/bookings");
    const b = bookings.find((x) => x.id === id);
    if (!b) { app.innerHTML = `<div class="panel empty">${esc(t("common.notFound"))}</div>`; return; }
    title = t("pay.depositFor", { name: b.group_name }); amount = b.deposit_cents;
    summary = `${esc(fmtDate(b.date))} · ${esc(b.time)}`;
  } else { title = t("pay.featureTitle"); amount = state.meta.feature_price_cents; summary = esc(t("pay.featureText")); }
  app.innerHTML = `<div class="panel narrow"><h2>${esc(title)}</h2><p>${summary}</p><div class="sum strong"><span>${esc(t("pay.amount"))}</span><span>${money(amount)}</span></div>
    <div class="note">${esc(t("pay.testMode"))}</div><div id="payerr" class="err" role="alert"></div><button class="btn wide" id="paybtn">${esc(t("pay.button", { amount: money(amount) }))}</button></div>`;
  document.getElementById("paybtn").onclick = async () => {
    document.getElementById("paybtn").disabled = true;
    try {
      if (kind === "booking") { await api.post(`/api/bookings/${encodeURIComponent(id)}/simulate-pay`); location.hash = `#/booking/${id}?paid=1`; }
      else { const r = await api.post(`/api/feature/${encodeURIComponent(id)}/simulate-pay`); toast(t("dash.featured")); location.hash = `#/dashboard?g=${r.group_id}&tab=payments`; }
    } catch (e) { document.getElementById("payerr").textContent = e.message; document.getElementById("paybtn").disabled = false; }
  };
}
