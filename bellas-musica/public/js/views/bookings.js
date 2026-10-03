import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, money, fmtDate, statusBadge, toast, today, goto, parseKey } from "../ui.js";
import { calendar, monthKey } from "../calendar.js";
import { shrink } from "./dashboard.js";

function payBadge(b) {
  const k = b.payment_status;
  return `<span class="badge pay-${esc(k)}">${esc(t("pay." + k))}</span>`;
}

function card(b) {
  const cancelNote = b.can_cancel && b.status !== "pending_payment" ? `<div class="dim small">${esc(t("bk.cancelNote", { amount: money(b.refund_if_cancel_cents), pct: b.refund_percent_now }))}</div>` : "";
  const balanceLine = balanceInfo(b) + guaranteeInfo(b) + (b.reschedule ? `<div class="note small">${esc(t("rs.pending", { date: fmtDate(b.reschedule.date), time: b.reschedule.time }))}</div>` : "");
  return `<div class="req" data-id="${esc(b.id)}"><div><strong><a href="#/group/${esc(b.group_id)}">${esc(b.group_name)}</a></strong> ${statusBadge(b.status)} ${payBadge(b)}<br>
    ${esc(t("event." + b.event_type))} · ${esc(fmtDate(b.date))} · ${esc(b.time)} · ${esc(t("g.hours", { n: b.hours }))}${b.package_name ? ` · ${esc(b.package_name)}` : ""}${b.addons && b.addons.length ? `<br><span class="dim small">${esc(t("ao.line", { list: b.addons.map((a) => a.name).join(", ") }))}</span>` : ""}<br>
    <span class="dim">${esc(b.address)}</span>${cancelNote}${balanceLine}</div>
    <div class="req-r"><strong>${money(b.total_cents)}</strong><br><span class="dim small">${esc(t("bk.deposit"))} ${money(b.deposit_cents)}${b.refund_cents ? ` · ${esc(t("bk.refunded", { amount: money(b.refund_cents) }))}` : ""}</span><br>
      ${b.status === "pending_payment" ? `<a class="btn small" href="#/booking/${esc(b.id)}">${esc(t("bk.payNow"))}</a> ` : ""}
      ${["requested", "confirmed"].includes(b.status) ? `<a class="btn ghost small" href="/api/bookings/${esc(b.id)}/ics" download>${esc(t("bk.ics"))}</a> ` : ""}
      ${b.status === "confirmed" ? `<a class="btn ghost small" href="#/agreement/${esc(b.id)}">${esc(t("agr.link"))}</a> ` : ""}
      ${b.can_pay_balance ? `<button class="btn small" data-balance="${esc(b.id)}">${esc(t("bal.payNow", { amount: money(b.balance_cents) }))}</button> ` : ""}
      ${b.can_pay_part ? `<button class="btn ghost small" data-part="${esc(b.id)}" data-left="${b.balance_left_cents}">${esc(t("plan.payPart"))}</button> ` : ""}
      ${b.reschedule ? `<button class="btn ghost small" data-unresched="${esc(b.id)}">${esc(t("rs.withdraw"))}</button> ` : b.can_reschedule ? `<button class="btn ghost small" data-resched="${esc(b.id)}" data-group="${esc(b.group_id)}" data-date="${esc(b.date)}">${esc(t("rs.request"))}</button> ` : ""}
      ${b.can_cancel ? `<button class="btn ghost small" data-cancel="${esc(b.id)}" data-refund="${b.refund_if_cancel_cents}">${esc(t("bk.cancel"))}</button>` : ""}
      ${b.can_confirm_arrival ? `<button class="btn ghost small" data-arrived="${esc(b.id)}">${esc(t("show.arrived"))}</button> ` : ""}
      ${b.can_report_noshow ? `<button class="btn ghost small" data-noshow="${esc(b.id)}">${esc(t("show.report"))}</button> ` : ""}
      ${b.can_review ? `<button class="btn small" data-review="${esc(b.id)}">${esc(t("bk.review"))}</button>` : ""}
      ${b.reviewed ? `<span class="dim small">✓ ${esc(t("bk.reviewed"))}</span>` : ""}</div>
    <div class="review-form" hidden></div><div class="resched-form" hidden></div><div class="part-form" hidden></div></div>`;
}

// The arrival code (event day and the day before), the group's check-in, and where a no-show report stands.
function guaranteeInfo(b) {
  let out = "";
  if (b.checkin_code) out += `<div class="note small code-note">${esc(t("show.code"))} <strong class="bigcode">${esc(b.checkin_code)}</strong></div>`;
  if (b.checked_in) out += `<div class="dim small">✓ ${esc(t("show.checkedIn"))}</div>`;
  if (b.noshow) out += `<div class="note small">${esc(t(b.noshow.status === "refunded" ? "show.stRefunded" : b.noshow.status === "rejected" ? "show.stRejected" : "show.stReported"))}</div>`;
  return out;
}

// What is owed on top of the deposit, in words the customer can act on, and who has paid toward it (installments, padrinos).
function balanceInfo(b) {
  if (b.balance_cents <= 0 || b.status !== "confirmed") return "";
  const line = (key, vars) => `<div class="dim small">${esc(t(key, vars))}</div>`;
  const paidParts = (b.parts || []).filter((p) => p.status !== "stray");
  const who = paidParts.length ? `<div class="dim small parts">${paidParts.map((p) => esc(t(p.by_customer ? "plan.youPaid" : "plan.padrinoPaid", { name: p.payer_name, amount: money(p.amount_cents) })) + (p.note ? ` <em>(${esc(p.note)})</em>` : "")).join(" · ")}</div>` : "";
  if (paidParts.length && b.balance_status === "unpaid") return who + line("plan.left", { amount: money(b.balance_left_cents) });
  if (paidParts.length && b.balance_status === "paid") return who + line("bal.paid");
  if (b.balance_status === "paid") return line("bal.paid");
  if (b.balance_status === "offline") return line("bal.offline");
  if (b.balance_status === "refunded") return line("bal.refunded");
  if (b.balance_status === "partial_refund") return line("bal.partial", { amount: money(b.balance_refund_cents) });
  return b.payment_status === "paid" ? line("bal.due", { amount: money(b.balance_cents) }) : "";
}

// Ask the group to move the event: pick another open date and time. The group decides; nothing changes until they approve.
function reschedulePanel(holder, b, groupId, reload) {
  const start = b.date ? parseKey(b.date) : today(); // open on the month of the current date: that's where the alternatives usually are
  const st = { month: new Date(start.getFullYear(), start.getMonth(), 1), date: null, time: null, days: {} };
  holder.hidden = false;
  holder.innerHTML = `<h3>${esc(t("rs.title"))}</h3><p class="dim small">${esc(t("rs.hint"))}</p><div class="rs-cal"></div><div class="rs-slots"></div>
    <label for="rs-note-${esc(b.id)}">${esc(t("rs.note"))}</label><input id="rs-note-${esc(b.id)}" maxlength="200"><div class="err" role="alert"></div>
    <button type="button" class="btn small" data-send>${esc(t("rs.send"))}</button> <button type="button" class="btn ghost small" data-close>${esc(t("rs.close"))}</button>`;
  const calBox = holder.querySelector(".rs-cal"), slotBox = holder.querySelector(".rs-slots"), err = holder.querySelector(".err");
  async function draw() {
    const k = monthKey(st.month);
    if (!st.days[k]) { try { st.days[k] = (await api.get(`/api/groups/${encodeURIComponent(groupId)}/availability?month=${k}`)).days; } catch { st.days[k] = {}; } }
    const days = st.days[k];
    calendar(calBox, st, {
      dayState: (d) => { const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; const ok = Boolean(days[key]); return { enabled: ok, open: ok }; },
      onPick: (key) => { st.date = key; st.time = null; draw(); },
      onMonth: draw
    });
    const slots = st.date ? (st.days[st.date.slice(0, 7)] || {})[st.date] || [] : [];
    slotBox.innerHTML = st.date ? `<div class="slots">${slots.map((x) => `<button type="button" class="slot${st.time === x ? " sel" : ""}" data-t="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : "";
    slotBox.querySelectorAll(".slot").forEach((btn) => { btn.onclick = () => { st.time = btn.dataset.t; draw(); }; });
  }
  holder.querySelector("[data-close]").onclick = () => { holder.hidden = true; holder.innerHTML = ""; };
  holder.querySelector("[data-send]").onclick = async () => {
    err.textContent = "";
    if (!st.date || !st.time) { err.textContent = t("rs.pickFirst"); return; }
    try { await api.post(`/api/bookings/${encodeURIComponent(b.id)}/reschedule`, { date: st.date, time: st.time, note: holder.querySelector("input").value }); toast(t("rs.sent")); reload(); }
    catch (e) { err.textContent = e.message; }
  };
  draw();
}

// Several unpaid holds: pay all their deposits in one checkout.
export function cartBox(bookings) {
  const unpaid = bookings.filter((b) => b.status === "pending_payment");
  if (unpaid.length < 2) return "";
  const total = unpaid.reduce((n, b) => n + b.deposit_cents, 0);
  return `<div class="note cartbox"><strong>🛒 ${esc(t("cart.title", { n: unpaid.length }))}</strong><br><span class="small">${esc(unpaid.map((b) => b.group_name).join(" · "))}</span><br>
    <button type="button" class="btn small" data-cart="${esc(unpaid.slice(0, 6).map((b) => b.id).join(","))}">${esc(t("cart.pay", { amount: money(total) }))}</button> <span class="dim small">${esc(t("cart.hint"))}</span></div>`;
}
export function wireCart(root) {
  root.querySelectorAll("[data-cart]").forEach((b) => { b.onclick = async () => {
    b.disabled = true;
    try { goto((await api.post("/api/cart", { bookingIds: b.dataset.cart.split(",") })).payment.url); } catch (e) { toast(e.message, "error"); b.disabled = false; }
  }; });
}

export async function myBookings(app) {
  const { bookings } = await api.get("/api/my/bookings");
  app.innerHTML = `<h1 class="sec">${esc(t("bk.title"))}</h1>${cartBox(bookings)}<div class="panel">${bookings.length ? bookings.map(card).join("") : `<div class="empty">${esc(t("bk.none"))} <a href="#/">${esc(t("nav.find"))}</a></div>`}</div>`;
  wire(app, () => myBookings(app)); wireCart(app);
}

function wire(root, reload) {
  root.querySelectorAll("[data-cancel]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm(t("bk.confirmCancel", { amount: money(Number(b.dataset.refund)) }))) return;
      try { await api.patch("/api/bookings/" + b.dataset.cancel, { action: "cancel" }); toast(t("bk.cancelled")); reload(); }
      catch (e) { toast(e.message, "error"); }
    };
  });
  root.querySelectorAll("[data-balance]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { goto((await api.post(`/api/bookings/${encodeURIComponent(b.dataset.balance)}/balance`)).payment.url); }
      catch (e) { toast(e.message, "error"); b.disabled = false; }
    };
  });
  // pay part of the balance (a payment plan): any amount from $20, or the rest
  root.querySelectorAll("[data-part]").forEach((b) => {
    b.onclick = () => {
      const holder = b.closest(".req").querySelector(".part-form"), left = Number(b.dataset.left);
      holder.hidden = false;
      const sug = [2, 3].map((n) => Math.ceil(left / n / 100)).filter((x) => x >= 20);
      holder.innerHTML = `<form class="cform"><p class="dim small" style="flex-basis:100%">${esc(t("plan.hint", { amount: money(left) }))}${sug.length ? " " + esc(t("plan.suggest", { two: money(sug[0] * 100), three: money((sug[1] || sug[0]) * 100) })) : ""}</p>
        <label class="sr-only" for="pa-${esc(b.dataset.part)}">${esc(t("plan.amount"))}</label><input id="pa-${esc(b.dataset.part)}" type="number" min="20" max="${Math.ceil(left / 100)}" inputmode="numeric" placeholder="${esc(t("plan.amount"))}" value="${sug[0] || Math.ceil(left / 100)}">
        <button class="btn small" type="submit">${esc(t("plan.pay"))}</button> <button type="button" class="btn ghost small" data-rest>${esc(t("plan.rest", { amount: money(left) }))}</button><div class="err" role="alert" style="flex-basis:100%"></div></form>`;
      const go = async (body) => { try { goto((await api.post(`/api/bookings/${encodeURIComponent(b.dataset.part)}/parts`, body)).payment.url); } catch (ex) { holder.querySelector(".err").textContent = ex.message; } };
      holder.querySelector("form").onsubmit = (e) => { e.preventDefault(); go({ amount: Number(holder.querySelector("input").value) }); };
      holder.querySelector("[data-rest]").onclick = () => go({ rest: true });
    };
  });
  root.querySelectorAll("[data-resched]").forEach((b) => {
    b.onclick = () => {
      reschedulePanel(b.closest(".req").querySelector(".resched-form"), { id: b.closest(".req").dataset.id, date: b.dataset.date }, b.dataset.group, reload);
    };
  });
  root.querySelectorAll("[data-unresched]").forEach((b) => {
    b.onclick = async () => {
      try { await api.del(`/api/bookings/${encodeURIComponent(b.dataset.unresched)}/reschedule`); toast(t("rs.withdrawn")); reload(); }
      catch (e) { toast(e.message, "error"); }
    };
  });
  root.querySelectorAll("[data-arrived]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm(t("show.arrivedConfirm"))) return;
      try { await api.post(`/api/bookings/${encodeURIComponent(b.dataset.arrived)}/arrived`); toast(t("show.arrivedDone")); reload(); } catch (e) { toast(e.message, "error"); }
    };
  });
  root.querySelectorAll("[data-noshow]").forEach((b) => {
    b.onclick = () => {
      const holder = b.closest(".req").querySelector(".review-form");
      holder.hidden = false;
      holder.innerHTML = `<form><p class="dim small">${esc(t("show.reportHint"))}</p><label for="ns-${esc(b.dataset.noshow)}">${esc(t("show.report"))}</label><textarea id="ns-${esc(b.dataset.noshow)}" name="note" maxlength="400" required minlength="5"></textarea><div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("show.reportSend"))}</button></form>`;
      holder.querySelector("form").onsubmit = async (e) => {
        e.preventDefault();
        try { await api.post(`/api/bookings/${encodeURIComponent(b.dataset.noshow)}/noshow`, { note: new FormData(e.target).get("note") }); toast(t("show.reported")); reload(); }
        catch (ex) { holder.querySelector(".err").textContent = ex.message; }
      };
    };
  });
  root.querySelectorAll("[data-review]").forEach((b) => {
    b.onclick = () => {
      const holder = b.closest(".req").querySelector(".review-form");
      holder.hidden = false;
      holder.innerHTML = `<form><label>${esc(t("bk.rating"))}</label><select name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${"★".repeat(n)} (${n})</option>`).join("")}</select>
        <label>${esc(t("bk.comment"))}</label><textarea name="text" maxlength="800"></textarea>
        <label for="rp-${esc(b.dataset.review)}">${esc(t("rv.addPhotos"))}</label><input id="rp-${esc(b.dataset.review)}" name="photos" type="file" accept="image/*" multiple>
        <div class="err" role="alert"></div><button class="btn small" type="submit">${esc(t("bk.submitReview"))}</button></form>`;
      holder.querySelector("form").onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const files = [...e.target.photos.files];
        if (files.length > 3) { holder.querySelector(".err").textContent = t("rv.max3"); return; }
        try { const photos = await Promise.all(files.map((x) => shrink(x, 1400))); await api.post(`/api/bookings/${b.dataset.review}/review`, { rating: Number(f.rating), text: f.text, photos }); toast(t("bk.thanks")); reload(); }
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
  const msg = params.get("balance") && ["paid", "offline"].includes(b.balance_status) ? `<div class="note ok"><strong>${esc(t("bal.thanks"))}</strong></div>`
    : b.payment_status !== "unpaid" ? `<div class="note ok"><strong>${esc(t("bk.paidTitle"))}</strong> ${esc(t("bk.paidText"))}</div>`
    : params.get("cancelled") ? `<div class="note">${esc(t("bk.payCancelled"))}</div>` : "";
  app.innerHTML = `<h1 class="sec">${esc(t("bk.detail"))}</h1>${msg}<div class="panel">${card(b)}
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
  } else if (kind === "balance") {
    const { bookings } = await api.get("/api/my/bookings");
    const b = bookings.find((x) => x.id === id);
    if (!b || !b.can_pay_balance) { app.innerHTML = `<div class="panel empty">${esc(t("common.notFound"))}</div>`; return; }
    title = t("bal.payTitle", { name: b.group_name }); amount = b.balance_cents;
    summary = `${esc(fmtDate(b.date))} · ${esc(b.time)}`;
  } else if (kind === "part") {
    let p; try { p = (await api.get(`/api/parts/${encodeURIComponent(id)}`)).part; } catch { app.innerHTML = `<div class="panel empty">${esc(t("common.notFound"))}</div>`; return; }
    if (p.status !== "pending") { app.innerHTML = `<div class="panel empty">${esc(t("plan.done"))}</div>`; return; }
    title = t("plan.payTitle", { name: p.group_name }); amount = p.amount_cents; summary = `${esc(fmtDate(p.date))} · ${esc(p.time)}`;
  } else if (kind === "cart") {
    let c; try { c = (await api.get(`/api/carts/${encodeURIComponent(id)}`)).cart; } catch { app.innerHTML = `<div class="panel empty">${esc(t("common.notFound"))}</div>`; return; }
    title = t("cart.payTitle"); amount = c.amount_cents;
    summary = c.items.map((x) => `${esc(x.group_name)} · ${esc(fmtDate(x.date))} · ${money(x.deposit_cents)}${x.discount_cents ? ` <span class="tag trust">${esc(t("bun.saved", { amount: money(x.discount_cents) }))}</span>` : ""}`).join("<br>");
  } else if (kind === "pro") { title = t("pro.title"); amount = state.meta.pro_price_cents; summary = esc(t("pro.text", { fee: state.meta.pro_fee_pct, base: state.meta.fee_pct }));
  } else { title = t("pay.featureTitle"); amount = state.meta.feature_price_cents; summary = esc(t("pay.featureText")); }
  app.innerHTML = `<div class="panel narrow"><h1>${esc(title)}</h1><p>${summary}</p><div class="sum strong"><span>${esc(t(kind === "balance" ? "bal.amount" : "pay.amount"))}</span><span>${money(amount)}</span></div>
    <div class="note">${esc(t("pay.testMode"))}</div><div id="payerr" class="err" role="alert"></div><button class="btn wide" id="paybtn">${esc(t("pay.button", { amount: money(amount) }))}</button></div>`;
  document.getElementById("paybtn").onclick = async () => {
    document.getElementById("paybtn").disabled = true;
    try {
      if (kind === "booking") { await api.post(`/api/bookings/${encodeURIComponent(id)}/simulate-pay`); location.hash = `#/booking/${id}?paid=1`; }
      else if (kind === "balance") { await api.post(`/api/bookings/${encodeURIComponent(id)}/simulate-pay-balance`); location.hash = `#/booking/${id}?balance=1`; }
      else if (kind === "part") { const r = await api.post(`/api/parts/${encodeURIComponent(id)}/simulate-pay`); toast(t("plan.thanks")); location.hash = r.part.mine ? `#/booking/${r.part.booking_id}` : "#/bookings"; }
      else if (kind === "cart") { await api.post(`/api/carts/${encodeURIComponent(id)}/simulate-pay`); toast(t("cart.thanks")); location.hash = "#/bookings"; }
      else { const r = await api.post(`/api/feature/${encodeURIComponent(id)}/simulate-pay`); toast(t(kind === "pro" ? "pro.done" : "dash.featured")); location.hash = `#/dashboard?g=${r.group_id}&tab=payments`; }
    } catch (e) { document.getElementById("payerr").textContent = e.message; document.getElementById("paybtn").disabled = false; }
  };
}
